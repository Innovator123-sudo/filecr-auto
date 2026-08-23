const INSTAGRAM_URL = 'https://www.instagram.com/samrat_kun/';

// Floating credit tag — links to the creator's Instagram.
// Sits above the MusicBar zone (bottom-20) so they never overlap.
export function CreatorBadge() {
  return (
    <a
      href={INSTAGRAM_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="Samrat Bhusal on Instagram"
      className="fixed bottom-20 right-3 z-30 flex items-center gap-1.5 rounded-full border border-white/10 bg-black/45 px-3 py-1.5 text-[11px] font-bold text-zinc-300 backdrop-blur-md transition hover:border-pink-500/60 hover:text-white active:scale-95"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 text-pink-400">
        <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
        <circle cx="12" cy="12" r="4.25" />
        <circle cx="17.6" cy="6.4" r="1.15" fill="currentColor" stroke="none" />
      </svg>
      <span>Created by Samrat Bhusal</span>
    </a>
  );
}
