// pose.worker.ts — runs MediaPipe PoseLandmarker off the main thread
// Main thread stays at 30 FPS UI while inference (10-40ms) runs in parallel.
// NOW: more accurate model search (heavy > lite > github > local) but fast when going fast:
// worker keeps pipeline depth 2 + no main-thread resize squash, so heavy model still delivers ~20-30 FPS inference
// while UI holds 30 FPS. Fast reps use velocity-aware thresholds inside usePoseEngine.

import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

let landmarker: PoseLandmarker | null = null;
let initDone = false;
let activeModel: string | null = null;

type InitMsg = {
  type: 'init';
  wasmUrl: string;
  modelAssetPath: string;
  fallbackPath: string;
  fullModelPath?: string;
  fullModelHeavyLatest?: string;
  githubCandidates?: string[];
  numPoses: number;
  minPoseDetectionConfidence: number;
  minPosePresenceConfidence: number;
  minTrackingConfidence: number;
  preferHeavy?: boolean;
};

type FrameMsg = {
  type: 'frame';
  id: number;
  timestamp: number;
  bitmap: ImageBitmap;
};

self.onmessage = async (e: MessageEvent<InitMsg | FrameMsg>) => {
  const msg: any = e.data;

  if (msg.type === 'init') {
    const init: InitMsg = msg;
    try {
      const vision = await FilesetResolver.forVisionTasks(init.wasmUrl as any);
      const Lite = init.modelAssetPath;
      const Heavy = init.fullModelPath || init.fullModelHeavyLatest || '';
      const HeavyLatest = init.fullModelHeavyLatest || Heavy;
      const Local = init.fallbackPath;
      const githubCandidates: string[] = init.githubCandidates || [];
      const preferHeavy = !!init.preferHeavy;

      const ordered: string[] = [];
      if (preferHeavy) {
        ordered.push(Heavy, HeavyLatest, ...githubCandidates.filter(u => u.includes('heavy') || u.includes('full')), Lite, Local);
      } else {
        // mobile-fast: Lite first, but Heavy second for accurate upgrade if device can handle it
        ordered.push(Lite, Heavy, HeavyLatest, ...githubCandidates, Local);
      }
      const candidates = [...new Set(ordered.filter(Boolean))];

      // HEAD probe to rank (more accurate search — skip 404 CDN)
      async function rank(urls: string[]): Promise<string[]> {
        try {
          const checks = await Promise.all(urls.slice(0,4).map(async u => {
            if (u.startsWith('/') || u.startsWith('blob:')) return { u, ok: true };
            try {
              const ctrl = new AbortController();
              const t = setTimeout(()=>ctrl.abort(), 1800);
              const r = await fetch(u, { method: 'HEAD', signal: ctrl.signal } as any);
              clearTimeout(t);
              return { u, ok: r.ok };
            } catch { return { u, ok: false }; }
          }));
          const ok = checks.filter(c=>c.ok).map(c=>c.u);
          const fail = urls.filter(u=>!ok.includes(u));
          return [...ok, ...fail];
        } catch { return urls; }
      }
      const ranked = await rank(candidates);

      const tryCreate = async (path: string, delegate: 'GPU' | 'CPU') => {
        const p = PoseLandmarker.createFromOptions(vision as any, {
          baseOptions: { modelAssetPath: path, delegate },
          runningMode: 'VIDEO',
          numPoses: init.numPoses,
          minPoseDetectionConfidence: init.minPoseDetectionConfidence,
          minPosePresenceConfidence: init.minPosePresenceConfidence,
          minTrackingConfidence: init.minTrackingConfidence,
        });
        const timeout = new Promise<never>((_, rej)=> setTimeout(()=> rej(new Error('timeout')), 12000));
        return Promise.race([p, timeout]) as Promise<PoseLandmarker>;
      };

      const attempts: [string, 'GPU' | 'CPU'][] = [];
      for (const u of ranked) attempts.push([u,'GPU'],[u,'CPU']);

      let lastErr:any=null;
      for (const [path, delegate] of attempts) {
        try {
          landmarker = await tryCreate(path, delegate);
          activeModel = path;
          (self as any).postMessage({ type: 'ready', model: path, delegate });
          initDone = true;
          return;
        } catch (err) { lastErr = err; }
      }
      (self as any).postMessage({ type: 'error', error: String(lastErr) });
    } catch (err: any) {
      (self as any).postMessage({ type: 'error', error: String(err?.message || err) });
    }
    return;
  }

  if (msg.type === 'frame') {
    if (!initDone || !landmarker) return;
    const { id, timestamp, bitmap } = msg as FrameMsg;
    try {
      const result: any = (landmarker as any).detectForVideo(bitmap, timestamp);
      let landmarks: any = null;
      if (result?.landmarks?.length) {
        const raw = result.landmarks[0];
        landmarks = raw.map((p: any) => ({
          x: p.x,
          y: p.y,
          z: p.z ?? 0,
          visibility: p.visibility ?? (p as any).visibility ?? 1,
        }));
      }
      (self as any).postMessage({ type: 'result', id, timestamp, landmarks, model: activeModel });
    } catch {
      (self as any).postMessage({ type: 'result', id, timestamp, landmarks: null, model: activeModel });
    } finally {
      try { (bitmap as any).close?.(); } catch {}
    }
  }

  if (msg.type === 'close') {
    try { landmarker?.close(); } catch {}
    landmarker = null;
    activeModel = null;
    // @ts-ignore
    close();
  }
};
