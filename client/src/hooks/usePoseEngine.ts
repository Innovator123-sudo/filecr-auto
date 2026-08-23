import { useEffect, useRef, useState, useCallback } from 'react';
import { createPoseLandmarker, detectLandmarks } from '../engine/poseLandmarker';
import { elbowAngle, hipAngle, meanVisibility, smoothLandmarks, velocityAdaptiveAlpha, isPushupPostureValid } from '../engine/math';
import { RepStateMachine, DEFAULT_MACHINE_CONFIG } from '../engine/repStateMachine';
import type { Landmark, RepEvent, PoseState } from '../engine/types';
import type { TrackingStatus } from '../engine/types';
import { CRITICAL_INDICES } from '../engine/types';
import { playRepBeep } from '../engine/sound';
import poseConfig from '../config/pose-config.json';

type ExtendedStatus = TrackingStatus | 'loading';

const ARM_IDX_LIST = [
  CRITICAL_INDICES.leftShoulder, CRITICAL_INDICES.rightShoulder,
  CRITICAL_INDICES.leftElbow, CRITICAL_INDICES.rightElbow,
  CRITICAL_INDICES.leftWrist, CRITICAL_INDICES.rightWrist,
];
const LOWER_IDX_LIST = [
  CRITICAL_INDICES.leftHip, CRITICAL_INDICES.rightHip,
  CRITICAL_INDICES.leftKnee, CRITICAL_INDICES.rightKnee,
  CRITICAL_INDICES.leftAnkle, CRITICAL_INDICES.rightAnkle,
];

const IS_MOBILE =
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent));

// FPS TARGET: 30 FPS UI, ≥15 FPS inference on any device.
// Worker offloads inference so UI never janks. Same target on mobile & desktop —
// 45 FPS was too ambitious for CPU fallback and starved <15 FPS devices.
const LOCK_FPS = 30;
const BASE_DETECT_MS = 33; // 30 FPS gate
const MAX_DETECT_MS = 50; // allow slower devices to at least hold 15-20 FPS
const WORKER_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

export interface UsePoseEngineOpts {
  videoRef: React.RefObject<HTMLVideoElement>;
  enabled: boolean;
  onRep?: (ev: RepEvent) => void;
}

export function usePoseEngine({ videoRef, enabled, onRep }: UsePoseEngineOpts) {
  const [repCount, setRepCount] = useState(0);
  const [poseState, setPoseState] = useState<PoseState>('UP');
  const [status, setStatus] = useState<ExtendedStatus>('paused');
  const [elbow, setElbow] = useState(180);
  const [hip, setHip] = useState(180);
  const [knee, setKnee] = useState(180);
  const [formScore, setFormScore] = useState(100);
  const [fps, setFps] = useState(0);
  const [landmarks, setLandmarks] = useState<Landmark[] | null>(null);
  const [formWarning, setFormWarning] = useState<string | null>(null);

  const landmarksRef = useRef<Landmark[] | null>(null);
  const elbowRef = useRef(180); const hipRef = useRef(180); const kneeRef = useRef(180);
  const machineRef = useRef<RepStateMachine | null>(null);
  const smoothedRef = useRef<Landmark[] | null>(null);
  const rafRef = useRef<number>(0);
  const lastHudUpdate = useRef(0);
  const frameCountRef = useRef(0);
  const fpsTimeRef = useRef(performance.now());
  const aliveRef = useRef(true);
  const warningTimeoutRef = useRef<number | null>(null);
  const lastDetectTime = useRef(0);
  const fpsShownRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
  const lastPoseStateRef = useRef<PoseState | null>(null);
  const lastStatusRef = useRef<string | null>(null);
  const lastRawElbowRef = useRef<number | null>(null);
  const lastRawTimeRef = useRef<number>(0);

  const onRepRef = useRef(onRep);
  onRepRef.current = onRep;

  const getMachine = useCallback(() => {
    if (!machineRef.current) {
      machineRef.current = new RepStateMachine({
        ...DEFAULT_MACHINE_CONFIG,
        visibilityThreshold: IS_MOBILE ? 0.38 : DEFAULT_MACHINE_CONFIG.visibilityThreshold,
      });
      machineRef.current.onRep = (ev) => {
        setRepCount(ev.repNumber);
        setFormScore(ev.formScore);
        setFormWarning(null);
        if ('vibrate' in navigator) navigator.vibrate(35);
        playRepBeep();
        onRepRef.current?.(ev);
      };
    }
    return machineRef.current;
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (landmarksRef.current) setLandmarks(landmarksRef.current);
      const now = performance.now();
      if (now - lastHudUpdate.current > 120) {
        setElbow(elbowRef.current);
        setHip(hipRef.current);
        setKnee(kneeRef.current);
        lastHudUpdate.current = now;
      }
    }, 120);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    if (!enabled) {
      setStatus('paused');
      cancelAnimationFrame(rafRef.current);
      // @ts-ignore
      if ((rafRef as any)._rvfc) cancelAnimationFrame((rafRef as any)._rvfc);
      return () => { aliveRef.current = false; cancelAnimationFrame(rafRef.current); };
    }

    let landmarker: any = null;
    let rvfcId: number | null = null;
    let worker: Worker | null = null;
    let workerReady = false;
    // pipeline depth 2: overlap frame-transfer with inference instead of strict
    // lockstep (depth 1 stalls the camera handoff every other frame)
    let inflight = 0;
    const MAX_INFLIGHT = 2;
    let captureCanvas: HTMLCanvasElement | null = null;
    let captureCtx: CanvasRenderingContext2D | null = null;
    let fallbackToMain = false;

    const tryGetCaptureCtx = () => {
      if (captureCanvas && captureCtx) return captureCtx;
      captureCanvas = document.createElement('canvas');
      // 256×256 square — MediaPipe internally square-crops, avoids aspect math cost
      captureCanvas.width = 256;
      captureCanvas.height = 256;
      captureCtx = captureCanvas.getContext('2d', { alpha: false } as any) as unknown as CanvasRenderingContext2D | null;
      if (captureCtx) {
        // @ts-ignore low quality for speed
        captureCtx.imageSmoothingEnabled = true;
        // @ts-ignore
        if ('imageSmoothingQuality' in captureCtx) (captureCtx as any).imageSmoothingQuality = 'low';
      }
      return captureCtx;
    };

    // Shared landmark handling — used by both worker and main path
    const handleLandmarks = (lm: Landmark[] | null, now: number) => {
      const machine = getMachine();
      if (!lm) {
        if (aliveRef.current && lastStatusRef.current !== 'lost') { lastStatusRef.current = 'lost'; setStatus('lost'); }
        return;
      }
      // Velocity-adaptive smoothing: when moving fast, use higher alpha (more
      // responsive) so fast reps aren't missed; slow reps keep lower alpha for
      // jitter suppression. Applied on ALL devices.
      const baseAlpha = (poseConfig as any).smoothingAlpha ?? 0.22;
      const fastAlpha = (poseConfig as any).fastSmoothingAlpha ?? (poseConfig as any).fastMode?.smoothingAlphaFast ?? 0.55;
      const velThresh = (poseConfig as any).fastMode?.velocityThresholdDegPerSec ?? 160;
      let smoothAlpha = baseAlpha;
      const dt = now - lastRawTimeRef.current;
      if (lastRawElbowRef.current != null && dt > 5 && dt < 400) {
        // quick raw angle estimate from current landmarks (pre-smooth) for velocity detection
        const C = CRITICAL_INDICES;
        const quickEL = elbowAngle(lm[C.leftShoulder], lm[C.leftElbow], lm[C.leftWrist]);
        const quickER = elbowAngle(lm[C.rightShoulder], lm[C.rightElbow], lm[C.rightWrist]);
        const confLq = Math.min(lm[C.leftShoulder]?.visibility ?? 0, lm[C.leftElbow]?.visibility ?? 0);
        const confRq = Math.min(lm[C.rightShoulder]?.visibility ?? 0, lm[C.rightElbow]?.visibility ?? 0);
        const quickEa = (confLq >= 0.5 && confRq >= 0.5) ? (quickEL + quickER) / 2 : (confLq >= confRq ? quickEL : quickER);
        smoothAlpha = velocityAdaptiveAlpha(baseAlpha, fastAlpha, quickEa, lastRawElbowRef.current, dt, velThresh);
      } else if (IS_MOBILE) {
        smoothAlpha = 0.32;
      }
      const smoothed = smoothLandmarks(smoothedRef.current, lm, smoothAlpha);
      smoothedRef.current = smoothed;
      landmarksRef.current = smoothed;

      // ── Face / posture math gate ──
      // When user just shows face upright, torso is vertical → reject before state machine
      const posture = isPushupPostureValid(smoothed);
      if (!posture.valid) {
        // still update HUD angles for debug but don't feed elbow to counter
        const C0 = CRITICAL_INDICES;
        const eaL0 = elbowAngle(smoothed[C0.leftShoulder], smoothed[C0.leftElbow], smoothed[C0.leftWrist]);
        const eaR0 = elbowAngle(smoothed[C0.rightShoulder], smoothed[C0.rightElbow], smoothed[C0.rightWrist]);
        const confL0 = Math.min(smoothed[C0.leftShoulder]?.visibility ?? 0, smoothed[C0.leftElbow]?.visibility ?? 0);
        const confR0 = Math.min(smoothed[C0.rightShoulder]?.visibility ?? 0, smoothed[C0.rightElbow]?.visibility ?? 0);
        const ea0 = (confL0 >= 0.5 && confR0 >= 0.5) ? (eaL0 + eaR0) / 2 : (confL0 >= confR0 ? eaL0 : eaR0);
        const ha0 = hipAngle(smoothed[C0.leftShoulder], smoothed[C0.leftHip], smoothed[C0.leftKnee]);
        const ka0 = hipAngle(smoothed[C0.leftHip], smoothed[C0.leftKnee], smoothed[C0.leftAnkle]);
        elbowRef.current = Math.round(ea0); hipRef.current = Math.round(ha0); kneeRef.current = Math.round(ka0);
        lastRawElbowRef.current = ea0; lastRawTimeRef.current = now;
        if (aliveRef.current) {
          setFormWarning(posture.reason || 'Get into pushup position');
          if (warningTimeoutRef.current) window.clearTimeout(warningTimeoutRef.current);
          // keep warning visible while posture stays invalid; will be cleared on valid frame
          warningTimeoutRef.current = window.setTimeout(() => setFormWarning(null), 900) as any;
          // do NOT advance state machine — prevents face-triggered counts
        }
        return;
      }

      const armVis = meanVisibility(smoothed, ARM_IDX_LIST);
      const lowerVis = meanVisibility(smoothed, LOWER_IDX_LIST);
      const lowerBodyVisible = lowerVis >= ((poseConfig as any).lowerBodyVisibilityThreshold ?? 0.45);

      const C = CRITICAL_INDICES;
      const eaL = elbowAngle(smoothed[C.leftShoulder], smoothed[C.leftElbow], smoothed[C.leftWrist]);
      const eaR = elbowAngle(smoothed[C.rightShoulder], smoothed[C.rightElbow], smoothed[C.rightWrist]);
      const confL = Math.min(smoothed[C.leftShoulder]?.visibility ?? 0, smoothed[C.leftElbow]?.visibility ?? 0, smoothed[C.leftWrist]?.visibility ?? 0);
      const confR = Math.min(smoothed[C.rightShoulder]?.visibility ?? 0, smoothed[C.rightElbow]?.visibility ?? 0, smoothed[C.rightWrist]?.visibility ?? 0);
      const ea = (confL >= 0.5 && confR >= 0.5) ? (eaL + eaR) / 2 : (confL >= confR ? eaL : eaR);
      const ha = hipAngle(smoothed[C.leftShoulder], smoothed[C.leftHip], smoothed[C.leftKnee]);
      const ka = hipAngle(smoothed[C.leftHip], smoothed[C.leftKnee], smoothed[C.leftAnkle]);
      elbowRef.current = Math.round(ea); hipRef.current = Math.round(ha); kneeRef.current = Math.round(ka);
      lastRawElbowRef.current = ea;
      lastRawTimeRef.current = now;
      if (aliveRef.current) {
        const plank = machine.isPlankValid(ha, ka, lowerBodyVisible);
        if (!plank.valid && ea > 150) {
          const reason = ka < (poseConfig as any).kneeStraightThresholdDeg ? 'Straighten legs!' : 'Keep back straight!';
          setFormWarning(reason);
          if (warningTimeoutRef.current) window.clearTimeout(warningTimeoutRef.current);
          warningTimeoutRef.current = window.setTimeout(() => setFormWarning(null), 800) as any;
        }
        const res = machine.update({ elbowAngle: ea, hipAngle: ha, kneeAngle: ka, meanVisibility: armVis, now, lowerBodyVisible });
        if (res.state !== lastPoseStateRef.current) { lastPoseStateRef.current = res.state; setPoseState(res.state); }
        const st = res.status as ExtendedStatus;
        if (st !== lastStatusRef.current) { lastStatusRef.current = st; setStatus(st); }
        if ((res as any).rejectReason) {
          setFormWarning((res as any).rejectReason);
          if (warningTimeoutRef.current) window.clearTimeout(warningTimeoutRef.current);
          warningTimeoutRef.current = window.setTimeout(() => setFormWarning(null), 2200) as any;
        } else if (res.counted) setFormWarning(null);
      }
    };

    (async () => {
      try {
        setStatus('loading' as ExtendedStatus);
        // Always prefer worker — it keeps UI at 30 FPS even when inference is slow
        const useWorker = typeof Worker !== 'undefined' && !fallbackToMain;
        // Try worker first on mobile — it guarantees 30 FPS UI
        if (useWorker) {
          // two attempts: transient CDN/wasm hiccups must NOT push us to the
          // main-thread path (that's what caps weak phones below 15 FPS)
          for (let attempt = 1; attempt <= 2 && !workerReady; attempt++) {
            try {
              const pc: any = (poseConfig as any).pose;
              worker = new Worker(new URL('../engine/pose.worker.ts', import.meta.url), { type: 'module' });
              const readyPromise = new Promise<void>((resolve, reject) => {
                const t = setTimeout(() => reject(new Error('worker init timeout')), 30000);
                worker!.onmessage = (e: MessageEvent<any>) => {
                  const d = e.data;
                  if (d.type === 'ready') {
                    clearTimeout(t);
                    workerReady = true;
                    // switch to tracking, attach result handler
                    worker!.onmessage = (ev: MessageEvent<any>) => {
                      const r = ev.data;
                      if (r.type === 'result') {
                        inflight = Math.max(0, inflight - 1);
                        frameCountRef.current += 1;
                        // fps calc
                        const now = r.timestamp || performance.now();
                        if (now - fpsTimeRef.current > 500) {
                          const curFps = Math.round((frameCountRef.current * 1000) / (now - fpsTimeRef.current));
                          const shown = fpsShownRef.current ? Math.round(fpsShownRef.current * 0.6 + curFps * 0.4) : curFps;
                          fpsShownRef.current = shown;
                          if (aliveRef.current) setFps(Math.min(shown, 34)); // cap display
                          frameCountRef.current = 0;
                          fpsTimeRef.current = performance.now();
                        }
                        if (!aliveRef.current) return;
                        if (!r.landmarks) {
                          if (lastStatusRef.current !== 'lost') { lastStatusRef.current = 'lost'; setStatus('lost'); }
                          return;
                        }
                        handleLandmarks(r.landmarks as Landmark[], now);
                      } else if (r.type === 'error') {
                        console.error('[PoseWorker] error', r.error);
                        fallbackToMain = true;
                      }
                    };
                    worker!.onerror = (err) => {
                      console.error('[PoseWorker] onerror', err);
                      fallbackToMain = true;
                    };
                    resolve();
                  } else if (d.type === 'error') {
                    clearTimeout(t);
                    reject(new Error(d.error));
                  }
                };
                worker!.onerror = (err) => { clearTimeout(t); reject(err); };
                (worker as Worker).postMessage({
                  type: 'init',
                  wasmUrl: WORKER_WASM_URL,
                  modelAssetPath: pc.modelAssetPath,
                  fallbackPath: pc.localModelPath || '/models/pose_landmarker_lite.task',
                  fullModelPath: pc.fullModelPath,
                  fullModelHeavyLatest: pc.fullModelHeavyLatest,
                  githubCandidates: pc.githubCandidates || [],
                  // FPS-first: always lite for speed; heavy only as fallback inside worker
                  preferHeavy: false,
                  numPoses: pc.numPoses ?? 1,
                  minPoseDetectionConfidence: pc.minPoseDetectionConfidence ?? 0.5,
                  minPosePresenceConfidence: pc.minPosePresenceConfidence ?? 0.5,
                  minTrackingConfidence: pc.minTrackingConfidence ?? 0.5,
                });
              });
              await readyPromise;
              if (!aliveRef.current) return;
              setStatus('tracking');
            } catch (wErr) {
              console.warn(`[PoseEngine] Worker init attempt ${attempt} failed`, wErr);
              try { worker?.terminate(); } catch {}
              worker = null;
              workerReady = false;
              if (attempt === 2) fallbackToMain = true;
            }
          }
        }

        if (!workerReady) {
          // Main-thread fallback: always lite when worker fails — guarantees ≥15 FPS
          landmarker = await createPoseLandmarker(false);
          if (!aliveRef.current) return;
          setStatus('tracking');
        }

        const machine = getMachine();
        void machine;
        fpsTimeRef.current = performance.now();
        frameCountRef.current = 0;
        lastDetectTime.current = 0;
        lastPoseStateRef.current = null;
        lastStatusRef.current = null;
        const hasRVFC = typeof (HTMLVideoElement.prototype as any).requestVideoFrameCallback === 'function';
        let detectMs = BASE_DETECT_MS;
        let lastInferDuration = 0;

        const captureAndPost = async (video: HTMLVideoElement, now: number) => {
          if (!worker || !workerReady || inflight >= MAX_INFLIGHT) return;
          inflight++;
          try {
            // FPS fix: always downscale to 256×256 before sending to worker.
            // MediaPipe's internal model input is 256×256 — sending 640×480 wastes
            // ~4× pixels for zero accuracy gain and halves FPS on CPU devices.
            // A single drawImage (1–2 ms) saves ~30–60 ms of inference.
            // Letterbox preserve aspect so elbow/hip math stays geometrically correct.
            let bitmap: ImageBitmap | null = null;
            try {
              const ctx = tryGetCaptureCtx();
              if (ctx && captureCanvas) {
                const vw = video.videoWidth || captureCanvas.width;
                const vh = video.videoHeight || captureCanvas.height;
                const cw = captureCanvas.width, ch = captureCanvas.height;
                const scale = Math.min(cw / vw, ch / vh);
                const w = vw * scale, h = vh * scale;
                const dx = (cw - w) / 2, dy = (ch - h) / 2;
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, cw, ch);
                ctx.drawImage(video, dx, dy, w, h);
                bitmap = await createImageBitmap(captureCanvas);
              } else {
                bitmap = await createImageBitmap(video);
              }
            } catch {
              try { bitmap = await createImageBitmap(video); } catch { bitmap = null; }
            }
            if (!bitmap) { inflight--; return; }
            if (!aliveRef.current) { try { bitmap.close(); } catch {}; inflight--; return; }
            try {
              (worker as Worker).postMessage({ type: 'frame', id: now, timestamp: now, bitmap } as any, [bitmap as any]);
            } catch {
              try { (worker as Worker).postMessage({ type: 'frame', id: now, timestamp: now, bitmap } as any); } catch {}
              try { (bitmap as any).close?.(); } catch {}
              inflight--;
            }
          } catch {
            inflight--;
          }
        };

        const processFrame = (now: number) => {
          if (!aliveRef.current) return;
          const video = videoRef.current;
          if (!video || !video.isConnected || video.readyState < 2 || video.videoWidth === 0) return;
          if (video.currentTime === lastVideoTimeRef.current) return;
          lastVideoTimeRef.current = video.currentTime;
          if (now - lastDetectTime.current < detectMs) return;
          lastDetectTime.current = now;

          if (workerReady && worker) {
            // Worker path: never block main thread
            // count FPS based on attempted sends (capped)
            // don't double-count: fps counted on result; but keep gate
            void captureAndPost(video, now);
            return;
          }

          // Main-thread path — must be very fast; measure duration to adapt
          const t0 = performance.now();
          const lm = detectLandmarks(landmarker, video, now);
          const dur = performance.now() - t0;
          lastInferDuration = dur;
          frameCountRef.current += 1;
          if (now - fpsTimeRef.current > 500) {
            const curFps = Math.round((frameCountRef.current * 1000) / (now - fpsTimeRef.current));
            const shown = fpsShownRef.current ? Math.round(fpsShownRef.current * 0.6 + curFps * 0.4) : curFps;
            fpsShownRef.current = shown;
            if (aliveRef.current) setFps(shown);
            frameCountRef.current = 0;
            fpsTimeRef.current = performance.now();
            // FPS fix: keep gate tight so main thread can still hit ≥15 FPS.
            // Only back off if inference itself is very slow (>35 ms ≈ 28 FPS budget).
            if (dur > 35 && detectMs < MAX_DETECT_MS) {
              detectMs = Math.min(MAX_DETECT_MS, detectMs + 2);
            } else if (dur < 20 && detectMs > BASE_DETECT_MS) {
              detectMs = Math.max(BASE_DETECT_MS, detectMs - 2);
            }
          }
          // even if dur is high, we still processed; duration-based FPS
          void lastInferDuration;
          if (!lm) {
            if (aliveRef.current && lastStatusRef.current !== 'lost') { lastStatusRef.current = 'lost'; setStatus('lost'); }
            return;
          }
          handleLandmarks(lm as any, now);
        };

        if (hasRVFC) {
          const video = videoRef.current!;
          const rvfcLoop = () => {
            if (!aliveRef.current || !video) return;
            // @ts-ignore
            rvfcId = video.requestVideoFrameCallback((now: number, _meta: any) => {
              processFrame(now);
              if (aliveRef.current) rvfcLoop();
            });
          };
          rvfcLoop();
        } else {
          const loop = (now: number) => {
            if (!aliveRef.current) return;
            rafRef.current = requestAnimationFrame(loop);
            processFrame(now);
          };
          rafRef.current = requestAnimationFrame(loop);
        }
      } catch (e) {
        console.error('[PoseEngine] init failed', e);
        if (aliveRef.current) setStatus('lost');
      }
    })();

    return () => {
      aliveRef.current = false;
      cancelAnimationFrame(rafRef.current);
      if (rvfcId != null) {
        const v = videoRef.current as any;
        try { v?.cancelVideoFrameCallback?.(rvfcId); } catch {}
      }
      if (warningTimeoutRef.current) window.clearTimeout(warningTimeoutRef.current);
      try { worker?.postMessage({ type: 'close' }); } catch {}
      try { worker?.terminate(); } catch {}
    };
  }, [enabled, videoRef, getMachine]);
  const reset = useCallback(() => { machineRef.current?.reset(); setRepCount(0); setFormScore(100); setFormWarning(null); smoothedRef.current = null; landmarksRef.current = null; setLandmarks(null); }, []);
  const calibrate = useCallback((up: number, down: number) => { getMachine().updateThresholds(up, down); }, [getMachine]);

  return { repCount, poseState, status: status as any, elbow, hip, knee, formScore, formWarning, fps, landmarks: (landmarksRef.current || landmarks) as any, landmarksRef, reset, calibrate } as any;
}
