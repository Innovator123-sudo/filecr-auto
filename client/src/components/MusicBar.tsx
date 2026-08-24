import { Link, useLocation } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMusic } from '../music/MusicPlayerContext';
import { fmtTime, searchMusic, fetchTopSongs } from '../music/api';
import type { Song } from '../music/api';

// Global floating player + arena mini-window.
// In battle arenas (/bot/arena , /room/*) it is ALWAYS visible as a small
// window — even when no track is queued — and clicking it opens an inline
// picker so you can change music without leaving the battle.
// Hidden only on /music (full page already shows everything).
export function MusicBar() {
  const music = useMusic();
  const { current, isPlaying, botMode, progress, duration, volume, isMuted, queue, playSong, addToQueue } = music;
  const location = useLocation();
  const inArena = location.pathname.startsWith('/bot/arena') || location.pathname.startsWith('/room/');

  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  const [topSongs, setTopSongs] = useState<Song[]>([]);
  const [busy, setBusy] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [showVol, setShowVol] = useState(false);
  const seekRef = useRef<HTMLDivElement>(null);

  // load top songs when picker opens
  // (must stay ABOVE the early returns below - hooks can't be conditional,
  //  otherwise navigating here mid-playback crashes into the ErrorBoundary)
  useEffect(() => {
    if (!pickerOpen) return;
    let alive = true;
    setBusy(true);
    fetchTopSongs(12)
      .then((s) => alive && setTopSongs(s))
      .catch(() => {})
      .finally(() => alive && setBusy(false));
    return () => { alive = false; };
  }, [pickerOpen]);

  const doSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setPickerError(null);
    try {
      const songs = await searchMusic(q, 12);
      setResults(songs);
      if (!songs.length) setPickerError(`No songs for "${q}"`);
    } catch (e: any) {
      setPickerError(e.message || 'Search failed');
    } finally {
      setBusy(false);
    }
  };

  if (location.pathname === '/music') return null;
  // outside arenas hide the bar when nothing is playing; inside arenas keep a small window always
  if (!current && !inArena) return null;

  const pct = duration > 0 ? Math.min(100, (progress / duration) * 100) : 0;

  const list = results.length ? results : topSongs;

  // Small window collapsed view
  const collapsed = !current;

  const handleSeek = (clientX: number, rect: DOMRect) => {
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    music.seek(ratio * duration);
  };

  return (
    <>
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className={`fixed left-1/2 -translate-x-1/2 z-40 ${inArena ? 'bottom-2 w-[min(96vw,420px)]' : 'bottom-3 w-[min(96vw,720px)]'} safe-bottom`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="glass rounded-2xl px-3 py-2.5 shadow-2xl shadow-black/60 border border-white/10">
          {collapsed ? (
            // ── Arena placeholder — always a small window even before any track
            <div className="flex items-center gap-2 sm:gap-2.5">
              <button
                onClick={() => setPickerOpen(true)}
                className="w-10 h-10 rounded-lg bg-gradient-to-br from-brand to-violet-600 flex items-center justify-center text-white shrink-0 touch-manipulation"
                title="Choose music"
              >🎵</button>
              <button onClick={() => setPickerOpen(true)} className="flex-1 text-left min-w-0 py-1 touch-manipulation">
                <div className="text-xs font-bold leading-tight">Tap to choose music</div>
                <div className="text-[10px] text-zinc-500 truncate">No track queued · BOT DJ can auto-play</div>
              </button>
              <button
                onClick={() => music.setBotMode(!botMode)}
                title="BOT DJ"
                className={`shrink-0 text-xs px-3 py-2.5 rounded-full border font-bold transition touch-manipulation min-h-[40px] ${botMode ? 'bg-brand border-brand text-white' : 'border-white/15 text-zinc-400 hover:text-white'}`}
              >🤖 {botMode ? 'ON' : 'OFF'}</button>
              <button
                onClick={() => setPickerOpen(true)}
                className="shrink-0 px-4 py-2.5 rounded-full bg-white text-black text-xs font-bold hover:scale-105 transition touch-manipulation min-h-[40px]"
              >Browse</button>
            </div>
          ) : (
            <>
              {/* Row 1: track info */}
              <div className="flex items-center gap-2.5">
                {/* clickable window — click image/title to change music */}
                <button
                  onClick={() => setPickerOpen(true)}
                  title="Click to change music"
                  className="shrink-0 relative group touch-manipulation"
                >
                  <img src={current.image ?? ''} alt="" className={`${inArena ? 'w-10 h-10' : 'w-11 h-11'} rounded-lg object-cover`} />
                  <span className="absolute inset-0 rounded-lg bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] font-bold transition">CHANGE</span>
                </button>
                <button
                  onClick={() => setPickerOpen(true)}
                  title="Click to change music"
                  className="min-w-0 flex-1 text-left py-1 touch-manipulation"
                >
                  <div className={`truncate text-sm font-bold leading-tight ${isPlaying ? '' : 'text-zinc-400'}`}>{current.title}</div>
                  {!inArena ? (
                    <div className="truncate text-xs text-zinc-500">{current.primary_artists || current.singers || current.album || ''}</div>
                  ) : (
                    <div className="text-xs truncate flex items-center gap-1">
                      <span className="text-zinc-500 truncate">{current.primary_artists || current.singers || ''}</span>
                      {botMode && <span className="text-brand font-bold shrink-0">· 🤖 BOT</span>}
                    </div>
                  )}
                </button>

                {/* Change button — always visible on mobile now */}
                <button
                  onClick={() => setPickerOpen(true)}
                  title="Change music"
                  className="shrink-0 hidden xs:flex sm:flex text-xs px-2.5 py-2 rounded-full border border-white/10 text-zinc-400 hover:text-white hover:border-white/20 touch-manipulation"
                >✎</button>
                <Link to="/music" title="Open Music Zone" className="hidden sm:flex shrink-0 text-xs px-2.5 py-2 rounded-full border border-white/10 text-zinc-400 hover:text-white touch-manipulation">↗</Link>
              </div>

              {/* Row 2: transport controls — full width, mobile-friendly 44px targets */}
              <div className="mt-2 flex items-center justify-between gap-1 sm:gap-1.5">
                <div className="flex items-center gap-1">
                  <button onClick={(e) => { e.stopPropagation(); music.prev(); }} title="Previous" aria-label="Previous" className="w-10 h-10 rounded-full text-zinc-300 hover:text-white hover:bg-white/10 flex items-center justify-center text-base touch-manipulation active:scale-95 transition">⏮</button>
                  <button onClick={(e) => { e.stopPropagation(); music.toggle(); }} title={isPlaying ? 'Pause' : 'Play'} aria-label={isPlaying ? 'Pause' : 'Play'} className="w-11 h-11 rounded-full bg-white text-black font-bold hover:scale-105 active:scale-95 transition flex items-center justify-center text-sm touch-manipulation shadow">
                    {music.loading ? <span className="animate-pulse">…</span> : isPlaying ? '⏸' : '▶'}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); music.next(); }} title="Next" aria-label="Next" className="w-10 h-10 rounded-full text-zinc-300 hover:text-white hover:bg-white/10 flex items-center justify-center text-base touch-manipulation active:scale-95 transition">⏭</button>
                  <button onClick={(e) => { e.stopPropagation(); music.stop(); }} title="Stop" aria-label="Stop" className="w-10 h-10 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 flex items-center justify-center text-sm touch-manipulation active:scale-95 transition border border-white/5">⏹</button>
                </div>

                <div className="flex items-center gap-1 sm:gap-1.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); music.setBotMode(!botMode); }}
                    title="Bot DJ — auto play"
                    aria-label="Toggle Bot DJ"
                    className={`w-10 h-10 flex items-center justify-center rounded-full text-sm border transition touch-manipulation active:scale-95 ${botMode ? 'bg-brand border-brand text-white shadow' : 'border-white/15 text-zinc-400 hover:text-white hover:border-white/30'}`}
                  >🤖</button>

                  {/* Mute */}
                  <button
                    onClick={(e) => { e.stopPropagation(); music.toggleMute(); }}
                    title={isMuted || volume===0 ? 'Unmute' : 'Mute'}
                    aria-label={isMuted || volume===0 ? 'Unmute' : 'Mute'}
                    className={`w-10 h-10 flex items-center justify-center rounded-full border transition touch-manipulation active:scale-95 ${isMuted || volume===0 ? 'bg-red-500/20 border-red-500/40 text-red-300' : 'border-white/10 text-zinc-400 hover:text-white hover:border-white/20'}`}
                  >{isMuted || volume===0 ? '🔇' : volume < 0.4 ? '🔈' : '🔊'}</button>

                  {/* Volume — desktop: inline slider, mobile: popover */}
                  <div className="relative hidden md:flex items-center">
                    <input
                      type="range" min={0} max={1} step={0.01} value={isMuted ? 0 : volume}
                      onChange={(e) => music.setVolume(Number(e.target.value))}
                      title="Volume"
                      className="w-20 accent-[#FF3B30] cursor-pointer"
                    />
                  </div>
                  {/* mobile volume popover trigger */}
                  <div className="relative md:hidden">
                    <button
                      onClick={() => setShowVol(v=>!v)}
                      title="Volume"
                      className="w-10 h-10 rounded-full border border-white/10 text-zinc-400 hover:text-white flex items-center justify-center touch-manipulation"
                    >🎚️</button>
                    <AnimatePresence>
                      {showVol && (
                        <motion.div
                          initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:8 }}
                          className="absolute bottom-12 right-0 glass rounded-2xl p-3 border border-white/10 shadow-2xl z-50 flex flex-col items-center gap-2"
                          onClick={(e)=>e.stopPropagation()}
                        >
                          <span className="text-[10px] tracking-widest text-zinc-500 font-black">VOLUME</span>
                          <input
                            type="range" min={0} max={1} step={0.01} value={isMuted ? 0 : volume}
                            onChange={(e) => music.setVolume(Number(e.target.value))}
                            className="w-24 accent-[#FF3B30] cursor-pointer"
                            style={{ writingMode: 'vertical-lr' } as any}
                          />
                          <span className="mono text-[10px] text-zinc-500">{Math.round((isMuted?0:volume)*100)}%</span>
                          <button onClick={()=>setShowVol(false)} className="text-xs px-3 py-1 rounded-full bg-white/10">Close</button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <button
                    onClick={() => setPickerOpen(true)}
                    title="Queue & Search"
                    className="hidden sm:flex shrink-0 text-xs px-3 py-2 rounded-full border border-white/10 text-zinc-400 hover:text-white hover:border-white/20 touch-manipulation"
                  >Queue</button>
                </div>
              </div>

              {/* seek bar — larger touch target on mobile */}
              <div className="mt-2 flex items-center gap-2">
                <span className="mono text-[10px] sm:text-[11px] text-zinc-500 w-9 text-right">{fmtTime(progress)}</span>
                <div
                  ref={seekRef}
                  role="slider"
                  aria-label="Seek"
                  aria-valuenow={Math.round(progress)}
                  aria-valuemin={0}
                  aria-valuemax={Math.round(duration)}
                  tabIndex={0}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    handleSeek(e.clientX, rect);
                  }}
                  onTouchMove={(e) => {
                    const t = e.touches[0];
                    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                    if (t) handleSeek(t.clientX, rect);
                  }}
                  className="relative flex-1 h-3 sm:h-2.5 rounded-full bg-white/10 cursor-pointer group touch-manipulation flex items-center"
                >
                  <div className="absolute inset-y-1 sm:inset-y-0.5 left-0 rounded-full bg-gradient-to-r from-brand to-violet-500 pointer-events-none" style={{ width: `${pct}%` }} />
                  <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 sm:w-3 sm:h-3 rounded-full bg-white shadow opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition pointer-events-none" style={{ left: `${pct}%` }} />
                  {/* invisible larger hit area */}
                  <div className="absolute -inset-y-2 inset-x-0" />
                </div>
                <span className="mono text-[10px] sm:text-[11px] text-zinc-500 w-9">{fmtTime(duration)}</span>
              </div>
            </>
          )}
        </div>
      </motion.div>

      {/* ── Picker modal — change music without leaving the battle ── */}
      <AnimatePresence>
        {pickerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => { setPickerOpen(false); setShowVol(false); }}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
              className="fixed left-1/2 -translate-x-1/2 bottom-0 sm:bottom-4 md:bottom-8 z-50 w-[100vw] sm:w-[min(96vw,720px)] max-h-[88vh] sm:max-h-[82vh] sm:rounded-[20px] rounded-t-[20px] overflow-hidden glass border border-white/10 shadow-2xl flex flex-col"
              style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
            >
              <div className="shrink-0 px-4 pt-4 pb-3 border-b border-white/10 bg-zinc-900/40">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-black text-sm">🎵 Change Music</h3>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => music.setBotMode(!botMode)}
                      className={`text-xs px-3 py-2 rounded-full border font-bold touch-manipulation min-h-[36px] ${botMode ? 'bg-brand border-brand text-white' : 'border-white/15 text-zinc-400'}`}
                    >🤖 BOT DJ {botMode ? 'ON' : 'OFF'}</button>
                    <button onClick={() => setPickerOpen(false)} className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center touch-manipulation">✕</button>
                  </div>
                </div>
                {/* in-picker transport for mobile — so you can stop/pause without closing picker */}
                {current && (
                  <div className="mt-3 flex items-center gap-2">
                    <button onClick={() => music.prev()} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center touch-manipulation">⏮</button>
                    <button onClick={() => music.toggle()} className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center font-bold touch-manipulation">{isPlaying ? '⏸' : '▶'}</button>
                    <button onClick={() => music.next()} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center touch-manipulation">⏭</button>
                    <button onClick={() => music.stop()} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center touch-manipulation border border-white/10">⏹</button>
                    <button onClick={() => music.toggleMute()} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center touch-manipulation">{isMuted || volume===0 ? '🔇' : '🔊'}</button>
                    <div className="ml-auto text-xs truncate flex-1 text-right">
                      <span className="text-zinc-500">Now: </span>
                      <span className="font-bold">{current.title.slice(0,28)}</span>
                    </div>
                  </div>
                )}
                <div className="mt-3 flex gap-2">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && doSearch()}
                    placeholder="Search any song, artist or album…"
                    className="flex-1 bg-black/40 border border-white/10 rounded-full px-4 py-3 text-sm outline-none focus:border-brand/50 placeholder:text-zinc-600"
                  />
                  <button onClick={doSearch} disabled={busy} className="px-5 py-3 rounded-full bg-brand hover:bg-brand-dark disabled:opacity-50 font-bold text-sm touch-manipulation min-h-[44px]">
                    {busy ? '…' : 'Search'}
                  </button>
                </div>
                {pickerError && <div className="mt-2 text-xs text-red-400">{pickerError}</div>}
                {current && (
                  <div className="mt-3 flex items-center gap-2 text-xs">
                    <span className="text-zinc-500">Now:</span>
                    <span className="font-bold truncate">{current.title}</span>
                    <span className="text-zinc-500 truncate">· {current.primary_artists || ''}</span>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-4 grid md:grid-cols-2 gap-4 bg-black/20 overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' as any }}>
                <section>
                  <h4 className="text-[11px] tracking-widest font-black text-zinc-500 mb-2">{results.length ? `RESULTS (${results.length})` : `🔥 TOP SONGS`}</h4>
                  <div className="space-y-2">
                    {busy && list.length === 0 && <div className="text-sm text-zinc-500 py-6 text-center">Loading…</div>}
                    {list.map((s) => (
                      <div key={s.id} className={`group flex items-center gap-3 rounded-2xl p-2.5 border transition ${current?.id === s.id ? 'bg-brand/10 border-brand/40' : 'bg-zinc-900/60 border-white/5 hover:border-white/20'}`}>
                        <button onClick={() => { playSong(s, list); setPickerOpen(false); }} className="shrink-0 relative touch-manipulation">
                          <img src={s.image ?? ''} alt="" loading="lazy" className="w-11 h-11 rounded-xl object-cover bg-zinc-800" />
                          <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50 text-sm opacity-0 group-hover:opacity-100 transition">{current?.id === s.id ? '🔊' : '▶'}</span>
                        </button>
                        <button onClick={() => { playSong(s, list); setPickerOpen(false); }} className="min-w-0 flex-1 text-left py-1 touch-manipulation">
                          <div className={`truncate text-sm font-bold ${current?.id === s.id ? 'text-brand' : ''}`}>{s.title}</div>
                          <div className="truncate text-xs text-zinc-500">{s.primary_artists || s.singers || ''}</div>
                        </button>
                        <button onClick={() => addToQueue(s)} title="Add to queue" className="shrink-0 w-10 h-10 rounded-full border border-white/10 text-zinc-400 hover:text-white hover:bg-white/10 flex items-center justify-center touch-manipulation">＋</button>
                      </div>
                    ))}
                    {!busy && list.length === 0 && <div className="text-sm text-zinc-500 py-4 text-center">No songs found. Try search or BOT DJ.</div>}
                  </div>
                </section>

                <section>
                  <h4 className="text-[11px] tracking-widest font-black text-zinc-500 mb-2">📋 QUEUE ({queue.length})</h4>
                  <div className="space-y-2">
                    {queue.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-zinc-500">
                        Queue empty.<br />Hit ＋ or let <b className="text-brand">BOT DJ</b> choose.
                      </div>
                    )}
                    {queue.map((s, i) => (
                      <button key={s.id} onClick={() => { playSong(s, queue); }} className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left border touch-manipulation ${current?.id === s.id ? 'bg-brand/10 border-brand/40' : 'bg-zinc-900/40 border-white/5 hover:border-white/20'}`}>
                        <span className="mono text-xs text-zinc-600 w-6">{String(i + 1).padStart(2, '0')}</span>
                        <img src={s.image ?? ''} alt="" className="w-8 h-8 rounded-md object-cover" />
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate text-sm font-bold ${current?.id === s.id ? 'text-brand' : ''}`}>{s.title}</span>
                          <span className="block truncate text-xs text-zinc-500">{s.primary_artists || ''}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  <Link to="/music" onClick={() => setPickerOpen(false)} className="mt-3 inline-flex text-xs px-3 py-2 rounded-full border border-white/10 text-zinc-400 hover:text-white">Open full Music Zone ↗</Link>
                </section>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
