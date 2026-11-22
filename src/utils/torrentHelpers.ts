import type {
  FileTreeNode,
  MediaKind,
  ParsedTorrentInput,
  TorrentFileItem,
} from '../types/torrent';

const DEFAULT_PUBLIC_TRACKERS = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
];

const NATIVE_VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'webm', 'ogv']);
const TRANSCODE_VIDEO_EXTENSIONS = new Set([
  'mkv',
  'avi',
  'mov',
  'wmv',
  'flv',
  'ts',
  'm2ts',
  'mpg',
  'mpeg',
  'vob',
  '3gp',
]);
const AUDIO_EXTENSIONS = new Set(['mp3', 'aac', 'flac', 'ogg', 'wav', 'm4a', 'opus']);
const SUBTITLE_EXTENSIONS = new Set(['srt', 'vtt', 'ass', 'ssa', 'sub']);

const MIME_BY_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  mov: 'video/quicktime',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  ts: 'video/mp2t',
  m2ts: 'video/mp2t',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  opus: 'audio/opus',
  srt: 'application/x-subrip',
  vtt: 'text/vtt',
  ass: 'text/x-ssa',
  ssa: 'text/x-ssa',
};

const LANGUAGE_PATTERNS: Array<{ code: string; label: string; regex: RegExp }> = [
  { code: 'en', label: 'English', regex: /(?:^|[._\-\s])(en|eng|english)(?:[._\-\s]|$)/i },
  { code: 'es', label: 'Spanish', regex: /(?:^|[._\-\s])(es|spa|spanish|esp)(?:[._\-\s]|$)/i },
  { code: 'fr', label: 'French', regex: /(?:^|[._\-\s])(fr|fre|fra|french)(?:[._\-\s]|$)/i },
  { code: 'de', label: 'German', regex: /(?:^|[._\-\s])(de|ger|deu|german)(?:[._\-\s]|$)/i },
  { code: 'ja', label: 'Japanese', regex: /(?:^|[._\-\s])(ja|jpn|japanese)(?:[._\-\s]|$)/i },
  { code: 'ko', label: 'Korean', regex: /(?:^|[._\-\s])(ko|kor|korean)(?:[._\-\s]|$)/i },
  { code: 'pt', label: 'Portuguese', regex: /(?:^|[._\-\s])(pt|por|portuguese)(?:[._\-\s]|$)/i },
  { code: 'it', label: 'Italian', regex: /(?:^|[._\-\s])(it|ita|italian)(?:[._\-\s]|$)/i },
];

export function detectLanguageHint(filename: string): string | undefined {
  const withoutExt = filename.replace(/\.[^.]+$/, '');
  for (const entry of LANGUAGE_PATTERNS) {
    if (entry.regex.test(withoutExt)) {
      return entry.label;
    }
  }
  return undefined;
}

export function classifyMediaFile(filename: string): {
  kind: MediaKind;
  extension: string;
  browserNative: boolean;
  needsTranscode: boolean;
  mimeType: string;
  languageHint?: string;
} {
  const parts = filename.toLowerCase().split('.');
  const extension = parts.length > 1 ? parts[parts.length - 1] : '';
  const mimeType = MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';

  if (NATIVE_VIDEO_EXTENSIONS.has(extension)) {
    return {
      kind: 'video',
      extension,
      browserNative: true,
      needsTranscode: false,
      mimeType,
    };
  }

  if (TRANSCODE_VIDEO_EXTENSIONS.has(extension)) {
    return {
      kind: 'video',
      extension,
      browserNative: false,
      needsTranscode: true,
      mimeType,
    };
  }

  if (AUDIO_EXTENSIONS.has(extension)) {
    return {
      kind: 'audio',
      extension,
      browserNative: extension !== 'flac',
      needsTranscode: extension === 'flac',
      mimeType,
    };
  }

  if (SUBTITLE_EXTENSIONS.has(extension)) {
    return {
      kind: 'subtitle',
      extension,
      browserNative: extension === 'vtt',
      needsTranscode: false,
      mimeType,
      languageHint: detectLanguageHint(filename),
    };
  }

  return {
    kind: 'other',
    extension,
    browserNative: false,
    needsTranscode: false,
    mimeType,
  };
}

export function extractReleaseMeta(filename: string): {
  cleanTitle: string;
  resolution?: string;
  episodeTag?: string;
  codecHint?: string;
} {
  const base = filename.replace(/\.[^.]+$/, '');
  const resolutionMatch = base.match(/\b(2160p|4K|1080p|720p|480p)\b/i);
  const episodeMatch = base.match(/\b(S\d{1,2}E\d{1,2})\b/i);
  const codecMatch = base.match(/\b(x264|x265|H\.?264|H\.?265|HEVC|AV1|VP9)\b/i);

  const cleanTitle = base
    .replace(/[._]+/g, ' ')
    .replace(/\b(2160p|4K|1080p|720p|480p|BluRay|WEB-DL|WEBRip|HDRip|x264|x265|H264|H265|HEVC|AAC|AC3|DTS|REMUX)\b/gi, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return {
    cleanTitle: cleanTitle || base,
    resolution: resolutionMatch ? resolutionMatch[1].toUpperCase() : undefined,
    episodeTag: episodeMatch ? episodeMatch[1].toUpperCase() : undefined,
    codecHint: codecMatch ? codecMatch[1].toUpperCase().replace('.', '') : undefined,
  };
}

export function parseMagnetOrHash(rawInput: string): ParsedTorrentInput {
  const input = rawInput.trim();
  if (!input) {
    return {
      valid: false,
      infoHash: '',
      magnetURI: '',
      displayName: '',
      trackers: [],
      error: 'Paste a magnet link or 40-character torrent infoHash to start streaming.',
    };
  }

  // Raw 40-char hex infoHash or 32-char base32 infoHash
  if (/^[a-fA-F0-9]{40}$/.test(input) || /^[A-Z2-7]{32}$/i.test(input)) {
    const infoHash = input.toLowerCase();
    const trackerQuery = DEFAULT_PUBLIC_TRACKERS.map(
      (tr) => `&tr=${encodeURIComponent(tr)}`
    ).join('');
    return {
      valid: true,
      infoHash,
      magnetURI: `magnet:?xt=urn:btih:${infoHash}${trackerQuery}`,
      displayName: `Torrent ${infoHash.slice(0, 8)}`,
      trackers: [...DEFAULT_PUBLIC_TRACKERS],
    };
  }

  if (!input.toLowerCase().startsWith('magnet:?')) {
    return {
      valid: false,
      infoHash: '',
      magnetURI: '',
      displayName: '',
      trackers: [],
      error: 'Invalid format. Enter a magnet:?xt=urn:btih:... URI, an infoHash, or drop a .torrent file.',
    };
  }

  const queryString = input.slice('magnet:?'.length);
  const params = new URLSearchParams(queryString);
  const xtValues = params.getAll('xt');
  const btihEntry = xtValues.find((v) => v.toLowerCase().startsWith('urn:btih:'));

  if (!btihEntry) {
    return {
      valid: false,
      infoHash: '',
      magnetURI: '',
      displayName: '',
      trackers: [],
      error: 'Magnet link is missing a valid BitTorrent infoHash (xt=urn:btih:...).',
    };
  }

  const rawHash = btihEntry.slice('urn:btih:'.length).trim();
  if (!/^[a-fA-F0-9]{40}$/.test(rawHash) && !/^[A-Z2-7]{32}$/i.test(rawHash)) {
    return {
      valid: false,
      infoHash: '',
      magnetURI: '',
      displayName: '',
      trackers: [],
      error: 'Magnet link infoHash must be 40 hex characters or 32 base32 characters.',
    };
  }

  const infoHash = rawHash.toLowerCase();
  const displayName = (params.get('dn') || `Torrent ${infoHash.slice(0, 8)}`).trim();
  const trackers = Array.from(new Set([...params.getAll('tr'), ...DEFAULT_PUBLIC_TRACKERS]));

  return {
    valid: true,
    infoHash,
    magnetURI: input,
    displayName,
    trackers,
  };
}

export function buildFileTree(files: TorrentFileItem[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];

  for (const file of files) {
    const normalizedPath = file.path.replace(/\\/g, '/').replace(/^\/+/, '');
    const segments = normalizedPath.split('/').filter(Boolean);
    if (segments.length === 0) continue;

    let currentLevel = root;
    let accumulatedPath = '';

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${segment}` : segment;
      const isLeaf = i === segments.length - 1;

      if (isLeaf) {
        currentLevel.push({
          name: segment,
          path: accumulatedPath,
          type: 'file',
          file,
          children: [],
        });
      } else {
        let folder = currentLevel.find(
          (node) => node.type === 'folder' && node.name === segment
        );
        if (!folder) {
          folder = {
            name: segment,
            path: accumulatedPath,
            type: 'folder',
            children: [],
          };
          currentLevel.push(folder);
        }
        currentLevel = folder.children;
      }
    }
  }

  const sortNodes = (nodes: FileTreeNode[]): FileTreeNode[] => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      if (a.file && b.file) {
        const rank = (k: MediaKind) =>
          k === 'video' ? 0 : k === 'subtitle' ? 1 : k === 'audio' ? 2 : 3;
        const rDiff = rank(a.file.kind) - rank(b.file.kind);
        if (rDiff !== 0) return rDiff;
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
    for (const node of nodes) {
      if (node.children.length > 0) sortNodes(node.children);
    }
    return nodes;
  };

  return sortNodes(root);
}

export function pickPrimaryVideoFile(files: TorrentFileItem[]): TorrentFileItem | undefined {
  const videos = files.filter((f) => f.kind === 'video');
  if (videos.length === 0) return undefined;
  return [...videos].sort((a, b) => b.length - a.length)[0];
}

export function convertSrtToVtt(srtContent: string): string {
  const normalized = srtContent.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (normalized.trimStart().startsWith('WEBVTT')) {
    return normalized;
  }

  const converted = normalized
    // Convert SRT timestamps 00:00:01,500 --> 00:00:04,000 to WebVTT 00:00:01.500 --> 00:00:04.000
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2 --> $3.$4')
    // Also handle single-digit hour timestamps like 0:01:02,300
    .replace(/(\d:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d:\d{2}:\d{2}),(\d{3})/g, '0$1.$2 --> 0$3.$4');

  return `WEBVTT\n\n${converted.trim()}\n`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exp);
  const decimals = exp >= 3 ? 2 : exp >= 2 ? 1 : 0;
  return `${value.toFixed(decimals)} ${units[exp]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0 B/s';
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Resolves the true full video duration.
 * Live fragmented MP4 transcodes expose only buffered seconds via video.duration
 * (e.g. 0:10 on a 24:00 episode), so ffprobe's container duration takes precedence.
 */
export function resolveEffectiveDuration(
  videoDuration: number,
  probeDuration: number,
  isLiveFragmented: boolean
): number {
  const safeVideo = Number.isFinite(videoDuration) && videoDuration > 0 ? videoDuration : 0;
  const safeProbe = Number.isFinite(probeDuration) && probeDuration > 0 ? probeDuration : 0;

  if (isLiveFragmented) {
    if (safeProbe > 0) return Math.max(safeProbe, safeVideo);
    return safeVideo;
  }

  if (safeProbe > 0 && safeVideo > 0) {
    // Prefer the larger value if the browser reports a partial/growing duration
    return Math.max(safeProbe, safeVideo);
  }
  return safeProbe || safeVideo;
}

export function computeBufferAhead(
  currentTime: number,
  ranges: Array<{ start: number; end: number }>
): { aheadSeconds: number; bufferedEnd: number } {
  if (!ranges.length || !Number.isFinite(currentTime)) {
    return { aheadSeconds: 0, bufferedEnd: 0 };
  }

  let maxEnd = 0;
  let activeAhead = 0;

  for (const r of ranges) {
    if (r.end > maxEnd) maxEnd = r.end;
    if (currentTime >= r.start - 0.5 && currentTime <= r.end) {
      activeAhead = Math.max(activeAhead, r.end - currentTime);
    }
  }

  return {
    aheadSeconds: Number(Math.max(0, activeAhead).toFixed(1)),
    bufferedEnd: Number(Math.max(0, maxEnd).toFixed(2)),
  };
}

export function buildPieceMapBuckets(pieceFlags: boolean[], bucketCount = 48): number[] {
  const safeBuckets = Math.max(1, bucketCount);
  if (pieceFlags.length === 0) {
    return new Array<number>(safeBuckets).fill(0);
  }

  const result: number[] = [];
  for (let b = 0; b < safeBuckets; b++) {
    const start = Math.floor((b * pieceFlags.length) / safeBuckets);
    const end = Math.max(start + 1, Math.floor(((b + 1) * pieceFlags.length) / safeBuckets));
    let done = 0;
    const total = Math.min(pieceFlags.length, end) - start;
    for (let i = start; i < Math.min(pieceFlags.length, end); i++) {
      if (pieceFlags[i]) done++;
    }
    result.push(total > 0 ? Number((done / total).toFixed(2)) : 0);
  }
  return result;
}

