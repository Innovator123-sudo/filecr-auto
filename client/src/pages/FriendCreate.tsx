import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocketRoom } from '../hooks/useSocketRoom';

export function FriendCreate() {
  const nav = useNavigate();
  const { createRoom, room } = useSocketRoom();
  const [nickname, setNickname] = useState('');
  const [mode, setMode] = useState<'target'|'timer'|'free'>('target');
  const [targetReps, setTargetReps] = useState(50);
  const [timerSec, setTimerSec] = useState(120);

  const handleCreate = () => {
    if (!nickname.trim()) return alert('Enter nickname');
    createRoom({ nickname, mode, targetReps: mode==='target'? targetReps: undefined, timerSec: mode==='timer'? timerSec: undefined });
  };

  // when room created, navigate
  if (room?.code) {
    // store nickname for rejoin
    sessionStorage.setItem(`nick:${room.code}`, nickname);
    nav(`/room/${room.code}`);
  }

  return (
    <div className="min-h-screen bg-ink flex items-center justify-center p-6">
      <div className="w-full max-w-lg glass rounded-3xl p-8">
        <h1 className="text-2xl font-black">Create Friend Battle</h1>
        <p className="text-sm text-zinc-400">Pick mode and share the link — friend can be anywhere.</p>

        <label className="block mt-6 text-sm font-semibold">Your nickname</label>
        <input value={nickname} onChange={e=>setNickname(e.target.value)} placeholder="e.g. Alex"
          className="mt-1 w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-brand" />

        <div className="mt-6 grid grid-cols-3 gap-2">
          {(['target','timer','free'] as const).map(m => (
            <button key={m} onClick={()=>setMode(m)}
              className={`py-3 rounded-xl font-bold text-sm capitalize border ${mode===m ? 'bg-brand text-white border-brand' : 'bg-white/5 border-white/10'}`}>
              {m==='target'?'🎯 Target':m==='timer'?'⏱ Timer':'🆓 Free'}
            </button>
          ))}
        </div>

        {mode==='target' && (
          <div className="mt-4">
            <label className="text-sm text-zinc-400">Target reps (10–500)</label>
            <input type="range" min={10} max={500} step={10} value={targetReps} onChange={e=>setTargetReps(Number(e.target.value))} className="w-full mt-2" />
            <div className="text-center font-black mono text-xl">{targetReps}</div>
          </div>
        )}
        {mode==='timer' && (
          <div className="mt-4">
            <label className="text-sm text-zinc-400">Timer (30s–30min)</label>
            <input type="range" min={30} max={1800} step={30} value={timerSec} onChange={e=>setTimerSec(Number(e.target.value))} className="w-full mt-2" />
            <div className="text-center font-black mono text-xl">{Math.floor(timerSec/60)}:{String(timerSec%60).padStart(2,'0')}</div>
          </div>
        )}

        <button onClick={handleCreate} className="mt-6 w-full bg-brand hover:bg-brand-dark py-4 rounded-full font-black">Generate Room Link →</button>
        <p className="mt-3 text-xs text-zinc-500 text-center">Room code is 6 chars (e.g. PUSH-4K2X) · link is instantly shareable</p>
      </div>
    </div>
  );
}
