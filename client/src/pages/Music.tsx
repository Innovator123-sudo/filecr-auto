import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useMusic } from '../music/MusicPlayerContext';
import { searchMusic, fetchTopSongs, fetchLyrics, fmtTime } from '../music/api';
import type { Song } from '../music/api';

function SongCard({ song, list }: { song: Song; list: Song[] }) {
  const { playSong, addToQueue, current } = useMusic();
  const isCurrent = current?.id === song.id;
  return (
    <div className={`group flex items-center gap-3 rounded-2xl p-3 border transition ${isCurrent ? 'bg-brand/10 border-brand/40' : 'bg-surface border-white/5 hover:border-white/20'}`}>
      <button onClick={() => playSong(song, list)} className="shrink-0 relative">
        <img src={song.image ?? ''} alt="" loading="lazy" className="w-14 h-14 rounded-xl object-cover bg-zinc-800" />
        <span className={`absolute inset-0 flex items-center justify-center rounded-xl bg-black/50 text-lg transition ${isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          {isCurrent ? '🔊' : '▶️'}
        </span>
      </button>
      <button onClick={() => playSong(song, list)} className="min-w-0 flex-1 text-left">
        <div className={`truncate text-sm font-bold ${isCurrent ? 'text-brand' : ''}`}>{song.title}</div>
        <div className="truncate text-xs text-zinc-500">{song.primary_artists || song.singers || song.album || 'Unknown artist'}{song.duration ? ` · ${fmtTime(Number(song.duration))}` : ''}</div>
      </button>
      <button onClick={() => addToQueue(song)} title="Add to queue" className="shrink-0 w-9 h-9 rounded-full border border-white/10 text-zinc-400 hover:text-white hover:bg-white/10">＋</button>
    </div>
  );
}

export function Music() {
  const { botMode, setBotMode, current, queue, isPlaying } = useMusic();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  const [topSongs, setTopSongs] = useState<Song[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lyrics, setLyrics] = useState<string | null>(null);
  const [lyricsOpen, setLyricsOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    fetchTopSongs(20)
      .then((s) => alive && setTopSongs(s))
      .catch(() => {})
      .finally(() => alive && setBusy(false));
    return () => { alive = false; };
  }, []);

  const doSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      const songs = await searchMusic(q, 16);
      setResults(songs);
      if (!songs.length) setError(`No songs found for "${q}"`);
    } catch (e: any) {
      setError(e.message || 'Search failed — is the game server running?');
    } finally {
      setBusy(false);
    }
  };

  const showLyrics = async () => {
    if (!current) return;
    if (lyricsOpen) return setLyricsOpen(false);
    setLyricsOpen(true);
    if (lyrics === null) {
      const l = await fetchLyrics(current.id);
      setLyrics(l ?? 'No lyrics available for this track.');
    }
  };

  return (
    <div className="min-h-screen bg-ink safe-y">
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-6">
        <nav className="flex items-center justify-between">
          <Link to="/" className="text-sm text-zinc-400 hover:text-white">← Home</Link>
          <div className="text-lg font-black tracking-tight">🎵 MUSIC<span className="text-brand">ZONE</span></div>
          <div className="text-xs text-zinc-500 hidden sm:block">powered by JioSaavn · Musify logic</div>
        </nav>

        {/* BOT DJ */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className={`mt-6 rounded-[24px] p-6 border ${botMode ? 'bg-gradient-to-br from-brand/25 to-violet-600/20 border-brand/50' : 'bg-surface border-white/10'}`}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-black">🤖 BOT DJ</h2>
              <p className="text-sm text-zinc-400 mt-1 max-w-md">
                Flip it on and the bot takes over: auto-picks trending tracks, keeps them playing one after another — perfect workout soundtrack for your battle.
              </p>
              {botMode && <div className="mt-2 inline-flex items-center gap-2 text-xs font-bold text-brand"><span className="w-2 h-2 rounded-full bg-brand animate-pulse" /> BOT IS SPINNING THE DECKS</div>}
            </div>
            <button
              onClick={() => setBotMode(!botMode)}
              aria-label="Toggle bot DJ"
              className={`relative shrink-0 w-16 h-9 rounded-full transition ${botMode ? 'bg-brand' : 'bg-zinc-700'}`}
            >
              <span className={`absolute top-1 w-7 h-7 rounded-full bg-white transition-all ${botMode ? 'left-8' : 'left-1'}`} />
            </button>
          </div>
        </motion.div>

        {/* NOW PLAYING — sticks to the top while you scroll */}
        {current && (
          <div className="sticky top-2 z-30 mt-4 glass rounded-2xl p-4 shadow-2xl shadow-black/50">
            <div className="flex items-center gap-3">
              <img src={current.image ?? ''} alt="" className="w-12 h-12 rounded-lg object-cover" />
              <div className="min-w-0 flex-1">
                <div className="text-xs tracking-widest text-zinc-500">{isPlaying ? 'NOW PLAYING' : 'PAUSED'} {botMode ? '· BOT DJ' : ''}</div>
                <div className="truncate font-bold text-sm">{current.title}</div>
                <div className="truncate text-xs text-zinc-500">{current.primary_artists || current.singers || ''} · {queue.length} in queue</div>
              </div>
              {(current.has_lyrics || lyrics) && (
                <button onClick={showLyrics} className="text-xs px-3 py-1.5 rounded-full border border-white/15 hover:bg-white/10 shrink-0">📝 Lyrics</button>
              )}
            </div>
            {lyricsOpen && lyrics !== null && (
              <pre className="mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap text-xs text-zinc-300 leading-relaxed font-display">{lyrics}</pre>
            )}
          </div>
        )}

        {/* SEARCH */}
        <div className="mt-6">
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doSearch()}
              placeholder="Search any song, artist or album…"
              className="flex-1 bg-surface border border-white/10 rounded-full px-5 py-3 text-sm outline-none focus:border-brand/60 placeholder:text-zinc-600"
            />
            <button onClick={doSearch} disabled={busy} className="px-6 py-3 rounded-full bg-brand hover:bg-brand-dark disabled:opacity-50 font-bold text-sm">
              {busy ? '…' : '🔍 Search'}
            </button>
          </div>
          {error && <div className="mt-3 text-sm text-red-400">{error}</div>}
        </div>

        {/* RESULTS / TOP SONGS */}
        <div className="mt-6 grid lg:grid-cols-2 gap-6">
          <section>
            <h3 className="text-sm font-black tracking-widest text-zinc-400 mb-3">{results.length ? `RESULTS (${results.length})` : busy && !topSongs.length ? 'LOADING…' : '🔥 TOP SONGS'}</h3>
            <div className="space-y-2">
              {results.length
                ? results.map((s) => <SongCard key={s.id} song={s} list={results} />)
                : topSongs.map((s) => <SongCard key={s.id} song={s} list={topSongs} />)}
              {!results.length && !topSongs.length && !busy && (
                <div className="glass rounded-2xl p-6 text-center text-sm text-zinc-500">Could not load top songs. Check that the game server is running on port 3001.</div>
              )}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-black tracking-widest text-zinc-400 mb-3">📋 QUEUE ({queue.length})</h3>
            <div className="space-y-2">
              {queue.length === 0 && (
                <div className="glass rounded-2xl p-6 text-center text-sm text-zinc-500">
                  Queue is empty.<br />Hit ＋ on any song, or let <span className="text-brand font-bold">BOT DJ</span> choose for you.
                </div>
              )}
              {queue.map((s, i) => (
                <QueueRow key={s.id} song={s} index={i} />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function QueueRow({ song, index }: { song: Song; index: number }) {
  const { current, playSong, queue } = useMusic();
  const isCurrent = current?.id === song.id;
  return (
    <button onClick={() => playSong(song, queue)} className={`w-full flex items-center gap-3 rounded-xl px-3 py-2 text-left border ${isCurrent ? 'bg-brand/10 border-brand/40' : 'bg-surface border-white/5 hover:border-white/20'}`}>
      <span className="mono text-xs text-zinc-600 w-6">{String(index + 1).padStart(2, '0')}</span>
      <img src={song.image ?? ''} alt="" loading="lazy" className="w-9 h-9 rounded-md object-cover" />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm font-bold ${isCurrent ? 'text-brand' : ''}`}>{song.title}</span>
        <span className="block truncate text-xs text-zinc-500">{song.primary_artists || song.singers || ''}</span>
      </span>
    </button>
  );
}
