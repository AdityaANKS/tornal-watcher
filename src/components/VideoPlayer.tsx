import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  AlertTriangle,
  Loader2,
  Maximize,
  Minimize,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  Settings2,
  Subtitles,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  MediaProbeInfo,
  MediaSubtitleTrack,
  PipelineSnapshot,
  PlayerPlaybackTelemetry,
  TorrentFileItem,
  TranscodeQuality,
} from '../types/torrent';
import {
  convertSubtitleFile,
  postClientPipelineEvent,
  saveWatchProgress,
} from '../api/client';
import {
  computeBufferAhead,
  formatBytes,
  formatDuration,
  resolveEffectiveDuration,
} from '../utils/torrentHelpers';

interface VideoPlayerProps {
  infoHash: string;
  title: string;
  file: TorrentFileItem;
  isLocalSample: boolean;
  posterUrl?: string;
  probe: MediaProbeInfo | null;
  pipeline: PipelineSnapshot | null;
  subtitles: MediaSubtitleTrack[];
  initialTime?: number;
  defaultQuality: TranscodeQuality;
  defaultMode: 'auto' | 'direct' | 'transcode';
  autoSelectSubtitles: boolean;
  theaterMode: boolean;
  externalSubId?: string | null;
  onActiveSubChange?: (subId: string) => void;
  onTelemetryChange?: (telemetry: PlayerPlaybackTelemetry) => void;
  onInspectPipeline?: () => void;
  onToggleTheater: () => void;
  onAddUploadedSubtitle: (track: MediaSubtitleTrack) => void;
}

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2];
const QUALITY_OPTIONS: Array<{ value: TranscodeQuality; label: string }> = [
  { value: 'original', label: 'Original' },
  { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' },
  { value: '480p', label: '480p' },
];

export function VideoPlayer({
  infoHash,
  title,
  file,
  isLocalSample,
  posterUrl,
  probe,
  pipeline,
  subtitles,
  initialTime = 0,
  defaultQuality,
  defaultMode,
  autoSelectSubtitles,
  theaterMode,
  externalSubId,
  onActiveSubChange,
  onTelemetryChange,
  onInspectPipeline,
  onToggleTheater,
  onAddUploadedSubtitle,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const subtitleFileInputRef = useRef<HTMLInputElement>(null);
  const lastSavedTimeRef = useRef<number>(0);

  const recommendedEngine: 'direct' | 'transcode' = useMemo(() => {
    if (defaultMode === 'direct') return 'direct';
    if (defaultMode === 'transcode') return 'transcode';
    if (probe) return probe.recommendedMode;
    return file.needsTranscode ? 'transcode' : 'direct';
  }, [defaultMode, probe, file.needsTranscode]);

  const [engineMode, setEngineMode] = useState<'direct' | 'transcode'>(recommendedEngine);
  const [quality, setQuality] = useState<TranscodeQuality>(defaultQuality);
  const [audioTrack, setAudioTrack] = useState<number>(0);
  const [activeSubId, setActiveSubId] = useState<string>('off');
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [seekOffset, setSeekOffset] = useState<number>(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [rawVideoTime, setRawVideoTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(probe?.duration || 0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [bufferAheadSeconds, setBufferAheadSeconds] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<'none' | 'subtitles' | 'settings'>('none');
  const [activeCueLines, setActiveCueLines] = useState<string[]>([]);
  const shouldResumeAfterSeekRef = useRef(false);

  const selectSubtitle = useCallback(
    (subId: string) => {
      setActiveSubId(subId);
      onActiveSubChange?.(subId);
    },
    [onActiveSubChange]
  );

  // Sync external subtitle selection from Torrent File Tree
  useEffect(() => {
    if (externalSubId !== undefined && externalSubId !== null) {
      setActiveSubId(externalSubId);
    }
  }, [externalSubId]);

  // Reset engine & seek offset when switching torrent or file
  useEffect(() => {
    setEngineMode(recommendedEngine);
    setPlayerError(null);
    setAudioTrack(0);
    setSeekOffset(0);
    setRawVideoTime(0);
    setHasStarted(false);
  }, [infoHash, file.index, recommendedEngine]);

  // Auto-select first subtitle if enabled
  useEffect(() => {
    if (autoSelectSubtitles && subtitles.length > 0) {
      const next =
        activeSubId === 'off' || !subtitles.some((s) => s.id === activeSubId)
          ? subtitles[0].id
          : activeSubId;
      if (next !== activeSubId) {
        setActiveSubId(next);
      }
      onActiveSubChange?.(next);
    } else if (activeSubId !== 'off' && !subtitles.some((s) => s.id === activeSubId)) {
      setActiveSubId('off');
      onActiveSubChange?.('off');
    }
  }, [subtitles, autoSelectSubtitles]);

  // Build active stream URL
  const streamSource = useMemo(() => {
    if (engineMode === 'direct') {
      return {
        type: 'native' as const,
        isLiveFragmented: false,
        transportLabel: 'HTTP 206 Range' as const,
        url: `/api/stream/${encodeURIComponent(infoHash)}/${file.index}`,
      };
    }
    if (isLocalSample) {
      return {
        type: 'hls' as const,
        isLiveFragmented: false,
        transportLabel: 'FFmpeg HLS' as const,
        url: `/api/hls/${encodeURIComponent(infoHash)}/${file.index}/${quality}/${audioTrack}/index.m3u8`,
      };
    }
    return {
      type: 'native' as const,
      isLiveFragmented: true,
      transportLabel: 'FFmpeg Live fMP4' as const,
      url: `/api/transcode/${encodeURIComponent(infoHash)}/${file.index}/stream.mp4?quality=${quality}&audioTrack=${audioTrack}&start=${Math.floor(seekOffset)}`,
    };
  }, [engineMode, infoHash, file.index, isLocalSample, quality, audioTrack, seekOffset]);

  const displayedCurrentTime = streamSource.isLiveFragmented
    ? seekOffset + rawVideoTime
    : rawVideoTime;
  const effectiveDuration = resolveEffectiveDuration(
    videoDuration,
    probe?.duration ?? 0,
    streamSource.isLiveFragmented
  );

  // Report live playback telemetry upward to PlayerWorkspace & StreamPipelineDrawer
  useEffect(() => {
    onTelemetryChange?.({
      isPlaying,
      isBuffering,
      hasStarted,
      currentTime: displayedCurrentTime,
      duration: effectiveDuration,
      bufferAheadSeconds,
      bufferedEndSeconds: streamSource.isLiveFragmented ? seekOffset + bufferedEnd : bufferedEnd,
      engineMode,
      transportLabel: streamSource.transportLabel,
      quality,
      seekOffset,
    });
  }, [
    isPlaying,
    isBuffering,
    hasStarted,
    displayedCurrentTime,
    effectiveDuration,
    bufferAheadSeconds,
    bufferedEnd,
    engineMode,
    streamSource.transportLabel,
    streamSource.isLiveFragmented,
    quality,
    seekOffset,
    onTelemetryChange,
  ]);

  // Attach source (Native MP4 or hls.js)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setPlayerError(null);
    setIsBuffering(true);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const resumePos = !streamSource.isLiveFragmented
      ? displayedCurrentTime > 1
        ? displayedCurrentTime
        : initialTime > 1
          ? initialTime
          : 0
      : 0;

    if (streamSource.type === 'hls' && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
      });
      hlsRef.current = hls;
      hls.loadSource(streamSource.url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsBuffering(false);
        if (resumePos > 0 && resumePos < (video.duration || 99999)) {
          video.currentTime = resumePos;
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          hls.destroy();
          hlsRef.current = null;
          video.src = `/api/transcode/${encodeURIComponent(infoHash)}/${file.index}/stream.mp4?quality=${quality}&audioTrack=${audioTrack}&start=${Math.floor(seekOffset)}`;
          video.load();
        }
      });
    } else {
      video.src = streamSource.url;
      video.load();
      const handleReady = () => {
        if (resumePos > 0 && Number.isFinite(video.duration) && resumePos < video.duration - 1) {
          video.currentTime = resumePos;
        }
        if (shouldResumeAfterSeekRef.current) {
          shouldResumeAfterSeekRef.current = false;
          void video.play().catch(() => {});
        }
        video.removeEventListener('loadedmetadata', handleReady);
      };
      video.addEventListener('loadedmetadata', handleReady);
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [streamSource.url, streamSource.type]);

  // Sync textTracks and extract active WebVTT cues into dedicated overlay positioned above controls
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const cleanupFns: Array<() => void> = [];
    setActiveCueLines([]);

    const syncTracks = () => {
      const tracks = video.textTracks;
      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        if (track.id === activeSubId && activeSubId !== 'off') {
          // Keep native track 'hidden' so browser loads & evaluates cues without colliding with bottom controls
          track.mode = 'hidden';
          const readCues = () => {
            const cues = track.activeCues;
            if (!cues || cues.length === 0) {
              setActiveCueLines([]);
              return;
            }
            const lines: string[] = [];
            for (let c = 0; c < cues.length; c++) {
              const cue = cues[c] as VTTCue;
              if (cue.text) {
                lines.push(cue.text.trim());
              }
            }
            setActiveCueLines(lines);
          };
          readCues();
          track.addEventListener('cuechange', readCues);
          cleanupFns.push(() => track.removeEventListener('cuechange', readCues));
        } else {
          track.mode = 'disabled';
        }
      }
    };

    syncTracks();
    // Re-sync shortly after track elements mount
    const timer = setTimeout(syncTracks, 250);
    return () => {
      clearTimeout(timer);
      for (const fn of cleanupFns) fn();
    };
  }, [activeSubId, subtitles, streamSource.url]);

  // Sync volume / muted / playbackRate
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
    video.playbackRate = playbackRate;
  }, [volume, muted, playbackRate]);

  // Track fullscreen changes
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) {
      void video.play().catch((err) => {
        setPlayerError(err instanceof Error ? err.message : 'Unable to start video playback.');
      });
    } else {
      video.pause();
    }
  }, []);

  const seekToTime = useCallback(
    (targetSeconds: number) => {
      const video = videoRef.current;
      if (!video) return;
      const clamped = Math.max(0, Math.min(effectiveDuration || 0, targetSeconds));

      if (streamSource.isLiveFragmented) {
        shouldResumeAfterSeekRef.current = !video.paused;
        setRawVideoTime(0);
        setSeekOffset(Math.floor(clamped));
        void postClientPipelineEvent(
          infoHash,
          `Seeked live stream to ${formatDuration(clamped)}`,
          `Restarting FFmpeg at ${Math.floor(clamped)}s`
        );
      } else {
        video.currentTime = clamped;
        setRawVideoTime(clamped);
      }
    },
    [effectiveDuration, streamSource.isLiveFragmented, infoHash]
  );

  const seekBy = useCallback(
    (deltaSeconds: number) => {
      seekToTime(displayedCurrentTime + deltaSeconds);
    },
    [seekToTime, displayedCurrentTime]
  );

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void el.requestFullscreen?.();
    }
  }, []);

  const togglePiP = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch {
      // Ignore PiP rejection in unsupported headless contexts
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.key === ' ' || e.key.toLowerCase() === 'k') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekBy(-10);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekBy(10);
      } else if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        setMuted((m) => !m);
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePlay, seekBy, toggleFullscreen]);

  const persistProgress = useCallback(
    (time: number, total: number) => {
      if (total <= 0) return;
      if (Math.abs(time - lastSavedTimeRef.current) < 3) return;
      lastSavedTimeRef.current = time;
      void saveWatchProgress(infoHash, file.index, time, total);
    },
    [infoHash, file.index]
  );

  const handleSubtitleUpload = async (uploadedFile: File | undefined) => {
    if (!uploadedFile) return;
    try {
      const converted = await convertSubtitleFile(uploadedFile);
      const blob = new Blob([converted.vtt], { type: 'text/vtt' });
      const objectUrl = URL.createObjectURL(blob);
      const newTrack: MediaSubtitleTrack = {
        id: `uploaded-${Date.now()}`,
        label: uploadedFile.name.replace(/\.(srt|vtt)$/i, ''),
        language: 'custom',
        source: 'uploaded',
        url: objectUrl,
      };
      onAddUploadedSubtitle(newTrack);
      selectSubtitle(newTrack.id);
      setOpenMenu('none');
    } catch (err) {
      setPlayerError(err instanceof Error ? err.message : 'Unable to load subtitle file.');
    } finally {
      if (subtitleFileInputRef.current) subtitleFileInputRef.current.value = '';
    }
  };

  const playedPct =
    effectiveDuration > 0 ? Math.min(100, (displayedCurrentTime / effectiveDuration) * 100) : 0;
  const totalBufferedPos = streamSource.isLiveFragmented ? seekOffset + bufferedEnd : bufferedEnd;
  const bufferedPct =
    effectiveDuration > 0 ? Math.min(100, (totalBufferedPos / effectiveDuration) * 100) : 0;
  const serverCachePct = pipeline?.cachePercent ?? (isLocalSample ? 100 : 0);

  return (
    <div
      ref={containerRef}
      data-testid="cinema-player"
      data-engine={engineMode}
      data-playing={isPlaying ? 'true' : 'false'}
      className="group relative overflow-hidden rounded-xl border border-[#222836] bg-black"
    >
      {/* 16:9 Video Stage */}
      <div className="relative aspect-video w-full bg-black">
        <video
          ref={videoRef}
          poster={posterUrl}
          playsInline
          crossOrigin="anonymous"
          onClick={() => {
            setOpenMenu('none');
            togglePlay();
          }}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (Number.isFinite(v.duration) && v.duration > 0) {
              setVideoDuration(v.duration);
            }
            setIsBuffering(false);
          }}
          onDurationChange={(e) => {
            const v = e.currentTarget;
            if (Number.isFinite(v.duration) && v.duration > 0) {
              setVideoDuration(v.duration);
            }
          }}
          onCanPlay={() => setIsBuffering(false)}
          onWaiting={() => setIsBuffering(true)}
          onPlaying={() => {
            setIsPlaying(true);
            setHasStarted(true);
            setIsBuffering(false);
            void postClientPipelineEvent(
              infoHash,
              `Playing at ${formatDuration(displayedCurrentTime)}`,
              `${streamSource.transportLabel} · +${bufferAheadSeconds.toFixed(1)}s buffered`
            );
          }}
          onPause={() => {
            setIsPlaying(false);
            if (videoRef.current) {
              const absolutePos = streamSource.isLiveFragmented
                ? seekOffset + videoRef.current.currentTime
                : videoRef.current.currentTime;
              void saveWatchProgress(infoHash, file.index, absolutePos, effectiveDuration);
              void postClientPipelineEvent(
                infoHash,
                `Paused at ${formatDuration(absolutePos)} / ${formatDuration(effectiveDuration)}`,
                `Server cache ${serverCachePct}% · browser buffer +${bufferAheadSeconds.toFixed(1)}s`
              );
            }
          }}
          onEnded={() => setIsPlaying(false)}
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            setRawVideoTime(v.currentTime);
            const ranges: Array<{ start: number; end: number }> = [];
            for (let i = 0; i < v.buffered.length; i++) {
              ranges.push({ start: v.buffered.start(i), end: v.buffered.end(i) });
            }
            const buf = computeBufferAhead(v.currentTime, ranges);
            setBufferedEnd(buf.bufferedEnd);
            setBufferAheadSeconds(buf.aheadSeconds);
            const absolutePos = streamSource.isLiveFragmented
              ? seekOffset + v.currentTime
              : v.currentTime;
            persistProgress(absolutePos, effectiveDuration);
          }}
          onError={() => {
            setIsBuffering(false);
            if (engineMode === 'direct') {
              setEngineMode('transcode');
            } else {
              setPlayerError(
                'The browser could not decode this stream yet. Verify peers are connected or switch playback engine.'
              );
            }
          }}
          className="h-full w-full cursor-pointer object-contain"
        >
          {subtitles.map((sub) => (
            <track
              key={sub.id}
              id={sub.id}
              kind="subtitles"
              label={sub.label}
              srcLang={sub.language}
              src={sub.url}
            />
          ))}
        </video>

        {/* Animated Pause Info Overlay HUD */}
        <AnimatePresence>
          {!isPlaying && !isBuffering && !playerError && hasStarted && (
            <motion.div
              key="pause-info-hud"
              data-testid="pause-info-overlay"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="pointer-events-auto absolute top-4 left-4 right-4 z-20 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-white/10 bg-[#0B0D12]/88 p-3.5 backdrop-blur-md sm:right-auto sm:max-w-md sm:p-4"
            >
              <div className="min-w-0 space-y-1.5">
                <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-[#FDA4AF]">
                  <span>Paused</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-[#E2E8F0]">
                    {formatDuration(displayedCurrentTime)} / {formatDuration(effectiveDuration)}
                  </span>
                </div>
                <p className="truncate text-sm font-semibold text-white">{title}</p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] tabular-nums text-[#94A3B8]">
                  <span>
                    Server cache {serverCachePct}%
                    {pipeline ? ` (${formatBytes(pipeline.cacheBytes)})` : ''}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Buffer +{bufferAheadSeconds.toFixed(1)}s</span>
                  <span aria-hidden="true">·</span>
                  <span>{streamSource.transportLabel}</span>
                </div>
                {onInspectPipeline && (
                  <button
                    type="button"
                    onClick={onInspectPipeline}
                    className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-[#FDA4AF] transition-colors hover:text-white"
                  >
                    <Activity className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Inspect live server pipeline</span>
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Dedicated Cinema Subtitle Overlay — positioned cleanly above bottom control bar */}
        {activeCueLines.length > 0 && activeSubId !== 'off' && (
          <div
            data-testid="subtitle-overlay"
            aria-live="polite"
            className="pointer-events-none absolute inset-x-4 bottom-24 z-20 flex flex-col items-center gap-1 text-center sm:bottom-24"
          >
            {activeCueLines.map((line, idx) => (
              <span
                key={idx}
                className="max-w-2xl whitespace-pre-line rounded-md bg-black/80 px-3.5 py-1.5 text-sm leading-snug font-medium text-white shadow-lg sm:text-base"
              >
                {line}
              </span>
            ))}
          </div>
        )}

        {/* Buffering Spinner */}
        {isBuffering && !playerError && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35">
            <div className="flex items-center gap-2.5 rounded-lg bg-[#0B0D12]/90 px-4 py-2.5 text-xs font-medium text-white">
              <Loader2 className="h-4 w-4 animate-spin text-[#E11D48]" aria-hidden="true" />
              <span>
                {engineMode === 'transcode' ? 'Transcoding stream via FFmpeg' : 'Buffering stream'}
              </span>
            </div>
          </div>
        )}

        {/* Center Play Trigger when Paused */}
        {!isPlaying && !isBuffering && !playerError && (
          <button
            type="button"
            onClick={togglePlay}
            aria-label="Play video"
            className="absolute top-1/2 left-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#E11D48] text-white shadow-xl transition-transform duration-150 hover:scale-105 hover:bg-[#BE123C] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            <Play className="ml-1 h-7 w-7 fill-current" aria-hidden="true" />
          </button>
        )}

        {/* Error Overlay */}
        {playerError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0B0D12]/90 p-6 text-center">
            <AlertTriangle className="h-8 w-8 text-amber-400" aria-hidden="true" />
            <p className="mt-3 max-w-md text-sm text-[#E2E8F0]">{playerError}</p>
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setPlayerError(null);
                  setEngineMode((prev) => (prev === 'direct' ? 'transcode' : 'direct'));
                }}
                className="rounded-lg bg-[#E11D48] px-4 py-2 text-xs font-semibold text-white hover:bg-[#BE123C]"
              >
                Switch to {engineMode === 'direct' ? 'FFmpeg Transcode' : 'Direct Play'}
              </button>
            </div>
          </div>
        )}

        {/* Bottom Scrim & Custom Control Bar */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent px-3 pt-10 pb-3 sm:px-4">
          {/* Interactive 3-Layer Timeline Scrubber (Server Cache + Browser Buffer + Playhead) */}
          <div className="relative mb-2.5 flex items-center">
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/15">
              {/* Layer 1: Server Disk Cache */}
              <div
                className="absolute inset-y-0 left-0 bg-slate-400/30 transition-all duration-300"
                style={{ width: `${serverCachePct}%` }}
              />
              {/* Layer 2: Browser Buffered */}
              <div
                className="absolute inset-y-0 left-0 bg-white/45 transition-all duration-150"
                style={{ width: `${bufferedPct}%` }}
              />
              {/* Layer 3: Playhead */}
              <div
                className="absolute inset-y-0 left-0 bg-[#E11D48]"
                style={{ width: `${playedPct}%` }}
              />
            </div>
            <input
              type="range"
              aria-label="Seek timeline"
              min={0}
              max={effectiveDuration || 100}
              step={0.5}
              value={Math.min(displayedCurrentTime, effectiveDuration || 100)}
              onChange={(e) => seekToTime(Number(e.target.value))}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </div>

          {/* Controls Row */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Left Transport & Timecode */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={togglePlay}
                aria-label={isPlaying ? 'Pause video' : 'Play video'}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/15"
              >
                {isPlaying ? (
                  <Pause className="h-4 w-4 fill-current" aria-hidden="true" />
                ) : (
                  <Play className="ml-0.5 h-4 w-4 fill-current" aria-hidden="true" />
                )}
              </button>

              <button
                type="button"
                onClick={() => seekBy(-10)}
                aria-label="Rewind 10 seconds"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-[#CBD5E1] transition-colors hover:bg-white/15 hover:text-white"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={() => seekBy(10)}
                aria-label="Forward 10 seconds"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-[#CBD5E1] transition-colors hover:bg-white/15 hover:text-white"
              >
                <RotateCw className="h-4 w-4" aria-hidden="true" />
              </button>

              {/* Volume */}
              <div className="hidden items-center gap-1.5 sm:flex">
                <button
                  type="button"
                  onClick={() => setMuted((m) => !m)}
                  aria-label={muted || volume === 0 ? 'Unmute audio' : 'Mute audio'}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-[#CBD5E1] transition-colors hover:bg-white/15 hover:text-white"
                >
                  {muted || volume === 0 ? (
                    <VolumeX className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Volume2 className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
                <input
                  type="range"
                  aria-label="Volume"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setVolume(v);
                    if (v > 0 && muted) setMuted(false);
                  }}
                  className="h-1 w-16 cursor-pointer accent-[#E11D48]"
                />
              </div>

              {/* Tabular Timecode */}
              <span
                data-testid="player-timecode"
                className="ml-1 font-mono text-xs tabular-nums text-[#E2E8F0] whitespace-nowrap"
              >
                {formatDuration(displayedCurrentTime)} / {formatDuration(effectiveDuration)}
              </span>
            </div>

            {/* Right Playback Engine, Subtitles & Display Controls */}
            <div className="relative flex items-center gap-1 sm:gap-1.5">
              {/* Interactive Engine Switcher */}
              <div
                role="group"
                aria-label="Streaming engine mode"
                className="hidden items-center rounded-lg bg-white/10 p-0.5 text-xs sm:flex"
              >
                <button
                  type="button"
                  onClick={() => setEngineMode('direct')}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap ${
                    engineMode === 'direct'
                      ? 'bg-[#E11D48] text-white'
                      : 'text-[#CBD5E1] hover:text-white'
                  }`}
                >
                  Direct
                </button>
                <button
                  type="button"
                  onClick={() => setEngineMode('transcode')}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap ${
                    engineMode === 'transcode'
                      ? 'bg-[#E11D48] text-white'
                      : 'text-[#CBD5E1] hover:text-white'
                  }`}
                >
                  FFmpeg
                </button>
              </div>

              {/* Subtitles Button & Popover */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOpenMenu((m) => (m === 'subtitles' ? 'none' : 'subtitles'))}
                  aria-label="Subtitles"
                  aria-expanded={openMenu === 'subtitles'}
                  className={`flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors hover:bg-white/15 ${
                    activeSubId !== 'off' ? 'text-[#FDA4AF]' : 'text-[#CBD5E1] hover:text-white'
                  }`}
                >
                  <Subtitles className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">CC</span>
                </button>

                {openMenu === 'subtitles' && (
                  <div className="absolute right-0 bottom-11 z-30 w-56 rounded-xl border border-[#2A3245] bg-[#121620] p-2 shadow-2xl">
                    <p className="px-2.5 py-1.5 text-xs font-semibold text-[#94A3B8]">Subtitles</p>
                    <button
                      type="button"
                      onClick={() => {
                        selectSubtitle('off');
                        setOpenMenu('none');
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                        activeSubId === 'off'
                          ? 'bg-[#E11D48]/20 text-white'
                          : 'text-[#CBD5E1] hover:bg-white/5'
                      }`}
                    >
                      <span>Off</span>
                    </button>
                    {subtitles.map((sub) => (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => {
                          selectSubtitle(sub.id);
                          setOpenMenu('none');
                        }}
                        className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                          activeSubId === sub.id
                            ? 'bg-[#E11D48]/20 text-white'
                            : 'text-[#CBD5E1] hover:bg-white/5'
                        }`}
                      >
                        <span className="truncate">{sub.label}</span>
                        <span className="ml-2 font-mono text-[10px] uppercase text-[#64748B]">
                          {sub.source}
                        </span>
                      </button>
                    ))}
                    <div className="mt-1.5 border-t border-[#1E2432] pt-1.5">
                      <input
                        ref={subtitleFileInputRef}
                        type="file"
                        accept=".srt,.vtt"
                        onChange={(e) => void handleSubtitleUpload(e.target.files?.[0])}
                        className="sr-only"
                      />
                      <button
                        type="button"
                        onClick={() => subtitleFileInputRef.current?.click()}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#FDA4AF] hover:bg-white/5"
                      >
                        <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Load local .srt / .vtt</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Stream Settings (Quality, Speed, Audio Track) */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOpenMenu((m) => (m === 'settings' ? 'none' : 'settings'))}
                  aria-label="Stream playback settings"
                  aria-expanded={openMenu === 'settings'}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-[#CBD5E1] transition-colors hover:bg-white/15 hover:text-white"
                >
                  <Settings2 className="h-4 w-4" aria-hidden="true" />
                </button>

                {openMenu === 'settings' && (
                  <div className="absolute right-0 bottom-11 z-30 w-64 space-y-3 rounded-xl border border-[#2A3245] bg-[#121620] p-3 shadow-2xl">
                    {/* Mobile engine switch */}
                    <div className="sm:hidden">
                      <p className="mb-1.5 text-xs font-medium text-[#94A3B8]">Playback Engine</p>
                      <div className="grid grid-cols-2 gap-1 rounded-lg bg-[#0B0D12] p-1">
                        <button
                          type="button"
                          onClick={() => setEngineMode('direct')}
                          className={`rounded-md py-1 text-xs font-medium ${
                            engineMode === 'direct' ? 'bg-[#E11D48] text-white' : 'text-[#94A3B8]'
                          }`}
                        >
                          Direct
                        </button>
                        <button
                          type="button"
                          onClick={() => setEngineMode('transcode')}
                          className={`rounded-md py-1 text-xs font-medium ${
                            engineMode === 'transcode' ? 'bg-[#E11D48] text-white' : 'text-[#94A3B8]'
                          }`}
                        >
                          FFmpeg
                        </button>
                      </div>
                    </div>

                    <div>
                      <p className="mb-1.5 text-xs font-medium text-[#94A3B8]">
                        Transcode Resolution
                      </p>
                      <div className="grid grid-cols-4 gap-1">
                        {QUALITY_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => {
                              setQuality(opt.value);
                              setEngineMode('transcode');
                            }}
                            className={`rounded-md py-1 text-xs font-medium transition-colors ${
                              engineMode === 'transcode' && quality === opt.value
                                ? 'bg-[#E11D48] text-white'
                                : 'bg-[#1A202E] text-[#CBD5E1] hover:text-white'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="mb-1.5 text-xs font-medium text-[#94A3B8]">Playback Speed</p>
                      <div className="grid grid-cols-5 gap-1">
                        {SPEED_OPTIONS.map((rate) => (
                          <button
                            key={rate}
                            type="button"
                            onClick={() => setPlaybackRate(rate)}
                            className={`rounded-md py-1 font-mono text-xs tabular-nums transition-colors ${
                              playbackRate === rate
                                ? 'bg-[#E11D48] text-white'
                                : 'bg-[#1A202E] text-[#CBD5E1] hover:text-white'
                            }`}
                          >
                            {rate}x
                          </button>
                        ))}
                      </div>
                    </div>

                    {probe && probe.audioTracks.length > 0 && (
                      <div>
                        <p className="mb-1.5 text-xs font-medium text-[#94A3B8]">Audio Track</p>
                        <div className="space-y-1">
                          {probe.audioTracks.map((track) => (
                            <button
                              key={track.streamIndex}
                              type="button"
                              onClick={() => {
                                setAudioTrack(track.index);
                                if (probe.audioTracks.length > 1) {
                                  setEngineMode('transcode');
                                }
                              }}
                              className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-xs ${
                                audioTrack === track.index
                                  ? 'bg-[#E11D48]/20 text-white'
                                  : 'bg-[#1A202E] text-[#CBD5E1] hover:text-white'
                              }`}
                            >
                              <span className="truncate">{track.title}</span>
                              <span className="font-mono text-[10px] text-[#94A3B8]">
                                {track.channels}ch
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => void togglePiP()}
                aria-label="Picture in Picture"
                className="hidden h-9 w-9 items-center justify-center rounded-lg text-[#CBD5E1] transition-colors hover:bg-white/15 hover:text-white sm:flex"
              >
                <PictureInPicture2 className="h-4 w-4" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={onToggleTheater}
                aria-label={theaterMode ? 'Show file sidebar' : 'Theater mode'}
                className="hidden h-9 w-9 items-center justify-center rounded-lg text-[#CBD5E1] transition-colors hover:bg-white/15 hover:text-white lg:flex"
              >
                {theaterMode ? (
                  <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <PanelRightClose className="h-4 w-4" aria-hidden="true" />
                )}
              </button>

              <button
                type="button"
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-[#CBD5E1] transition-colors hover:bg-white/15 hover:text-white"
              >
                {isFullscreen ? (
                  <Minimize className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Maximize className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
