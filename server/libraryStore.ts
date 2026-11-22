import fs from 'node:fs';
import path from 'node:path';
import type {
  ServerSettings,
  TorrentSummary,
  WatchProgressEntry,
} from '../src/types/torrent.ts';

export interface PersistedTorrentRecord {
  infoHash: string;
  name: string;
  magnetURI: string;
  source: 'local-sample' | 'torrent';
  posterUrl?: string;
  addedAt: string;
  lastWatchedAt?: string;
  watchProgress: Record<string, WatchProgressEntry>;
  torrentFileBase64?: string;
}

interface PersistedDatabase {
  settings: ServerSettings;
  torrents: Record<string, PersistedTorrentRecord>;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'library.json');
const DOWNLOAD_DIR = path.join(DATA_DIR, 'torrents');

export function getDefaultSettings(ffmpegAvailable: boolean): ServerSettings {
  return {
    defaultPlaybackMode: 'auto',
    transcodeQuality: '720p',
    maxConnections: 60,
    seedAfterComplete: false,
    autoSelectSubtitles: true,
    downloadDir: DOWNLOAD_DIR,
    ffmpegAvailable,
    serverPort: 3000,
  };
}

export class LibraryStore {
  private db: PersistedDatabase;

  constructor(ffmpegAvailable: boolean) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    this.db = this.load(ffmpegAvailable);
  }

  private load(ffmpegAvailable: boolean): PersistedDatabase {
    const defaults = getDefaultSettings(ffmpegAvailable);
    if (!fs.existsSync(DB_PATH)) {
      const initial: PersistedDatabase = {
        settings: defaults,
        torrents: {},
      };
      this.writeToDisk(initial);
      return initial;
    }

    try {
      const raw = fs.readFileSync(DB_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedDatabase>;
      return {
        settings: {
          ...defaults,
          ...(parsed.settings ?? {}),
          ffmpegAvailable,
          serverPort: 3000,
        },
        torrents: parsed.torrents ?? {},
      };
    } catch {
      return {
        settings: defaults,
        torrents: {},
      };
    }
  }

  private writeToDisk(data: PersistedDatabase): void {
    const tempPath = `${DB_PATH}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempPath, DB_PATH);
  }

  private save(): void {
    this.writeToDisk(this.db);
  }

  getSettings(): ServerSettings {
    return { ...this.db.settings };
  }

  updateSettings(patch: Partial<ServerSettings>): ServerSettings {
    this.db.settings = {
      ...this.db.settings,
      ...patch,
      // Runtime-detected fields remain server-owned
      ffmpegAvailable: this.db.settings.ffmpegAvailable,
      serverPort: 3000,
    };
    this.save();
    return this.getSettings();
  }

  getAllRecords(): PersistedTorrentRecord[] {
    return Object.values(this.db.torrents);
  }

  getRecord(infoHash: string): PersistedTorrentRecord | undefined {
    return this.db.torrents[infoHash.toLowerCase()];
  }

  upsertRecord(record: PersistedTorrentRecord): void {
    const key = record.infoHash.toLowerCase();
    const existing = this.db.torrents[key];
    this.db.torrents[key] = {
      ...existing,
      ...record,
      infoHash: key,
      watchProgress: {
        ...(existing?.watchProgress ?? {}),
        ...(record.watchProgress ?? {}),
      },
    };
    this.save();
  }

  updateWatchProgress(
    infoHash: string,
    fileIndex: number,
    currentTime: number,
    duration: number
  ): WatchProgressEntry | null {
    const key = infoHash.toLowerCase();
    const rec = this.db.torrents[key];
    if (!rec) return null;

    const now = new Date().toISOString();
    const entry: WatchProgressEntry = {
      fileIndex,
      currentTime: Math.max(0, currentTime),
      duration: Math.max(0, duration),
      updatedAt: now,
    };
    rec.watchProgress[String(fileIndex)] = entry;
    rec.lastWatchedAt = now;
    this.save();
    return entry;
  }

  removeRecord(infoHash: string): void {
    const key = infoHash.toLowerCase();
    if (this.db.torrents[key]) {
      delete this.db.torrents[key];
      this.save();
    }
  }

  mergePersistedIntoSummary(summary: TorrentSummary): TorrentSummary {
    const rec = this.getRecord(summary.infoHash);
    if (!rec) return summary;
    return {
      ...summary,
      addedAt: rec.addedAt || summary.addedAt,
      lastWatchedAt: rec.lastWatchedAt,
      posterUrl: rec.posterUrl || summary.posterUrl,
      watchProgress: rec.watchProgress ?? {},
    };
  }
}
