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
  isMuted: boolean;
  loading: boolean;
  playSong: (song: Song, queue?: Song[]) => void;
  addToQueue: (song: Song) => void;
  toggle: () => void;
  stop: () => void;
  toggleMute: () => void;
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
  const ytIframeRef = useRef<HTMLIFrameElement | null>(null);
  const [youtubeId, setYoutubeId] = useState<string | null>(null);
  const youtubeIdRef = useRef<string | null>(null);
  youtubeIdRef.current = youtubeId;
  // Create a DOM-attached <audio> so iOS Safari allows playback after a user gesture.
  // new Audio() off-DOM is often blocked on mobile; a mounted element with playsInline is reliable.
  useEffect(() => {
    if (audioRef.current) return;
    if (typeof document === 'undefined') return;
    const a = document.createElement('audio');
    a.preload = 'auto';
    (a as any).playsInline = true;
    a.crossOrigin = 'anonymous';
    a.style.display = 'none';
    // keep hidden but mounted so mobile browsers keep audio session alive
    document.body.appendChild(a);
    audioRef.current = a;
    a.volume = 0.85;
    return () => {
      try { a.pause(); } catch {}
      a.src = '';
      try { document.body.removeChild(a); } catch {}
      if (audioRef.current === a) audioRef.current = null;
    };
  }, []);
  // Fallback for SSR / early calls before effect mounts — still create via Audio() so startSong doesn't crash
  if (!audioRef.current && typeof Audio !== 'undefined' && typeof document === 'undefined') {
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
  const [isMuted, setIsMuted] = useState(false);
  const [loading, setLoading] = useState(false);
  const prevVolumeRef = useRef(0.85);

  // refs so audio event handlers always see latest values without re-binding
  const queueRef = useRef<Song[]>([]);
  const currentRef = useRef<Song | null>(null);
  const botRef = useRef(false);
  const historyRef = useRef<Set<string>>(new Set());
  const playedFromBotRef = useRef(0);
  // anti-cascade guards: consecutive failed tracks, intentional-src-clear flag,
  // and whether the YouTube iframe ACTUALLY started playing (autoplay is often blocked)
  const errStreakRef = useRef(0);
  const clearingAudioRef = useRef(false);
  const ytPlayingRef = useRef(false);
  // true only after the iframe reports an actual "playing" state — gates
  // ended->next so spurious iframe events can't walk the queue
  const ytPlayedOnceRef = useRef(false);
  // Keep volume refs sync for YouTube unmute after autoplay (used in iframe onLoad + message handler)
  const volumeRef = useRef(volume);
  const mutedRef = useRef(isMuted);
  volumeRef.current = volume;
  mutedRef.current = isMuted;

  queueRef.current = queue;
  botRef.current = botMode;

  const current = useMemo(() => queue.find((s) => s.id === currentId) ?? null, [queue, currentId]);
  currentRef.current = current;

  const isYouTubeSong = useCallback((song: Song) => {
    const anyS: any = song as any;
    if (anyS.source === 'youtube') return true;
    if (anyS.videoId) return true;
    if (song.media_url.includes('/api/music/yt/stream')) return true;
    if (song.perma_url?.includes('youtube.com') || song.perma_url?.includes('youtu.be')) return true;
    return false;
  }, []);

  const extractVideoId = useCallback((song: Song): string | null => {
    const anyS: any = song as any;
    if (anyS.videoId) return String(anyS.videoId);
    try {
      const u = new URL(song.media_url, window.location.origin);
      const id = u.searchParams.get('id');
      if (id) return id;
    } catch {}
    // Saavn ids are not 11 char youtube ids, youtube ids are 11 chars
    if (/^[a-zA-Z0-9_-]{11}$/.test(song.id)) return song.id;
    return null;
  }, []);

  const postToYT = useCallback((func: string, args: any[] = []) => {
    const iframe = ytIframeRef.current;
    if (!iframe || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
  }, []);

  const startSong = useCallback((song: Song) => {
    const yt = isYouTubeSong(song);
    const vid = yt ? extractVideoId(song) : null;
    // YouTube path — use iframe, not <audio>
    if (yt && vid) {
      // pause + properly detach any saavn audio.
      // NOTE: a.src='' fires a bogus 'error' event which used to trigger
      // the auto-skip cascade (\"go down to the last\" when playing Nepali
      // search results). removeAttribute+load() is silent, and the
      // clearingAudioRef flag double-guards it — kept async so the
      // micro-task 'error' is still covered.
      if (audioRef.current) {
        const a = audioRef.current;
        clearingAudioRef.current = true;
        try { a.pause(); } catch {}
        try { a.removeAttribute('src'); try { a.load(); } catch {} } catch {}
        setTimeout(() => { clearingAudioRef.current = false; }, 800);
      }
      // keep queue + current refs sync so a transient audio error
      // doesn't see a stale queue and skip to the wrong item
      currentRef.current = song;
      setYoutubeId(vid);
      setCurrentId(song.id);
      setProgress(0);
      setDuration(Number(song.duration) || 0);
      historyRef.current.add(song.id);
      if (botRef.current) playedFromBotRef.current += 1;
      ytPlayingRef.current = false;
      errStreakRef.current = 0;
      setLoading(false);
      // optimistic UI — corrected by iframe onStateChange events (or the
      // watchdog below if autoplay is blocked)
      setIsPlaying(true);
      return;
    }
    // Saavn path — use <audio>
    ytPlayingRef.current = false;
    errStreakRef.current = 0;
    setYoutubeId(null);
    // keep currentRef sync for immediate next()/prev() correctness
    currentRef.current = song;
    let audio = audioRef.current;
    if (!audio && typeof document !== 'undefined') {
      const a = document.createElement('audio');
      a.preload = 'auto';
      (a as any).playsInline = true;
      a.crossOrigin = 'anonymous';
      a.style.display = 'none';
      document.body.appendChild(a);
      audioRef.current = a;
      audio = a;
    }
    if (!audio) return;
    setLoading(true);
    setCurrentId(song.id);
    setProgress(0);
    setDuration(Number(song.duration) || 0);
    historyRef.current.add(song.id);
    if (botRef.current) playedFromBotRef.current += 1;
    if (!isMuted) audio.volume = volume;
    else audio.volume = 0;
    audio.muted = isMuted;
    audio.src = streamUrl(song);
    const p = audio.play();
    if (p && typeof p.then === 'function') {
      p.then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    }
  }, [volume, isMuted, isYouTubeSong, extractVideoId]);

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
    else if (youtubeIdRef.current) {
      postToYT('seekTo', [0, true]);
      setProgress(0);
    } else if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
  }, [startSong, postToYT]);

  // bind audio element events — re-bind when audio element is lazily created
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setProgress(audio.currentTime);
    const onMeta = () => setDuration(audio.duration || 0);
    const onEnd = () => next();
    const onErr = () => {
      // ignore the bogus error fired by an intentional src clear
      // (YouTube switch) and any audio error while a YouTube iframe
      // is active — the iframe has its own error handling
      if (clearingAudioRef.current) return;
      if (youtubeIdRef.current) return;
      setLoading(false);
      setIsPlaying(false);
      // skip forward on a broken track, but CAP the cascade: after 2
      // consecutive failures stop skipping — otherwise one bad network
      // state burns through 5+ queue entries without playing anything
      // (this was the \"go down to the last\" bug for Nepali/YouTube)
      if (errStreakRef.current >= 2) return;
      if (botRef.current || queueRef.current.length > 1) {
        errStreakRef.current += 1;
        setTimeout(next, 300);
      }
    };
    const onPlay = () => { errStreakRef.current = 0; setIsPlaying(true); setLoading(false); };
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
    // keep volume in sync after element creation
    audio.volume = isMuted ? 0 : volume;
    audio.muted = isMuted;
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
  }, [next, isMuted, volume]);

  const playSong = useCallback((song: Song, list?: Song[]) => {
    if (list?.length) {
      setQueue(list);
      // keep ref in sync immediately — startSong + the queued
      // audio 'error' handler both read queueRef synchronously,
      // and setState is async, so without this the queue looks
      // stale and next() jumps to the wrong item (\"goes to last\")
      queueRef.current = list;
      currentRef.current = song;
    } else if (!queueRef.current.some((s) => s.id === song.id)) {
      const nxt = [...queueRef.current, song];
      setQueue(nxt);
      queueRef.current = nxt;
      currentRef.current = song;
    } else {
      currentRef.current = song;
    }
    startSong(song);
  }, [startSong]);

  const addToQueue = useCallback((song: Song) => {
    setQueue((q) => (q.some((s) => s.id === song.id) ? q : [...q, song]));
  }, []);

  const toggle = useCallback(() => {
    // YouTube path
    if (youtubeIdRef.current) {
      if (isPlaying) {
        postToYT('pauseVideo');
        setIsPlaying(false);
      } else {
        postToYT('playVideo');
        setIsPlaying(true);
      }
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (!currentRef.current) {
      setBotModeState(true);
      botNext();
      return;
    }
    if (audio.paused) {
      const p = audio.play();
      if (p?.catch) p.catch(() => {});
    } else audio.pause();
  }, [botNext, isPlaying, postToYT]);

  const stop = useCallback(() => {
    if (youtubeIdRef.current) {
      postToYT('stopVideo');
      setYoutubeId(null);
      setIsPlaying(false);
      setLoading(false);
      setProgress(0);
      setBotModeState(false);
      botRef.current = false;
      return;
    }
    const audio = audioRef.current;
    if (audio) {
      try { audio.pause(); } catch {}
      try { audio.currentTime = 0; } catch {}
      setIsPlaying(false);
    }
    setLoading(false);
    setProgress(0);
    setBotModeState(false);
    botRef.current = false;
  }, [postToYT]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const nextMuted = !prev;
      if (youtubeIdRef.current) {
        if (nextMuted) postToYT('mute');
        else postToYT('unMute');
        return nextMuted;
      }
      const audio = audioRef.current;
      if (audio) {
        if (nextMuted) {
          prevVolumeRef.current = volume;
          audio.muted = true;
          audio.volume = 0;
        } else {
          audio.muted = false;
          audio.volume = prevVolumeRef.current || 0.85;
          setVolumeState(audio.volume);
        }
      }
      return nextMuted;
    });
  }, [volume, postToYT]);

  const seek = useCallback((t: number) => {
    if (youtubeIdRef.current) {
      postToYT('seekTo', [t, true]);
      setProgress(t);
      return;
    }
    const audio = audioRef.current;
    if (audio && isFinite(t)) audio.currentTime = t;
  }, [postToYT]);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    prevVolumeRef.current = clamped;
    if (clamped > 0 && isMuted) setIsMuted(false);
    if (youtubeIdRef.current) {
      postToYT('setVolume', [Math.round(clamped * 100)]);
      if (clamped === 0) postToYT('mute');
      else postToYT('unMute');
      return;
    }
    if (audioRef.current) {
      audioRef.current.volume = clamped;
      audioRef.current.muted = clamped === 0 ? true : isMuted && clamped === 0;
      if (clamped > 0) audioRef.current.muted = false;
    }
  }, [isMuted, postToYT]);

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
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
      audioRef.current.muted = isMuted;
    }
    if (youtubeIdRef.current) {
      if (isMuted) postToYT('mute');
      else { postToYT('unMute'); postToYT('setVolume', [Math.round(volume * 100)]); }
    }
  }, [volume, isMuted, postToYT]);

  // YouTube progress simulation (YT iframe doesn't expose timeupdate like <audio>)
  // We poll via postMessage and also simulate locally for smooth bar
  useEffect(() => {
    if (!youtubeId || !isPlaying) return;
    const dur = Number(current?.duration) || 180;
    const id = setInterval(() => {
      setProgress((p) => {
        const np = p + 1;
        if (np >= dur) {
          // auto-next when track ends — ONLY if the iframe actually played;
          // otherwise a blocked-autoplay iframe would skip through the queue
          clearInterval(id);
          if (ytPlayingRef.current) setTimeout(() => next(), 200);
          return dur;
        }
        return np;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [youtubeId, isPlaying, current?.duration, next]);

  // Watchdog: if the YouTube iframe never actually starts (mobile autoplay
  // block), drop the optimistic isPlaying so the UI shows paused instead of
  // silently skipping ahead. User taps ▶ → playVideo works with the gesture.
  useEffect(() => {
    if (!youtubeId) return;
    ytPlayingRef.current = false;
    ytPlayedOnceRef.current = false;
    const t = setTimeout(() => {
      if (!ytPlayingRef.current) setIsPlaying(false);
    }, 6000);
    return () => clearTimeout(t);
  }, [youtubeId]);

  // Listen to YouTube iframe state changes (ended -> next)
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      try {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        const state = data?.event === 'onStateChange' ? data?.info
          : data?.event === 'infoDelivery' ? data?.info?.playerState
          : undefined;
        if (state === 0) {
          // 0 = ended — honour it only if this video ACTUALLY played;
          // a fresh/reloading iframe can emit a spurious ended which would
          // otherwise walk the whole queue down to the last entry
          ytPlayingRef.current = false;
          if (ytPlayedOnceRef.current) next();
        }
        if (state === 1) {
          ytPlayingRef.current = true; ytPlayedOnceRef.current = true; errStreakRef.current = 0; setIsPlaying(true); setLoading(false);
          // Autoplay started muted — restore user's volume preference
          // (must be done on 'playing' so the player accepts the command).
          // Use postToYT helper so we go through the same channel.
          if (mutedRef.current) {
            postToYT('mute');
          } else {
            postToYT('unMute');
            postToYT('setVolume', [Math.round(volumeRef.current * 100)]);
          }
        }
        if (state === 2) { ytPlayingRef.current = false; setIsPlaying(false); }
      } catch {}
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [next, postToYT]);

  const value: PlayerState = {
    current,
    queue,
    isPlaying,
    botMode,
    progress,
    duration,
    volume,
    isMuted,
    loading,
    playSong,
    addToQueue,
    toggle,
    stop,
    toggleMute,
    next,
    prev,
    seek,
    setVolume,
    setBotMode,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* Hidden YouTube iframe for Nepali/YouTube songs — unlimited via official embed (no decipher needed).
          Starts muted for autoplay (Chrome blocks unmuted autoplay without a
          same-tick gesture). Once the player reports \"playing\", we unmute
          to restore the user's volume. Kept in-viewport 1×1 with opacity 0.01
          — offscreen (-1000) is considered hidden and throttled by Chrome. */}
      {youtubeId && (
        <div style={{ position: 'fixed', left: 0, top: 0, width: 1, height: 1, overflow: 'hidden', pointerEvents: 'none', opacity: 0.01 }} aria-hidden>
          <iframe
            ref={ytIframeRef}
            width="1"
            height="1"
            src={`https://www.youtube.com/embed/${youtubeId}?enablejsapi=1&autoplay=1&mute=1&playsinline=1&controls=0&rel=0&origin=${typeof window !== 'undefined' ? encodeURIComponent(window.location.origin) : ''}`}
            title="YouTube audio"
            allow="autoplay; encrypted-media"
            allowFullScreen={false}
            frameBorder={0}
            onLoad={(e) => {
              // required handshake — without 'listening', YouTube never
              // posts onStateChange events back to window.message
              try {
                const w = (e.currentTarget as HTMLIFrameElement).contentWindow;
                w?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');
                setTimeout(() => w?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*'), 1200);
                // If autoplay was muted, schedule an unmute once the player is ready.
                // This re-uses the user's volume/muted preference. Must happen
                // after the 'listening' handshake or setVolume is ignored.
                setTimeout(() => {
                  if (mutedRef.current) {
                    w?.postMessage(JSON.stringify({ event: 'command', func: 'mute', args: [] }), '*');
                  } else {
                    w?.postMessage(JSON.stringify({ event: 'command', func: 'unMute', args: [] }), '*');
                    w?.postMessage(JSON.stringify({ event: 'command', func: 'setVolume', args: [Math.round(volumeRef.current * 100)] }), '*');
                  }
                }, 1800);
              } catch {}
            }}
          />
        </div>
      )}
    </Ctx.Provider>
  );
}
