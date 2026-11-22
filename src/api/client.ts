import type {
  MediaProbeInfo,
  ServerSettings,
  TorrentSummary,
} from '../types/torrent';

async function parseJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}

export async function fetchTorrents(): Promise<TorrentSummary[]> {
  const res = await fetch('/api/torrents');
  const data = await parseJson<{ torrents: TorrentSummary[] }>(res);
  return data.torrents;
}

export async function fetchTorrent(infoHash: string): Promise<TorrentSummary> {
  const res = await fetch(`/api/torrents/${encodeURIComponent(infoHash)}`);
  return parseJson<TorrentSummary>(res);
}

export async function addMagnetTorrent(magnet: string): Promise<TorrentSummary> {
  const res = await fetch('/api/torrents/magnet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ magnet }),
  });
  return parseJson<TorrentSummary>(res);
}

export async function uploadTorrentFile(file: File): Promise<TorrentSummary> {
  const form = new FormData();
  form.append('torrent', file);
  const res = await fetch('/api/torrents/upload', {
    method: 'POST',
    body: form,
  });
  return parseJson<TorrentSummary>(res);
}

export async function togglePauseTorrent(infoHash: string): Promise<TorrentSummary> {
  const res = await fetch(`/api/torrents/${encodeURIComponent(infoHash)}/toggle-pause`, {
    method: 'POST',
  });
  return parseJson<TorrentSummary>(res);
}

export async function removeTorrent(infoHash: string): Promise<void> {
  const res = await fetch(`/api/torrents/${encodeURIComponent(infoHash)}`, {
    method: 'DELETE',
  });
  await parseJson<{ deleted: boolean }>(res);
}

export async function saveWatchProgress(
  infoHash: string,
  fileIndex: number,
  currentTime: number,
  duration: number
): Promise<void> {
  await fetch(`/api/torrents/${encodeURIComponent(infoHash)}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileIndex, currentTime, duration }),
  });
}

export async function probeMediaFile(
  infoHash: string,
  fileIndex: number
): Promise<MediaProbeInfo> {
  const res = await fetch(`/api/probe/${encodeURIComponent(infoHash)}/${fileIndex}`);
  return parseJson<MediaProbeInfo>(res);
}

export async function convertSubtitleFile(file: File): Promise<{ filename: string; vtt: string }> {
  const form = new FormData();
  form.append('subtitle', file);
  const res = await fetch('/api/subtitles/convert', {
    method: 'POST',
    body: form,
  });
  return parseJson<{ filename: string; vtt: string }>(res);
}

export async function fetchServerSettings(): Promise<ServerSettings> {
  const res = await fetch('/api/settings');
  return parseJson<ServerSettings>(res);
}

export async function updateServerSettings(
  patch: Partial<ServerSettings>
): Promise<ServerSettings> {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return parseJson<ServerSettings>(res);
}
