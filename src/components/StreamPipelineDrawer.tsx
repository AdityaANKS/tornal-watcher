import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  ChevronDown,
  Cpu,
  Globe,
  HardDrive,
  MonitorPlay,
  Server,
} from 'lucide-react';
import type {
  MediaProbeInfo,
  PipelineSnapshot,
  PlayerPlaybackTelemetry,
  TorrentSummary,
} from '../types/torrent';
import { formatBytes, formatDuration, formatSpeed } from '../utils/torrentHelpers';

interface StreamPipelineDrawerProps {
  open: boolean;
  onToggle: () => void;
  torrent: TorrentSummary;
  pipeline: PipelineSnapshot | null;
  probe: MediaProbeInfo | null;
  telemetry: PlayerPlaybackTelemetry;
}

function FlowBeam({ active, label }: { active: boolean; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-1">
      <div className="relative h-1.5 w-full min-w-[44px] overflow-hidden rounded-full bg-[#1C2230]">
        {active ? (
          <>
            <motion.div
              aria-hidden="true"
              className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-[#E11D48] to-[#FDA4AF]"
              animate={{ x: ['-100%', '340%'] }}
              transition={{ duration: 1.35, repeat: Infinity, ease: 'linear' }}
            />
            <motion.div
              aria-hidden="true"
              className="absolute inset-y-0 left-0 w-1/4 rounded-full bg-gradient-to-r from-transparent via-[#FB7185]/70 to-transparent"
              animate={{ x: ['-120%', '420%'] }}
              transition={{ duration: 1.35, delay: 0.65, repeat: Infinity, ease: 'linear' }}
            />
          </>
        ) : (
          <div className="h-full w-full bg-[#262E40]/60" />
        )}
      </div>
      <span className="font-mono text-[10px] text-[#64748B] whitespace-nowrap">{label}</span>
    </div>
  );
}

function formatEventTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '--:--:--';
  }
}

export function StreamPipelineDrawer({
  open,
  onToggle,
  torrent,
  pipeline,
  probe,
  telemetry,
}: StreamPipelineDrawerProps) {
  const cachePercent = pipeline?.cachePercent ?? Math.round(torrent.progress * 100);
  const cacheBytes = pipeline?.cacheBytes ?? torrent.downloaded;
  const totalBytes = pipeline?.totalBytes ?? torrent.totalLength;
  const pieceBuckets = pipeline?.pieceBuckets ?? new Array<number>(48).fill(torrent.progress);

  const swarmActive =
    torrent.source === 'torrent' &&
    torrent.status !== 'paused' &&
    (torrent.downloadSpeed > 0 || torrent.numPeers > 0 || torrent.status === 'connecting');

  const serverToBrowserActive =
    telemetry.isPlaying ||
    telemetry.isBuffering ||
    (pipeline?.activeHttpStreams ?? 0) > 0 ||
    Boolean(pipeline?.transcode.active);

  // Plain-English live explanation of what is happening between Swarm -> Server -> Website -> User
  const liveNarrative = (() => {
    if (torrent.source === 'local-sample') {
      if (telemetry.isPlaying) {
        return telemetry.engineMode === 'transcode'
          ? `Server disk cache is 100% ready. FFmpeg is serving ${telemetry.transportLabel} (${telemetry.quality}) to your browser with +${telemetry.bufferAheadSeconds.toFixed(1)}s buffered ahead.`
          : `Server disk cache is 100% ready. Streaming direct HTTP 206 byte ranges to your browser with +${telemetry.bufferAheadSeconds.toFixed(1)}s buffered ahead.`;
      }
      return telemetry.hasStarted
        ? `Playback paused at ${formatDuration(telemetry.currentTime)} / ${formatDuration(telemetry.duration)}. Video stays cached on your server (${cachePercent}%) for instant resume.`
        : `Media is 100% cached on your private server. Press Play to begin ${telemetry.transportLabel} delivery to your browser.`;
    }

    if (torrent.status === 'connecting') {
      return `Your server is querying DHT and ${torrent.trackers.length} trackers for peers. Once metadata and header pieces arrive, streaming begins automatically.`;
    }
    if (telemetry.isPlaying) {
      return `Swarm (${torrent.numPeers} peers at ${formatSpeed(torrent.downloadSpeed)}) is feeding sequential pieces to server cache (${cachePercent}% cached), while ${telemetry.transportLabel} delivers frames to your browser (+${telemetry.bufferAheadSeconds.toFixed(1)}s buffered).`;
    }
    if (telemetry.hasStarted && !telemetry.isPlaying) {
      return `Playback paused at ${formatDuration(telemetry.currentTime)} / ${formatDuration(telemetry.duration)}. Your server continues caching ahead (${cachePercent}% done · ${formatSpeed(torrent.downloadSpeed)}) so resume is smooth.`;
    }
    return `Server has cached ${cachePercent}% (${formatBytes(cacheBytes)}) from ${torrent.numPeers} peers and is ready to stream over ${telemetry.transportLabel}.`;
  })();

  const stageLabel = (stage: 'swarm' | 'server' | 'transcoder' | 'browser') => {
    switch (stage) {
      case 'swarm':
        return 'Swarm';
      case 'server':
        return 'Server';
      case 'transcoder':
        return 'FFmpeg';
      case 'browser':
        return 'Browser';
    }
  };

  return (
    <section
      data-testid="stream-pipeline-drawer"
      className="overflow-hidden rounded-xl border border-[#1E2432] bg-[#121620]"
    >
      {/* Always-visible dropdown header with key cache & buffer summary */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="stream-pipeline-panel"
        className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[#171C29] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#E11D48]"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <Activity className="h-4 w-4 shrink-0 text-[#E11D48]" aria-hidden="true" />
          <span className="text-sm font-semibold text-white whitespace-nowrap">
            Server &amp; Stream Pipeline
          </span>
          <span className="hidden text-xs text-[#64748B] sm:inline" aria-hidden="true">
            ·
          </span>
          <span className="hidden truncate font-mono text-xs tabular-nums text-[#94A3B8] sm:inline">
            Cache {cachePercent}% ({formatBytes(cacheBytes)}) · Buffer +
            {telemetry.bufferAheadSeconds.toFixed(1)}s · {telemetry.transportLabel}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2 text-xs font-medium text-[#CBD5E1]">
          <span className="whitespace-nowrap">{open ? 'Hide details' : 'Inspect flow'}</span>
          <motion.span
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="flex items-center"
          >
            <ChevronDown className="h-4 w-4 text-[#94A3B8]" aria-hidden="true" />
          </motion.span>
        </div>
      </button>

      {/* Smooth animated dropdown body */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id="stream-pipeline-panel"
            key="pipeline-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-t border-[#1E2432]"
          >
            <div className="space-y-5 p-4 sm:p-5">
              {/* Live Plain-English Status Summary */}
              <p className="text-xs leading-relaxed text-[#CBD5E1]">{liveNarrative}</p>

              {/* Animated 3-Node Architecture Flow: Swarm -> Private Server -> User Browser */}
              <div className="grid grid-cols-1 items-center gap-3 rounded-xl border border-[#1E2432] bg-[#0D1017] p-4 md:grid-cols-[1fr_92px_1fr_92px_1fr]">
                {/* Node 1: BitTorrent Swarm */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <Globe className="h-4 w-4 shrink-0 text-[#94A3B8]" aria-hidden="true" />
                    <span>BitTorrent Swarm</span>
                  </div>
                  <p className="font-mono text-xs tabular-nums text-[#CBD5E1]">
                    {torrent.source === 'local-sample'
                      ? 'Local library source'
                      : `${torrent.numPeers} peers · ${formatSpeed(torrent.downloadSpeed)}`}
                  </p>
                  <p className="text-[11px] text-[#64748B]">
                    {torrent.source === 'local-sample'
                      ? 'Pre-verified on server disk'
                      : `${torrent.trackers.length} trackers · sequential order`}
                  </p>
                </div>

                {/* Animated Link 1 -> 2 */}
                <FlowBeam
                  active={swarmActive}
                  label={swarmActive ? formatSpeed(torrent.downloadSpeed) : 'Cached'}
                />

                {/* Node 2: Your Private Server (Disk Cache + FFmpeg) */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <Server className="h-4 w-4 shrink-0 text-[#E11D48]" aria-hidden="true" />
                    <span>Private Server</span>
                  </div>
                  <p className="font-mono text-xs tabular-nums text-[#CBD5E1]">
                    {cachePercent}% cached · {formatBytes(cacheBytes)}
                  </p>
                  <p className="text-[11px] text-[#64748B]">
                    {pipeline?.transcode.active
                      ? `FFmpeg active · ${pipeline.transcode.speed} (${pipeline.transcode.fps} fps)`
                      : telemetry.engineMode === 'transcode'
                        ? `FFmpeg ready (${telemetry.quality})`
                        : 'Direct HTTP 206 zero-CPU'}
                  </p>
                </div>

                {/* Animated Link 2 -> 3 */}
                <FlowBeam
                  active={serverToBrowserActive}
                  label={telemetry.isPlaying ? telemetry.transportLabel : 'Standby'}
                />

                {/* Node 3: User Browser Player */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <MonitorPlay className="h-4 w-4 shrink-0 text-[#94A3B8]" aria-hidden="true" />
                    <span>Browser Player (You)</span>
                  </div>
                  <p className="font-mono text-xs tabular-nums text-[#CBD5E1]">
                    {formatDuration(telemetry.currentTime)} / {formatDuration(telemetry.duration)}
                  </p>
                  <p className="text-[11px] text-[#64748B]">
                    {telemetry.isBuffering
                      ? 'Buffering frames...'
                      : telemetry.isPlaying
                        ? `Playing · +${telemetry.bufferAheadSeconds.toFixed(1)}s buffered`
                        : `Paused · +${telemetry.bufferAheadSeconds.toFixed(1)}s buffered`}
                  </p>
                </div>
              </div>

              {/* Server Disk Cache Piece Map & Engine Metrics */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-medium text-[#CBD5E1]">
                      <HardDrive className="h-3.5 w-3.5 text-[#94A3B8]" aria-hidden="true" />
                      <span>Server Piece Cache Map</span>
                    </span>
                    <span className="font-mono tabular-nums text-[#94A3B8]">
                      {cachePercent}% · {formatBytes(cacheBytes)} / {formatBytes(totalBytes)}
                    </span>
                  </div>

                  {/* 48-segment piece density bar */}
                  <div
                    role="img"
                    aria-label={`Server cache map: ${cachePercent}% cached across ${pipeline?.totalPieces ?? 48} pieces`}
                    className="grid h-4 w-full gap-[2px] rounded-md bg-[#0B0D12] p-1"
                    style={{ gridTemplateColumns: `repeat(${pieceBuckets.length}, minmax(0, 1fr))` }}
                  >
                    {pieceBuckets.map((ratio, idx) => (
                      <span
                        key={idx}
                        className="h-full rounded-[1px] transition-colors duration-200"
                        style={{
                          backgroundColor:
                            ratio >= 0.95
                              ? '#E11D48'
                              : ratio > 0.05
                                ? 'rgba(225, 29, 72, 0.45)'
                                : '#1E2432',
                        }}
                      />
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] tabular-nums text-[#64748B]">
                    <span>
                      Verified pieces: {pipeline?.verifiedPieces ?? 0} /{' '}
                      {pipeline?.totalPieces ?? 0}
                    </span>
                    <span>
                      Last HTTP 206 range: {pipeline?.lastRangeBytes || 'Awaiting byte request'}
                    </span>
                  </div>
                </div>

                {/* Compact Transcoder & Probe Snapshot */}
                <div className="space-y-1.5 border-t border-[#1E2432] pt-3 text-xs lg:border-t-0 lg:border-l lg:pt-0 lg:pl-4">
                  <div className="flex items-center gap-1.5 font-medium text-[#CBD5E1]">
                    <Cpu className="h-3.5 w-3.5 text-[#94A3B8]" aria-hidden="true" />
                    <span>Playback Telemetry</span>
                  </div>
                  <div className="flex justify-between gap-2 text-[11px]">
                    <span className="text-[#64748B]">Full Duration</span>
                    <span className="font-mono tabular-nums text-[#E2E8F0]">
                      {formatDuration(telemetry.duration || probe?.duration || 0)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2 text-[11px]">
                    <span className="text-[#64748B]">Browser Buffer Ahead</span>
                    <span className="font-mono tabular-nums text-[#E2E8F0]">
                      +{telemetry.bufferAheadSeconds.toFixed(1)}s
                    </span>
                  </div>
                  <div className="flex justify-between gap-2 text-[11px]">
                    <span className="text-[#64748B]">Active HTTP Streams</span>
                    <span className="font-mono tabular-nums text-[#E2E8F0]">
                      {pipeline?.activeHttpStreams ?? 0}
                    </span>
                  </div>
                </div>
              </div>

              {/* Real Chronological Server <-> Browser Event Feed */}
              <div className="border-t border-[#1E2432] pt-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-[#CBD5E1]">Live Pipeline Activity</h3>
                  <span className="font-mono text-[11px] tabular-nums text-[#64748B]">
                    {(pipeline?.events.length ?? 0)} events
                  </span>
                </div>

                {!pipeline || pipeline.events.length === 0 ? (
                  <p className="text-xs text-[#64748B]">
                    Start playback or seek to inspect live HTTP range and FFmpeg events.
                  </p>
                ) : (
                  <ul className="max-h-40 space-y-1.5 overflow-y-auto pr-1 text-xs">
                    {pipeline.events.slice(0, 10).map((evt) => (
                      <li
                        key={evt.id}
                        className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-[#181D29] pb-1.5 last:border-b-0 last:pb-0"
                      >
                        <div className="flex min-w-0 items-baseline gap-2">
                          <span className="shrink-0 font-mono text-[11px] tabular-nums text-[#64748B]">
                            {formatEventTime(evt.timestamp)}
                          </span>
                          <span className="shrink-0 font-mono text-[11px] text-[#FDA4AF]">
                            {stageLabel(evt.stage)}
                          </span>
                          <span className="text-[#E2E8F0]">{evt.message}</span>
                        </div>
                        {evt.detail && (
                          <span className="font-mono text-[11px] text-[#64748B]">
                            {evt.detail}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
