import { useParams, Link } from 'react-router-dom';

export function Results() {
  const { id } = useParams();
  // In full version, fetch from Supabase / server. Skeleton shows layout per spec §6.1
  return (
    <div className="min-h-screen bg-ink p-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-black">Results — {id}</h1>
        <p className="text-sm text-zinc-400">Winner banner · rep graphs · pace curves · form scores (wireframe — connect to Supabase when DB enabled).</p>
        <div className="mt-6 glass rounded-2xl p-8 text-center text-zinc-500">
          No persisted match yet. Play a Friend or Bot battle to generate results.
        </div>
        <div className="mt-6 flex gap-3">
          <Link to="/" className="px-5 py-3 bg-white text-black rounded-full font-bold">Home</Link>
          <Link to="/bot" className="px-5 py-3 border border-white/15 rounded-full">Battle Bot Again</Link>
        </div>
      </div>
    </div>
  );
}

export function History() {
  return (
    <div className="min-h-screen bg-ink p-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-black">History & PRs</h1>
        <p className="text-sm text-zinc-400">Enable Supabase to persist matches (spec §9). Local placeholder shows where streaks, total reps, and leaderboard live.</p>
        <div className="mt-6 grid grid-cols-3 gap-4">
          {[
            ['Total Reps', '—'],
            ['Best Match', '—'],
            ['Streak', '—'],
          ].map(([k,v]) => (
            <div key={k} className="glass rounded-xl p-4 text-center"><div className="text-xs text-zinc-500">{k}</div><div className="text-2xl font-black mono">{v}</div></div>
          ))}
        </div>
      </div>
    </div>
  );
}
