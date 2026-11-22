import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  FileText,
  Film,
  Folder,
  Loader2,
  Music,
  Pause,
  Play,
  Subtitles,
  Trash2,
} from 'lucide-react';
import type {
  FileTreeNode,
  MediaProbeInfo,
  MediaSubtitleTrack,
  ServerSettings,
  TorrentFileItem,
  TorrentSummary,
} from '../types/torrent';
import { probeMediaFile } from '../api/client';
import {
  buildFileTree,
  extractReleaseMeta,
  formatBytes,
  formatDuration,
  formatSpeed,
  pickPrimaryVideoFile,
} from '../utils/torrentHelpers';
import { VideoPlayer } from './VideoPlayer';

interface PlayerWorkspaceProps {
  torrent: TorrentSummary;
  settings: ServerSettings;
  onBack: () => void;
  onTogglePause: (infoHash: string) => Promise<void>;
  onRemove: (infoHash: string) => Promise<void>;
}

function FileTreeItem({
  node,
  depth,
  selectedFileIndex,
  activeSubtitleId,
  onSelectFile,
  onSelectSubtitleFile,
}: {
  node: FileTreeNode;
  depth: number;
  selectedFileIndex: number;
  activeSubtitleId: string;
  onSelectFile: (file: TorrentFileItem) => void;
  onSelectSubtitleFile: (file: TorrentFileItem) => void;
}) {
  if (node.type === 'folder') {
    return (
      <div>
        <div
          className="flex items-center gap-2 py-1.5 text-xs font-medium text-[#94A3B8]"
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
        >
          <Folder className="h-3.5 w-3.5 shrink-0 text-[#64748B]" aria-hidden="true" />
          <span className="truncate">{node.name}</span>
        </div>
        <div>
          {node.children.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedFileIndex={selectedFileIndex}
              activeSubtitleId={activeSubtitleId}
              onSelectFile={onSelectFile}
              onSelectSubtitleFile={onSelectSubtitleFile}
            />
          ))}
        </div>
      </div>
    );
  }

  const file = node.file!;
  const isSelected = file.index === selectedFileIndex;
  const isSubtitle = file.kind === 'subtitle';
  const isActiveSub = isSubtitle && activeSubtitleId === `sidecar-${file.index}`;
  const isInteractive = file.kind === 'video' || file.kind === 'audio' || isSubtitle;

  return (
    <button
      type="button"
      onClick={() => {
        if (isSubtitle) {
          onSelectSubtitleFile(file);
        } else if (file.kind === 'video' || file.kind === 'audio') {
          onSelectFile(file);
        }
      }}
      disabled={!isInteractive}
      className={`flex w-full items-center justify-between gap-2 rounded-lg py-2 pr-3 text-left text-xs transition-colors ${
        isSelected || isActiveSub
          ? 'bg-[#E11D48]/15 text-white'
          : isInteractive
            ? 'text-[#CBD5E1] hover:bg-[#1A202E] hover:text-white'
            : 'cursor-default text-[#64748B]'
      }`}
      style={{ paddingLeft: `${depth * 14 + 8}px` }}
    >
      <div className="flex min-w-0 items-center gap-2">
        {file.kind === 'video' ? (
          <Film
            className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-[#FB7185]' : 'text-[#94A3B8]'}`}
            aria-hidden="true"
          />
        ) : isSubtitle ? (
          <Subtitles
            className={`h-3.5 w-3.5 shrink-0 ${isActiveSub ? 'text-[#FB7185]' : 'text-[#94A3B8]'}`}
            aria-hidden="true"
          />
        ) : file.kind === 'audio' ? (
          <Music className="h-3.5 w-3.5 shrink-0 text-[#94A3B8]" aria-hidden="true" />
        ) : (
          <FileText className="h-3.5 w-3.5 shrink-0 text-[#475569]" aria-hidden="true" />
        )}
        <span className="truncate font-medium">{node.name}</span>
      </div>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-[#64748B]">
        {isActiveSub ? 'CC on' : formatBytes(file.length)}
      </span>
    </button>
  );
}

export function PlayerWorkspace({
  torrent,
  settings,
  onBack,
  onTogglePause,
  onRemove,
}: PlayerWorkspaceProps) {
  const primaryVideo = useMemo(() => pickPrimaryVideoFile(torrent.files), [torrent.files]);
  const [selectedFileIndex, setSelectedFileIndex] = useState<number>(primaryVideo?.index ?? 0);
  const [probe, setProbe] = useState<MediaProbeInfo | null>(null);
  const [uploadedSubs, setUploadedSubs] = useState<MediaSubtitleTrack[]>([]);
  const [activeSubId, setActiveSubId] = useState<string>('off');
  const [externalSubId, setExternalSubId] = useState<string | null>(null);
  const [theaterMode, setTheaterMode] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [busyAction, setBusyAction] = useState(false);

  // Sync active video file when torrent changes or metadata arrives
  useEffect(() => {
    const firstVideo = pickPrimaryVideoFile(torrent.files);
    if (firstVideo) {
      setSelectedFileIndex(firstVideo.index);
    } else if (torrent.files.length > 0) {
      setSelectedFileIndex(0);
    }
    setUploadedSubs([]);
  }, [torrent.infoHash, primaryVideo?.index]);

  const activeFile = useMemo(
    () => torrent.files.find((f) => f.index === selectedFileIndex) ?? primaryVideo,
    [torrent.files, selectedFileIndex, primaryVideo]
  );

  // Probe active file via ffprobe on backend
  useEffect(() => {
    if (!activeFile || activeFile.kind !== 'video') {
      setProbe(null);
      return;
    }
    let cancelled = false;
    setProbe(null);
    probeMediaFile(torrent.infoHash, activeFile.index)
      .then((info) => {
        if (!cancelled) setProbe(info);
      })
      .catch(() => {
        if (!cancelled) setProbe(null);
      });
    return () => {
      cancelled = true;
    };
  }, [torrent.infoHash, activeFile?.index, activeFile?.kind]);

  // Combine sidecar subtitles from torrent + embedded FFmpeg tracks + user-uploaded subtitles
  const availableSubtitles = useMemo<MediaSubtitleTrack[]>(() => {
    const sidecars: MediaSubtitleTrack[] = torrent.files
      .filter((f) => f.kind === 'subtitle')
      .map((f) => ({
        id: `sidecar-${f.index}`,
        label: f.languageHint || f.name.replace(/\.[^.]+$/, ''),
        language: f.languageHint?.slice(0, 2).toLowerCase() || 'en',
        source: 'sidecar',
        fileIndex: f.index,
        url: `/api/subtitles/${encodeURIComponent(torrent.infoHash)}/${f.index}`,
      }));

    const embedded = probe?.embeddedSubtitles ?? [];
    return [...sidecars, ...embedded, ...uploadedSubs];
  }, [torrent.files, torrent.infoHash, probe, uploadedSubs]);

  const fileTree = useMemo(() => buildFileTree(torrent.files), [torrent.files]);
  const releaseMeta = activeFile ? extractReleaseMeta(activeFile.name) : null;
  const savedProgress = activeFile ? torrent.watchProgress[String(activeFile.index)] : undefined;

  const directStreamUrl = activeFile
    ? `${window.location.origin}/api/stream/${encodeURIComponent(torrent.infoHash)}/${activeFile.index}`
    : '';

  const handleCopyStreamUrl = async () => {
    if (!directStreamUrl) return;
    try {
      await navigator.clipboard.writeText(directStreamUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 1800);
    } catch {
      // Ignore clipboard permission errors in sandboxed iframes
    }
  };

  const handleTogglePause = async () => {
    setBusyAction(true);
    try {
      await onTogglePause(torrent.infoHash);
    } finally {
      setBusyAction(false);
    }
  };

  const handleRemove = async () => {
    setBusyAction(true);
    try {
      await onRemove(torrent.infoHash);
      onBack();
    } finally {
      setBusyAction(false);
    }
  };

  const statusLabel =
    torrent.status === 'ready'
      ? 'Ready to stream'
      : torrent.status === 'connecting'
        ? 'Discovering peers'
        : torrent.status === 'downloading'
          ? 'Streaming from swarm'
          : torrent.status === 'seeding'
            ? 'Complete'
            : torrent.status === 'paused'
              ? 'Paused'
              : 'Error';

  return (
    <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
      {/* Contextual Top Breadcrumb Row */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#222836] bg-[#121620] px-3 py-1.5 text-xs font-medium text-[#CBD5E1] transition-colors hover:border-[#374157] hover:text-white whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Back</span>
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-white sm:text-xl">
              {releaseMeta?.cleanTitle || torrent.name}
            </h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[#94A3B8]">
              <span>{statusLabel}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-[#64748B]">
                {torrent.infoHash.slice(0, 12)}
              </span>
              {activeFile && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono uppercase text-[#CBD5E1]">{activeFile.extension}</span>
                </>
              )}
              {probe && probe.width > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {probe.width}×{probe.height}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{probe.videoCodec}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Action Strip */}
        <div className="flex flex-wrap items-center gap-2">
          {activeFile && (
            <>
              <button
                type="button"
                onClick={() => void handleCopyStreamUrl()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#222836] bg-[#121620] px-3 py-2 text-xs font-medium text-[#CBD5E1] transition-colors hover:border-[#374157] hover:text-white whitespace-nowrap"
              >
                {copiedUrl ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                    <span>Copied URL</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Copy Stream URL</span>
                  </>
                )}
              </button>

              <a
                href={`/api/stream/${encodeURIComponent(torrent.infoHash)}/${activeFile.index}?download=1`}
                download={activeFile.name}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#222836] bg-[#121620] px-3 py-2 text-xs font-medium text-[#CBD5E1] transition-colors hover:border-[#374157] hover:text-white whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Download</span>
              </a>
            </>
          )}

          {torrent.source === 'torrent' && (
            <button
              type="button"
              disabled={busyAction}
              onClick={() => void handleTogglePause()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#222836] bg-[#121620] px-3 py-2 text-xs font-medium text-[#CBD5E1] transition-colors hover:border-[#374157] hover:text-white whitespace-nowrap"
            >
              {torrent.status === 'paused' ? (
                <>
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Resume</span>
                </>
              ) : (
                <>
                  <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Pause</span>
                </>
              )}
            </button>
          )}

          <button
            type="button"
            disabled={busyAction}
            onClick={() => void handleRemove()}
            aria-label={`Remove ${torrent.name}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#2B1F24] bg-[#181215] px-3 py-2 text-xs font-medium text-[#FDA4AF] transition-colors hover:border-[#E11D48]/50 hover:bg-[#24161B] whitespace-nowrap"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Remove</span>
          </button>
        </div>
      </div>

      {/* Main Cinema Stage + Collapsible File Inspector */}
      <div
        className={`grid grid-cols-1 gap-6 ${
          theaterMode ? 'lg:grid-cols-1' : 'lg:grid-cols-[minmax(0,1fr)_340px]'
        }`}
      >
        {/* Left Primary Stage */}
        <div className="min-w-0 space-y-5">
          {activeFile ? (
            <VideoPlayer
              infoHash={torrent.infoHash}
              file={activeFile}
              isLocalSample={torrent.source === 'local-sample'}
              posterUrl={torrent.posterUrl}
              probe={probe}
              subtitles={availableSubtitles}
              initialTime={savedProgress?.currentTime ?? 0}
              defaultQuality={settings.transcodeQuality}
              defaultMode={settings.defaultPlaybackMode}
              autoSelectSubtitles={settings.autoSelectSubtitles}
              theaterMode={theaterMode}
              externalSubId={externalSubId}
              onActiveSubChange={(id) => {
                setActiveSubId(id);
                setExternalSubId(null);
              }}
              onToggleTheater={() => setTheaterMode((t) => !t)}
              onAddUploadedSubtitle={(track) => setUploadedSubs((prev) => [...prev, track])}
            />
          ) : (
            <div className="flex aspect-video flex-col items-center justify-center rounded-xl border border-[#222836] bg-[#121620] p-8 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-[#E11D48]" aria-hidden="true" />
              <h2 className="mt-4 text-base font-semibold text-white">
                Fetching torrent metadata from swarm
              </h2>
              <p className="mt-2 max-w-md text-sm text-[#94A3B8]">
                Contacting DHT and {torrent.trackers.length} trackers to retrieve the file tree for{' '}
                <span className="font-mono text-[#E2E8F0]">{torrent.infoHash.slice(0, 12)}</span>.
                Playback starts automatically once peers respond.
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-mono text-xs tabular-nums text-[#94A3B8]">
                <span>Peers: {torrent.numPeers}</span>
                <span aria-hidden="true">·</span>
                <span>Trackers: {torrent.trackers.length}</span>
                <span aria-hidden="true">·</span>
                <span>Status: {statusLabel}</span>
              </div>
            </div>
          )}

          {/* Live Swarm & Technical Media Telemetry Bar */}
          <div className="grid grid-cols-2 gap-4 rounded-xl border border-[#1E2432] bg-[#121620] p-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-[#64748B]">Swarm Peers</p>
              <p className="mt-1 font-mono text-sm font-medium tabular-nums text-white">
                {torrent.source === 'local-sample' ? 'Local cache' : torrent.numPeers}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#64748B]">Transfer Speed</p>
              <p className="mt-1 font-mono text-sm font-medium tabular-nums text-white">
                {torrent.source === 'local-sample'
                  ? 'Direct disk'
                  : formatSpeed(torrent.downloadSpeed)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#64748B]">Buffered / Size</p>
              <p className="mt-1 font-mono text-sm font-medium tabular-nums text-white">
                {Math.round(torrent.progress * 100)}% · {formatBytes(torrent.totalLength)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#64748B]">Media Stream</p>
              <p className="mt-1 font-mono text-sm font-medium tabular-nums text-white">
                {probe && probe.duration > 0
                  ? `${probe.videoCodec} · ${formatDuration(probe.duration)}`
                  : activeFile
                    ? `${activeFile.extension.toUpperCase()} · ${activeFile.needsTranscode ? 'FFmpeg' : 'Native'}`
                    : 'Pending'}
              </p>
            </div>
          </div>
        </div>

        {/* Right Collapsible Sidebar: Torrent File Tree & Media Inspector */}
        {!theaterMode && (
          <aside className="flex flex-col gap-5">
            {/* File Explorer */}
            <section className="rounded-xl border border-[#1E2432] bg-[#121620] p-4">
              <div className="flex items-center justify-between border-b border-[#1E2432] pb-3">
                <h2 className="text-sm font-semibold text-white">Torrent Files</h2>
                <span className="font-mono text-xs tabular-nums text-[#64748B]">
                  {torrent.files.length} {torrent.files.length === 1 ? 'file' : 'files'}
                </span>
              </div>

              {fileTree.length === 0 ? (
                <p className="py-6 text-center text-xs text-[#64748B]">
                  Waiting for torrent metadata to populate the file tree.
                </p>
              ) : (
                <div className="mt-2 max-h-[360px] space-y-0.5 overflow-y-auto pr-1">
                  {fileTree.map((node) => (
                    <FileTreeItem
                      key={node.path}
                      node={node}
                      depth={0}
                      selectedFileIndex={selectedFileIndex}
                      activeSubtitleId={activeSubId}
                      onSelectFile={(f) => setSelectedFileIndex(f.index)}
                      onSelectSubtitleFile={(f) => {
                        const targetId = `sidecar-${f.index}`;
                        const nextId = activeSubId === targetId ? 'off' : targetId;
                        setExternalSubId(nextId);
                        setActiveSubId(nextId);
                      }}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Stream Details from FFprobe */}
            <section className="rounded-xl border border-[#1E2432] bg-[#121620] p-4">
              <h2 className="border-b border-[#1E2432] pb-3 text-sm font-semibold text-white">
                Stream Diagnostics
              </h2>
              <dl className="mt-3 space-y-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-[#64748B]">Container</dt>
                  <dd className="truncate font-mono text-[#E2E8F0]">
                    {probe?.formatName || activeFile?.extension.toUpperCase() || '—'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-[#64748B]">Video Codec</dt>
                  <dd className="font-mono text-[#E2E8F0]">
                    {probe
                      ? `${probe.videoCodec} · ${probe.fps} fps`
                      : activeFile?.needsTranscode
                        ? 'Auto Transcode'
                        : '—'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-[#64748B]">Audio Tracks</dt>
                  <dd className="font-mono tabular-nums text-[#E2E8F0]">
                    {probe?.audioTracks.length ?? 0}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-[#64748B]">Subtitles Detected</dt>
                  <dd className="font-mono tabular-nums text-[#E2E8F0]">
                    {availableSubtitles.length}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-[#64748B]">Browser Native</dt>
                  <dd className="text-[#E2E8F0]">
                    {probe
                      ? probe.browserCompatible
                        ? 'Yes (Direct Play)'
                        : 'No (FFmpeg Transcode)'
                      : activeFile
                        ? activeFile.browserNative
                          ? 'Yes'
                          : 'Transcode recommended'
                        : '—'}
                  </dd>
                </div>
              </dl>
            </section>
          </aside>
        )}
      </div>
    </main>
  );
}
