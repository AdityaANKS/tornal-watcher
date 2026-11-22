import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import type { Readable } from 'node:stream';
import type { Request, Response } from 'express';
import type {
  MediaAudioTrack,
  MediaProbeInfo,
  MediaSubtitleTrack,
  TranscodeQuality,
} from '../src/types/torrent.ts';

const execFileAsync = promisify(execFile);
const HLS_CACHE_ROOT = path.resolve(process.cwd(), 'data/hls-cache');

export function checkFfmpegAvailable(): boolean {
  try {
    const res = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return res.status === 0;
  } catch {
    return false;
  }
}

interface FfprobeStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  channels?: number;
  tags?: {
    language?: string;
    title?: string;
  };
}

interface FfprobeOutput {
  format?: {
    duration?: string;
    format_name?: string;
    bit_rate?: string;
  };
  streams?: FfprobeStream[];
}

function parseFrameRate(raw?: string): string {
  if (!raw || raw === '0/0') return '24';
  const [numStr, denStr] = raw.split('/');
  const num = Number(numStr);
  const den = Number(denStr || '1');
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return '24';
  const val = num / den;
  return Number.isInteger(val) ? String(val) : val.toFixed(2);
}

export async function probeLocalFile(
  filePath: string,
  infoHash: string,
  fileIndex: number
): Promise<MediaProbeInfo> {
  const { stdout } = await execFileAsync(
    'ffprobe',
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { timeout: 10_000 }
  );

  const parsed = JSON.parse(stdout) as FfprobeOutput;
  const streams = parsed.streams ?? [];
  const videoStream = streams.find((s) => s.codec_type === 'video');
  const audioStreams = streams.filter((s) => s.codec_type === 'audio');
  const subStreams = streams.filter((s) => s.codec_type === 'subtitle');

  const formatName = parsed.format?.format_name ?? 'unknown';
  const ext = path.extname(filePath).toLowerCase();
  const videoCodec = (videoStream?.codec_name ?? 'unknown').toLowerCase();
  const primaryAudioCodec = (audioStreams[0]?.codec_name ?? 'aac').toLowerCase();

  const nativeContainer =
    ext === '.mp4' ||
    ext === '.m4v' ||
    ext === '.webm' ||
    ext === '.ogv' ||
    (!ext && (formatName.includes('mp4') || formatName === 'webm'));
  const nativeVideo = videoCodec === 'h264' || videoCodec === 'vp8' || videoCodec === 'vp9';
  const nativeAudio =
    audioStreams.length === 0 ||
    primaryAudioCodec === 'aac' ||
    primaryAudioCodec === 'mp3' ||
    primaryAudioCodec === 'opus';

  const browserCompatible = nativeContainer && nativeVideo && nativeAudio;

  const audioTracks: MediaAudioTrack[] = audioStreams.map((stream, idx) => ({
    index: idx,
    streamIndex: stream.index,
    codec: (stream.codec_name ?? 'unknown').toUpperCase(),
    language: stream.tags?.language || `Track ${idx + 1}`,
    title: stream.tags?.title || `Audio ${idx + 1} (${(stream.codec_name ?? '').toUpperCase()})`,
    channels: stream.channels ?? 2,
  }));

  const embeddedSubtitles: MediaSubtitleTrack[] = subStreams.map((stream, idx) => ({
    id: `embedded-${stream.index}`,
    label: stream.tags?.title || stream.tags?.language || `Embedded Track ${idx + 1}`,
    language: stream.tags?.language || 'und',
    source: 'embedded',
    streamIndex: stream.index,
    url: `/api/subtitles/embedded/${infoHash}/${fileIndex}/${stream.index}`,
  }));

  return {
    duration: Number(parsed.format?.duration ?? 0) || 0,
    formatName,
    bitRate: Number(parsed.format?.bit_rate ?? 0) || 0,
    videoCodec: videoCodec.toUpperCase(),
    width: videoStream?.width ?? 0,
    height: videoStream?.height ?? 0,
    fps: parseFrameRate(videoStream?.r_frame_rate),
    audioTracks,
    embeddedSubtitles,
    browserCompatible,
    recommendedMode: browserCompatible ? 'direct' : 'transcode',
  };
}

function getScaleFilter(quality: TranscodeQuality): string | null {
  switch (quality) {
    case '1080p':
      return "scale=-2:'min(1080,ih)'";
    case '720p':
      return "scale=-2:'min(720,ih)'";
    case '480p':
      return "scale=-2:'min(480,ih)'";
    default:
      return null;
  }
}

export function streamTranscodedMp4(options: {
  req: Request;
  res: Response;
  filePath?: string;
  inputStream?: Readable;
  quality: TranscodeQuality;
  startSeconds?: number;
  audioTrack?: number;
}): void {
  const { req, res, filePath, inputStream, quality, startSeconds = 0, audioTrack = 0 } = options;

  const args: string[] = ['-hide_banner', '-loglevel', 'error'];

  if (filePath && startSeconds > 0) {
    args.push('-ss', String(startSeconds));
  }

  if (filePath) {
    args.push('-i', filePath);
  } else {
    args.push('-i', 'pipe:0');
  }

  args.push('-map', '0:v:0', '-map', `0:a:${Math.max(0, audioTrack)}?`);

  const scale = getScaleFilter(quality);
  if (scale) {
    args.push('-vf', scale);
  }

  args.push(
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-tune',
    'zerolatency',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ac',
    '2',
    '-movflags',
    'frag_keyframe+empty_moov+default_base_moof',
    '-f',
    'mp4',
    'pipe:1'
  );

  res.status(200);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Transfer-Encoding', 'chunked');

  const ffmpeg = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });

  if (inputStream && ffmpeg.stdin) {
    inputStream.pipe(ffmpeg.stdin);
    inputStream.on('error', () => {
      ffmpeg.kill('SIGKILL');
    });
    ffmpeg.stdin.on('error', () => {
      // Ignore EPIPE when client disconnects early
    });
  }

  ffmpeg.stdout.pipe(res);

  let stderrBuf = '';
  ffmpeg.stderr.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString('utf-8');
  });

  ffmpeg.on('error', () => {
    if (!res.headersSent) {
      res.status(500).json({ error: 'FFmpeg failed to start transcoding.' });
    } else {
      res.end();
    }
  });

  ffmpeg.on('close', (code) => {
    if (code !== 0 && code !== null && !res.headersSent) {
      res.status(500).json({ error: stderrBuf.trim() || 'Transcoding failed.' });
    }
  });

  req.on('close', () => {
    if (inputStream && 'destroy' in inputStream && typeof inputStream.destroy === 'function') {
      inputStream.destroy();
    }
    if (!ffmpeg.killed) {
      ffmpeg.kill('SIGKILL');
    }
  });
}

const hlsJobs = new Map<string, Promise<string>>();

export async function ensureHlsPlaylist(options: {
  cacheKey: string;
  filePath: string;
  quality: TranscodeQuality;
  audioTrack: number;
}): Promise<string> {
  const { cacheKey, filePath, quality, audioTrack } = options;
  const outDir = path.join(HLS_CACHE_ROOT, cacheKey);
  const playlistPath = path.join(outDir, 'index.m3u8');

  if (fs.existsSync(playlistPath)) {
    return outDir;
  }

  const existingJob = hlsJobs.get(cacheKey);
  if (existingJob) {
    return existingJob;
  }

  const job = (async () => {
    fs.mkdirSync(outDir, { recursive: true });
    const args: string[] = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      filePath,
      '-map',
      '0:v:0',
      '-map',
      `0:a:${Math.max(0, audioTrack)}?`,
    ];

    const scale = getScaleFilter(quality);
    if (scale) {
      args.push('-vf', scale);
    }

    args.push(
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '23',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ac',
      '2',
      '-f',
      'hls',
      '-hls_time',
      '3',
      '-hls_list_size',
      '0',
      '-hls_playlist_type',
      'vod',
      '-hls_segment_filename',
      path.join(outDir, 'seg_%03d.ts'),
      playlistPath
    );

    await execFileAsync('ffmpeg', args, { timeout: 60_000 });
    return outDir;
  })();

  hlsJobs.set(cacheKey, job);
  try {
    return await job;
  } finally {
    hlsJobs.delete(cacheKey);
  }
}

export function extractEmbeddedSubtitleVtt(
  filePath: string,
  streamIndex: number,
  res: Response
): void {
  const ffmpeg = spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      filePath,
      '-map',
      `0:${streamIndex}`,
      '-f',
      'webvtt',
      'pipe:1',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  res.status(200);
  res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
  ffmpeg.stdout.pipe(res);

  ffmpeg.on('error', () => {
    if (!res.headersSent) {
      res.status(500).send('WEBVTT\n\n');
    }
  });
}
