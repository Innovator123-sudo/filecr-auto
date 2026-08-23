import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchTopSongs, streamUrl } from './api';
import type { Song } from './api';

interface PlayerState {
  current: Song | null;
  queue: Song[];
  isPlaying: boolean;
  botMode: boolean;
  progress: number;
  duration: number;
  volume: number;
  loading: boolean;
  playSong: (song: Song, queue?: Song[]) => void;
  addToQueue: (song: Song) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (t: number) => void;
  setVolume: (v: number) => void;
  setBotMode: (on: boolean) => void;
}

const Ctx = createContext<PlayerState | null>(null);

export function useMusic(): PlayerState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useMusic must be used inside <MusicProvider>');
  return ctx;
}

export function MusicProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  if (!audioRef.current && typeof Audio !== 'undefined') {
    audioRef.current = new Audio();
    (audioRef.current as any).preload = 'auto';
  }

  const [queue, setQueue] = useState<Song[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [botMode, setBotModeState] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.85);
  const [loading, setLoading] = useState(false);

  // refs so audio event handlers always see latest values without re-binding
  const queueRef = useRef<Song[]>([]);
  const currentRef = useRef<Song | null>(null);
  const botRef = useRef(false);
  const historyRef = useRef<Set<string>>(new Set());
  const playedFromBotRef = useRef(0);

  queueRef.current = queue;
  botRef.current = botMode;

  const current = useMemo(() => queue.find((s) => s.id === currentId) ?? null, [queue, currentId]);
  currentRef.current = current;

  const startSong = useCallback((song: Song) => {
    const audio = audioRef.current;
    if (!audio) return;
    setLoading(true);
    setCurrentId(song.id);
    setProgress(0);
    setDuration(Number(song.duration) || 0);
    historyRef.current.add(song.id);
    if (botRef.current) playedFromBotRef.current += 1;
    audio.src = streamUrl(song);
    audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
  }, []);

  // Bot DJ refill: when the queue is done (or empty) and bot mode is on,
  // pull JioSaavn top songs and keep the party going automatically.
  const botNext = useCallback(async () => {
    setLoading(true);
    try {
      let pool = await fetchTopSongs(30);
      pool = pool.filter((s) => !historyRef.current.has(s.id));
      if (!pool.length) {
        // everything heard already — reset history and reuse the full list
        historyRef.current.clear();
        pool = await fetchTopSongs(30);
      }
      if (!pool.length) return;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      startSong(pick);
    } catch {
      setLoading(false);
    }
  }, [startSong]);

  const next = useCallback(() => {
    const q = queueRef.current;
    const idx = q.findIndex((s) => s.id === currentRef.current?.id);
    if (idx >= 0 && idx < q.length - 1) {
      startSong(q[idx + 1]);
      return;
    }
    if (idx >= 0 && idx === q.length - 1) {
      // end of queue
      if (botRef.current) botNext();
      else setIsPlaying(false);
      return;
    }
    if (q.length) startSong(q[0]);
    else if (botRef.current) botNext();
  }, [startSong, botNext]);

  const prev = useCallback(() => {
    const q = queueRef.current;
    const idx = q.findIndex((s) => s.id === currentRef.current?.id);
    if (idx > 0) startSong(q[idx - 1]);
    else if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
  }, [startSong]);

  // bind audio element events once
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setProgress(audio.currentTime);
    const onMeta = () => setDuration(audio.duration || 0);
    const onEnd = () => next();
    const onErr = () => {
      setLoading(false);
      setIsPlaying(false);
      // broken/unavailable track — skip forward (bot keeps going)
      if (botRef.current || queueRef.current.length > 1) setTimeout(next, 300);
    };
    const onPlay = () => { setIsPlaying(true); setLoading(false); };
    const onPause = () => setIsPlaying(false);
    const onWaiting = () => setLoading(true);

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('durationchange', onMeta);
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('error', onErr);
    audio.addEventListener('playing', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('waiting', onWaiting);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('durationchange', onMeta);
      audio.removeEventListener('ended', onEnd);
      audio.removeEventListener('error', onErr);
      audio.removeEventListener('playing', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('waiting', onWaiting);
    };
  }, [next]);

  const playSong = useCallback((song: Song, list?: Song[]) => {
    if (list?.length) setQueue(list);
    else if (!queueRef.current.some((s) => s.id === song.id)) setQueue((prevQ) => [...prevQ, song]);
    startSong(song);
  }, [startSong]);

  const addToQueue = useCallback((song: Song) => {
    setQueue((q) => (q.some((s) => s.id === song.id) ? q : [...q, song]));
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!currentRef.current) {
      // nothing loaded yet — behave like the bot pressing play
      setBotModeState(true);
      botNext();
      return;
    }
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }, [botNext]);

  const seek = useCallback((t: number) => {
    const audio = audioRef.current;
    if (audio && isFinite(t)) audio.currentTime = t;
  }, []);

  const setVolume = useCallback((v: number) => {
    setVolumeState(v);
    if (audioRef.current) audioRef.current.volume = v;
  }, []);

  const setBotMode = useCallback((on: boolean) => {
    setBotModeState(on);
    if (!on) return;
    playedFromBotRef.current = 0;
    const audio = audioRef.current;
    // turning the bot ON starts music immediately if idle/paused
    if (!audio || audio.paused) {
      if (!currentRef.current) botNext();
      else audio?.play().catch(() => {});
    }
  }, [botNext]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, []);

  const value: PlayerState = {
    current,
    queue,
    isPlaying,
    botMode,
    progress,
    duration,
    volume,
    loading,
    playSong,
    addToQueue,
    toggle,
    next,
    prev,
    seek,
    setVolume,
    setBotMode,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
