import { useEffect, useRef } from 'react';
import type { Landmark } from '../engine/types';
import { SKELETON_CONNECTIONS, SKELETON_MAX_LANDMARK } from '../engine/types';

// client/src/components/BotSkeleton.tsx — MediaPipe skeleton who is doing pushup (replaces simple block)
// Renders a 17/33-landmark skeleton animated via synthetic pushup cycle driven by tBot period
// When you select bot (Easy/Medium/Hard), this skeleton performs pushups alongside you.

interface BotSkeletonProps {
  tBot: number; // seconds per rep (from BotPacer)
  isLive: boolean;
  commentary?: string;
  mirrored?: boolean;
  repCount?: number;
}

// Generate synthetic 33 BlazePose landmarks for pushup at phase 0..1 (0=UP arms extended, 0.5=DOWN chest low)
// We define a side-view plank as base, then animate elbow bend and torso height.
// Coordinates normalized 0-1 (x horizontal, y vertical). Facing left, side view.
function generateBotLandmarks(phase: number): Landmark[] {
  // Smooth sinusoidal ease: phase 0->1 via cos
  // push: UP (0) -> DOWN (0.5) -> UP (1) => using (1-cos(2*pi*phase))/2
  const p = (1 - Math.cos(phase * Math.PI * 2)) / 2; // 0 at UP, 1 at DOWN
  // Elbow angle interpolation: UP 175°, DOWN 70°
  // Instead of computing angle, directly animate y positions: lower torso/chest when p->1
  const chestDrop = p * 0.18; // how much chest lowers
  const hipDrop = p * 0.08; // hips drop less (keep back straight-ish)
  const elbowBendX = p * 0.06; // elbows flare slightly

  // Base positions (UP plank, side view, normalized)
  // Place person centered at (0.5, 0.52)
  const cx = 0.5, cy = 0.52;
  // Helper to create point
  const pt = (x:number,y:number,vis=1): Landmark => ({x, y, z:0, visibility: vis});

  // We will define 33 landmarks array initialized to dummy
  const lm: Landmark[] = Array.from({length:33}, ()=> pt(0.5,0.5,0));

  // Key points side view (facing left)
  // Nose ~ shoulder height but slightly higher
  lm[0] = pt(cx -0.22, cy -0.18 - chestDrop*0.3); // nose
  // Shoulders
  lm[11] = pt(cx -0.14, cy -0.10 - chestDrop); // left shoulder
  lm[12] = pt(cx -0.13, cy -0.11 - chestDrop); // right shoulder (slightly offset for 3D)
  // Elbows
  lm[13] = pt(cx -0.08 + elbowBendX, cy -0.02 - chestDrop*0.5);
  lm[14] = pt(cx -0.07 + elbowBendX, cy -0.01 - chestDrop*0.5);
  // Wrists (hands stay on ground y ~ 0.70)
  lm[15] = pt(cx -0.10, cy +0.18);
  lm[16] = pt(cx -0.09, cy +0.18);
  // Hips
  lm[23] = pt(cx +0.08, cy -0.06 - hipDrop);
  lm[24] = pt(cx +0.09, cy -0.05 - hipDrop);
  // Knees (legs straight)
  lm[25] = pt(cx +0.22, cy +0.02 - hipDrop*0.2);
  lm[26] = pt(cx +0.23, cy +0.03 - hipDrop*0.2);
  // Ankles
  lm[27] = pt(cx +0.30, cy +0.12);
  lm[28] = pt(cx +0.31, cy +0.13);
  // Heels/feet tips
  lm[29] = pt(cx +0.33, cy +0.14);
  lm[30] = pt(cx +0.34, cy +0.15);
  lm[31] = pt(cx +0.33, cy +0.14);
  lm[32] = pt(cx +0.34, cy +0.15);

  // Ears/eyes approximated near nose
  lm[1] = pt(cx -0.23, cy -0.18 - chestDrop*0.3); // left eye
  lm[2] = pt(cx -0.22, cy -0.18 - chestDrop*0.3); // right eye
  lm[3] = pt(cx -0.23, cy -0.17 - chestDrop*0.3);
  lm[4] = pt(cx -0.21, cy -0.17 - chestDrop*0.3);
  lm[7] = pt(cx -0.24, cy -0.16 - chestDrop*0.3);
  lm[8] = pt(cx -0.20, cy -0.16 - chestDrop*0.3);

  // Mouth etc.
  lm[9] = pt(cx -0.21, cy -0.15 - chestDrop*0.3);
  lm[10]= pt(cx -0.20, cy -0.15 - chestDrop*0.3);

  // Ensure visibility 1 for key points, 0.5 for others
  for (let i=0;i<33;i++) if (lm[i]) lm[i].visibility = lm[i].x===0.5 && lm[i].y===0.5 ? 0 : 1;

  return lm;
}

export function BotSkeleton({ tBot, isLive, commentary, mirrored=false, repCount }: BotSkeletonProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef(0);
  const rafRef = useRef<number>(0);
  const lastRef = useRef(performance.now());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true } as any) as unknown as CanvasRenderingContext2D | null;
    if (!ctx) return;

    let alive = true;
    let lastDraw = 0;
    const IS_TOUCH = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
    const draw = () => {
      if (!alive) return;
      rafRef.current = requestAnimationFrame(draw);
      // AGGRESSIVE 30 FPS mobile lock (33ms) — saves ~40% GPU vs 60Hz
      const cap = IS_TOUCH ? 33 : 32;
      const now = performance.now();
      if (now - lastDraw < cap) return;
      lastDraw = now;
      const dt = Math.min(0.1, (now - lastRef.current) / 1000);
      lastRef.current = now;
      if (isLive) {
        phaseRef.current = (phaseRef.current + dt / Math.max(0.5, tBot)) % 1;
      }
      const phase = phaseRef.current;
      const lm = generateBotLandmarks(phase);

      // HiDPI capped — mobile DPR 1 = 4× fewer pixels than DPR 2 at 1080p, huge save
      const dpr = Math.min(window.devicePixelRatio || 1, IS_TOUCH ? 1 : 2);
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const needW = Math.round(rect.width * dpr);
      const needH = Math.round(rect.height * dpr);
      if (canvas.width !== needW || canvas.height !== needH) {
        canvas.width = needW;
        canvas.height = needH;
      }
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.clearRect(0,0,rect.width, rect.height);

      // Background — single fill, no gradient
      ctx.fillStyle = '#0f0f0f';
      ctx.fillRect(0,0,rect.width, rect.height);

      const isDown = phase > 0.25 && phase < 0.75;
      const col = isDown ? '#38bdf8' : '#22c55e';

      // Draw bones — batched single path (one stroke vs 10 strokes → ~30% faster)
      ctx.lineWidth = IS_TOUCH ? 2.2 : 2.6;
      ctx.strokeStyle = col;
      if (!IS_TOUCH) { ctx.shadowColor = col; ctx.shadowBlur = 8; }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let hasPath = false;
      for (const [a,b] of SKELETON_CONNECTIONS) {
        const p1 = lm[a], p2 = lm[b];
        if (!p1 || !p2 || p1.visibility < 0.3 || p2.visibility < 0.3) continue;
        const x1 = (mirrored ? 1-p1.x : p1.x) * rect.width;
        const y1 = p1.y * rect.height;
        const x2 = (mirrored ? 1-p2.x : p2.x) * rect.width;
        const y2 = p2.y * rect.height;
        ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); hasPath = true;
      }
      if (hasPath) ctx.stroke();
      ctx.shadowBlur = 0;
      // Joints — single fill batch
      ctx.fillStyle = col;
      ctx.beginPath();
      let dotCount = 0;
      for (let i = 0; i < lm.length; i++) {
        if (i > SKELETON_MAX_LANDMARK) break;
        const pt = lm[i];
        if (pt.visibility < 0.3) continue;
        const x = (mirrored ? 1-pt.x : pt.x) * rect.width;
        const y = pt.y * rect.height;
        ctx.moveTo(x + (IS_TOUCH ? 2.4 : 3.2), y);
        ctx.arc(x,y, IS_TOUCH ? 2.4 : 3.2,0,Math.PI*2);
        dotCount++; if (dotCount>22) break;
      }
      ctx.fill();
      if (!IS_TOUCH) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        for (let i = 0; i < lm.length; i++) {
          if (i > SKELETON_MAX_LANDMARK) break;
          const pt = lm[i];
          if (pt.visibility < 0.3) continue;
          const x = (mirrored ? 1-pt.x : pt.x) * rect.width;
          const y = pt.y * rect.height;
          ctx.moveTo(x + 1.1, y);
          ctx.arc(x,y,1.0,0,Math.PI*2);
        }
        ctx.fill();
      }

      // Pace indicator — static, no shadow
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath(); 
      // roundRect may be missing on old mobiles — fallback
      try { (ctx as any).roundRect(8,8,80,22,11); } catch { ctx.rect(8,8,80,22); }
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.fillText(`${(60/Math.max(0.5,tBot)).toFixed(1)} RPM`, 14, 22);

      if (!isLive) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0,0,rect.width, rect.height);
        ctx.fillStyle = '#aaa';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Paused', rect.width/2, rect.height/2);
        ctx.textAlign = 'left';
      }
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => { alive=false; cancelAnimationFrame(rafRef.current); };
  }, [tBot, isLive, mirrored]);

  return (
    <div className="aspect-[4/3] bg-gradient-to-br from-sky-900/40 to-zinc-900 rounded-2xl relative overflow-hidden border border-sky-800/30">
      <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-sky-500 text-black text-xs font-black tracking-widest z-10">IRON-1 🤖 · MediaPipe</div>
      <div className="absolute top-3 right-3 text-[11px] mono bg-black/60 px-2 py-1 rounded z-10">{(60/Math.max(0.5,tBot)).toFixed(1)} RPM</div>
      <canvas ref={canvasRef} className="w-full h-full" style={{width:'100%', height:'100%'}} />
      {typeof repCount === 'number' && (
        <div className="absolute bottom-3 left-3 bg-black/70 rounded-2xl px-4 py-2 z-10">
          <div className="text-3xl font-black mono text-white leading-none">{repCount}</div>
          <div className="text-[11px] tracking-widest text-zinc-400 -mt-1">BOT REPS</div>
        </div>
      )}
      {commentary && (
        <div className="absolute bottom-3 inset-x-3 bg-white text-black text-sm px-3 py-2 rounded-2xl rounded-bl-sm shadow-lg animate-bounce z-10" style={{marginLeft: repCount!==undefined ? '80px' : '0'}}>
          {commentary}
        </div>
      )}
    </div>
  );
}

// Helper for BotArena to get current synthetic rep progress (optional)
export function useBotPhase(tBot:number, isLive:boolean) {
  const phaseRef = useRef(0);
  const lastRef = useRef(performance.now());
  useEffect(()=>{
    let raf=0; let alive=true;
    const loop=()=>{
      if(!alive) return;
      raf=requestAnimationFrame(loop);
      const now=performance.now();
      const dt=(now-lastRef.current)/1000;
      lastRef.current=now;
      if(isLive) phaseRef.current=(phaseRef.current+dt/Math.max(0.5,tBot))%1;
    };
    raf=requestAnimationFrame(loop);
    return()=>{alive=false; cancelAnimationFrame(raf);};
  },[tBot,isLive]);
  return phaseRef;
}
