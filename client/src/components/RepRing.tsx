export function RepRing({ count, target, size = 140 }: { count: number; target: number; size?: number }) {
  const pct = Math.min(1, count / Math.max(1, target));
  const r = 52, c = 2 * Math.PI * r;
  return (
    <div className="relative flex flex-col items-center">
      <svg width={size} height={size} viewBox="0 0 120 120" className="-rotate-90">
        <circle cx={60} cy={60} r={r} stroke="#27272a" strokeWidth={10} fill="none" />
        <circle cx={60} cy={60} r={r} stroke="#FF3B30" strokeWidth={10} fill="none"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.4s ease' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-3xl font-black mono">{count}</div>
        <div className="text-xs text-zinc-400">/ {target}</div>
        <div className="text-[10px] tracking-widest text-zinc-500">{Math.round(pct*100)}%</div>
      </div>
    </div>
  );
}
