import { useEffect, useState, type FormEvent } from 'react';
import { Check, Loader2, Save } from 'lucide-react';
import type { PlaybackMode, ServerSettings, TranscodeQuality } from '../types/torrent';

interface SettingsViewProps {
  settings: ServerSettings;
  onSaveSettings: (patch: Partial<ServerSettings>) => Promise<ServerSettings>;
}

export function SettingsView({ settings, onSaveSettings }: SettingsViewProps) {
  const [defaultPlaybackMode, setDefaultPlaybackMode] = useState<PlaybackMode>(
    settings.defaultPlaybackMode
  );
  const [transcodeQuality, setTranscodeQuality] = useState<TranscodeQuality>(
    settings.transcodeQuality
  );
  const [maxConnections, setMaxConnections] = useState<number>(settings.maxConnections);
  const [seedAfterComplete, setSeedAfterComplete] = useState<boolean>(settings.seedAfterComplete);
  const [autoSelectSubtitles, setAutoSelectSubtitles] = useState<boolean>(
    settings.autoSelectSubtitles
  );
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    setDefaultPlaybackMode(settings.defaultPlaybackMode);
    setTranscodeQuality(settings.transcodeQuality);
    setMaxConnections(settings.maxConnections);
    setSeedAfterComplete(settings.seedAfterComplete);
    setAutoSelectSubtitles(settings.autoSelectSubtitles);
  }, [settings]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedNotice(false);
    try {
      await onSaveSettings({
        defaultPlaybackMode,
        transcodeQuality,
        maxConnections,
        seedAfterComplete,
        autoSelectSubtitles,
      });
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto max-w-[960px] px-4 py-8 sm:px-6 lg:px-8">
      <div className="border-b border-[#1E2432] pb-6">
        <h1 className="text-2xl font-bold tracking-tight text-white">Private Server Settings</h1>
        <p className="mt-1 text-sm text-[#94A3B8]">
          Configure browser playback defaults, FFmpeg transcoding quality caps, and BitTorrent peer
          limits for your self-hosted StreamTor server.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-8 space-y-8">
        {/* Playback & Transcoding Section */}
        <section className="grid grid-cols-1 gap-6 border-b border-[#1E2432] pb-8 md:grid-cols-[260px_1fr]">
          <div>
            <h2 className="text-sm font-semibold text-white">Playback & Transcoding</h2>
            <p className="mt-1 text-xs leading-relaxed text-[#94A3B8]">
              Controls whether streams default to zero-CPU HTTP Range direct play or FFmpeg
              transcoding for non-native containers like MKV and AVI.
            </p>
          </div>

          <div className="space-y-5">
            <div>
              <label
                htmlFor="default-playback-mode"
                className="block text-xs font-medium text-[#CBD5E1]"
              >
                Default Playback Engine
              </label>
              <select
                id="default-playback-mode"
                value={defaultPlaybackMode}
                onChange={(e) => setDefaultPlaybackMode(e.target.value as PlaybackMode)}
                className="mt-1.5 h-10 w-full rounded-lg border border-[#262E40] bg-[#121620] px-3 text-sm text-white focus:border-[#E11D48] focus:outline-none"
              >
                <option value="auto">Auto (Direct MP4/WebM, FFmpeg for MKV/AVI/HEVC)</option>
                <option value="direct">Always Direct Play (HTTP Range)</option>
                <option value="transcode">Always Transcode (FFmpeg HLS / Fragmented MP4)</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="transcode-quality-cap"
                className="block text-xs font-medium text-[#CBD5E1]"
              >
                FFmpeg Transcode Quality Cap
              </label>
              <select
                id="transcode-quality-cap"
                value={transcodeQuality}
                onChange={(e) => setTranscodeQuality(e.target.value as TranscodeQuality)}
                className="mt-1.5 h-10 w-full rounded-lg border border-[#262E40] bg-[#121620] px-3 text-sm text-white focus:border-[#E11D48] focus:outline-none"
              >
                <option value="original">Original Resolution</option>
                <option value="1080p">1080p Full HD</option>
                <option value="720p">720p HD (Balanced CPU & Bandwidth)</option>
                <option value="480p">480p SD (Low Bandwidth / Mobile)</option>
              </select>
            </div>

            <label className="flex items-start gap-3 text-sm text-[#E2E8F0]">
              <input
                type="checkbox"
                checked={autoSelectSubtitles}
                onChange={(e) => setAutoSelectSubtitles(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-[#334155] bg-[#0B0D12] accent-[#E11D48]"
              />
              <span>
                <span className="block font-medium">Auto-load detected torrent subtitles</span>
                <span className="block text-xs text-[#94A3B8]">
                  Automatically converts sidecar .srt files to WebVTT and enables them in the
                  player.
                </span>
              </span>
            </label>
          </div>
        </section>

        {/* Swarm & Network Section */}
        <section className="grid grid-cols-1 gap-6 border-b border-[#1E2432] pb-8 md:grid-cols-[260px_1fr]">
          <div>
            <h2 className="text-sm font-semibold text-white">Swarm & Network</h2>
            <p className="mt-1 text-xs leading-relaxed text-[#94A3B8]">
              Tune BitTorrent peer connection ceilings and post-stream seeding behavior.
            </p>
          </div>

          <div className="space-y-5">
            <div>
              <label
                htmlFor="max-peer-connections"
                className="block text-xs font-medium text-[#CBD5E1]"
              >
                Max Peer Connections per Torrent
              </label>
              <input
                id="max-peer-connections"
                type="number"
                min={10}
                max={300}
                value={maxConnections}
                onChange={(e) => setMaxConnections(Number(e.target.value) || 60)}
                className="mt-1.5 h-10 w-36 rounded-lg border border-[#262E40] bg-[#121620] px-3 font-mono text-sm tabular-nums text-white focus:border-[#E11D48] focus:outline-none"
              />
            </div>

            <label className="flex items-start gap-3 text-sm text-[#E2E8F0]">
              <input
                type="checkbox"
                checked={seedAfterComplete}
                onChange={(e) => setSeedAfterComplete(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-[#334155] bg-[#0B0D12] accent-[#E11D48]"
              />
              <span>
                <span className="block font-medium">Continue seeding after download completes</span>
                <span className="block text-xs text-[#94A3B8]">
                  Keep uploading pieces to peers after the full file is cached locally.
                </span>
              </span>
            </label>
          </div>
        </section>

        {/* Server Runtime Info (Read-Only Real Environment Details) */}
        <section className="grid grid-cols-1 gap-6 border-b border-[#1E2432] pb-8 md:grid-cols-[260px_1fr]">
          <div>
            <h2 className="text-sm font-semibold text-white">Server Environment</h2>
            <p className="mt-1 text-xs leading-relaxed text-[#94A3B8]">
              Direct HTTP endpoints exposed by your private StreamTor backend.
            </p>
          </div>

          <dl className="space-y-3 rounded-xl border border-[#1E2432] bg-[#121620] p-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <dt className="text-[#64748B]">FFmpeg Transcoder</dt>
              <dd
                className={`font-medium ${
                  settings.ffmpegAvailable ? 'text-emerald-400' : 'text-amber-300'
                }`}
              >
                {settings.ffmpegAvailable ? 'Installed and ready' : 'Not detected on PATH'}
              </dd>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <dt className="text-[#64748B]">Direct Stream Endpoint</dt>
              <dd className="font-mono text-[#CBD5E1]">
                {window.location.origin}/api/stream/:infoHash/:fileIndex
              </dd>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <dt className="text-[#64748B]">FFmpeg Transcode Endpoint</dt>
              <dd className="font-mono text-[#CBD5E1]">
                {window.location.origin}/api/transcode/:infoHash/:fileIndex/stream.mp4
              </dd>
            </div>
          </dl>
        </section>

        <div className="flex items-center justify-end gap-4">
          {savedNotice && (
            <span
              role="status"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-400"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              <span>Settings saved</span>
            </span>
          )}
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-[#E11D48] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#BE123C] disabled:opacity-60"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Saving</span>
              </>
            ) : (
              <>
                <Save className="h-4 w-4" aria-hidden="true" />
                <span>Save Settings</span>
              </>
            )}
          </button>
        </div>
      </form>
    </main>
  );
}
