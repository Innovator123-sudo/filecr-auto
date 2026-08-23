import { useEffect, useRef, useState } from 'react';
import { SkeletonOverlay } from './SkeletonOverlay';

// Friend's panel: live P2P camera with their pose skeleton drawn on top.
// Landmarks come in via ref (no React churn) and are rendered by one
// persistent rAF loop inside SkeletonOverlay.
export function OpponentStage({ landmarksRef, lastSeenAtRef, repCount, nickname, remoteStream }: {
  landmarksRef: React.MutableRefObject<any>;
  lastSeenAtRef: React.MutableRefObject<number>;
  repCount: number;
  nickname?: string;
  remoteStream: MediaStream | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ghostFresh, setGhostFresh] = useState(false);

  // cheap staleness check (well under 1 Hz of re-renders)
  useEffect(() => {
    const id = setInterval(() => {
      setGhostFresh(performance.now() - lastSeenAtRef.current < 2000);
    }, 700);
    return () => clearInterval(id);
  }, [lastSeenAtRef]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.srcObject !== remoteStream) v.srcObject = remoteStream;
    if (remoteStream) v.play().catch(() => {});
  }, [remoteStream]);

  return (
    <div className="aspect-[4/3] bg-zinc-900 rounded-2xl relative overflow-hidden border border-white/10">
      {remoteStream && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover scale-x-[-1]"
        />
      )}
      {!remoteStream && <div className="absolute inset-0 bg-gradient-to-b from-zinc-900 to-black" />}

      {/* pose ghost over the video (mirrored to match the mirrored video) */}
      <SkeletonOverlay landmarks={null} landmarksRef={landmarksRef as any} status="tracking" formScore={100} mirrored />

      <div className="absolute top-3 left-3 flex gap-2">
        <span className="px-3 py-1 rounded-full bg-black/60 text-xs font-bold">{nickname || 'FRIEND'}</span>
        <span className={`px-2 py-1 rounded-full bg-black/60 text-[10px] font-semibold ${remoteStream ? 'text-emerald-400' : ghostFresh ? 'text-sky-400' : 'text-zinc-500'}`}>
          {remoteStream ? '● LIVE CAM' : ghostFresh ? '◌ SKELETON SYNC' : '○ CONNECTING…'}
        </span>
      </div>

      {!remoteStream && !ghostFresh && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center px-4 pointer-events-none">
          <div className="text-sm text-zinc-400 font-bold">Connecting to friend…</div>
          <div className="text-[11px] text-zinc-600">P2P cam + skeleton start when both players open this room</div>
        </div>
      )}
      {remoteStream && !ghostFresh && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/60 text-[10px] text-zinc-400">pose sync reconnecting…</div>
      )}

      <div className="absolute bottom-3 left-3 bg-black/70 rounded-xl px-4 py-2">
        <div className="text-3xl font-black mono">{repCount}</div>
        <div className="text-[10px] tracking-widest text-zinc-400">REPS</div>
      </div>
    </div>
  );
}
