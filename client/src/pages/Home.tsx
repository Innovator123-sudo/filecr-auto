import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

export function Home() {
  return (
    <div className="min-h-screen bg-ink">
      {/* hero */}
      <div className="max-w-6xl mx-auto px-6 pt-10 pb-8">
        <nav className="flex items-center justify-between">
          <div className="text-xl font-black tracking-tight">💪 PUSHUP<span className="text-brand">PRO</span></div>
          <div className="flex items-center gap-4">
            <Link to="/music" className="text-sm font-bold text-zinc-300 hover:text-brand transition">🎵 Music</Link>
            <div className="text-xs text-zinc-500 hidden sm:block">AI counts · privacy-first · works offline after load</div>
          </div>
        </nav>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mt-12 text-center">
          <h1 className="text-4xl md:text-6xl font-black leading-tight">
            PUSHUPS. <span className="text-brand">COUNTED BY AI.</span><br />
            BATTLED IN REAL TIME.
          </h1>
          <p className="mt-4 text-zinc-400 max-w-2xl mx-auto">
            BlazePose in your browser. No wearables. Friend battles via share-link or an adaptive bot that reads your speed and changes pace within one rep.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-6 mt-10">
          <Link to="/friend/create" className="group relative overflow-hidden rounded-[28px] bg-gradient-to-br from-brand to-brand-dark p-[1.5px]">
            <div className="rounded-[26px] bg-surface p-8 h-full hover:bg-zinc-900 transition">
              <div className="text-4xl">👥</div>
              <h2 className="mt-3 text-2xl font-black">BATTLE A FRIEND</h2>
              <p className="text-sm text-zinc-400 mt-2">Create room → share link → race from anywhere. Live ghost skeletons over WebRTC.</p>
              <div className="mt-6 inline-flex items-center gap-2 bg-white text-black px-5 py-3 rounded-full font-bold text-sm group-hover:gap-3 transition-all">
                Create Room →</div>
              <div className="mt-4 text-[11px] tracking-widest text-zinc-500">TARGET · TIMER · FREE STYLE</div>
            </div>
          </Link>

          <Link to="/bot" className="group relative overflow-hidden rounded-[28px] bg-gradient-to-br from-sky-500 to-violet-600 p-[1.5px]">
            <div className="rounded-[26px] bg-surface p-8 h-full hover:bg-zinc-900 transition">
              <div className="text-4xl">🤖</div>
              <h2 className="mt-3 text-2xl font-black">BATTLE THE BOT</h2>
              <p className="text-sm text-zinc-400 mt-2">Easy / Medium / Hard + Adaptive. Bot measures your 3-rep rolling pace and re-paces instantly.</p>
              <div className="mt-6 inline-flex items-center gap-2 bg-sky-400 text-black px-5 py-3 rounded-full font-bold text-sm group-hover:gap-3 transition-all">
                Choose Difficulty →</div>
              <div className="mt-4 text-[11px] tracking-widest text-zinc-500">FORM SCORING · COMMENTARY · SURGE MODE</div>
            </div>
          </Link>

          <Link to="/music" className="group relative overflow-hidden rounded-[28px] bg-gradient-to-br from-brand-light to-violet-600 p-[1.5px]">
            <div className="rounded-[26px] bg-surface p-8 h-full hover:bg-zinc-900 transition">
              <div className="text-4xl">🎵</div>
              <h2 className="mt-3 text-2xl font-black">MUSIC ZONE</h2>
              <p className="text-sm text-zinc-400 mt-2">Search & hear millions of tracks via JioSaavn, build a queue — or let BOT DJ auto-spin workout hits.</p>
              <div className="mt-6 inline-flex items-center gap-2 bg-white text-black px-5 py-3 rounded-full font-bold text-sm group-hover:gap-3 transition-all">
                Open Player →</div>
              <div className="mt-4 text-[11px] tracking-widest text-zinc-500">320 KBPS · LYRICS · BOT DJ AUTOPLAY</div>
            </div>
          </Link>
        </div>

        <div className="mt-8 grid grid-cols-3 gap-4 text-center">
          {[
            ['100% private', 'Video never leaves browser'],
            ['~25 FPS', 'Pose on-device via MediaPipe'],
            ['≤300 ms', 'Rep → opponent screen'],
          ].map(([k,v]) => (
            <div key={k} className="glass rounded-2xl p-4">
              <div className="font-black mono text-brand">{k}</div>
              <div className="text-xs text-zinc-500">{v}</div>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap gap-3 justify-center">
          <Link to="/friend/join" className="px-5 py-2 rounded-full border border-white/15 text-sm hover:bg-white/10">Have a code? Join Room</Link>
          <a href="#how" className="px-5 py-2 rounded-full border border-white/10 text-sm text-zinc-400">How counting works ↓</a>
        </div>

        <div id="how" className="mt-16 glass rounded-2xl p-6">
          <h3 className="font-bold">How the AI counts (faithful to VNOpenAI repo)</h3>
          <p className="text-sm text-zinc-400 mt-2">
            Elbow angle θ = arccos((S-E)·(W-E)/|S-E||W-E|). Hysteresis: UP ≥160°, DOWN ≤100°, MID dead-band. Rep = UP→DOWN→UP + ≥600 ms + depth + hip ≥160° + visibility ≥0.5. EMA α=0.4. Form score 0-100. Try side view, 1.5–2 m away, phone on floor tilted up.
          </p>
        </div>

        <footer className="mt-12 text-center text-xs text-zinc-600">
          Built from <span className="text-zinc-400">VNOpenAI/pushup-counter-app</span> · MediaPipe BlazePose · Socket.io · WebRTC · Vercel + Render
        </footer>
      </div>
    </div>
  );
}
