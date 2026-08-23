import { useSearchParams } from 'react-router-dom';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { CameraStage } from '../components/CameraStage';
import { BotSkeleton } from '../components/BotSkeleton';
import { RepRing } from '../components/RepRing';
import { BotPacer } from '../engine/botPacing';
import type { BotDifficulty } from '../engine/botPacing';
import type { RepEvent } from '../engine/types';
import { useMusic } from '../music/MusicPlayerContext';
import { ErrorBoundary } from '../components/ErrorBoundary';

// recharts is ~500 kB — only load it when the graph actually renders
const PaceGraph = lazy(() => import('../components/PaceGraph').then(m => ({ default: m.PaceGraph })));
const GraphFallback = () => <div className="h-40 rounded-2xl bg-surface animate-pulse" />;

const COMMENTS = {
  encourage: ["Nice depth!", "Keep that back straight 💪", "You're flying!"],
  taunt: ["You're slowing down, human 😏", "Is that all you got?", "My circuits are warming up 🔥"],
  surge: ["SURGE MODE — catch me if you can!", "Final 10 — let's finish this!"],
};

function pick(arr: string[]) { return arr[Math.floor(Math.random()*arr.length)]; }

export function BotArena() {
  const [sp] = useSearchParams();
  const level = (sp.get('level') as BotDifficulty) || 'medium';
  const mode = sp.get('mode') || 'target';
  const target = Number(sp.get('target') || 40);
  const timerSec = Number(sp.get('timer') || 120);
  const adaptive = sp.get('adaptive') !== '0';
  const music = useMusic();

  const pacerRef = useRef<BotPacer | null>(null);
  if (!pacerRef.current) pacerRef.current = new BotPacer(level);
  const pacer = pacerRef.current;

  const [myReps, setMyReps] = useState(0);
  const [botReps, setBotReps] = useState(0);
  const [myHist, setMyHist] = useState<number[]>([]);
  const [botHist, setBotHist] = useState<number[]>([]);
  const [tBot, setTBot] = useState(pacer.getTBot());
  const [commentary, setCommentary] = useState<string | undefined>(undefined);
  const [live, setLive] = useState(true);
  const [botStarted, setBotStarted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(timerSec);
  const winner = useMemo(() => {
    if (mode==='target' && (myReps>=target || botReps>=target)) return myReps>=target ? 'You' : 'IRON-1';
    if (mode==='timer' && timeLeft<=0) return myReps>botReps ? 'You' : myReps<botReps ? 'IRON-1' : 'Tie';
    return null;
  }, [myReps, botReps, target, mode, timeLeft]);

  // timer battle
  useEffect(() => {
    if (mode!=='timer' || winner) return;
    const id = setInterval(()=> setTimeLeft(t=> Math.max(0, t-1)), 1000);
    return ()=> clearInterval(id);
  }, [mode, winner]);

  // bot tick loop — increments bot counter on its period
  // FIX: bot waits for user's first rep before starting (was head-starting 2-5s)
  useEffect(() => {
    if (!live || winner || !botStarted) return;
    let id: number;
    const tick = () => {
      pacer.onBotRep();
      setBotReps(c => {
        const n = c+1;
        setBotHist(h=> [...h, n]);
        // surge / commentary triggers
        if (level==='hard' && n%12===0) { pacer.triggerSurge(5); setCommentary(pick(COMMENTS.surge)); setTimeout(()=>setCommentary(undefined), 2500); }
        else if (n%7===0) { setCommentary(pick(COMMENTS.taunt)); setTimeout(()=>setCommentary(undefined), 2000); }
        return n;
      });
      setTBot(pacer.getTBot());
      id = window.setTimeout(tick, pacer.getTBot()*1000);
    };
    id = window.setTimeout(tick, pacer.getTBot()*1000);
    return ()=> clearTimeout(id);
  }, [live, winner, pacer, level, botStarted]);

  // keep tBot reactive when user reps change
  useEffect(() => { setTBot(pacer.getTBot()); }, [myReps]);

  const handleRep = (ev: RepEvent) => {
    setMyReps(ev.repNumber);
    setMyHist(h=> [...h, ev.repNumber]);
    if (!botStarted) setBotStarted(true);
    if (adaptive) {
      pacer.onUserRep(ev.durationMs);
      setTBot(pacer.getTBot());
    }
    if (ev.formScore >= 85 && Math.random()<0.3) { setCommentary(pick(COMMENTS.encourage)); setTimeout(()=>setCommentary(undefined), 2000); }
  };

  const lead = myReps - botReps;

  return (
    <div className="min-h-screen bg-ink p-4 md:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between">
          <h1 className="font-black">🤖 Bot Arena · {level.toUpperCase()} {adaptive?'· Adaptive':''}</h1>
          <div className="flex items-center gap-3">
            {/* in-battle music control: hear your queue or let BOT DJ spin */}
            <button
              onClick={() => music.setBotMode(!music.botMode)}
              title="BOT DJ auto-plays trending workout tracks"
              className={`text-xs px-3 py-1.5 rounded-full border transition ${music.botMode ? 'bg-brand border-brand text-white animate-pulse' : 'border-white/15 text-zinc-300 hover:bg-white/10'}`}
            >🤖 {music.botMode ? `BOT DJ ON${music.current ? ` · ${music.current.title.slice(0, 18)}` : ''}` : '🎵 BOT DJ OFF'}</button>
            {mode==='timer' && <div className="mono font-black text-xl">{Math.floor(timeLeft/60)}:{String(timeLeft%60).padStart(2,'0')}</div>}
            {mode==='target' && <div className="text-sm text-zinc-400">First to {target}</div>}
          </div>
        </div>

        {winner && (
          <div className="mt-4 bg-gradient-to-r from-sky-600 to-violet-600 rounded-2xl p-6 text-center">
            <div className="text-2xl font-black">{winner==='You' ? '🏆 You win!' : winner==='Tie' ? '🤝 Tie!' : '🤖 IRON-1 wins — rematch?'}</div>
            <button onClick={()=>window.location.reload()} className="mt-3 px-5 py-2 bg-white text-black rounded-full font-bold">Rematch</button>
          </div>
        )}

        <ErrorBoundary label="BotArena grid">
          <div className="grid md:grid-cols-[1fr_220px_1fr] gap-4 mt-6">
            <ErrorBoundary label="CameraStage" fallback={<div className="aspect-[4/3] bg-surface rounded-2xl p-6 flex flex-col items-center justify-center gap-3 text-center"><p className="text-red-300 text-sm">Camera crashed</p><button onClick={()=>window.location.reload()} className="px-4 py-2 bg-white text-black rounded-full text-sm font-bold">Reload</button></div>}>
              <CameraStage enabled={live && !winner} onRep={handleRep} label="YOU" />
            </ErrorBoundary>
            <div className="flex flex-col items-center gap-3 order-first md:order-none">
              <RepRing count={myReps} target={mode==='target'? target : Math.max(target, myReps+10)} />
              <div className={`px-4 py-2 rounded-full font-black text-sm ${lead>0?'bg-emerald-500':lead<0?'bg-red-500':'bg-white/10'}`}>{lead===0?'TIED':lead>0?`YOU +${lead}`:`BOT +${-lead}`}</div>
              <button onClick={()=>setLive(v=>!v)} className="text-xs px-3 py-1 rounded-full border border-white/15">{live?'Pause':'Resume'}</button>
              <div className={`text-xs text-center ${!botStarted ? 'text-amber-400 font-bold animate-pulse' : 'text-zinc-500'}`}>
                {!botStarted ? '⏳ Waiting for your 1st rep — bot idle' : `Bot RPM ${(60/tBot).toFixed(1)} · period ${tBot.toFixed(2)}s`}
              </div>
              {!botStarted && <div className="text-[11px] text-zinc-500 text-center -mt-1">Do one pushup and IRON-1 will start</div>}
            </div>
            <ErrorBoundary label="BotSkeleton">
              <BotSkeleton tBot={tBot} isLive={live && !winner && botStarted} commentary={!botStarted ? '👋 Waiting for your first rep…' : commentary} repCount={botReps} />
            </ErrorBoundary>
          </div>
        </ErrorBoundary>

        <div className="mt-4 grid md:grid-cols-2 gap-4">
          <Suspense fallback={<GraphFallback />}>
            <PaceGraph you={myHist} bot={botHist} />
          </Suspense>
          <div className="glass rounded-xl p-4">
            <div className="text-xs tracking-widest text-zinc-500">BOT MATH (spec §8.2)</div>
            <div className="mono text-xs mt-2 leading-relaxed text-zinc-300">
              T_target = k·T_user·(1+γ(R_bot−R_user))<br/>
              k={level==='easy'?1.30:level==='medium'?1.00:0.85} · γ={level==='easy'?0.02:level==='medium'?0.05:0.10} · α=0.35<br/>
              T_bot ∈ [0.5,4]s · surge ×0.72 (hard)
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
