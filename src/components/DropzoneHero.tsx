import { useRef, useState, type DragEvent, type FormEvent } from 'react';
import {
  Film,
  FolderUp,
  Link2,
  Play,
  Subtitles,
  Zap,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import type { TorrentSummary } from '../types/torrent';
import { formatBytes, parseMagnetOrHash } from '../utils/torrentHelpers';

interface DropzoneHeroProps {
  torrents: TorrentSummary[];
  loading: boolean;
  onAddMagnet: (magnet: string) => Promise<void>;
  onUploadTorrent: (file: File) => Promise<void>;
  onSelectTorrent: (infoHash: string) => void;
}

export function DropzoneHero({
  torrents,
  loading,
  onAddMagnet,
  onUploadTorrent,
  onSelectTorrent,
}: DropzoneHeroProps) {
  const [magnetInput, setMagnetInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsed = parseMagnetOrHash(magnetInput);
    if (!parsed.valid) {
      setError(parsed.error || 'Please enter a valid magnet URI or torrent infoHash.');
      return;
    }

    try {
      setSubmitting(true);
      await onAddMagnet(magnetInput.trim());
      setMagnetInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start torrent stream.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFileChange = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!file.name.toLowerCase().endsWith('.torrent')) {
      setError('Only .torrent metainfo files are accepted here.');
      return;
    }

    try {
      setSubmitting(true);
      await onUploadTorrent(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse .torrent file.');
    } finally {
      setSubmitting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleFileChange(file);
    }
  };

  const featuredMedia = torrents.slice(0, 4);

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
      {/* Primary Focal Anchor: Webtor-inspired Instant Stream Input & Dropzone */}
      <section aria-labelledby="stream-hero-heading" className="mx-auto max-w-3xl text-center">
        <h1
          id="stream-hero-heading"
          className="text-balance text-3xl font-bold tracking-tight text-white sm:text-5xl"
          style={{ lineHeight: 1.12 }}
        >
          Stream torrent video directly in your browser.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-[#94A3B8]">
          Private server playback without plugins or external players. Paste a magnet link or drop
          a .torrent file for sequential HTTP streaming and live FFmpeg transcoding.
        </p>

        {/* Magnet & Dropzone Console */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`mt-8 rounded-2xl border p-5 text-left transition-colors duration-150 sm:p-6 ${
            isDragging
              ? 'border-[#E11D48] bg-[#E11D48]/10'
              : 'border-[#232A3A] bg-[#121620]'
          }`}
        >
          <form onSubmit={handleSubmit} noValidate>
            <label htmlFor="magnet-uri-input" className="sr-only">
              Magnet URI or 40-character infoHash
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Link2
                  className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[#64748B]"
                  aria-hidden="true"
                />
                <input
                  id="magnet-uri-input"
                  type="text"
                  value={magnetInput}
                  onChange={(e) => {
                    setMagnetInput(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="magnet:?xt=urn:btih:... or 40-character infoHash"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-12 w-full rounded-xl border border-[#283042] bg-[#0B0D12] pr-4 pl-10 font-mono text-sm text-white placeholder-[#64748B] transition-colors focus:border-[#E11D48] focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#E11D48] px-6 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#BE123C] disabled:opacity-60 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FB7185]"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>Connecting</span>
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                    <span>Stream Video</span>
                  </>
                )}
              </button>
            </div>

            {error && (
              <div
                role="alert"
                className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-950/40 px-3.5 py-2.5 text-sm text-red-200"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}
          </form>

          {/* Drop .torrent bar */}
          <div className="mt-4 flex flex-col items-center justify-between gap-3 border-t border-[#1E2432] pt-4 sm:flex-row">
            <div className="flex items-center gap-2.5 text-sm text-[#94A3B8]">
              <FolderUp className="h-4 w-4 shrink-0 text-[#CBD5E1]" aria-hidden="true" />
              <span>
                {isDragging
                  ? 'Release to load .torrent file into your server'
                  : 'Or drag and drop a .torrent file anywhere in this box'}
              </span>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".torrent,application/x-bittorrent"
              onChange={(e) => void handleFileChange(e.target.files?.[0])}
              className="hidden"
              tabIndex={-1}
              aria-hidden="true"
              id="hero-torrent-upload"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg border border-[#2B3345] bg-[#181D2A] px-4 py-2 text-xs font-medium text-[#E2E8F0] transition-colors hover:border-[#3E4963] hover:text-white whitespace-nowrap shrink-0"
            >
              Browse .torrent file
            </button>
          </div>
        </div>
      </section>

      {/* Ready on Your Server — Quick-Launch Cinema Grid */}
      <section aria-labelledby="ready-library-heading" className="mt-16">
        <div className="flex items-baseline justify-between gap-4 border-b border-[#1E2432] pb-4">
          <div>
            <h2 id="ready-library-heading" className="text-xl font-semibold text-white">
              Ready on your server
            </h2>
            <p className="mt-1 text-sm text-[#94A3B8]">
              Instant browser playback from your private library — test Direct HTTP Range streaming
              or live FFmpeg MKV transcoding.
            </p>
          </div>
          <span className="shrink-0 whitespace-nowrap font-mono text-xs tabular-nums text-[#64748B]">
            {torrents.length} {torrents.length === 1 ? 'item' : 'items'}
          </span>
        </div>

        {loading && torrents.length === 0 ? (
          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="overflow-hidden rounded-xl border border-[#1E2432] bg-[#121620]"
              >
                <div className="aspect-video animate-pulse bg-[#1A202E]" />
                <div className="p-4 space-y-2">
                  <div className="h-5 w-2/3 animate-pulse rounded bg-[#1F2636]" />
                  <div className="h-3.5 w-1/2 animate-pulse rounded bg-[#181E2B]" />
                </div>
              </div>
            ))}
          </div>
        ) : featuredMedia.length === 0 ? (
          <div className="mt-6 rounded-xl border border-[#1E2432] bg-[#121620] px-6 py-12 text-center">
            <p className="text-sm text-[#94A3B8]">
              Your private server library is empty. Paste a magnet URI or upload a .torrent file
              above to begin streaming.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
            {featuredMedia.map((item) => {
              const primaryVideo = item.files.find((f) => f.kind === 'video');
              const isTranscode = primaryVideo?.needsTranscode ?? false;
              const progressEntry = primaryVideo
                ? item.watchProgress[String(primaryVideo.index)]
                : undefined;
              const watchPct =
                progressEntry && progressEntry.duration > 0
                  ? Math.min(100, Math.round((progressEntry.currentTime / progressEntry.duration) * 100))
                  : 0;

              return (
                <button
                  key={item.infoHash}
                  type="button"
                  onClick={() => onSelectTorrent(item.infoHash)}
                  className="group flex flex-col overflow-hidden rounded-xl border border-[#222836] bg-[#121620] text-left transition-colors duration-150 hover:border-[#39435A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E11D48]"
                >
                  <div className="relative aspect-video w-full overflow-hidden bg-[#0E1118]">
                    {item.posterUrl ? (
                      <img
                        src={item.posterUrl}
                        alt={item.name}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#161B28] to-[#0D1017]">
                        <Film className="h-10 w-10 text-[#475569]" aria-hidden="true" />
                      </div>
                    )}

                    {/* Measured contrast scrim */}
                    <div
                      aria-hidden="true"
                      className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"
                    />

                    {/* Centered Play Affordance */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#E11D48] text-white shadow-lg transition-transform duration-150 group-hover:scale-105">
                        <Play className="ml-0.5 h-5 w-5 fill-current" aria-hidden="true" />
                      </span>
                    </div>

                    {/* Watch progress hairline bar if resumed */}
                    {watchPct > 0 && (
                      <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
                        <div
                          className="h-full bg-[#E11D48]"
                          style={{ width: `${watchPct}%` }}
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col justify-between p-4 sm:p-5">
                    <div>
                      <h3 className="truncate text-base font-semibold text-white group-hover:text-[#FDA4AF] transition-colors">
                        {item.name}
                      </h3>
                      {/* Zero-pill clean unboxed metadata with typographic separators */}
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#94A3B8]">
                        <span className="font-mono uppercase text-[#CBD5E1]">
                          {primaryVideo?.extension || 'torrent'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{isTranscode ? 'FFmpeg Transcode' : 'Direct HTTP Range'}</span>
                        {item.subtitleCount > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              {item.subtitleCount}{' '}
                              {item.subtitleCount === 1 ? 'subtitle' : 'subtitles'}
                            </span>
                          </>
                        )}
                        {item.totalLength > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {formatBytes(item.totalLength)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Core Engine Capabilities — Clean editorial 3-column strip with hairline divider */}
      <section
        aria-label="Streaming engine capabilities"
        className="mt-16 grid grid-cols-1 gap-8 border-t border-[#1E2432] pt-10 md:grid-cols-3"
      >
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Zap className="h-4 w-4 text-[#E11D48]" aria-hidden="true" />
            <h3>Sequential Piece Streaming</h3>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-[#94A3B8]">
            Prioritizes video headers and playback byte ranges first so HTML5 video starts in
            seconds and seeks cleanly over RFC 7233 HTTP 206 streams.
          </p>
        </div>

        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Film className="h-4 w-4 text-[#E11D48]" aria-hidden="true" />
            <h3>Live FFmpeg Transcoding</h3>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-[#94A3B8]">
            Automatically transmuxes or transcodes Matroska (MKV), AVI, HEVC, and AC3 audio into
            browser-native HLS and fragmented MP4 without external plugins.
          </p>
        </div>

        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Subtitles className="h-4 w-4 text-[#E11D48]" aria-hidden="true" />
            <h3>Instant WebVTT Subtitles</h3>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-[#94A3B8]">
            Detects torrent sidecar .srt files and embedded subtitle tracks, converts them to
            WebVTT on the fly, and supports uploading local subtitle files.
          </p>
        </div>
      </section>
    </main>
  );
}
