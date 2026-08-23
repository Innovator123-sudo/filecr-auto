import { useEffect, useRef } from 'react';

export function BotAvatar({ tBot, isLive, commentary }: { tBot: number; isLive: boolean; commentary?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // drive CSS animation duration via tBot (seconds per rep)
  useEffect(() => {
    if (ref.current) ref.current.style.setProperty('--bot-period', `${tBot}s`);
  }, [tBot]);

  return (
    <div className="aspect-[4/3] bg-gradient-to-br from-sky-900/40 to-zinc-900 rounded-2xl relative overflow-hidden flex flex-col items-center justify-center border border-sky-800/30">
      <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-sky-500 text-black text-xs font-black tracking-widest">IRON-1 🤖</div>
      <div className="absolute top-3 right-3 text-[11px] mono bg-black/60 px-2 py-1 rounded">{(60 / tBot).toFixed(1)} RPM</div>

      {/* simple skeleton-driven avatar: two bars animate as pushup */}
      <div
        ref={ref}
        className={`relative w-40 h-28 ${isLive ? 'bot-anim' : ''}`}
        style={{ ['--bot-period' as any]: `${tBot}s` }}
      >
        <style>{`
          .bot-anim .bot-body { animation: botPush var(--bot-period) ease-in-out infinite; }
          @keyframes botPush {
            0%,100% { transform: translateY(0) }
            50% { transform: translateY(28px) }
          }
        `}</style>
        <div className="bot-body absolute inset-x-4 top-2 bottom-6 bg-gradient-to-b from-zinc-200 to-zinc-400 rounded-xl shadow-[0_0_20px_rgba(56,189,248,0.5)] flex items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-sky-400 flex items-center justify-center text-xl">🤖</div>
        </div>
        <div className="absolute inset-x-8 bottom-2 h-1 bg-sky-400/50 rounded-full" />
      </div>

      {commentary && (
        <div className="absolute bottom-3 inset-x-3 bg-white text-black text-sm px-3 py-2 rounded-2xl rounded-bl-sm shadow-lg animate-bounce">
          {commentary}
        </div>
      )}
      {!isLive && <div className="absolute inset-0 bg-black/40 flex items-center justify-center text-sm text-zinc-300">Paused</div>}
    </div>
  );
}
