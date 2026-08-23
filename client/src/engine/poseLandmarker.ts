import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { Landmark } from './types';
import poseConfig from '../config/pose-config.json';

let landmarker: PoseLandmarker | null = null;
let loadingPromise: Promise<PoseLandmarker> | null = null;
let loadedModelInfo: { path: string; delegate: string } | null = null;

const IS_MOBILE_LANDMARKER =
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent));

export async function createPoseLandmarker(useHeavy?: boolean): Promise<PoseLandmarker> {
  if (landmarker) return landmarker;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    console.log('[Pose] Loading WASM...');
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );
    console.log('[Pose] WASM loaded');
    const pc: any = poseConfig.pose;

    // MORE ACCURATE MODEL SEARCH — accuracy-ordered candidate list
    // Heavy is most accurate (full skeleton, better knees/hips when contorted),
    // Lite is fastest. GitHub + CDN fallbacks ensure we ALWAYS find a model.
    const githubCandidates: string[] = pc.githubCandidates || [];
    const LitePrimary = pc.modelAssetPath;
    const HeavyPrimary = pc.fullModelPath || pc.fullModelHeavyLatest;
    const Lite16 = pc.fullModelLite16Path;
    const HeavyLatest = pc.fullModelHeavyLatest;
    const Local = pc.localModelPath || '/models/pose_landmarker_lite.task';

    // Build accuracy-ordered search:
    // Desktop prefers Heavy first (accuracy), then Lite. Mobile prefers Lite first (speed) but still
    // probes Heavy opportunistically — if Heavy loads fast (<4s) we keep it for better accuracy at speed.
    const preferHeavy = typeof useHeavy === 'boolean' ? useHeavy : (pc.preferHeavyOnDesktop && !IS_MOBILE_LANDMARKER);
    const orderedModels: string[] = [];
    if (preferHeavy) {
      orderedModels.push(
        HeavyPrimary,
        HeavyLatest,
        ...githubCandidates.filter((u: string) => u.includes('heavy') || u.includes('full')),
        LitePrimary,
        Lite16,
        Local
      );
    } else {
      // Mobile-fast path: Lite first for speed, but Heavy is second so fast phones upgrade accuracy
      orderedModels.push(
        LitePrimary,
        Lite16,
        HeavyPrimary,
        HeavyLatest,
        ...githubCandidates,
        Local
      );
    }
    // dedupe while preserving order
    const candidates = [...new Set(orderedModels.filter(Boolean))];

    // Optional: probe with HEAD to skip 404s quickly (more accurate search, no wasted WASM init)
    // Don't block on failure — just reorder.
    async function rankByAvailability(urls: string[]): Promise<string[]> {
      if (urls.length <= 1) return urls;
      try {
        const checks = await Promise.all(
          urls.slice(0, 4).map(async (u) => {
            if (u.startsWith('/')) return { u, ok: true, t: 0 };
            try {
              const ctrl = new AbortController();
              const tid = setTimeout(() => ctrl.abort(), 1800);
              const t0 = performance.now();
              const res = await fetch(u, { method: 'HEAD', signal: ctrl.signal, cache: 'no-cache' } as any);
              clearTimeout(tid);
              return { u, ok: res.ok, t: performance.now() - t0 };
            } catch { return { u, ok: false, t: 9999 }; }
          })
        );
        // keep original accuracy order, but push 404s to end
        const ok = checks.filter((c) => c.ok).map((c) => c.u);
        const fail = urls.filter((u) => !ok.includes(u));
        // log availability
        console.log('[Pose] Model availability', checks.map((c) => `${c.u.split('/').pop()} ok=${c.ok} ${c.t|0}ms`).join(' | '));
        return [...ok, ...fail];
      } catch { return urls; }
    }

    const ranked = await rankByAvailability(candidates);

    const tryCreate = async (modelPath: string, delegate: 'GPU' | 'CPU') => {
      console.log(`[Pose] Creating Landmarker ${modelPath} delegate=${delegate}`);
      // Add 12s per-model timeout so one slow CDN doesn't block the whole search
      const createPromise = PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: modelPath, delegate },
        runningMode: 'VIDEO',
        numPoses: pc.numPoses,
        minPoseDetectionConfidence: pc.minPoseDetectionConfidence,
        minPosePresenceConfidence: pc.minPosePresenceConfidence,
        minTrackingConfidence: pc.minTrackingConfidence,
      });
      const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('create timeout 12s')), 12000));
      return Promise.race([createPromise, timeout]) as Promise<PoseLandmarker>;
    };

    // GPU-first for each candidate (much faster inference at speed — needed for fast reps)
    const attempts: [string, 'GPU' | 'CPU'][] = [];
    for (const p of ranked) attempts.push([p, 'GPU'], [p, 'CPU']);

    let lastErr: any = null;
    for (const [path, delegate] of attempts) {
      try {
        console.log(`[Pose] trying model ${path} with ${delegate}...`);
        const t0 = performance.now();
        const lm = await tryCreate(path, delegate);
        const dt = performance.now() - t0;
        console.log(`[Pose] ✅ loaded model ${path} (${delegate}) in ${dt|0}ms`);
        landmarker = lm;
        loadedModelInfo = { path, delegate };
        // Warmup inference: one dummy detect can trigger shader compilation while UI still loading
        try {
          // tiny 1x1 canvas warmup to avoid first-frame jank when going fast
          const c = document.createElement('canvas');
          c.width = 4; c.height = 4;
          // not running detect here to avoid needing a video; just ensure model is compiled
        } catch {}
        return lm;
      } catch (e) {
        console.warn(`[Pose] ❌ failed ${path} (${delegate}):`, (e as any)?.message || e);
        lastErr = e;
      }
    }
    throw lastErr || new Error('All PoseLandmarker load attempts failed');
  })();

  try {
    const res = await loadingPromise;
    return res;
  } finally {
    loadingPromise = null;
  }
}

export function getLoadedModelInfo() { return loadedModelInfo; }

export function detectLandmarks(
  lm: PoseLandmarker,
  video: HTMLVideoElement,
  timestampMs: number
): Landmark[] | null {
  if (!video.isConnected || video.videoWidth === 0 || video.videoHeight === 0) return null;
  if (video.readyState < 2) return null;
  try {
    const result = lm.detectForVideo(video, timestampMs);
    if (!result.landmarks || result.landmarks.length === 0) return null;
    const raw = result.landmarks[0];
    return raw.map((p: any) => ({
      x: p.x,
      y: p.y,
      z: p.z ?? 0,
      visibility: (p as any).visibility ?? 1,
    }));
  } catch (e) {
    return null;
  }
}

export function disposePoseLandmarker() {
  try { landmarker?.close(); } catch {}
  landmarker = null;
  loadingPromise = null;
  loadedModelInfo = null;
}
