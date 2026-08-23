import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export function PaceGraph({ you, opponent, bot }: {
  you: number[];
  opponent?: number[];
  bot?: number[];
}) {
  const len = Math.max(you.length, opponent?.length ?? 0, bot?.length ?? 0);
  const data = Array.from({ length: len }, (_, i) => ({
    t: i + 1,
    you: you[i] ?? null,
    opponent: opponent?.[i] ?? null,
    bot: bot?.[i] ?? null,
  }));
  return (
    <div className="h-[180px] w-full bg-surface rounded-xl p-3">
      <div className="text-xs tracking-widest text-zinc-400 mb-1">REPS OVER TIME</div>
      <ResponsiveContainer width="100%" height="90%">
        <LineChart data={data}>
          <XAxis dataKey="t" tick={{ fontSize: 10, fill: '#71717a' }} />
          <YAxis tick={{ fontSize: 10, fill: '#71717a' }} allowDecimals={false} />
          <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 8 }} />
          <Legend />
          <Line type="monotone" dataKey="you" stroke="#FF3B30" strokeWidth={2} dot={false} name="You" />
          {opponent && <Line type="monotone" dataKey="opponent" stroke="#22c55e" strokeWidth={2} dot={false} name="Friend" />}
          {bot && <Line type="monotone" dataKey="bot" stroke="#38bdf8" strokeWidth={2} dot={false} name="Bot" />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
