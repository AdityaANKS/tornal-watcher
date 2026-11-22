import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface LocalSampleFile {
  relativePath: string;
  absolutePath: string;
  name: string;
}

export interface LocalSampleTorrent {
  infoHash: string;
  name: string;
  magnetURI: string;
  posterUrl: string;
  addedAt: string;
  files: LocalSampleFile[];
}

const SAMPLES_ROOT = path.resolve(process.cwd(), 'data/samples');

const ALPINE_HASH = '7f4e9a2c1b8d3e6f0a5c4b2d9e8f1a3c5d7e9f01';
const TRANSIT_HASH = '3c8a1d5e9f2b4c6a8d0e1f3a5b7c9d2e4f6a8b12';

const ALPINE_EN_SRT = `1
00:00:00,600 --> 00:00:04,200
[Alpine Dusk — Direct HTTP Range Stream]
Streaming native H.264 / AAC MP4 directly to your browser.

2
00:00:04,600 --> 00:00:09,000
Byte-range seeking requires zero server transcoding CPU,
delivering instant scrubbing across sequential pieces.

3
00:00:09,400 --> 00:00:13,600
SubRip (.srt) subtitle files inside a torrent are automatically
converted to WebVTT on the fly.
`;

const TRANSIT_EN_SRT = `1
00:00:00,600 --> 00:00:04,200
[Midnight Transit — MKV On-the-Fly Transcode]
Matroska (.mkv) containers are transmuxed by FFmpeg for browser playback.

2
00:00:04,600 --> 00:00:09,000
Switch quality caps (Original, 720p, 480p) or audio tracks
directly inside the cinema player without plugins.

3
00:00:09,400 --> 00:00:13,600
Toggle between English and Spanish sidecar subtitles
or upload any local .srt / .vtt track.
`;

const TRANSIT_ES_SRT = `1
00:00:00,600 --> 00:00:04,200
[Tránsito Nocturno — Transcodificación MKV en Vivo]
Los contenedores Matroska (.mkv) se convierten al vuelo con FFmpeg.

2
00:00:04,600 --> 00:00:09,000
Cambia la calidad o las pistas de audio directamente
desde el reproductor del navegador sin complementos.

3
00:00:09,400 --> 00:00:13,600
Alterna entre subtítulos en inglés y español
o carga cualquier archivo .srt o .vtt local.
`;

async function generateVideoFromPoster(options: {
  posterFile: string;
  outputFile: string;
  format: 'mp4' | 'mkv';
  baseFreq: number;
}): Promise<void> {
  if (fs.existsSync(options.outputFile) && fs.statSync(options.outputFile).size > 20_000) {
    return;
  }

  fs.mkdirSync(path.dirname(options.outputFile), { recursive: true });
  const hasPoster = fs.existsSync(options.posterFile);

  const videoInputArgs = hasPoster
    ? ['-loop', '1', '-framerate', '24', '-i', options.posterFile]
    : ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24:duration=14'];

  const audioFilter = `sine=frequency=${options.baseFreq}:duration=14`;

  const videoFilter = hasPoster
    ? "scale=1360:765:force_original_aspect_ratio=increase,crop=1360:765,crop=1280:720:'min(80,t*5.4)':'min(45,t*3)',fade=t=in:st=0:d=1.0,fade=t=out:st=13.0:d=1.0"
    : 'fade=t=in:st=0:d=1.0,fade=t=out:st=13.0:d=1.0';

  const args: string[] = [
    '-y',
    ...videoInputArgs,
    '-f',
    'lavfi',
    '-i',
    audioFilter,
    '-t',
    '14',
    '-vf',
    videoFilter,
    '-af',
    'volume=0.14,afade=t=in:st=0:d=1.2,afade=t=out:st=12.6:d=1.4',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ac',
    '2',
    '-shortest',
  ];

  if (options.format === 'mp4') {
    args.push('-movflags', '+faststart');
  }

  args.push(options.outputFile);

  await execFileAsync('ffmpeg', args, { timeout: 30_000 });
}

let generationPromise: Promise<LocalSampleTorrent[]> | null = null;

export function getSampleDescriptors(): LocalSampleTorrent[] {
  const alpineDir = path.join(SAMPLES_ROOT, 'alpine-dusk');
  const transitDir = path.join(SAMPLES_ROOT, 'midnight-transit');

  return [
    {
      infoHash: ALPINE_HASH,
      name: 'Alpine Dusk (720p Direct MP4 Sample)',
      magnetURI: `magnet:?xt=urn:btih:${ALPINE_HASH}&dn=Alpine+Dusk+720p+H264+AAC`,
      posterUrl: '/src/assets/images/poster_alpine_reel_1795356637256.jpg',
      addedAt: '2026-11-18T18:00:00.000Z',
      files: [
        {
          relativePath: 'Alpine.Dusk.720p/Alpine.Dusk.720p.H264.AAC.mp4',
          absolutePath: path.join(alpineDir, 'Alpine.Dusk.720p.H264.AAC.mp4'),
          name: 'Alpine.Dusk.720p.H264.AAC.mp4',
        },
        {
          relativePath: 'Alpine.Dusk.720p/Subs/Alpine.Dusk.en.srt',
          absolutePath: path.join(alpineDir, 'Alpine.Dusk.en.srt'),
          name: 'Alpine.Dusk.en.srt',
        },
      ],
    },
    {
      infoHash: TRANSIT_HASH,
      name: 'Midnight Transit (720p MKV Transcode Sample)',
      magnetURI: `magnet:?xt=urn:btih:${TRANSIT_HASH}&dn=Midnight+Transit+720p+x264+MKV`,
      posterUrl: '/src/assets/images/poster_noir_transit_1795356640577.jpg',
      addedAt: '2026-11-19T08:30:00.000Z',
      files: [
        {
          relativePath: 'Midnight.Transit.720p/Midnight.Transit.720p.x264.mkv',
          absolutePath: path.join(transitDir, 'Midnight.Transit.720p.x264.mkv'),
          name: 'Midnight.Transit.720p.x264.mkv',
        },
        {
          relativePath: 'Midnight.Transit.720p/Subs/Midnight.Transit.en.srt',
          absolutePath: path.join(transitDir, 'Midnight.Transit.en.srt'),
          name: 'Midnight.Transit.en.srt',
        },
        {
          relativePath: 'Midnight.Transit.720p/Subs/Midnight.Transit.es.srt',
          absolutePath: path.join(transitDir, 'Midnight.Transit.es.srt'),
          name: 'Midnight.Transit.es.srt',
        },
      ],
    },
  ];
}

export function ensureSampleMediaReady(): Promise<LocalSampleTorrent[]> {
  if (generationPromise) return generationPromise;

  generationPromise = (async () => {
    const samples = getSampleDescriptors();
    const alpineDir = path.join(SAMPLES_ROOT, 'alpine-dusk');
    const transitDir = path.join(SAMPLES_ROOT, 'midnight-transit');

    fs.mkdirSync(alpineDir, { recursive: true });
    fs.mkdirSync(transitDir, { recursive: true });

    fs.writeFileSync(path.join(alpineDir, 'Alpine.Dusk.en.srt'), ALPINE_EN_SRT, 'utf-8');
    fs.writeFileSync(path.join(transitDir, 'Midnight.Transit.en.srt'), TRANSIT_EN_SRT, 'utf-8');
    fs.writeFileSync(path.join(transitDir, 'Midnight.Transit.es.srt'), TRANSIT_ES_SRT, 'utf-8');

    const alpinePoster = path.resolve(
      process.cwd(),
      'src/assets/images/poster_alpine_reel_1795356637256.jpg'
    );
    const transitPoster = path.resolve(
      process.cwd(),
      'src/assets/images/poster_noir_transit_1795356640577.jpg'
    );

    await Promise.all([
      generateVideoFromPoster({
        posterFile: alpinePoster,
        outputFile: path.join(alpineDir, 'Alpine.Dusk.720p.H264.AAC.mp4'),
        format: 'mp4',
        baseFreq: 196,
      }),
      generateVideoFromPoster({
        posterFile: transitPoster,
        outputFile: path.join(transitDir, 'Midnight.Transit.720p.x264.mkv'),
        format: 'mkv',
        baseFreq: 164.81,
      }),
    ]);

    return samples;
  })();

  return generationPromise;
}
