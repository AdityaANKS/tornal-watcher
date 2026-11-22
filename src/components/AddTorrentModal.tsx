import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, FolderUp, Link2, Loader2, Play, X } from 'lucide-react';
import { parseMagnetOrHash } from '../utils/torrentHelpers';

interface AddTorrentModalProps {
  open: boolean;
  onClose: () => void;
  onAddMagnet: (magnet: string) => Promise<void>;
  onUploadTorrent: (file: File) => Promise<void>;
}

export function AddTorrentModal({
  open,
  onClose,
  onAddMagnet,
  onUploadTorrent,
}: AddTorrentModalProps) {
  const [magnetInput, setMagnetInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsed = parseMagnetOrHash(magnetInput);
    if (!parsed.valid) {
      setError(parsed.error || 'Enter a valid magnet URI or 40-character infoHash.');
      return;
    }

    try {
      setSubmitting(true);
      await onAddMagnet(magnetInput.trim());
      setMagnetInput('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add torrent.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!file.name.toLowerCase().endsWith('.torrent')) {
      setError('Please select a .torrent file.');
      return;
    }
    try {
      setSubmitting(true);
      await onUploadTorrent(file);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload .torrent file.');
    } finally {
      setSubmitting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-torrent-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl rounded-2xl border border-[#262E40] bg-[#121620] p-6 shadow-2xl">
        <div className="flex items-center justify-between gap-4">
          <h2 id="add-torrent-modal-title" className="text-lg font-semibold text-white">
            Add torrent to stream
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Add Torrent dialog"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#94A3B8] transition-colors hover:bg-[#1E2433] hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <p className="mt-1.5 text-sm text-[#94A3B8]">
          Paste a magnet URI or infoHash, or upload a .torrent file from your device.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
          <div>
            <label
              htmlFor="modal-magnet-input"
              className="block text-xs font-medium text-[#CBD5E1]"
            >
              Magnet URI or InfoHash
            </label>
            <div className="relative mt-1.5">
              <Link2
                className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[#64748B]"
                aria-hidden="true"
              />
              <input
                ref={inputRef}
                id="modal-magnet-input"
                type="text"
                value={magnetInput}
                onChange={(e) => {
                  setMagnetInput(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="magnet:?xt=urn:btih:..."
                spellCheck={false}
                className="h-11 w-full rounded-xl border border-[#2A3245] bg-[#0B0D12] pr-3 pl-10 font-mono text-sm text-white placeholder-[#64748B] focus:border-[#E11D48] focus:outline-none"
              />
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-950/40 px-3 py-2.5 text-sm text-red-200"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-col-reverse gap-3 border-t border-[#1E2432] pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <input
                ref={fileRef}
                type="file"
                accept=".torrent,application/x-bittorrent"
                onChange={(e) => void handleFile(e.target.files?.[0])}
                className="sr-only"
                id="modal-torrent-upload"
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-lg border border-[#2A3245] bg-[#181E2B] px-3.5 py-2 text-xs font-medium text-[#E2E8F0] transition-colors hover:border-[#3D4963] hover:text-white"
              >
                <FolderUp className="h-4 w-4" aria-hidden="true" />
                <span>Upload .torrent file</span>
              </button>
            </div>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm font-medium text-[#94A3B8] transition-colors hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-lg bg-[#E11D48] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#BE123C] disabled:opacity-60 whitespace-nowrap"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>Adding</span>
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                    <span>Open Player</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
