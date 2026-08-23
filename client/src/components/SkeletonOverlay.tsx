import { useEffect, useRef } from 'react';
import type { Landmark, TrackingStatus } from '../engine/types';
import { SKELETON_CONNECTIONS, SKELETON_MAX_LANDMARK } from '../engine/types';

function colorFor(status: TrackingStatus, formScore: number) {
  if (status === 'lost') return '#EF4444';
  if (status === 'paused') return '#9CA3AF';
  if (formScore < 70) return '#F59E0B';
  return '#22C55E';
}

// AGGRESSIVE MOBILE 30 FPS CAP — at any cost
// DPR 1 on touch (vs 2-3 before) = 4-9× fewer pixels → massive GPU saving.
// Draw interval 33ms on mobile (30 FPS) vs 21ms desktop (45 FPS). Bias to smooth UI, not max draws.
const IS_TOUCH = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
const MAX_DPR = IS_TOUCH ? 1 : 2;
const DRAW_INTERVAL_MS = IS_TOUCH ? 33 : 22; // 30 FPS mobile, 45 desktop

export function SkeletonOverlay({ landmarks, landmarksRef, status, formScore, mirrored = true }: {
  landmarks: Landmark[] | null;
  landmarksRef?: React.MutableRefObject<Landmark[] | null>;
  status: TrackingStatus;
  formScore: number;
  mirrored?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const lastDrawRef = useRef(0);
  const propsRef = useRef({ landmarks, status, formScore });
  propsRef.current = { landmarks, status, formScore };

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d', { alpha: true } as any) as unknown as CanvasRenderingContext2D | null;
    if (!ctx) return;

    let alive = true;
    let curLandmarks = landmarks;
    let curStatus = status;
    let curFormScore = formScore;

    let rectW = 0, rectH = 0;
    const measure = () => {
      const r = c.getBoundingClientRect();
      rectW = r.width; rectH = r.height;
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(c);
    window.addEventListener('resize', measure);

    const draw = (now: number) => {
      if (!alive) return;
      rafRef.current = requestAnimationFrame(draw);
      if (now - lastDrawRef.current < DRAW_INTERVAL_MS) return;
      lastDrawRef.current = now;

      ({ landmarks: curLandmarks, status: curStatus, formScore: curFormScore } = propsRef.current);

      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      if (rectW === 0 || rectH === 0) { measure(); if (rectW === 0 || rectH === 0) return; }
      const needW = Math.round(rectW * dpr);
      const needH = Math.round(rectH * dpr);
      if (c.width !== needW || c.height !== needH) {
        c.width = needW;
        c.height = needH;
      }
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.clearRect(0,0,rectW, rectH);

      const lm = (landmarksRef?.current || curLandmarks) as Landmark[] | null;
      if (!lm) return;

      const col = colorFor(curStatus, curFormScore);
      // batch all bones in ONE path where possible to cut stroke() calls, but we still need per-segment visibility
      // For mobile, thin lines = faster rasterization
      ctx.lineWidth = IS_TOUCH ? 2.2 : 2.8;
      ctx.strokeStyle = col;
      // shadowBlur is ultra-slow (forces extra pass) — disabled on ALL mobiles now (was only disabled on touch before shadows)
      if (!IS_TOUCH) { ctx.shadowColor = col; ctx.shadowBlur = 6; }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Build single path for all visible bones — one stroke call instead of N
      ctx.beginPath();
      let hasPath = false;
      for (const [a,b] of SKELETON_CONNECTIONS) {
        const p1 = lm[a], p2 = lm[b];
        if (!p1 || !p2) continue;
        if ((p1.visibility ?? 0) < 0.3 || (p2.visibility ?? 0) < 0.3) continue;
        const x1 = mirrored ? (1 - p1.x) * rectW : p1.x * rectW;
        const y1 = p1.y * rectH;
        const x2 = mirrored ? (1 - p2.x) * rectW : p2.x * rectW;
        const y2 = p2.y * rectH;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        hasPath = true;
      }
      if (hasPath) ctx.stroke();
      ctx.shadowBlur = 0;

      // Joints — single fill pass
      ctx.fillStyle = col;
      let dotCount = 0;
      for (let i = 0; i < lm.length; i++) {
        if (i > SKELETON_MAX_LANDMARK) break;
        const lmPt = lm[i];
        if ((lmPt.visibility ?? 0) < 0.38) continue; // slightly higher threshold = fewer dots on mobile
        const x = mirrored ? (1 - lmPt.x) * rectW : lmPt.x * rectW;
        const y = lmPt.y * rectH;
        ctx.moveTo(x + 2.8, y);
        ctx.arc(x, y, IS_TOUCH ? 2.6 : 3.2, 0, Math.PI * 2);
        dotCount++;
        if (dotCount > 24) break; // safety cap
      }
      ctx.fill();
      // inner highlight skipped on mobile — saves 12 extra arcs
      if (!IS_TOUCH) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        for (let i = 0; i < lm.length; i++) {
          if (i > SKELETON_MAX_LANDMARK) break;
          const lmPt = lm[i];
          if ((lmPt.visibility ?? 0) < 0.38) continue;
          const x = mirrored ? (1 - lmPt.x) * rectW : lmPt.x * rectW;
          const y = lmPt.y * rectH;
          ctx.moveTo(x + 1.1, y);
          ctx.arc(x, y, 1.0, 0, Math.PI * 2);
        }
        ctx.fill();
      }
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [landmarksRef, mirrored]);

  return <canvas ref={ref} className="absolute inset-0 w-full h-full pointer-events-none" style={{width:'100%', height:'100%'}} />;
}
