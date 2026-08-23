import { useEffect, useState } from 'react';

export function useCountdown(targetAtMs?: number) {
  const [left, setLeft] = useState<number | null>(null);
  const [phase, setPhase] = useState<'idle'|'countdown'|'go'>('idle');

  useEffect(() => {
    if (!targetAtMs) { setPhase('idle'); setLeft(null); return; }
    const tick = () => {
      const diff = targetAtMs - Date.now();
      if (diff <= 0) { setPhase('go'); setLeft(0); return; }
      setPhase('countdown');
      setLeft(Math.ceil(diff / 1000));
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [targetAtMs]);

  return { left, phase, isGo: phase === 'go' };
}
