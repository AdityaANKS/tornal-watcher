import { useMemo, useState } from 'react';
import { Film, Play, Plus, Search, Trash2 } from 'lucide-react';
import type { TorrentSummary } from '../types/torrent';
import { formatBytes } from '../utils/torrentHelpers';

interface LibraryViewProps {
  torrents: TorrentSummary[];
  loading: boolean;
  onSelectTorrent: (infoHash: string) => void;
  onRemoveTorrent: (infoHash: string) => Promise<void>;
  onOpenAddModal: () => void;
}

type StatusFilter = 'all' | 'ready' | 'active' | 'paused';

export function LibraryView({
  torrents,
  loading,
  onSelectTorrent,
  onRemoveTorrent,
  onOpenAddModal,
}: LibraryViewProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return torrents.filter((item) => {
      if (filter === 'ready' && item.status !== 'ready' && item.status !== 'seeding') {
        return false;
      }
      if (
        filter === 'active' &&
        item.status !== 'downloading' &&
        item.status !== 'connecting'
      ) {
        return false;
      }
      if (filter === 'paused' && item.status !== 'paused') {
        return false;
      }
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.infoHash.toLowerCase().includes(q) ||
        item.files.some((f) => f.name.toLowerCase().includes(q))
      );
    });
  }, [torrents, query, filter]);

  return (
    <main className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 border-b border-[#1E2432] pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Private Media Library</h1>
          <p className="mt-1 text-sm text-[#94A3B8]">
            Saved torrents, resume timestamps, and cached videos ready for browser playback.
          </p>
        </div>

        {/* Search & Interactive Segmented Filter */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#64748B]"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="Search library"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by title or hash..."
              className="h-10 w-full rounded-lg border border-[#242B3B] bg-[#121620] pr-3 pl-9 text-sm text-white placeholder-[#64748B] focus:border-[#E11D48] focus:outline-none sm:w-64"
            />
          </div>

          <div
            role="group"
            aria-label="Filter by torrent status"
            className="inline-flex items-center rounded-lg border border-[#222836] bg-[#121620] p-1 text-xs"
          >
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'ready', label: 'Ready' },
                { id: 'active', label: 'Downloading' },
                { id: 'paused', label: 'Paused' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`rounded-md px-3 py-1.5 font-medium transition-colors whitespace-nowrap ${
                  filter === tab.id
                    ? 'bg-[#22293A] text-white'
                    : 'text-[#94A3B8] hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && torrents.length === 0 ? (
        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="overflow-hidden rounded-xl border border-[#1E2432] bg-[#121620]"
            >
              <div className="aspect-video animate-pulse bg-[#1A202E]" />
              <div className="p-4 space-y-2">
                <div className="h-4 w-3/4 animate-pulse rounded bg-[#1E2535]" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-[#181E2B]" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-10 rounded-xl border border-[#1E2432] bg-[#121620] px-6 py-14 text-center">
          <Film className="mx-auto h-9 w-9 text-[#475569]" aria-hidden="true" />
          <h2 className="mt-3 text-base font-semibold text-white">
            {torrents.length === 0 ? 'No media in your library yet' : 'No matching torrents found'}
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-[#94A3B8]">
            {torrents.length === 0
              ? 'Add a magnet URI or upload a .torrent file to start building your private browser-streamable media library.'
              : 'Try clearing your search query or switching the status filter.'}
          </p>
          <div className="mt-5 flex justify-center gap-3">
            {query || filter !== 'all' ? (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setFilter('all');
                }}
                className="rounded-lg border border-[#2B3345] bg-[#181D2A] px-4 py-2 text-sm font-medium text-white hover:border-[#3E4963]"
              >
                Reset filters
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpenAddModal}
                className="inline-flex items-center gap-2 rounded-lg bg-[#E11D48] px-4 py-2 text-sm font-semibold text-white hover:bg-[#BE123C]"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>Add First Torrent</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => {
            const primaryVideo = item.files.find((f) => f.kind === 'video');
            const progressEntry = primaryVideo
              ? item.watchProgress[String(primaryVideo.index)]
              : undefined;
            const watchPct =
              progressEntry && progressEntry.duration > 0
                ? Math.min(100, Math.round((progressEntry.currentTime / progressEntry.duration) * 100))
                : 0;

            return (
              <article
                key={item.infoHash}
                className="flex flex-col overflow-hidden rounded-xl border border-[#222836] bg-[#121620] transition-colors hover:border-[#364056]"
              >
                <button
                  type="button"
                  onClick={() => onSelectTorrent(item.infoHash)}
                  aria-label={`Stream ${item.name}`}
                  className="group relative aspect-video w-full overflow-hidden bg-[#0E1118] text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E11D48]"
                >
                  {item.posterUrl ? (
                    <img
                      src={item.posterUrl}
                      alt={item.name}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#171D2B] to-[#0D1017] p-4">
                      <Film className="h-9 w-9 text-[#475569]" aria-hidden="true" />
                      <span className="mt-2 font-mono text-xs text-[#64748B]">
                        {item.infoHash.slice(0, 10)}
                      </span>
                    </div>
                  )}

                  <div
                    aria-hidden="true"
                    className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent"
                  />

                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#E11D48] text-white shadow-lg transition-transform duration-150 group-hover:scale-105">
                      <Play className="ml-0.5 h-4 w-4 fill-current" aria-hidden="true" />
                    </span>
                  </div>

                  {watchPct > 0 && (
                    <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
                      <div className="h-full bg-[#E11D48]" style={{ width: `${watchPct}%` }} />
                    </div>
                  )}
                </button>

                <div className="flex flex-1 flex-col justify-between p-4">
                  <div>
                    <h2 className="truncate text-sm font-semibold text-white">{item.name}</h2>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#94A3B8]">
                      <span className="capitalize text-[#CBD5E1]">{item.status}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {formatBytes(item.totalLength)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {item.videoCount} {item.videoCount === 1 ? 'video' : 'videos'}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-2 border-t border-[#1E2432] pt-3">
                    <button
                      type="button"
                      onClick={() => onSelectTorrent(item.infoHash)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#FDA4AF] transition-colors hover:text-white"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                      <span>{watchPct > 0 ? `Resume (${watchPct}%)` : 'Stream Now'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void onRemoveTorrent(item.infoHash)}
                      aria-label={`Remove ${item.name}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#64748B] transition-colors hover:bg-[#1E2432] hover:text-[#FDA4AF]"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
