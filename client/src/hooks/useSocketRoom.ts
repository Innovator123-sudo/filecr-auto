import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

const SERVER_URL = (import.meta as any).env?.VITE_SERVER_URL || '';

export interface RoomState {
  code: string;
  phase: 'lobby' | 'countdown' | 'live' | 'finished';
  mode: 'target' | 'timer' | 'free';
  targetReps?: number;
  timerSec?: number;
  players: { id: string; nickname: string; ready: boolean; repCount: number }[];
  countdownAt?: number;
  winner?: string;
}

export function useSocketRoom(code?: string, nickname?: string) {
  const socketRef = useRef<Socket | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [connected, setConnected] = useState(false);
  const [opponentRep, setOpponentRep] = useState<number>(0);
  // Landmarks arrive at ~15 FPS — writing them to React state re-renders the whole
  // arena 15x/sec and tears down the canvas render loop (the "glitching" bug).
  // Refs keep the hot path outside React; consumers read them in their own rAF loop.
  const opponentLandmarksRef = useRef<any>(null);
  const lastGhostAtRef = useRef(0);

  useEffect(() => {
    const s = io(SERVER_URL, { transports: ['websocket'], autoConnect: true });
    socketRef.current = s;
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('room_state', (r: RoomState) => setRoom(r));
    s.on('opponent_rep', (d: { repCount: number }) => setOpponentRep(d.repCount));
    s.on('opponent_landmarks', (lm: any) => {
      opponentLandmarksRef.current = lm;
      lastGhostAtRef.current = performance.now();
    });
    s.on('match_end', (r: RoomState) => setRoom(r));
    return () => { s.disconnect(); };
  }, []);

  const createRoom = useCallback((opts: { nickname: string; mode: string; targetReps?: number; timerSec?: number }) => {
    socketRef.current?.emit('create_room', opts, (res: any) => {
      if (res?.room) setRoom(res.room);
    });
  }, []);

  const joinInfoRef = useRef<{ code: string; nickname: string } | null>(null);
  const joinRoom = useCallback((c: string, nick: string) => {
    joinInfoRef.current = { code: c, nickname: nick };
    socketRef.current?.emit('join_room', { code: c, nickname: nick }, (res: any) => {
      if (res?.room) setRoom(res.room);
      if (res?.error) alert(res.error);
    });
  }, []);

  // dropped tunnel/socket → rejoin automatically so the match survives blips
  useEffect(() => {
    const s = socketRef.current;
    if (!s) return;
    const onConnect = () => {
      const info = joinInfoRef.current;
      if (info) s.emit('join_room', info, () => {});
    };
    s.on('connect', onConnect);
    return () => { s.off('connect', onConnect); };
  }, []);

  const setReady = useCallback(() => socketRef.current?.emit('participant_ready', { code: room?.code }), [room?.code]);
  const sendRep = useCallback((rep: number, formScore: number) => {
    socketRef.current?.emit('rep_scored', { code: room?.code, repCount: rep, formScore, ts: Date.now() });
  }, [room?.code]);
  const sendLandmarks = useCallback((lm: any) => {
    socketRef.current?.emit('landmarks', { code: room?.code, landmarks: lm });
  }, [room?.code]);
  const forfeit = useCallback(() => socketRef.current?.emit('forfeit', { code: room?.code }), [room?.code]);

  // auto-join if code+nickname provided
  useEffect(() => {
    if (code && nickname && socketRef.current?.connected) {
      joinRoom(code, nickname);
    }
  }, [code, nickname, connected, joinRoom]);

  return { socket: socketRef.current, room, connected, opponentRep, opponentLandmarksRef, lastGhostAtRef, createRoom, joinRoom, setReady, sendRep, sendLandmarks, forfeit };
}
