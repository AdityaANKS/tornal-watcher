import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFileTree,
  buildPieceMapBuckets,
  classifyMediaFile,
  computeBufferAhead,
  convertSrtToVtt,
  extractReleaseMeta,
  formatBytes,
  formatDuration,
  formatSpeed,
  parseMagnetOrHash,
  pickPrimaryVideoFile,
  resolveEffectiveDuration,
} from './torrentHelpers';
import type { TorrentFileItem } from '../types/torrent';

test('parseMagnetOrHash validates valid magnet URIs and extracts fields', () => {
  const hash = 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';
  const magnet = `magnet:?xt=urn:btih:${hash}&dn=Big+Buck+Bunny&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337`;
  const parsed = parseMagnetOrHash(magnet);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.infoHash, hash);
  assert.equal(parsed.displayName, 'Big Buck Bunny');
  assert.ok(parsed.trackers.length >= 1);
});

test('parseMagnetOrHash accepts bare 40-char hex infoHash', () => {
  const hash = 'A1B2C3D4E5F60718293A4B5C6D7E8F9012345678';
  const parsed = parseMagnetOrHash(hash);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.infoHash, hash.toLowerCase());
  assert.ok(parsed.magnetURI.startsWith(`magnet:?xt=urn:btih:${hash.toLowerCase()}`));
});

test('parseMagnetOrHash rejects empty or malformed strings', () => {
  assert.equal(parseMagnetOrHash('').valid, false);
  assert.equal(parseMagnetOrHash('https://example.com/video.mp4').valid, false);
  assert.equal(parseMagnetOrHash('magnet:?xt=urn:btih:tooshort').valid, false);
});

test('classifyMediaFile distinguishes direct-play vs transcode video and subtitles', () => {
  const mp4 = classifyMediaFile('Alpine.Dusk.720p.mp4');
  assert.equal(mp4.kind, 'video');
  assert.equal(mp4.browserNative, true);
  assert.equal(mp4.needsTranscode, false);

  const mkv = classifyMediaFile('Midnight.Transit.1080p.HEVC.mkv');
  assert.equal(mkv.kind, 'video');
  assert.equal(mkv.browserNative, false);
  assert.equal(mkv.needsTranscode, true);

  const srt = classifyMediaFile('Midnight.Transit.en.srt');
  assert.equal(srt.kind, 'subtitle');
  assert.equal(srt.languageHint, 'English');
});

test('extractReleaseMeta cleans filenames and extracts resolution and episode tags', () => {
  const meta = extractReleaseMeta('Dark.Matter.S01E04.1080p.WEB-DL.x265.mkv');
  assert.equal(meta.resolution, '1080P');
  assert.equal(meta.episodeTag, 'S01E04');
  assert.equal(meta.codecHint, 'X265');
  assert.equal(meta.cleanTitle, 'Dark Matter S01E04');
});

test('convertSrtToVtt converts SRT timestamps to WebVTT cleanly', () => {
  const srt = `1\r\n00:00:01,250 --> 00:00:04,500\r\nHello world.\r\n\r\n2\r\n00:00:05,000 --> 00:00:08,750\r\nSecond cue.\r\n`;
  const vtt = convertSrtToVtt(srt);
  assert.ok(vtt.startsWith('WEBVTT\n\n'));
  assert.ok(vtt.includes('00:00:01.250 --> 00:00:04.500'));
  assert.ok(vtt.includes('00:00:05.000 --> 00:00:08.750'));
});

test('buildFileTree creates nested folder hierarchy sorted with videos first', () => {
  const files: TorrentFileItem[] = [
    {
      index: 0,
      name: 'notes.txt',
      path: 'Movie/notes.txt',
      length: 512,
      downloaded: 512,
      progress: 1,
      kind: 'other',
      extension: 'txt',
      browserNative: false,
      needsTranscode: false,
      mimeType: 'application/octet-stream',
    },
    {
      index: 1,
      name: 'feature.mkv',
      path: 'Movie/feature.mkv',
      length: 900_000_000,
      downloaded: 900_000_000,
      progress: 1,
      kind: 'video',
      extension: 'mkv',
      browserNative: false,
      needsTranscode: true,
      mimeType: 'video/x-matroska',
    },
    {
      index: 2,
      name: 'en.srt',
      path: 'Movie/Subs/en.srt',
      length: 4096,
      downloaded: 4096,
      progress: 1,
      kind: 'subtitle',
      extension: 'srt',
      browserNative: false,
      needsTranscode: false,
      mimeType: 'application/x-subrip',
      languageHint: 'English',
    },
  ];

  const tree = buildFileTree(files);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].name, 'Movie');
  assert.equal(tree[0].children[0].type, 'folder');
  assert.equal(tree[0].children[0].name, 'Subs');
  assert.equal(tree[0].children[1].name, 'feature.mkv');

  const primary = pickPrimaryVideoFile(files);
  assert.equal(primary?.index, 1);
});

test('formatters output clean human-readable tabular units', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024 * 1024 * 12.5), '12.5 MB');
  assert.equal(formatSpeed(1024 * 1024 * 4.2), '4.2 MB/s');
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(1440), '24:00');
  assert.equal(formatDuration(3661), '1:01:01');
});

test('resolveEffectiveDuration preserves full 24-min probe duration over 10s fragmented MP4 buffer', () => {
  // 24 min = 1440s probed, browser fragmented MP4 reports only 10s buffered
  assert.equal(resolveEffectiveDuration(10, 1440, true), 1440);
  // Infinity browser duration on live stream falls back to probe duration
  assert.equal(resolveEffectiveDuration(Infinity, 1440, true), 1440);
  // Direct play where probe hasn't finished yet still uses video.duration
  assert.equal(resolveEffectiveDuration(1445, 0, false), 1445);
});

test('computeBufferAhead calculates exact buffered seconds ahead of playhead', () => {
  const res = computeBufferAhead(120, [
    { start: 0, end: 30 },
    { start: 100, end: 156.4 },
  ]);
  assert.equal(res.aheadSeconds, 36.4);
  assert.equal(res.bufferedEnd, 156.4);
});

test('buildPieceMapBuckets maps torrent piece flags into normalized density buckets', () => {
  const flags = [true, true, true, true, false, false, false, false];
  const buckets = buildPieceMapBuckets(flags, 4);
  assert.deepEqual(buckets, [1, 1, 0, 0]);
});
