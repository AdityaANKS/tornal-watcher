import { Plus } from 'lucide-react';

export type AppView = 'stream' | 'player' | 'library' | 'swarm' | 'server';

interface TopNavProps {
  activeView: AppView;
  hasActivePlayer: boolean;
  onNavigate: (view: AppView) => void;
  onOpenAddModal: () => void;
}

const NAV_ITEMS: Array<{ id: Exclude<AppView, 'player'>; label: string }> = [
  { id: 'stream', label: 'Stream' },
  { id: 'library', label: 'Library' },
  { id: 'swarm', label: 'Active Swarm' },
  { id: 'server', label: 'Server' },
];

export function TopNav({
  activeView,
  hasActivePlayer,
  onNavigate,
  onOpenAddModal,
}: TopNavProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-[#1E2432] bg-[#0B0D12]/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-8 px-4 sm:px-6 lg:px-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => onNavigate('stream')}
          className="flex shrink-0 items-center gap-2.5 text-left text-lg font-bold tracking-tight text-white whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#E11D48]"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className="shrink-0"
          >
            <rect width="24" height="24" rx="6" fill="#E11D48" />
            <path d="M9.5 7.25L17 12L9.5 16.75V7.25Z" fill="#FFFFFF" />
          </svg>
          <span>StreamTor</span>
        </button>

        {/* Zone 2: Clean Single-Line Text Navigation Links */}
        <nav
          aria-label="Primary navigation"
          className="hidden md:flex items-center gap-7 text-sm font-medium"
        >
          {NAV_ITEMS.map((item) => {
            const isCurrent =
              activeView === item.id || (activeView === 'player' && item.id === 'stream');
            return (
              <button
                key={item.id}
                type="button"
                onClick={() =>
                  onNavigate(item.id === 'stream' && hasActivePlayer && activeView !== 'player' ? 'player' : item.id)
                }
                aria-current={isCurrent ? 'page' : undefined}
                className={`relative py-5 transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#E11D48] ${
                  isCurrent ? 'text-white' : 'text-[#94A3B8] hover:text-white'
                }`}
              >
                {item.label}
                {isCurrent && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-[2px] bg-[#E11D48]"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={onOpenAddModal}
            className="inline-flex items-center gap-2 rounded-lg bg-[#E11D48] px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#BE123C] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FB7185]"
          >
            <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Add Torrent</span>
          </button>
        </div>
      </div>

      {/* Compact mobile navigation row — stays well within 15% mobile height cap */}
      <nav
        aria-label="Mobile navigation"
        className="flex items-center justify-around border-t border-[#1A202D] px-2 md:hidden"
      >
        {NAV_ITEMS.map((item) => {
          const isCurrent =
            activeView === item.id || (activeView === 'player' && item.id === 'stream');
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              aria-current={isCurrent ? 'page' : undefined}
              className={`min-h-[40px] px-3 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                isCurrent
                  ? 'border-b-2 border-[#E11D48] text-white'
                  : 'text-[#94A3B8] hover:text-white'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
