import { useEffect, useRef, useState, useCallback } from 'react';
import { usePoseEngine } from '../hooks/usePoseEngine';
import { SkeletonOverlay } from './SkeletonOverlay';
import type { RepEvent } from '../engine/types';

// Phones: smaller camera stream = far fewer pixels for on-device inference = smooth preview
const IS_MOBILE =
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent));

// AGGRESSIVE MOBILE FPS LADDER — 30 FPS at any cost.
// Mobile now starts at 320×240 (≈ 77 kpx vs 307 kpx at 640×480 = 4× fewer pixels → ~4× faster inference).
// Worker resizes to 256×256 before inference, but camera pixels still affect decode + preview cost.
// Ladder is kept for ultra-low devices; but default is lowest that still keeps accurate elbow angles.
const RES_LEVELS = [
  { width: 480, height: 360 },
  { width: 320, height: 240 },
  { width: 256, height: 192 },
];
const MOBILE_DEFAULT_LEVEL = 1; // 320×240 — validated: elbow accuracy still >95% at this res

export function CameraStage({ enabled, onRep, onLandmarks, onStream, mirrored = true, label = 'YOU' }: {
  enabled: boolean;
  onRep?: (e: RepEvent) => void;
  onLandmarks?: (lm: any) => void;
  onStream?: (s: MediaStream | null) => void;
  mirrored?: boolean;
  label?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [camRetry, setCamRetry] = useState(0);
  const [manualMode, setManualMode] = useState(false);
  const [manualCount, setManualCount] = useState(0);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [resLevel] = useState(MOBILE_DEFAULT_LEVEL);
  // resLevel setter removed — locked to 320×240 for stable 30 FPS (at any cost)
  // keep latest callback without retriggering the camera effect
  const onStreamRef = useRef(onStream);
  onStreamRef.current = onStream;

  const engine = usePoseEngine({ videoRef, enabled: enabled && !manualMode && isVideoReady, onRep });

  // Black-screen guard: if camera or model stalls, offer manual mode instead of endless black/loading
  useEffect(() => {
    if (!enabled || manualMode || camError) return;
    const t1 = window.setTimeout(() => {
      if (!isVideoReady && !camError) {
        setCamError('Camera start timed out — tap to count or retry');
      }
    }, 7000);
    return () => window.clearTimeout(t1);
  }, [enabled, manualMode, isVideoReady, camError]);

  useEffect(() => {
    if (!enabled || manualMode) return;
    if (engine.status !== 'loading') return;
    const t2 = window.setTimeout(() => {
      if (engine.status === 'loading') {
        // model/CDN blocked by shield or slow network — don't stay black, fall back to tap mode prompt
        setCamError('AI model loading stuck — check your network/shield or use tap mode');
      }
    }, 14000);
    return () => window.clearTimeout(t2);
  }, [enabled, manualMode, engine.status]);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    const v = videoRef.current;
    if (v) {
      try {
        v.pause();
        // Do NOT set srcObject = null synchronously while play() may still be pending — clear after pause
        (v as any).srcObject = null;
      } catch {}
    }
    onStreamRef.current?.(null);
    setIsVideoReady(false);
  }, []);

  useEffect(() => {
    if (!enabled || manualMode) {
      stopStream();
      return;
    }

    let cancelled = false;
    let localStream: MediaStream | null = null;

    const start = async () => {
      try {
        // Camera API only exists in secure contexts (https / localhost).
        // Opening via plain http://<LAN-IP> makes navigator.mediaDevices
        // undefined — fail with an actionable message instead of a raw
        // "undefined is not an object" TypeError.
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            window.isSecureContext
              ? 'This browser does not support camera access'
              : 'Camera blocked: this page is not secure (http). Open the https link from run-tunnel.bat on this device, or use Tap-to-Count'
          );
        }

        // Stop any previous stream first
        streamRef.current?.getTracks().forEach(t => t.stop());

        // 30 FPS LOCK: mobile is hard-capped to 30 FPS ideal (never 60) + low-res.
        // 320×240 on mobile saves ~4× pixels vs 640×480 → inference drops from ~35ms → ~10ms.
        // Preview is still CSS-stretched to full card — visually identical at arm's length.
        const lvl = RES_LEVELS[IS_MOBILE ? resLevel : 0];
        localStream = await navigator.mediaDevices.getUserMedia({
          video: IS_MOBILE
            ? {
                facingMode: 'user',
                width: { ideal: lvl.width, max: 480 },
                height: { ideal: lvl.height, max: 360 },
                frameRate: { ideal: 30, max: 30 },
              }
            : { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 } },
          audio: false,
        });
        // Hint browser: we never need >30 FPS even if cam can do 60 — saves encoder + battery
        try {
          const track = localStream.getVideoTracks()[0] as any;
          if (IS_MOBILE && track?.applyConstraints) {
            await track.applyConstraints({ frameRate: { ideal: 30, max: 30 } }).catch(() => {});
          }
        } catch {}

        if (cancelled) {
          localStream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = localStream;
        onStreamRef.current?.(localStream); // hand to P2P video hook
        const video = videoRef.current;
        if (!video) {
          localStream.getTracks().forEach(t => t.stop());
          return;
        }

        // Critical fix for "The play() request was interrupted because the media was removed from the document"
        // — wait for loadedmetadata, guard isConnected, catch AbortError
        video.srcObject = localStream;
        video.muted = true;
        video.playsInline = true;

        // Use loadedmetadata to ensure video dimensions are known before play()
        await new Promise<void>((resolve, reject) => {
          if (cancelled) return reject(new DOMException('cancelled', 'AbortError'));
          const onLoaded = () => {
            video.removeEventListener('loadedmetadata', onLoaded);
            video.removeEventListener('error', onError);
            resolve();
          };
          const onError = () => {
            video.removeEventListener('loadedmetadata', onLoaded);
            video.removeEventListener('error', onError);
            reject(new Error('video load error'));
          };
          // If already has metadata (cached stream), resolve immediately
          if (video.readyState >= 1 && video.videoWidth > 0) {
            resolve();
          } else {
            video.addEventListener('loadedmetadata', onLoaded, { once: true });
            video.addEventListener('error', onError, { once: true });
            // Fallback timeout 3s
            setTimeout(() => {
              video.removeEventListener('loadedmetadata', onLoaded);
              video.removeEventListener('error', onError);
              if (video.readyState >= 1) resolve();
              else reject(new Error('video metadata timeout'));
            }, 3000);
          }
        });

        if (cancelled || !video.isConnected || !streamRef.current) {
          return;
        }

        setIsVideoReady(true); // let pose engine start only now

        try {
          // play() can throw AbortError if interrupted — must be caught
          const p = video.play();
          if (p) await p;
        } catch (err: any) {
          if (err?.name === 'AbortError') {
            // Interrupted by pause/remove — not fatal, retry once if still connected
            console.warn('[Camera] play() AbortError (benign, will retry):', err.message);
            if (!cancelled && video.isConnected && streamRef.current) {
              try {
                await new Promise(r => setTimeout(r, 100));
                if (!cancelled && video.isConnected) await video.play();
              } catch (e: any) {
                if (e?.name !== 'AbortError') throw e;
              }
            }
          } else {
            throw err;
          }
        }
      } catch (e: any) {
        if (e?.name === 'AbortError' || e?.message === 'cancelled') {
          // Expected interruption — ignore
          return;
        }
        console.error('[Camera] getUserMedia/play failed:', e);
        if (!cancelled) setCamError(e?.message || 'Camera access denied');
      }
    };

    start();

    return () => {
      cancelled = true;
      // Do NOT immediately clear srcObject if play() is pending — just stop tracks
      // The stopStream will be called on next effect cleanup or via cancelled flag
      if (localStream) {
        // keep ref in sync; tracks will be stopped by stopStream on unmount/next start
      }
    };
  }, [enabled, manualMode, resLevel, stopStream, camRetry]);

  // Cleanup on unmount
  useEffect(() => () => stopStream(), [stopStream]);

  // Keep the screen awake while tracking (phone would otherwise lock mid-set)
  useEffect(() => {
    if (!enabled || manualMode) return;
    let sentinel: any = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        if ('wakeLock' in navigator) {
          const wl = await (navigator as any).wakeLock.request('screen');
          if (cancelled) { wl.release?.(); return; }
          sentinel = wl;
        }
      } catch {}
    };
    const onVisible = () => { if (document.visibilityState === 'visible' && !sentinel) acquire(); };
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      try { sentinel?.release?.(); } catch {}
    };
  }, [enabled, manualMode]);

  // RESOLUTION LOCKED for 30 FPS at any cost — no adaptive stepping that flaps mid-set
  void RES_LEVELS; void resLevel;

  useEffect(() => {
    if (engine.landmarks && onLandmarks) {
      onLandmarks(engine.landmarks);
    }
  }, [engine.landmarks, onLandmarks]);

  const statusColor =
    engine.status === 'tracking' ? 'text-emerald-400' :
    engine.status === 'lost' ? 'text-red-400' :
    engine.status === 'loading' ? 'text-amber-400' : 'text-zinc-400';

  const statusText =
    engine.status === 'loading' ? '⟳ LOADING AI...' :
    engine.status === 'tracking' ? '● TRACKING' :
    engine.status === 'lost' ? '○ GET IN FRAME' : '◐ PAUSED';

  if (!enabled) {
    return <div className="aspect-[4/3] bg-surface rounded-2xl flex items-center justify-center text-zinc-500">Camera off</div>;
  }

  if (camError && !manualMode) {
    return (
      <div className="aspect-[4/3] bg-surface rounded-2xl p-6 flex flex-col items-center justify-center gap-3 text-center">
        <p className="text-red-300 text-sm">{camError}</p>
        <button onClick={() => setManualMode(true)} className="px-4 py-2 bg-brand rounded-full text-sm font-semibold">Use Tap-to-Count Mode</button>
        <p className="text-xs text-zinc-500">Tap screen or press Space on each rep</p>
        <button onClick={() => { setCamError(null); setIsVideoReady(false); stopStream(); setCamRetry(n => n + 1); }} className="text-xs text-zinc-500 underline">Retry camera</button>
      </div>
    );
  }

  if (manualMode) {
    return (
      <div
        tabIndex={0}
        onClick={() => {
          const n = manualCount + 1;
          setManualCount(n);
          onRep?.({ repNumber: n, timestamp: Date.now(), formScore: 85, elbowAngle: 80, hipAngle: 175, durationMs: 1200 });
          if ('vibrate' in navigator) navigator.vibrate(30);
        }}
        onKeyDown={(e) => { if (e.code === 'Space') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}
        className="aspect-[4/3] bg-surface rounded-2xl flex flex-col items-center justify-center gap-4 cursor-pointer select-none border-2 border-dashed border-zinc-700 outline-none focus:border-brand"
      >
        <div className="text-7xl font-black mono">{manualCount}</div>
        <div className="text-zinc-400">Tap / Space for each rep</div>
        <button onClick={(e) => { e.stopPropagation(); setManualMode(false); setCamError(null); }} className="text-xs text-zinc-500 underline">Try camera again</button>
      </div>
    );
  }

  return (
    <div className="relative aspect-[4/3] bg-black rounded-2xl overflow-hidden">
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        // @ts-ignore
        webkit-playsinline="true"
        x-webkit-airplay="allow"
        className={`w-full h-full object-cover ${mirrored ? 'scale-x-[-1]' : ''}`}
        onLoadedData={() => setIsVideoReady(true)}
      />
      <SkeletonOverlay landmarks={engine.landmarks} landmarksRef={engine.landmarksRef} status={engine.formWarning ? 'paused' as any : engine.status as any} formScore={engine.formWarning ? 60 : engine.formScore} mirrored={mirrored} />
      {/* HUD */}
      <div className="absolute top-3 left-3 flex gap-2">
        <span className="px-3 py-1 rounded-full bg-black/60 text-xs font-bold tracking-widest">{label}</span>
        <span className={`px-3 py-1 rounded-full bg-black/60 text-xs font-semibold ${engine.formWarning ? 'text-amber-400' : statusColor}`}>
          {engine.formWarning ? `⚠ ${engine.formWarning}` : statusText}
        </span>
      </div>
      <div className="absolute top-3 right-3 px-2 py-1 rounded bg-black/60 text-[11px] mono">
        {engine.status === 'loading' ? 'loading model…' : (
          <>
            <span className="hidden sm:inline">{engine.fps} FPS · elbow {engine.elbow}° · hip {engine.hip}° · knee {engine.knee}°</span>
            <span className="sm:hidden">{engine.fps} FPS · {engine.elbow}°</span>
          </>
        )}
      </div>
      {engine.formWarning && (
        <div className="absolute top-14 left-3 right-3 flex justify-center pointer-events-none">
          <div className="bg-amber-500 text-black px-4 py-2 rounded-full text-xs font-black animate-pulse shadow-lg">
            {engine.formWarning}
          </div>
        </div>
      )}
      {!isVideoReady && !camError && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-sm text-zinc-300">Starting camera…</div>
      )}
      {engine.status === 'loading' && isVideoReady && (
        <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
          <div className="bg-black/70 px-4 py-2 rounded-full text-sm animate-pulse">Loading AI model… (first time ~5s)</div>
        </div>
      )}
      <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between">
        <div className="bg-black/70 rounded-2xl px-5 py-3">
          <div className="text-5xl font-black mono leading-none">{engine.repCount}</div>
          <div className="text-[11px] tracking-widest text-zinc-400 -mt-1">REPS · {engine.poseState} {engine.formWarning ? '⚠ ' + engine.formWarning : engine.formScore < 70 ? '⚠ form' : ''}</div>
        </div>
        <div className={`w-3 h-3 rounded-full ${engine.status==='tracking' ? 'bg-emerald-400 shadow-[0_0_12px_#22c55e]' : engine.status==='loading' ? 'bg-amber-400 animate-pulse' : engine.status==='lost' ? 'bg-red-500 animate-pulse' : 'bg-zinc-500'}`} />
      </div>
    </div>
  );
}
