import { Pause, Play, Plus, Trash2 } from 'lucide-react';
import type { TorrentSummary } from '../types/torrent';
import { formatBytes, formatSpeed } from '../utils/torrentHelpers';

interface SwarmViewProps {
  torrents: TorrentSummary[];
  onSelectTorrent: (infoHash: string) => void;
  onTogglePause: (infoHash: string) => Promise<void>;
  onRemoveTorrent: (infoHash: string) => Promise<void>;
  onOpenAddModal: () => void;
}

export function SwarmView({
  torrents,
  onSelectTorrent,
  onTogglePause,
  onRemoveTorrent,
  onOpenAddModal,
}: SwarmViewProps) {
  const totalBytes = torrents.reduce((sum, t) => sum + t.totalLength, 0);
  const totalDownSpeed = torrents.reduce((sum, t) => sum + t.downloadSpeed, 0);
  const totalPeers = torrents.reduce((sum, t) => sum + t.numPeers, 0);

  return (
    <main className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 border-b border-[#1E2432] pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Active Swarm</h1>
          <p className="mt-1 text-sm text-[#94A3B8]">
            Monitor peer connections, sequential piece transfer speeds, and server cache footprint.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-6 text-xs text-[#94A3B8]">
          <div>
            <span className="text-[#64748B]">Torrents</span>
            <p className="mt-0.5 font-mono text-sm font-medium tabular-nums text-white">
              {torrents.length}
            </p>
          </div>
          <div>
            <span className="text-[#64748B]">Connected Peers</span>
            <p className="mt-0.5 font-mono text-sm font-medium tabular-nums text-white">
              {totalPeers}
            </p>
          </div>
          <div>
            <span className="text-[#64748B]">Aggregate Down</span>
            <p className="mt-0.5 font-mono text-sm font-medium tabular-nums text-white">
              {formatSpeed(totalDownSpeed)}
            </p>
          </div>
          <div>
            <span className="text-[#64748B]">Library Size</span>
            <p className="mt-0.5 font-mono text-sm font-medium tabular-nums text-white">
              {formatBytes(totalBytes)}
            </p>
          </div>
        </div>
      </div>

      {torrents.length === 0 ? (
        <div className="mt-8 rounded-xl border border-[#1E2432] bg-[#121620] px-6 py-14 text-center">
          <p className="text-sm text-[#94A3B8]">No active or cached torrents on this server.</p>
          <button
            type="button"
            onClick={onOpenAddModal}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#E11D48] px-4 py-2 text-sm font-semibold text-white hover:bg-[#BE123C]"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>Add Torrent</span>
          </button>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-[#1E2432] bg-[#121620]">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[#1E2432] text-xs font-medium text-[#64748B]">
                <th className="px-4 py-3 font-medium">Name / InfoHash</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Progress</th>
                <th className="px-4 py-3 text-right font-medium">Size</th>
                <th className="px-4 py-3 text-right font-medium">Peers</th>
                <th className="px-4 py-3 text-right font-medium">Down Speed</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1A202D]">
              {torrents.map((t) => {
                const pct = Math.round(t.progress * 100);
                return (
                  <tr
                    key={t.infoHash}
                    className="h-12 transition-colors hover:bg-[#171C29]"
                  >
                    <td className="max-w-[300px] px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => onSelectTorrent(t.infoHash)}
                        className="block w-full truncate text-left font-medium text-white hover:text-[#FDA4AF]"
                      >
                        {t.name}
                      </button>
                      <span className="font-mono text-[11px] text-[#64748B]">
                        {t.infoHash.slice(0, 16)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      <span
                        className={
                          t.status === 'ready' || t.status === 'seeding'
                            ? 'text-emerald-400'
                            : t.status === 'paused'
                              ? 'text-[#94A3B8]'
                              : t.status === 'error'
                                ? 'text-red-400'
                                : 'text-amber-300'
                        }
                      >
                        {t.status === 'ready'
                          ? 'Ready'
                          : t.status === 'connecting'
                            ? 'Connecting'
                            : t.status === 'downloading'
                              ? 'Streaming'
                              : t.status === 'seeding'
                                ? 'Seeding'
                                : t.status === 'paused'
                                  ? 'Paused'
                                  : 'Error'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-[#E2E8F0]">
                      {pct}%
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-[#CBD5E1]">
                      {formatBytes(t.totalLength)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-[#CBD5E1]">
                      {t.source === 'local-sample' ? 'Local' : t.numPeers}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-[#CBD5E1]">
                      {formatSpeed(t.downloadSpeed)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => onSelectTorrent(t.infoHash)}
                          aria-label={`Play ${t.name}`}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-[#CBD5E1] transition-colors hover:bg-[#232A3C] hover:text-white"
                        >
                          <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                        </button>
                        {t.source === 'torrent' && (
                          <button
                            type="button"
                            onClick={() => void onTogglePause(t.infoHash)}
                            aria-label={`${t.status === 'paused' ? 'Resume' : 'Pause'} ${t.name}`}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-[#CBD5E1] transition-colors hover:bg-[#232A3C] hover:text-white"
                          >
                            {t.status === 'paused' ? (
                              <Play className="h-3.5 w-3.5" aria-hidden="true" />
                            ) : (
                              <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void onRemoveTorrent(t.infoHash)}
                          aria-label={`Delete ${t.name}`}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-[#94A3B8] transition-colors hover:bg-[#2B1B21] hover:text-[#FDA4AF]"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
