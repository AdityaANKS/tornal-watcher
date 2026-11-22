import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import torrentStream from 'torrent-stream';
import parseTorrent from 'parse-torrent';
import {
  buildPieceMapBuckets,
  classifyMediaFile,
  convertSrtToVtt,
  formatBytes,
  formatDuration,
  parseMagnetOrHash,
} from '../src/utils/torrentHelpers.ts';
import type {
  ActiveTranscodeInfo,
  MediaProbeInfo,
  PipelineEvent,
  PipelineSnapshot,
  TorrentFileItem,
  TorrentStatus,
  TorrentSummary,
} from '../src/types/torrent.ts';
import { LibraryStore } from './libraryStore.ts';
import {
  ensureSampleMediaReady,
  getSampleDescriptors,
  type LocalSampleTorrent,
} from './sampleGenerator.ts';
import { probeMediaSource } from './transcoder.ts';

interface TorrentStreamFile {
  name: string;
  path: string;
  length: number;
  select: () => void;
  deselect: () => void;
  createReadStream: (opts?: { start?: number; end?: number }) => Readable;
}

interface TorrentStreamEngine {
  infoHash: string;
  torrent?: {
    name?: string;
    length?: number;
    pieceLength?: number;
    pieces?: string[];
  };
  bitfield?: {
    get: (index: number) => boolean;
    buffer?: Buffer;
  };
  files: TorrentStreamFile[];
  swarm: {
    downloaded: number;
    uploaded: number;
    downloadSpeed: () => number;
    uploadSpeed: () => number;
    wires: unknown[];
    pause: () => void;
    resume: () => void;
  };
  path: string;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  destroy: (cb?: () => void) => void;
}

interface ManagedTorrentEntry {
  infoHash: string;
  name: string;
  magnetURI: string;
  source: 'local-sample' | 'torrent';
  status: TorrentStatus;
  posterUrl?: string;
  trackers: string[];
  addedAt: string;
  paused: boolean;
  errorMessage?: string;
  engine?: TorrentStreamEngine;
  parsedFiles?: Array<{ name: string; path: string; length: number }>;
  localSample?: LocalSampleTorrent;
  activeHttpStreams: number;
  lastRangeBytes: string | null;
  transcode: ActiveTranscodeInfo;
  events: PipelineEvent[];
}

export interface StreamableFileHandle {
  name: string;
  length: number;
  mimeType: string;
  needsTranscode: boolean;
  localFilePath?: string;
  createReadStream: (range?: { start: number; end: number }) => Readable;
}

export class TorrentManager {
  private entries = new Map<string, ManagedTorrentEntry>();
  private probeCache = new Map<string, MediaProbeInfo>();
  private probeInFlight = new Map<string, Promise<MediaProbeInfo | null>>();
  private store: LibraryStore;

  constructor(store: LibraryStore) {
    this.store = store;
    this.registerLocalSamples();
    this.restorePersistedTorrents();
  }

  private defaultTranscodeState(): ActiveTranscodeInfo {
    return {
      active: false,
      quality: '720p',
      startSeconds: 0,
      fps: 0,
      speed: '0x',
      encodedSeconds: 0,
    };
  }

  recordEvent(
    infoHash: string,
    stage: PipelineEvent['stage'],
    message: string,
    detail?: string
  ): void {
    const entry = this.entries.get(infoHash.toLowerCase());
    if (!entry) return;
    const evt: PipelineEvent = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      stage,
      message,
      detail,
    };
    entry.events.unshift(evt);
    if (entry.events.length > 24) {
      entry.events.length = 24;
    }
  }

  trackHttpStream(infoHash: string, rangeLabel: string, isInternalFfmpeg = false): () => void {
    const entry = this.entries.get(infoHash.toLowerCase());
    if (!entry) return () => {};
    if (!isInternalFfmpeg) {
      entry.activeHttpStreams += 1;
      entry.lastRangeBytes = rangeLabel;
      this.recordEvent(
        infoHash,
        'browser',
        `HTTP 206 byte range requested`,
        rangeLabel
      );
    }
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      if (!isInternalFfmpeg) {
        entry.activeHttpStreams = Math.max(0, entry.activeHttpStreams - 1);
      }
    };
  }

  updateTranscodeTelemetry(infoHash: string, patch: Partial<ActiveTranscodeInfo>): void {
    const entry = this.entries.get(infoHash.toLowerCase());
    if (!entry) return;
    entry.transcode = { ...entry.transcode, ...patch };
  }

  private registerLocalSamples(): void {
    const samples = getSampleDescriptors();
    for (const sample of samples) {
      const hash = sample.infoHash.toLowerCase();
      this.entries.set(hash, {
        infoHash: hash,
        name: sample.name,
        magnetURI: sample.magnetURI,
        source: 'local-sample',
        status: 'ready',
        posterUrl: sample.posterUrl,
        trackers: ['local://private-library'],
        addedAt: sample.addedAt,
        paused: false,
        localSample: sample,
        activeHttpStreams: 0,
        lastRangeBytes: null,
        transcode: this.defaultTranscodeState(),
        events: [
          {
            id: `init-${hash.slice(0, 8)}`,
            timestamp: new Date().toISOString(),
            stage: 'server',
            message: 'Media cached on private server disk',
            detail: '100% verified · ready for instant HTTP 206 or FFmpeg streaming',
          },
        ],
      });

      if (!this.store.getRecord(hash)) {
        this.store.upsertRecord({
          infoHash: hash,
          name: sample.name,
          magnetURI: sample.magnetURI,
          source: 'local-sample',
          posterUrl: sample.posterUrl,
          addedAt: sample.addedAt,
          watchProgress: {},
        });
      }
    }

    // Generate actual playable sample MP4/MKV files asynchronously on startup
    ensureSampleMediaReady().catch((err) => {
      console.error('Sample media generation warning:', err);
    });
  }

  private restorePersistedTorrents(): void {
    const records = this.store.getAllRecords();
    for (const rec of records) {
      const hash = rec.infoHash.toLowerCase();
      if (this.entries.has(hash)) continue;
      if (rec.source === 'local-sample') continue;

      const parsed = parseMagnetOrHash(rec.magnetURI || rec.infoHash);
      const entry: ManagedTorrentEntry = {
        infoHash: hash,
        name: rec.name || parsed.displayName || `Torrent ${hash.slice(0, 8)}`,
        magnetURI: rec.magnetURI || parsed.magnetURI,
        source: 'torrent',
        status: 'paused',
        posterUrl: rec.posterUrl,
        trackers: parsed.trackers,
        addedAt: rec.addedAt,
        paused: true,
        activeHttpStreams: 0,
        lastRangeBytes: null,
        transcode: this.defaultTranscodeState(),
        events: [
          {
            id: `restore-${hash.slice(0, 8)}`,
            timestamp: new Date().toISOString(),
            stage: 'server',
            message: 'Restored saved torrent from private library',
            detail: 'Paused until playback starts',
          },
        ],
      };
      this.entries.set(hash, entry);
    }
  }

  private attachTorrentEngine(
    entry: ManagedTorrentEntry,
    sourceInput: string | Buffer
  ): void {
    const settings = this.store.getSettings();
    const targetDir = path.join(settings.downloadDir, entry.infoHash);
    fs.mkdirSync(targetDir, { recursive: true });

    const engine = (torrentStream as unknown as (
      torrent: string | Buffer,
      opts: Record<string, unknown>
    ) => TorrentStreamEngine)(sourceInput, {
      connections: settings.maxConnections,
      uploads: settings.seedAfterComplete ? 6 : 0,
      tmp: settings.downloadDir,
      path: targetDir,
      verify: true,
      dht: true,
      tracker: true,
      trackers: entry.trackers,
    });

    entry.engine = engine;
    entry.status = 'connecting';
    entry.paused = false;

    this.recordEvent(
      entry.infoHash,
      'swarm',
      'Announcing to DHT and BitTorrent trackers',
      `${entry.trackers.length} trackers configured`
    );

    engine.on('ready', () => {
      if (engine.torrent?.name) {
        entry.name = engine.torrent.name;
      }
      entry.status = 'downloading';
      for (const file of engine.files) {
        file.deselect();
      }
      const videoFiles = engine.files
        .filter((f) => classifyMediaFile(f.name).kind === 'video')
        .sort((a, b) => b.length - a.length);
      if (videoFiles[0]) {
        videoFiles[0].select();
      }

      const totalSize = engine.files.reduce((s, f) => s + f.length, 0);
      this.recordEvent(
        entry.infoHash,
        'swarm',
        `Metadata received (${engine.files.length} files)`,
        `${formatBytes(totalSize)} · prioritizing sequential video header pieces`
      );

      this.store.upsertRecord({
        infoHash: entry.infoHash,
        name: entry.name,
        magnetURI: entry.magnetURI,
        source: 'torrent',
        addedAt: entry.addedAt,
        watchProgress: {},
      });
    });

    engine.on('idle', () => {
      if (!entry.paused) {
        entry.status = settings.seedAfterComplete ? 'seeding' : 'ready';
        this.recordEvent(
          entry.infoHash,
          'server',
          'All prioritized video pieces cached to server disk',
          settings.seedAfterComplete ? 'Seeding enabled' : 'Ready for instant local seeking'
        );
      }
    });
  }

  async addMagnet(rawInput: string): Promise<TorrentSummary> {
    const parsed = parseMagnetOrHash(rawInput);
    if (!parsed.valid) {
      throw new Error(parsed.error || 'Invalid magnet link or infoHash.');
    }

    const existing = this.entries.get(parsed.infoHash);
    if (existing) {
      if (existing.source === 'torrent' && !existing.engine) {
        this.attachTorrentEngine(existing, existing.magnetURI);
      }
      return this.toSummary(existing);
    }

    const now = new Date().toISOString();
    const entry: ManagedTorrentEntry = {
      infoHash: parsed.infoHash,
      name: parsed.displayName,
      magnetURI: parsed.magnetURI,
      source: 'torrent',
      status: 'connecting',
      trackers: parsed.trackers,
      addedAt: now,
      paused: false,
      activeHttpStreams: 0,
      lastRangeBytes: null,
      transcode: this.defaultTranscodeState(),
      events: [],
    };

    this.entries.set(parsed.infoHash, entry);
    this.store.upsertRecord({
      infoHash: entry.infoHash,
      name: entry.name,
      magnetURI: entry.magnetURI,
      source: 'torrent',
      addedAt: now,
      watchProgress: {},
    });

    this.attachTorrentEngine(entry, entry.magnetURI);
    return this.toSummary(entry);
  }

  async addTorrentBuffer(buffer: Buffer, originalFilename?: string): Promise<TorrentSummary> {
    const parsed = await (parseTorrent as unknown as (buf: Buffer) => Promise<{
      infoHash?: string;
      name?: string;
      announce?: string[];
      files?: Array<{ name: string; path: string; length: number }>;
    }>)(buffer);

    if (!parsed?.infoHash) {
      throw new Error('Could not parse .torrent file. Ensure the file is a valid BitTorrent metainfo file.');
    }

    const infoHash = parsed.infoHash.toLowerCase();
    const existing = this.entries.get(infoHash);
    if (existing) {
      if (existing.source === 'torrent' && !existing.engine) {
        this.attachTorrentEngine(existing, buffer);
      }
      return this.toSummary(existing);
    }

    const trackers = Array.isArray(parsed.announce) ? parsed.announce : [];
    const name =
      parsed.name ||
      (originalFilename ? originalFilename.replace(/\.torrent$/i, '') : `Torrent ${infoHash.slice(0, 8)}`);
    const magnetURI = `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name)}`;
    const now = new Date().toISOString();

    const entry: ManagedTorrentEntry = {
      infoHash,
      name,
      magnetURI,
      source: 'torrent',
      status: 'connecting',
      trackers,
      addedAt: now,
      paused: false,
      parsedFiles: parsed.files?.map((f) => ({
        name: f.name,
        path: f.path,
        length: f.length,
      })),
      activeHttpStreams: 0,
      lastRangeBytes: null,
      transcode: this.defaultTranscodeState(),
      events: [],
    };

    this.entries.set(infoHash, entry);
    this.store.upsertRecord({
      infoHash,
      name,
      magnetURI,
      source: 'torrent',
      addedAt: now,
      watchProgress: {},
      torrentFileBase64: buffer.length < 512_000 ? buffer.toString('base64') : undefined,
    });

    this.attachTorrentEngine(entry, buffer);
    return this.toSummary(entry);
  }

  listTorrents(): TorrentSummary[] {
    const summaries = Array.from(this.entries.values()).map((entry) => this.toSummary(entry));
    return summaries.sort((a, b) => {
      const aTime = new Date(a.lastWatchedAt || a.addedAt).getTime();
      const bTime = new Date(b.lastWatchedAt || b.addedAt).getTime();
      return bTime - aTime;
    });
  }

  getTorrent(infoHash: string): TorrentSummary | undefined {
    const entry = this.entries.get(infoHash.toLowerCase());
    if (!entry) return undefined;
    return this.toSummary(entry);
  }

  togglePause(infoHash: string): TorrentSummary | undefined {
    const entry = this.entries.get(infoHash.toLowerCase());
    if (!entry) return undefined;
    if (entry.source === 'local-sample') {
      return this.toSummary(entry);
    }

    if (entry.paused) {
      entry.paused = false;
      if (!entry.engine) {
        const rec = this.store.getRecord(entry.infoHash);
        const input = rec?.torrentFileBase64
          ? Buffer.from(rec.torrentFileBase64, 'base64')
          : entry.magnetURI;
        this.attachTorrentEngine(entry, input);
      } else {
        entry.engine.swarm.resume();
        entry.status = entry.engine.files.length > 0 ? 'downloading' : 'connecting';
      }
    } else {
      entry.paused = true;
      entry.status = 'paused';
      entry.engine?.swarm.pause();
    }

    return this.toSummary(entry);
  }

  removeTorrent(infoHash: string): boolean {
    const key = infoHash.toLowerCase();
    const entry = this.entries.get(key);
    if (!entry) return false;

    if (entry.engine) {
      try {
        entry.engine.destroy();
      } catch {
        // Ignore cleanup errors
      }
    }

    this.entries.delete(key);
    this.store.removeRecord(key);
    return true;
  }

  async resolveFileHandle(
    infoHash: string,
    fileIndex: number
  ): Promise<StreamableFileHandle | null> {
    const entry = this.entries.get(infoHash.toLowerCase());
    if (!entry) return null;

    if (entry.localSample) {
      await ensureSampleMediaReady();
      const sampleFile = entry.localSample.files[fileIndex];
      if (!sampleFile || !fs.existsSync(sampleFile.absolutePath)) return null;
      const stat = fs.statSync(sampleFile.absolutePath);
      const cls = classifyMediaFile(sampleFile.name);
      return {
        name: sampleFile.name,
        length: stat.size,
        mimeType: cls.mimeType,
        needsTranscode: cls.needsTranscode,
        localFilePath: sampleFile.absolutePath,
        createReadStream: (range) =>
          range
            ? fs.createReadStream(sampleFile.absolutePath, {
                start: range.start,
                end: range.end,
              })
            : fs.createReadStream(sampleFile.absolutePath),
      };
    }

    if (entry.source === 'torrent' && !entry.engine) {
      const rec = this.store.getRecord(entry.infoHash);
      const input = rec?.torrentFileBase64
        ? Buffer.from(rec.torrentFileBase64, 'base64')
        : entry.magnetURI;
      this.attachTorrentEngine(entry, input);
    }

    const engineFile = entry.engine?.files[fileIndex];
    if (!engineFile) return null;

    engineFile.select();
    const cls = classifyMediaFile(engineFile.name);
    const localCandidate = entry.engine?.path
      ? path.join(entry.engine.path, engineFile.path)
      : undefined;
    const isCompleteLocal =
      localCandidate &&
      fs.existsSync(localCandidate) &&
      fs.statSync(localCandidate).size >= engineFile.length;

    return {
      name: engineFile.name,
      length: engineFile.length,
      mimeType: cls.mimeType,
      needsTranscode: cls.needsTranscode,
      localFilePath: isCompleteLocal ? localCandidate : undefined,
      createReadStream: (range) =>
        engineFile.createReadStream(range ? { start: range.start, end: range.end } : undefined),
    };
  }

  async readSubtitleAsVtt(infoHash: string, fileIndex: number): Promise<string | null> {
    const handle = await this.resolveFileHandle(infoHash, fileIndex);
    if (!handle) return null;

    if (handle.localFilePath) {
      const raw = fs.readFileSync(handle.localFilePath, 'utf-8');
      return convertSrtToVtt(raw);
    }

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = handle.createReadStream();
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(convertSrtToVtt(raw));
      });
      stream.on('error', reject);
    });
  }

  async probeFile(infoHash: string, fileIndex: number): Promise<MediaProbeInfo | null> {
    const cacheKey = `${infoHash.toLowerCase()}:${fileIndex}`;
    const cached = this.probeCache.get(cacheKey);
    if (cached && cached.duration > 0) {
      return cached;
    }

    const inFlight = this.probeInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const job = (async (): Promise<MediaProbeInfo | null> => {
      const handle = await this.resolveFileHandle(infoHash, fileIndex);
      if (!handle) return null;

      try {
        // Probe local file directly if fully cached, otherwise probe via local HTTP Range stream
        // so ffprobe reads MKV/MP4 headers and discovers the true full duration (e.g. 24:00) immediately!
        const source =
          handle.localFilePath ||
          `http://127.0.0.1:3000/api/stream/${encodeURIComponent(infoHash)}/${fileIndex}`;
        const info = await probeMediaSource(source, handle.name, infoHash, fileIndex);
        if (info.duration > 0) {
          this.probeCache.set(cacheKey, info);
          this.recordEvent(
            infoHash,
            'server',
            `Container inspected (${formatDuration(info.duration)} · ${info.width}×${info.height} ${info.videoCodec})`,
            `${info.audioTracks.length} audio · ${info.recommendedMode === 'transcode' ? 'FFmpeg transcode recommended' : 'Browser native Direct Play'}`
          );
        }
        return info;
      } catch {
        return {
          duration: 0,
          formatName: handle.name.split('.').pop()?.toLowerCase() || 'stream',
          bitRate: 0,
          videoCodec: handle.needsTranscode ? 'TRANSCODE' : 'H264',
          width: 0,
          height: 0,
          fps: '24',
          audioTracks: [
            {
              index: 0,
              streamIndex: 1,
              codec: 'AAC',
              language: 'Default',
              title: 'Primary Audio Track',
              channels: 2,
            },
          ],
          embeddedSubtitles: [],
          browserCompatible: !handle.needsTranscode,
          recommendedMode: handle.needsTranscode ? 'transcode' : 'direct',
        };
      }
    })();

    this.probeInFlight.set(cacheKey, job);
    try {
      return await job;
    } finally {
      this.probeInFlight.delete(cacheKey);
    }
  }

  getPipelineSnapshot(infoHash: string): PipelineSnapshot | null {
    const entry = this.entries.get(infoHash.toLowerCase());
    if (!entry) return null;

    const summary = this.toSummary(entry);

    if (entry.localSample) {
      const totalBytes = summary.totalLength;
      return {
        infoHash: entry.infoHash,
        cacheBytes: totalBytes,
        totalBytes,
        cachePercent: 100,
        verifiedPieces: 48,
        totalPieces: 48,
        pieceLength: Math.max(1, Math.round(totalBytes / 48)),
        pieceBuckets: new Array<number>(48).fill(1),
        activeHttpStreams: entry.activeHttpStreams,
        lastRangeBytes: entry.lastRangeBytes,
        transcode: { ...entry.transcode },
        events: [...entry.events],
      };
    }

    const engine = entry.engine;
    const totalPieces = engine?.torrent?.pieces?.length ?? 0;
    const pieceLength = engine?.torrent?.pieceLength ?? 0;
    let verifiedPieces = 0;
    let pieceBuckets: number[] = new Array<number>(48).fill(0);

    if (engine?.bitfield && totalPieces > 0) {
      const flags: boolean[] = new Array<boolean>(totalPieces);
      for (let i = 0; i < totalPieces; i++) {
        const has = Boolean(engine.bitfield.get(i));
        flags[i] = has;
        if (has) verifiedPieces++;
      }
      pieceBuckets = buildPieceMapBuckets(flags, 48);
    }

    const totalBytes = summary.totalLength;
    const pieceBasedBytes = verifiedPieces * pieceLength;
    const cacheBytes =
      totalBytes > 0
        ? Math.min(totalBytes, Math.max(summary.downloaded, pieceBasedBytes))
        : summary.downloaded;
    const cachePercent =
      totalBytes > 0 ? Number(((cacheBytes / totalBytes) * 100).toFixed(1)) : 0;

    return {
      infoHash: entry.infoHash,
      cacheBytes,
      totalBytes,
      cachePercent,
      verifiedPieces,
      totalPieces,
      pieceLength,
      pieceBuckets,
      activeHttpStreams: entry.activeHttpStreams,
      lastRangeBytes: entry.lastRangeBytes,
      transcode: { ...entry.transcode },
      events: [...entry.events],
    };
  }

  private toSummary(entry: ManagedTorrentEntry): TorrentSummary {
    let files: TorrentFileItem[] = [];
    let totalLength = 0;
    let downloaded = 0;
    let uploaded = 0;
    let downloadSpeed = 0;
    let uploadSpeed = 0;
    let numPeers = 0;
    let status: TorrentStatus = entry.status;

    if (entry.localSample) {
      files = entry.localSample.files.map((sf, idx) => {
        const size = fs.existsSync(sf.absolutePath) ? fs.statSync(sf.absolutePath).size : 0;
        const cls = classifyMediaFile(sf.name);
        return {
          index: idx,
          name: sf.name,
          path: sf.relativePath,
          length: size,
          downloaded: size,
          progress: size > 0 ? 1 : 0,
          ...cls,
        };
      });
      totalLength = files.reduce((sum, f) => sum + f.length, 0);
      downloaded = totalLength;
      status = 'ready';
    } else if (entry.engine && entry.engine.files.length > 0) {
      const swarm = entry.engine.swarm;
      downloaded = swarm.downloaded || 0;
      uploaded = swarm.uploaded || 0;
      downloadSpeed = entry.paused ? 0 : swarm.downloadSpeed() || 0;
      uploadSpeed = entry.paused ? 0 : swarm.uploadSpeed() || 0;
      numPeers = Array.isArray(swarm.wires) ? swarm.wires.length : 0;

      totalLength = entry.engine.files.reduce((sum, f) => sum + f.length, 0);
      const overallProgress = totalLength > 0 ? Math.min(1, downloaded / totalLength) : 0;

      files = entry.engine.files.map((f, idx) => {
        const cls = classifyMediaFile(f.name);
        const fDownloaded = Math.round(f.length * overallProgress);
        return {
          index: idx,
          name: f.name,
          path: f.path,
          length: f.length,
          downloaded: fDownloaded,
          progress: overallProgress,
          ...cls,
        };
      });
    } else if (entry.parsedFiles && entry.parsedFiles.length > 0) {
      totalLength = entry.parsedFiles.reduce((sum, f) => sum + f.length, 0);
      files = entry.parsedFiles.map((f, idx) => {
        const cls = classifyMediaFile(f.name);
        return {
          index: idx,
          name: f.name,
          path: f.path,
          length: f.length,
          downloaded: 0,
          progress: 0,
          ...cls,
        };
      });
      if (entry.engine) {
        numPeers = Array.isArray(entry.engine.swarm.wires)
          ? entry.engine.swarm.wires.length
          : 0;
      }
    } else if (entry.engine) {
      numPeers = Array.isArray(entry.engine.swarm.wires) ? entry.engine.swarm.wires.length : 0;
    }

    const progress =
      entry.localSample
        ? 1
        : totalLength > 0
          ? Math.min(1, downloaded / totalLength)
          : 0;

    const summary: TorrentSummary = {
      infoHash: entry.infoHash,
      name: entry.name,
      magnetURI: entry.magnetURI,
      source: entry.source,
      status,
      posterUrl: entry.posterUrl,
      totalLength,
      downloaded,
      uploaded,
      progress,
      downloadSpeed,
      uploadSpeed,
      numPeers,
      trackers: entry.trackers,
      addedAt: entry.addedAt,
      videoCount: files.filter((f) => f.kind === 'video').length,
      subtitleCount: files.filter((f) => f.kind === 'subtitle').length,
      files,
      watchProgress: {},
      errorMessage: entry.errorMessage,
    };

    return this.store.mergePersistedIntoSummary(summary);
  }
}
