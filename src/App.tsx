import { useCallback, useEffect, useState } from 'react';
import type { ServerSettings, TorrentSummary } from './types/torrent';
import {
  addMagnetTorrent,
  fetchServerSettings,
  fetchTorrents,
  removeTorrent,
  togglePauseTorrent,
  updateServerSettings,
  uploadTorrentFile,
} from './api/client';
import { TopNav, type AppView } from './components/TopNav';
import { DropzoneHero } from './components/DropzoneHero';
import { PlayerWorkspace } from './components/PlayerWorkspace';
import { LibraryView } from './components/LibraryView';
import { SwarmView } from './components/SwarmView';
import { SettingsView } from './components/SettingsView';
import { AddTorrentModal } from './components/AddTorrentModal';

const DEFAULT_SETTINGS: ServerSettings = {
  defaultPlaybackMode: 'auto',
  transcodeQuality: '720p',
  maxConnections: 60,
  seedAfterComplete: false,
  autoSelectSubtitles: true,
  downloadDir: '',
  ffmpegAvailable: true,
  serverPort: 3000,
};

export default function App() {
  const [activeView, setActiveView] = useState<AppView>('stream');
  const [torrents, setTorrents] = useState<TorrentSummary[]>([]);
  const [activeInfoHash, setActiveInfoHash] = useState<string | null>(null);
  const [settings, setSettings] = useState<ServerSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [addModalOpen, setAddModalOpen] = useState(false);

  const refreshTorrents = useCallback(async () => {
    try {
      const list = await fetchTorrents();
      setTorrents(list);
    } catch {
      // Keep current list on transient network blip
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshTorrents();
    fetchServerSettings()
      .then((s) => setSettings(s))
      .catch(() => {});

    const interval = setInterval(() => {
      void refreshTorrents();
    }, 3000);

    return () => clearInterval(interval);
  }, [refreshTorrents]);

  const activeTorrent = activeInfoHash
    ? torrents.find((t) => t.infoHash === activeInfoHash) ?? null
    : null;

  const openTorrentInPlayer = useCallback((infoHash: string) => {
    setActiveInfoHash(infoHash);
    setActiveView('player');
  }, []);

  const handleAddMagnet = useCallback(
    async (magnet: string) => {
      const summary = await addMagnetTorrent(magnet);
      setTorrents((prev) => {
        const exists = prev.some((t) => t.infoHash === summary.infoHash);
        return exists
          ? prev.map((t) => (t.infoHash === summary.infoHash ? summary : t))
          : [summary, ...prev];
      });
      openTorrentInPlayer(summary.infoHash);
    },
    [openTorrentInPlayer]
  );

  const handleUploadTorrent = useCallback(
    async (file: File) => {
      const summary = await uploadTorrentFile(file);
      setTorrents((prev) => {
        const exists = prev.some((t) => t.infoHash === summary.infoHash);
        return exists
          ? prev.map((t) => (t.infoHash === summary.infoHash ? summary : t))
          : [summary, ...prev];
      });
      openTorrentInPlayer(summary.infoHash);
    },
    [openTorrentInPlayer]
  );

  const handleTogglePause = useCallback(async (infoHash: string) => {
    const updated = await togglePauseTorrent(infoHash);
    setTorrents((prev) => prev.map((t) => (t.infoHash === infoHash ? updated : t)));
  }, []);

  const handleRemoveTorrent = useCallback(
    async (infoHash: string) => {
      await removeTorrent(infoHash);
      setTorrents((prev) => prev.filter((t) => t.infoHash !== infoHash));
      if (activeInfoHash === infoHash) {
        setActiveInfoHash(null);
        setActiveView('library');
      }
    },
    [activeInfoHash]
  );

  const handleSaveSettings = useCallback(async (patch: Partial<ServerSettings>) => {
    const updated = await updateServerSettings(patch);
    setSettings(updated);
    return updated;
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-[#0B0D12] text-[#F1F5F9]">
      <TopNav
        activeView={activeView}
        hasActivePlayer={Boolean(activeTorrent)}
        onNavigate={(view) => setActiveView(view)}
        onOpenAddModal={() => setAddModalOpen(true)}
      />

      <div className="flex-1">
        {activeView === 'player' && activeTorrent ? (
          <PlayerWorkspace
            torrent={activeTorrent}
            settings={settings}
            onBack={() => setActiveView('stream')}
            onTogglePause={handleTogglePause}
            onRemove={handleRemoveTorrent}
          />
        ) : activeView === 'library' ? (
          <LibraryView
            torrents={torrents}
            loading={loading}
            onSelectTorrent={openTorrentInPlayer}
            onRemoveTorrent={handleRemoveTorrent}
            onOpenAddModal={() => setAddModalOpen(true)}
          />
        ) : activeView === 'swarm' ? (
          <SwarmView
            torrents={torrents}
            onSelectTorrent={openTorrentInPlayer}
            onTogglePause={handleTogglePause}
            onRemoveTorrent={handleRemoveTorrent}
            onOpenAddModal={() => setAddModalOpen(true)}
          />
        ) : activeView === 'server' ? (
          <SettingsView settings={settings} onSaveSettings={handleSaveSettings} />
        ) : (
          <DropzoneHero
            torrents={torrents}
            loading={loading}
            onAddMagnet={handleAddMagnet}
            onUploadTorrent={handleUploadTorrent}
            onSelectTorrent={openTorrentInPlayer}
          />
        )}
      </div>

      <footer className="border-t border-[#1A202D] py-5">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-4 text-xs text-[#64748B] sm:px-6 lg:px-8">
          <span>StreamTor — Self-Hosted Browser Torrent Video Server</span>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => setActiveView('library')}
              className="hover:text-[#CBD5E1] transition-colors"
            >
              Library
            </button>
            <button
              type="button"
              onClick={() => setActiveView('swarm')}
              className="hover:text-[#CBD5E1] transition-colors"
            >
              Active Swarm
            </button>
            <button
              type="button"
              onClick={() => setActiveView('server')}
              className="hover:text-[#CBD5E1] transition-colors"
            >
              Server Settings
            </button>
          </div>
        </div>
      </footer>

      <AddTorrentModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onAddMagnet={handleAddMagnet}
        onUploadTorrent={handleUploadTorrent}
      />
    </div>
  );
}
