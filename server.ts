import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { LibraryStore } from './server/libraryStore.ts';
import { TorrentManager } from './server/torrentEngine.ts';
import {
  checkFfmpegAvailable,
  ensureHlsPlaylist,
  extractEmbeddedSubtitleVtt,
  streamTranscodedMp4,
} from './server/transcoder.ts';
import { convertSrtToVtt } from './src/utils/torrentHelpers.ts';
import type { TranscodeQuality } from './src/types/torrent.ts';

const PORT = 3000;
const isProd = process.env.NODE_ENV === 'production';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

async function bootstrap() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const ffmpegAvailable = checkFfmpegAvailable();
  const libraryStore = new LibraryStore(ffmpegAvailable);
  const torrentManager = new TorrentManager(libraryStore);

  // Health & Server Info
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      ffmpegAvailable,
      torrentsCount: torrentManager.listTorrents().length,
    });
  });

  // Settings
  app.get('/api/settings', (_req, res) => {
    res.json(libraryStore.getSettings());
  });

  app.put('/api/settings', (req, res) => {
    const body = req.body ?? {};
    const updated = libraryStore.updateSettings({
      defaultPlaybackMode: body.defaultPlaybackMode,
      transcodeQuality: body.transcodeQuality,
      maxConnections:
        typeof body.maxConnections === 'number'
          ? Math.max(10, Math.min(300, Math.round(body.maxConnections)))
          : undefined,
      seedAfterComplete:
        typeof body.seedAfterComplete === 'boolean' ? body.seedAfterComplete : undefined,
      autoSelectSubtitles:
        typeof body.autoSelectSubtitles === 'boolean' ? body.autoSelectSubtitles : undefined,
    });
    res.json(updated);
  });

  // List Torrents
  app.get('/api/torrents', (_req, res) => {
    res.json({ torrents: torrentManager.listTorrents() });
  });

  // Get Single Torrent Status & Files
  app.get('/api/torrents/:infoHash', (req, res) => {
    const torrent = torrentManager.getTorrent(req.params.infoHash);
    if (!torrent) {
      res.status(404).json({ error: 'Torrent not found on this server.' });
      return;
    }
    res.json(torrent);
  });

  // Add Magnet / InfoHash
  app.post('/api/torrents/magnet', async (req, res) => {
    try {
      const raw = typeof req.body?.magnet === 'string' ? req.body.magnet : '';
      const summary = await torrentManager.addMagnet(raw);
      res.status(201).json(summary);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Unable to add magnet link.',
      });
    }
  });

  // Upload .torrent File
  app.post('/api/torrents/upload', upload.single('torrent'), async (req, res) => {
    try {
      if (!req.file?.buffer) {
        res.status(400).json({ error: 'Please select a valid .torrent file to upload.' });
        return;
      }
      const summary = await torrentManager.addTorrentBuffer(
        req.file.buffer,
        req.file.originalname
      );
      res.status(201).json(summary);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Unable to parse .torrent file.',
      });
    }
  });

  // Pause / Resume Torrent
  app.post('/api/torrents/:infoHash/toggle-pause', (req, res) => {
    const updated = torrentManager.togglePause(req.params.infoHash);
    if (!updated) {
      res.status(404).json({ error: 'Torrent not found.' });
      return;
    }
    res.json(updated);
  });

  // Save Watch Progress
  app.post('/api/torrents/:infoHash/progress', (req, res) => {
    const fileIndex = Number(req.body?.fileIndex ?? 0);
    const currentTime = Number(req.body?.currentTime ?? 0);
    const duration = Number(req.body?.duration ?? 0);
    if (!Number.isFinite(fileIndex) || fileIndex < 0) {
      res.status(400).json({ error: 'Invalid fileIndex.' });
      return;
    }
    const entry = libraryStore.updateWatchProgress(
      req.params.infoHash,
      fileIndex,
      currentTime,
      duration
    );
    if (!entry) {
      res.status(404).json({ error: 'Torrent not found.' });
      return;
    }
    res.json(entry);
  });

  // Delete Torrent
  app.delete('/api/torrents/:infoHash', (req, res) => {
    const ok = torrentManager.removeTorrent(req.params.infoHash);
    if (!ok) {
      res.status(404).json({ error: 'Torrent not found.' });
      return;
    }
    res.json({ deleted: true });
  });

  // Probe Video / Audio / Subtitle Codecs via FFprobe
  app.get('/api/probe/:infoHash/:fileIndex', async (req, res) => {
    try {
      const fileIndex = Number(req.params.fileIndex);
      if (!Number.isInteger(fileIndex) || fileIndex < 0) {
        res.status(400).json({ error: 'Invalid file index.' });
        return;
      }
      const probe = await torrentManager.probeFile(req.params.infoHash, fileIndex);
      if (!probe) {
        res.status(404).json({ error: 'Media file not ready or not found.' });
        return;
      }
      res.json(probe);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Unable to probe media file.',
      });
    }
  });

  // Direct HTTP Range Streaming (RFC 7233 206 Partial Content)
  app.get('/api/stream/:infoHash/:fileIndex', async (req, res) => {
    try {
      const fileIndex = Number(req.params.fileIndex);
      const handle = await torrentManager.resolveFileHandle(req.params.infoHash, fileIndex);
      if (!handle) {
        res.status(404).json({ error: 'Media file not found or still connecting to peers.' });
        return;
      }

      const fileSize = handle.length;
      const rangeHeader = req.headers.range;
      const download = req.query.download === '1';

      if (download) {
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(handle.name)}"`);
      }

      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', handle.mimeType);

      if (rangeHeader) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
        if (!match) {
          res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
          return;
        }
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Math.min(Number(match[2]), fileSize - 1) : fileSize - 1;

        if (start >= fileSize || end >= fileSize || start > end) {
          res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
          return;
        }

        const chunkSize = end - start + 1;
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        res.setHeader('Content-Length', String(chunkSize));

        const stream = handle.createReadStream({ start, end });
        stream.on('error', () => {
          if (!res.headersSent) res.status(500).end();
          else res.end();
        });
        req.on('close', () => {
          if ('destroy' in stream && typeof stream.destroy === 'function') {
            stream.destroy();
          }
        });
        stream.pipe(res);
      } else {
        res.status(200);
        res.setHeader('Content-Length', String(fileSize));
        const stream = handle.createReadStream();
        stream.on('error', () => {
          if (!res.headersSent) res.status(500).end();
          else res.end();
        });
        req.on('close', () => {
          if ('destroy' in stream && typeof stream.destroy === 'function') {
            stream.destroy();
          }
        });
        stream.pipe(res);
      }
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Streaming failed.',
        });
      }
    }
  });

  // On-the-Fly FFmpeg Fragmented MP4 Transcode Stream (Works on live torrents & MKV/AVI/HEVC)
  app.get('/api/transcode/:infoHash/:fileIndex/stream.mp4', async (req, res) => {
    try {
      if (!ffmpegAvailable) {
        res.status(503).json({ error: 'FFmpeg is not installed on this server.' });
        return;
      }

      const fileIndex = Number(req.params.fileIndex);
      const handle = await torrentManager.resolveFileHandle(req.params.infoHash, fileIndex);
      if (!handle) {
        res.status(404).json({ error: 'Media file not found or still connecting.' });
        return;
      }

      const quality = (String(req.query.quality || '720p') as TranscodeQuality);
      const startSeconds = Math.max(0, Number(req.query.start || 0) || 0);
      const audioTrack = Math.max(0, Number(req.query.audioTrack || 0) || 0);

      streamTranscodedMp4({
        req,
        res,
        filePath: handle.localFilePath,
        inputStream: handle.localFilePath ? undefined : handle.createReadStream(),
        quality,
        startSeconds,
        audioTrack,
      });
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Transcoding stream failed.',
        });
      }
    }
  });

  // On-the-Fly FFmpeg HLS Playlist & Segments (for hls.js adaptive/seeking playback)
  app.get('/api/hls/:infoHash/:fileIndex/:quality/:audioTrack/:asset', async (req, res) => {
    try {
      if (!ffmpegAvailable) {
        res.status(503).json({ error: 'FFmpeg is not available.' });
        return;
      }
      const { infoHash, asset } = req.params;
      const fileIndex = Number(req.params.fileIndex);
      const quality = req.params.quality as TranscodeQuality;
      const audioTrack = Math.max(0, Number(req.params.audioTrack) || 0);

      // Sanitize asset filename to prevent path traversal
      if (!/^(index\.m3u8|seg_\d{3}\.ts)$/.test(asset)) {
        res.status(400).json({ error: 'Invalid HLS asset requested.' });
        return;
      }

      const handle = await torrentManager.resolveFileHandle(infoHash, fileIndex);
      if (!handle?.localFilePath) {
        res.status(404).json({ error: 'HLS requires a locally buffered media file; use live MP4 transcode instead.' });
        return;
      }

      const cacheKey = `${infoHash.toLowerCase()}_${fileIndex}_${quality}_a${audioTrack}`;
      const hlsDir = await ensureHlsPlaylist({
        cacheKey,
        filePath: handle.localFilePath,
        quality,
        audioTrack,
      });

      const targetFile = path.join(hlsDir, asset);
      if (!fs.existsSync(targetFile)) {
        res.status(404).json({ error: 'HLS segment not found.' });
        return;
      }

      if (asset.endsWith('.m3u8')) {
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      } else {
        res.setHeader('Content-Type', 'video/mp2t');
      }
      fs.createReadStream(targetFile).pipe(res);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'HLS transcoding error.',
        });
      }
    }
  });

  // Sidecar Subtitle (SRT -> WebVTT Conversion)
  app.get('/api/subtitles/:infoHash/:fileIndex', async (req, res) => {
    try {
      const fileIndex = Number(req.params.fileIndex);
      const vtt = await torrentManager.readSubtitleAsVtt(req.params.infoHash, fileIndex);
      if (vtt === null) {
        res.status(404).send('WEBVTT\n\n');
        return;
      }
      res.status(200);
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      res.send(vtt);
    } catch {
      res.status(500).send('WEBVTT\n\n');
    }
  });

  // Embedded Subtitle Extraction via FFmpeg
  app.get('/api/subtitles/embedded/:infoHash/:fileIndex/:streamIndex', async (req, res) => {
    const fileIndex = Number(req.params.fileIndex);
    const streamIndex = Number(req.params.streamIndex);
    const handle = await torrentManager.resolveFileHandle(req.params.infoHash, fileIndex);
    if (!handle?.localFilePath) {
      res.status(404).send('WEBVTT\n\n');
      return;
    }
    extractEmbeddedSubtitleVtt(handle.localFilePath, streamIndex, res);
  });

  // Convert an uploaded local .srt/.vtt subtitle to WebVTT on the fly
  app.post('/api/subtitles/convert', upload.single('subtitle'), (req, res) => {
    if (!req.file?.buffer) {
      res.status(400).json({ error: 'No subtitle file uploaded.' });
      return;
    }
    const raw = req.file.buffer.toString('utf-8');
    const vtt = convertSrtToVtt(raw);
    res.json({
      filename: req.file.originalname,
      vtt,
    });
  });

  // Frontend Serving (Vite dev middleware in dev, dist/ in production)
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.use((_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`StreamTor private media server running at http://0.0.0.0:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start StreamTor server:', err);
  process.exit(1);
});
