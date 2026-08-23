let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

// iOS/Safari only play audio after a user gesture unlocks the AudioContext.
// The first tap anywhere unlocks it for the whole session.
if (typeof window !== 'undefined') {
  const unlock = () => {
    getCtx();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('touchstart', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('touchstart', unlock);
}

// Short synthesized "ding" on each rep — no asset download, zero latency
export function playRepBeep() {
  const ac = getCtx();
  if (!ac) return;
  try {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const t = ac.currentTime;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(1320, t + 0.08);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.2);
  } catch {}
}
