import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function FriendJoin() {
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [nick, setNick] = useState('');
  return (
    <div className="min-h-screen bg-ink flex items-center justify-center p-6">
      <div className="w-full max-w-md glass rounded-3xl p-8">
        <h1 className="text-2xl font-black">Join Room</h1>
        <p className="text-sm text-zinc-400">Enter the 6-char code or paste a shared link.</p>
        <input value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="PUSH-XXXX"
          className="mt-6 w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 mono tracking-widest outline-none focus:border-brand" />
        <input value={nick} onChange={e=>setNick(e.target.value)} placeholder="Your nickname"
          className="mt-3 w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-brand" />
        <button
          onClick={() => {
            const c = code.trim() || window.location.pathname.split('/').pop() || '';
            if (!c) return alert('Enter code');
            if (!nick.trim()) return alert('Enter nickname');
            sessionStorage.setItem(`nick:${c}`, nick);
            nav(`/room/${c}`);
          }}
          className="mt-6 w-full bg-white text-black py-3 rounded-full font-black"
        >Join →</button>
      </div>
    </div>
  );
}
