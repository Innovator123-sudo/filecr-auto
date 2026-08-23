import type { Landmark } from './types';

// More accurate 3D angle at elbow: uses x,y,z for depth-aware angle (side-view vs front-view)
// Falls back to 2D if z is 0 (lite model still has z)
export function elbowAngle(shoulder: Landmark, elbow: Landmark, wrist: Landmark): number {
  const vESx = shoulder.x - elbow.x;
  const vESy = shoulder.y - elbow.y;
  const vESz = (shoulder.z ?? 0) - (elbow.z ?? 0);
  const vEWx = wrist.x - elbow.x;
  const vEWy = wrist.y - elbow.y;
  const vEWz = (wrist.z ?? 0) - (elbow.z ?? 0);
  const dot = vESx * vEWx + vESy * vEWy + vESz * vEWz;
  const magES = Math.hypot(vESx, vESy, vESz);
  const magEW = Math.hypot(vEWx, vEWy, vEWz);
  if (magES < 1e-6 || magEW < 1e-6) return 180;
  const cos = Math.max(-1, Math.min(1, dot / (magES * magEW)));
  return (Math.acos(cos) * 180) / Math.PI;
}

export function hipAngle(shoulder: Landmark, hip: Landmark, knee: Landmark): number {
  const vHSx = shoulder.x - hip.x;
  const vHSy = shoulder.y - hip.y;
  const vHSz = (shoulder.z ?? 0) - (hip.z ?? 0);
  const vHKx = knee.x - hip.x;
  const vHKy = knee.y - hip.y;
  const vHKz = (knee.z ?? 0) - (hip.z ?? 0);
  const dot = vHSx * vHKx + vHSy * vHKy + vHSz * vHKz;
  const magHS = Math.hypot(vHSx, vHSy, vHSz);
  const magHK = Math.hypot(vHKx, vHKy, vHKz);
  if (magHS < 1e-6 || magHK < 1e-6) return 180;
  const cos = Math.max(-1, Math.min(1, dot / (magHS * magHK)));
  return (Math.acos(cos) * 180) / Math.PI;
}

export function meanVisibility(landmarks: Landmark[], indices: number[]): number {
  if (!indices.length) return 0;
  let s = 0;
  for (const i of indices) s += landmarks[i]?.visibility ?? 0;
  return s / indices.length;
}

// EMA smoothing; alpha = weight of current frame (higher = more responsive, less lag)
// For fast reps we want higher alpha so elbow crossing isn't delayed.
export function smoothLandmarks(prev: Landmark[] | null, curr: Landmark[], alpha: number): Landmark[] {
  if (!prev) return curr.map(l => ({ ...l }));
  return curr.map((c, i) => {
    const p = prev[i];
    if (!p) return { ...c };
    return {
      x: alpha * c.x + (1 - alpha) * p.x,
      y: alpha * c.y + (1 - alpha) * p.y,
      z: alpha * c.z + (1 - alpha) * p.z,
      visibility: c.visibility,
    };
  });
}

// Velocity-aware alpha: when moving fast, reduce smoothing lag so fast reps aren't missed
export function velocityAdaptiveAlpha(
  baseAlpha: number,
  fastAlpha: number,
  elbowAngle: number,
  prevElbow: number | null,
  dtMs: number,
  velThreshold = 160
): number {
  if (prevElbow == null || dtMs <= 0) return baseAlpha;
  const velocity = Math.abs(elbowAngle - prevElbow) / (dtMs / 1000); // deg/s
  if (velocity > velThreshold * 1.8) return fastAlpha;
  if (velocity > velThreshold) return baseAlpha + (fastAlpha - baseAlpha) * 0.6;
  // interpolate smoothly
  const t = Math.min(1, velocity / velThreshold);
  return baseAlpha + (fastAlpha - baseAlpha) * t * 0.4;
}

export function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

// ─── Pushup posture validation — prevents face-up false positives ───
// Uses 3D torso inclination math: in a real pushup the torso is roughly
// horizontal (≈90° from gravity), while standing / showing face is vertical.
// VertRatio = |ty| / |torso|  → 0 = horizontal, 1 = vertical.
// Nose-vs-shoulder y offset catches frontal standing even when hips are
// out of frame (upper-body-only mode previously counted any elbow motion).
export interface PostureCheck {
  valid: boolean;
  reason?: string;
  vertRatio?: number;
  noseDy?: number;
  hipDy?: number;
}

export function isPushupPostureValid(landmarks: Landmark[]): PostureCheck {
  if (!landmarks || landmarks.length < 25) return { valid: true };
  const NOSE = 0;
  const L_SH = 11, R_SH = 12, L_HIP = 23, R_HIP = 24;
  const nose = landmarks[NOSE] as Landmark | undefined;
  const lSh = landmarks[L_SH] as Landmark | undefined;
  const rSh = landmarks[R_SH] as Landmark | undefined;
  const lHip = landmarks[L_HIP] as Landmark | undefined;
  const rHip = landmarks[R_HIP] as Landmark | undefined;
  if (!lSh || !rSh) return { valid: true };

  const visSh = Math.min(lSh.visibility ?? 0, rSh.visibility ?? 0);
  const visHip = Math.min(lHip?.visibility ?? 0, rHip?.visibility ?? 0);
  const visNose = nose?.visibility ?? 0;
  const lowerVisible = !!lHip && !!rHip && visHip >= 0.38 && visSh >= 0.38;

  // 1) Torso verticality via 3D math (|ty| / |torso|)
  if (lowerVisible && lHip && rHip) {
    const midSh = { x: (lSh.x + rSh.x) / 2, y: (lSh.y + rSh.y) / 2, z: ((lSh.z ?? 0) + (rSh.z ?? 0)) / 2 };
    const midHip = { x: (lHip.x + rHip.x) / 2, y: (lHip.y + rHip.y) / 2, z: ((lHip.z ?? 0) + (rHip.z ?? 0)) / 2 };
    const tx = midSh.x - midHip.x;
    const ty = midSh.y - midHip.y;
    const tz = midSh.z - midHip.z;
    const mag = Math.hypot(tx, ty, tz);
    if (mag > 1e-6) {
      const vertRatio = Math.abs(ty) / mag; // 0 horizontal → 1 vertical
      // pushup: ~0.05–0.35; inclined pushup ~0.45–0.65; standing ~0.85–1.0
      // threshold 0.75 ≈ 41° from vertical (49° from horizontal) — allows incline, blocks upright
      if (vertRatio > 0.75) {
        return { valid: false, reason: 'Get into pushup plank — body too vertical', vertRatio };
      }
      // 2D fallback: hip far below shoulder in image = standing
      const dy2d = midHip.y - midSh.y; // >0 if hip below shoulder
      if (dy2d > 0.22) {
        return { valid: false, reason: 'Get into plank — hips too low', vertRatio, hipDy: dy2d };
      }
    }
  }

  // 2) Face-up check — nose clearly above shoulders = standing / showing face
  // Works even when hips are out of frame (upper-body-only)
  if (visNose > 0.45 && visSh > 0.42 && nose) {
    const midShY = (lSh.y + rSh.y) / 2;
    const noseDy = midShY - nose.y; // positive → nose above shoulders
    // plank side: nose ≈ shoulder y or slightly above (neutral head at the
    // BOTTOM of a pushup puts the nose 0.05–0.14 above the shoulder line!)
    // standing face-forward: nose well above → noseDy ≳ 0.2
    // 0.15 keeps real reps tracking through the bottom without counting
    // upright arm-waving as pushups.
    if (noseDy > 0.15) {
      return { valid: false, reason: 'Face up — flip to plank', noseDy };
    }
  }

  return { valid: true };
}
