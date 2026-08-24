import { useParams } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState, useRef } from 'react';
import { CameraStage } from '../components/CameraStage';
import { OpponentStage } from '../components/OpponentStage';
import { RepRing } from '../components/RepRing';
import { CountdownOverlay } from '../components/CountdownOverlay';
import { useSocketRoom } from '../hooks/useSocketRoom';
import { usePeerVideo } from '../hooks/usePeerVideo';
import { useCountdown } from '../hooks/useCountdown';
import type { RepEvent } from '../engine/types';

// recharts is ~500 kB — only load it when the graph actually renders
const PaceGraph = lazy(() => import('../components/PaceGraph').then(m => ({ default: m.PaceGraph })));
const GraphFallback = () => <div className="h-40 rounded-2xl bg-surface animate-pulse" />;

export function RoomArena() {
  const { code } = useParams<{ code: string }>();
  // stable for the lifetime of this page — otherwise every re-render invents a new
  // random fallback name and the label / "me" lookup desync from what joinRoom sent
  const [nickname] = useState(() => {
    const saved = sessionStorage.getItem(`nick:${code}`);
    if (saved) return saved;
    const generated = `Player-${Math.floor(Math.random()*999)}`;
    sessionStorage.setItem(`nick:${code}`, generated);
    return generated;
  });
  const { socket, room, connected, opponentRep, opponentLandmarksRef, lastGhostAtRef, joinRoom, setReady, sendRep, sendLandmarks } = useSocketRoom(code, nickname);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const { remoteStream } = usePeerVideo({ socket, connected, code, players: room?.players ?? [], localStream, audioStream });
  const [myReps, setMyReps] = useState(0);
  const [myHistory, setMyHistory] = useState<number[]>([]);
  const [oppHistory, setOppHistory] = useState<number[]>([]);
  const [phase, setPhase] = useState<'lobby'|'countdown'|'live'|'finished'>('lobby');
  const lastLandmarkSend = useRef(0);

  // join on mount if not already
  useEffect(() => { if (code && nickname) joinRoom(code, nickname); }, [code]);

  useEffect(() => { if (room?.phase) setPhase(room.phase as any); }, [room?.phase]);

  const { left, phase: cdPhase } = useCountdown(room?.countdownAt);

  useEffect(() => {
    // accumulate history for graph
    if (myReps) setMyHistory(h => [...h, myReps]);
  }, [myReps]);
  useEffect(() => {
    if (opponentRep) setOppHistory(h => [...h, opponentRep]);
  }, [opponentRep]);

  const isLive = phase === 'live' || cdPhase === 'go';
  const shareLink = `${window.location.origin}/room/${code}`;

  const handleRep = (ev: RepEvent) => {
    setMyReps(ev.repNumber);
    sendRep(ev.repNumber, ev.formScore);
    // win check client-side optimistic; server is authority
  };

  const handleLandmarks = (lm: any) => {
    const now = performance.now();
    if (now - lastLandmarkSend.current < 66) return; // ~15 FPS
    lastLandmarkSend.current = now;
    sendLandmarks(lm);
  };

  // First tap requests mic permission and adds the track to the peer connection
  // (auto-renegotiates). Later taps just mute/unmute the track — no renegotiation.
  const toggleMic = async () => {
    setMicError(null);
    try {
      if (!audioStream) {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Mic not supported here — open the https link');
        }
        const s = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        audioStreamRef.current = s;
        setAudioStream(s);
        setMicOn(true);
      } else {
        const next = !micOn;
        audioStream.getAudioTracks().forEach(t => { t.enabled = next; });
        setMicOn(next);
      }
    } catch (e: any) {
      setMicError(e?.message || 'Microphone access denied');
    }
  };

  // release mic hardware when leaving the room
  useEffect(() => () => {
    audioStreamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  const me = room?.players.find(p => p.nickname === nickname);
  const opp = room?.players.find(p => p.nickname !== nickname);
  const lead = myReps - opponentRep;
  const target = room?.targetReps ?? 50;

  if (!connected) return <div className="min-h-screen bg-ink flex items-center justify-center text-zinc-400">Connecting…</div>;

  return (
    <div className="min-h-screen bg-ink p-4 md:p-6">
      <CountdownOverlay left={left} phase={cdPhase} />

      <div className="max-w-6xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="px-3 py-1 rounded-full bg-white/10 mono text-sm">ROOM {code}</div>
            <button onClick={() => navigator.clipboard.writeText(shareLink)} className="px-3 py-1 rounded-full bg-brand text-white text-xs font-bold">Copy Link</button>
            <button
              onClick={toggleMic}
              title={micOn ? 'Mute microphone' : 'Turn on microphone — your friend will hear you'}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition ${micOn ? 'bg-emerald-500 text-white shadow-[0_0_12px_rgba(34,197,94,0.5)]' : 'bg-white/10 text-zinc-300 hover:text-white'}`}
            >
              {micOn ? '🎤 Mic ON' : '🎤 Mic OFF'}
            </button>
            {micError && <span className="text-xs text-red-400">{micError}</span>}
            <span className="text-xs text-zinc-500 hidden md:inline">{shareLink}</span>
          </div>
          <div className="text-xs text-zinc-400">{room?.mode.toUpperCase()} {room?.mode==='target'? `· first to ${target}` : room?.mode==='timer'? `· ${room?.timerSec}s` : '· endless'}</div>
        </div>

        {phase==='lobby' && (
          <div className="mt-6 glass rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-4">
            <div>
              <div className="font-bold">Lobby — {room?.players.length ?? 0}/2 players</div>
              <div className="text-sm text-zinc-400">{room?.players.map(p=>`${p.nickname}${p.ready?' ✓':''}`).join(' · ') || 'Waiting…'}</div>
            </div>
            <button onClick={setReady} className={`px-6 py-3 rounded-full font-black ${me?.ready ? 'bg-emerald-500 text-white' : 'bg-white text-black'}`}>
              {me?.ready ? 'Ready ✓ — waiting for opponent' : 'Ready →'}
            </button>
          </div>
        )}

        {phase==='finished' && (
          <div className="mt-6 bg-emerald-600 rounded-2xl p-6 text-center">
            <div className="text-2xl font-black">🏆 {room?.winner ? `${room.winner} wins!` : 'Match finished'}</div>
            <a href={`/results/${code}`} className="inline-block mt-3 px-5 py-2 bg-white text-black rounded-full font-bold text-sm">View Results →</a>
          </div>
        )}

        {/* split view */}
        <div className="grid md:grid-cols-[1fr_220px_1fr] gap-4 mt-6">
          <CameraStage enabled={true} onRep={handleRep} onLandmarks={handleLandmarks} onStream={setLocalStream} label={nickname} />

          <div className="flex flex-col items-center gap-4 order-first md:order-none">
            <RepRing count={myReps} target={target} />
            <div className={`px-4 py-2 rounded-full font-black text-sm ${lead>0?'bg-emerald-500 text-white':lead<0?'bg-red-500 text-white':'bg-white/10'}`}>
              {lead===0 ? 'TIED' : lead>0 ? `YOU LEAD +${lead}` : `TRAIL ${lead}`}
            </div>
            {room?.mode==='target' && <div className="text-xs text-zinc-500">First to {target} wins</div>}
            <div className="w-full glass rounded-xl p-3 text-center">
              <div className="text-[11px] tracking-widest text-zinc-500">OPPONENT</div>
              <div className="text-3xl font-black mono">{opponentRep}</div>
              <div className="text-xs text-zinc-400">{opp?.nickname || '—'}</div>
            </div>
          </div>

          <OpponentStage
            landmarksRef={opponentLandmarksRef}
            lastSeenAtRef={lastGhostAtRef}
            repCount={opponentRep}
            nickname={opp?.nickname}
            remoteStream={remoteStream}
          />
        </div>

        <div className="mt-4">
          <Suspense fallback={<GraphFallback />}>
            <PaceGraph you={myHistory} opponent={oppHistory} />
          </Suspense>
        </div>

        <p className="mt-3 text-[11px] text-zinc-600 text-center">Live cam + pose ghost are direct P2P WebRTC (landmarks ~15 FPS, video never touches the server). Rep events validated server-side (≥600 ms, ≤2.5 rps).</p>
      </div>
    </div>
  );
}
