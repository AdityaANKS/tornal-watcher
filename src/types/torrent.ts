export type MediaKind = 'video' | 'audio' | 'subtitle' | 'other';

export type PlaybackMode = 'auto' | 'direct' | 'transcode';

export type TranscodeQuality = 'original' | '1080p' | '720p' | '480p';

export type TorrentStatus =
  | 'ready'
  | 'connecting'
  | 'downloading'
  | 'seeding'
  | 'paused'
  | 'error';

export interface TorrentFileItem {
  index: number;
  name: string;
  path: string;
  length: number;
  downloaded: number;
  progress: number;
  kind: MediaKind;
  extension: string;
  browserNative: boolean;
  needsTranscode: boolean;
  mimeType: string;
  languageHint?: string;
}

export interface WatchProgressEntry {
  fileIndex: number;
  currentTime: number;
  duration: number;
  updatedAt: string;
}

export interface TorrentSummary {
  infoHash: string;
  name: string;
  magnetURI: string;
  source: 'local-sample' | 'torrent';
  status: TorrentStatus;
  posterUrl?: string;
  totalLength: number;
  downloaded: number;
  uploaded: number;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  numPeers: number;
  trackers: string[];
  addedAt: string;
  lastWatchedAt?: string;
  videoCount: number;
  subtitleCount: number;
  files: TorrentFileItem[];
  watchProgress: Record<string, WatchProgressEntry>;
  errorMessage?: string;
}

export interface MediaAudioTrack {
  index: number;
  streamIndex: number;
  codec: string;
  language: string;
  title: string;
  channels: number;
}

export interface MediaSubtitleTrack {
  id: string;
  label: string;
  language: string;
  source: 'sidecar' | 'embedded' | 'uploaded';
  fileIndex?: number;
  streamIndex?: number;
  url: string;
}

export interface MediaProbeInfo {
  duration: number;
  formatName: string;
  bitRate: number;
  videoCodec: string;
  width: number;
  height: number;
  fps: string;
  audioTracks: MediaAudioTrack[];
  embeddedSubtitles: MediaSubtitleTrack[];
  browserCompatible: boolean;
  recommendedMode: 'direct' | 'transcode';
}

export interface ServerSettings {
  defaultPlaybackMode: PlaybackMode;
  transcodeQuality: TranscodeQuality;
  maxConnections: number;
  seedAfterComplete: boolean;
  autoSelectSubtitles: boolean;
  downloadDir: string;
  ffmpegAvailable: boolean;
  serverPort: number;
}

export interface ParsedTorrentInput {
  valid: boolean;
  infoHash: string;
  magnetURI: string;
  displayName: string;
  trackers: string[];
  error?: string;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'folder' | 'file';
  file?: TorrentFileItem;
  children: FileTreeNode[];
}

export interface PipelineEvent {
  id: string;
  timestamp: string;
  stage: 'swarm' | 'server' | 'transcoder' | 'browser';
  message: string;
  detail?: string;
}

export interface ActiveTranscodeInfo {
  active: boolean;
  quality: TranscodeQuality;
  startSeconds: number;
  fps: number;
  speed: string;
  encodedSeconds: number;
}

export interface PipelineSnapshot {
  infoHash: string;
  cacheBytes: number;
  totalBytes: number;
  cachePercent: number;
  verifiedPieces: number;
  totalPieces: number;
  pieceLength: number;
  pieceBuckets: number[];
  activeHttpStreams: number;
  lastRangeBytes: string | null;
  transcode: ActiveTranscodeInfo;
  events: PipelineEvent[];
}

export interface PlayerPlaybackTelemetry {
  isPlaying: boolean;
  isBuffering: boolean;
  hasStarted: boolean;
  currentTime: number;
  duration: number;
  bufferAheadSeconds: number;
  bufferedEndSeconds: number;
  engineMode: 'direct' | 'transcode';
  transportLabel: 'HTTP 206 Range' | 'FFmpeg HLS' | 'FFmpeg Live fMP4';
  quality: TranscodeQuality;
  seekOffset: number;
}

