import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BotDifficulty } from '../engine/botPacing';

export function BotSetup() {
  const nav = useNavigate();
  const [level, setLevel] = useState<BotDifficulty>('medium');
  const [mode, setMode] = useState<'target'|'timer'|'free'>('target');
  const [target, setTarget] = useState(40);
  const [timerSec, setTimerSec] = useState(120);
  const [adaptive, setAdaptive] = useState(true);
  // flash flag → brief glow pulse when a difficulty is clicked
  const [flash, setFlash] = useState(false);

  // Auto-target presets: clicking a difficulty instantly picks a fitting goal
  const AUTO_TARGET: Record<BotDifficulty, number> = { easy: 30, medium: 40, hard: 60 };

  const pickLevel = (id: BotDifficulty) => {
    if (level !== id) { setLevel(id); setTarget(AUTO_TARGET[id]); }
    else setLevel(id);
    setFlash(true);
    setTimeout(() => setFlash(false), 450);
  };

  const cards: { id: BotDifficulty; rpm: string; desc: string; color: string; glow: string }[] = [
    { id: 'easy', rpm: '~12 RPM', desc: 'Encouraging coach; 30% slower than you · γ=0.02', color: 'border-emerald-500 bg-emerald-500/10 text-emerald-300', glow: '0 0 34px rgba(16,185,129,.55), inset 0 0 18px rgba(16,185,129,.12)' },
    { id: 'medium', rpm: '~18 RPM', desc: 'Fair rival; matches you · γ=0.05 · occasional sprints', color: 'border-amber-500 bg-amber-500/10 text-amber-300', glow: '0 0 34px rgba(245,158,11,.55), inset 0 0 18px rgba(245,158,11,.12)' },
    { id: 'hard', rpm: '~24 RPM', desc: 'Ruthless; 15% faster · γ=0.10 · surge cycles', color: 'border-red-500 bg-red-500/10 text-red-300', glow: '0 0 34px rgba(239,68,68,.55), inset 0 0 18px rgba(239,68,68,.12)' },
  ];

  return (
    <div className="min-h-screen bg-ink p-6 flex items-center justify-center">
      <div className="w-full max-w-3xl">
        <h1 className="text-3xl font-black text-center">Choose Your Bot</h1>
        <p className="text-center text-zinc-400 text-sm mt-1">Adaptive engine reads your rolling 3-rep pace and re-paces within one rep</p>

        <div className="grid md:grid-cols-3 gap-4 mt-6">
          {cards.map(c => {
            const selected = level === c.id;
            return (
              <button key={c.id} onClick={()=>pickLevel(c.id)}
                style={selected ? { boxShadow: c.glow } : undefined}
                className={`relative text-left glass rounded-2xl p-5 border-2 transition-all duration-300 ease-out hover:-translate-y-0.5 active:scale-[.98] ${
                  selected
                    ? `${c.color} ${flash ? 'scale-[1.03]' : 'scale-[1.01]'}`
                    : 'border-white/10 hover:border-white/25'
                }`}>
                {selected && (
                  <span className={`absolute -top-2 -right-2 px-2 py-0.5 rounded-full text-[10px] font-black tracking-wider bg-white text-black transition-opacity ${flash ? 'opacity-100' : 'opacity-80'}`}>
                    ✓ SELECTED
                  </span>
                )}
                <div className="text-lg font-black capitalize flex items-center gap-2">
                  {c.id==='easy'?'🟢':c.id==='medium'?'🟡':'🔴'} {c.id} <span className="ml-auto text-xs mono bg-white/10 px-2 py-1 rounded-full">{c.rpm}</span>
                </div>
                <div className="text-xs text-zinc-400 mt-2">{c.desc}</div>
              </button>
            );
          })}
        </div>

        <div className="glass rounded-2xl p-6 mt-6">
          <div className="flex gap-2">
            {(['target','timer','free'] as const).map(m => (
              <button key={m} onClick={()=>setMode(m)} className={`flex-1 py-2 rounded-xl font-bold text-sm capitalize border ${mode===m?'bg-brand border-brand':'bg-white/5 border-white/10'}`}>
                {m}
              </button>
            ))}
          </div>
          {mode==='target' && (
            <div className="mt-4">
              <input type="range" min={10} max={200} value={target} onChange={e=>setTarget(Number(e.target.value))} className="w-full" />
              <div className="text-center mono font-black">{target} reps</div>
              <div className="text-center text-[11px] text-zinc-500 mt-1">
                auto-set for <span className="capitalize font-bold text-zinc-300">{level}</span> · drag to customize
              </div>
            </div>
          )}
          {mode==='timer' && (
            <div className="mt-4">
              <input type="range" min={30} max={600} value={timerSec} onChange={e=>setTimerSec(Number(e.target.value))} className="w-full" />
              <div className="text-center mono font-black">{Math.floor(timerSec/60)}:{String(timerSec%60).padStart(2,'0')}</div>
            </div>
          )}
          <label className="flex items-center gap-2 mt-4 text-sm">
            <input type="checkbox" checked={adaptive} onChange={e=>setAdaptive(e.target.checked)} />
            Adaptive bot (rubber-band γ) — disable for fixed pace
          </label>
        </div>

        <button
          onClick={()=>nav(`/bot/arena?level=${level}&mode=${mode}&target=${target}&timer=${timerSec}&adaptive=${adaptive?1:0}`)}
          className="mt-6 w-full bg-sky-500 hover:bg-sky-400 text-black py-4 rounded-full font-black text-lg"
        >Enter Arena →</button>
      </div>
    </div>
  );
}
