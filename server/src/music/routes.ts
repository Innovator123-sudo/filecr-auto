import { Router } from 'express';
import { searchSongs, getSong, getAlbum, getPlaylist, getLyrics, getTopSongs } from './jiosaavn.js';
import { searchYouTubeMusic, getYouTubeStreamUrl, getYouTubeTopSongs } from './youtube.js';

export const musicRouter = Router();

// ── Unified helpers ──────────────────────────────────────────────────────
type Lang = 'ne' | 'hi' | 'en' | 'auto';
type Source = 'auto' | 'saavn' | 'youtube' | 'all';

function parseLang(v: unknown): Lang {
  const s = String(v || 'auto').toLowerCase();
  if (s === 'ne' || s === 'np') return 'ne';
  if (s === 'hi' || s === 'in') return 'hi';
  if (s === 'en' || s === 'us') return 'en';
  return 'auto';
}
function parseSource(v: unknown): Source {
  const s = String(v || 'auto').toLowerCase();
  if (s === 'saavn' || s === 'jiosaavn' || s === 'savn') return 'saavn';
  if (s === 'youtube' || s === 'yt' || s === 'ytmusic') return 'youtube';
  if (s === 'all' || s === 'both') return 'all';
  return 'auto';
}

// Musify's "Top songs" — powers Bot DJ auto-play + homepage suggestions
// Now supports ?lang=ne|hi|en|auto&source=auto|saavn|youtube|all
musicRouter.get('/top', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const lang = parseLang(req.query.lang);
  const source = parseSource(req.query.source);
  try {
    if (source === 'youtube') {
      const songs = await getYouTubeTopSongs(lang, limit);
      return res.json({ count: songs.length, songs, lang, source });
    }
    if (source === 'all') {
      const [a, b] = await Promise.allSettled([getTopSongs(limit), getYouTubeTopSongs(lang, limit)]);
      const saavn = a.status === 'fulfilled' ? a.value : [];
      const yt = b.status === 'fulfilled' ? b.value : [];
      // interleave for variety
      const merged: any[] = [];
      const max = Math.max(saavn.length, yt.length);
      for (let i = 0; i < max; i++) {
        if (i < saavn.length) merged.push(saavn[i]);
        if (i < yt.length) merged.push(yt[i]);
      }
      return res.json({ count: Math.min(merged.length, limit), songs: merged.slice(0, limit), lang, source });
    }
    // default auto/saavn — keep existing behavior for backward compat
    if (lang === 'ne' && source === 'auto') {
      // Nepali: prefer YouTube (Saavn has almost no Nepali)
      const yt = await getYouTubeTopSongs('ne', limit);
      if (yt.length >= Math.min(10, limit)) return res.json({ count: yt.length, songs: yt, lang, source });
      const saavn = await getTopSongs(limit - yt.length);
      const merged = [...yt, ...saavn].slice(0, limit);
      return res.json({ count: merged.length, songs: merged, lang, source });
    }
    const songs = await getTopSongs(limit);
    res.json({ count: songs.length, songs, lang, source });
  } catch (e: any) {
    res.status(502).json({ error: e.message || 'Top fetch failed' });
  }
});

// Unified search: GET /api/music/search?q=...&limit=12&lang=ne|hi|en|auto&source=auto|saavn|youtube|all
// - lang=ne -> YouTube-first (Nepali catalog is YouTube-only)
// - lang=hi -> Saavn-first (Hindi 320kbps)
// - lang=en/auto -> Saavn-first with YouTube fallback
// - source overrides lang heuristic
musicRouter.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing q' });
  const limit = Math.min(Number(req.query.limit) || 12, 30);
  const lang = parseLang(req.query.lang);
  const source = parseSource(req.query.source);

  // Backward compat: if client sends only q, use auto behavior
  try {
    if (source === 'saavn') {
      const songs = await searchSongs(q, limit);
      return res.json({ query: q, lang, source, count: songs.length, songs });
    }
    if (source === 'youtube') {
      const songs = await searchYouTubeMusic(q, limit, lang);
      return res.json({ query: q, lang, source, count: songs.length, songs });
    }
    if (source === 'all') {
      const [a, b] = await Promise.allSettled([searchSongs(q, limit), searchYouTubeMusic(q, limit, lang)]);
      const saavn = a.status === 'fulfilled' ? (a.value as any[]) : [];
      const yt = b.status === 'fulfilled' ? (b.value as any[]) : [];
      const merged: any[] = [];
      const max = Math.max(saavn.length, yt.length);
      for (let i = 0; i < max; i++) {
        if (i < saavn.length) merged.push(saavn[i]);
        if (i < yt.length) merged.push(yt[i]);
      }
      const out = merged.slice(0, limit);
      return res.json({ query: q, lang, source, count: out.length, songs: out, debug: { saavn: saavn.length, youtube: yt.length } });
    }

    // source=auto — heuristic by lang
    if (lang === 'ne') {
      // Nepali: YouTube is king
      const yt = await searchYouTubeMusic(q, limit, 'ne');
      if (yt.length >= Math.min(limit, 8)) return res.json({ query: q, lang, source, count: yt.length, songs: yt, debug: { saavn: 0, youtube: yt.length } });
      // fill remaining with Saavn (maybe Hindi transliteration)
      try {
        const saavn = await searchSongs(q, Math.max(0, limit - yt.length));
        return res.json({ query: q, lang, source, count: yt.length + saavn.length, songs: [...yt, ...saavn], debug: { saavn: saavn.length, youtube: yt.length } });
      } catch {
        return res.json({ query: q, lang, source, count: yt.length, songs: yt, debug: { saavn: 0, youtube: yt.length } });
      }
    }

    // hi/en/auto: Saavn first (320kbps), fallback to YouTube
    try {
      const saavn = await searchSongs(q, limit);
      if (saavn.length >= Math.min(limit, 6)) return res.json({ query: q, lang, source, count: saavn.length, songs: saavn, debug: { saavn: saavn.length, youtube: 0 } });
      const yt = await searchYouTubeMusic(q, Math.max(0, limit - saavn.length), lang);
      const merged = [...saavn, ...yt].slice(0, limit);
      return res.json({ query: q, lang, source, count: merged.length, songs: merged, debug: { saavn: saavn.length, youtube: yt.length } });
    } catch (e: any) {
      // Saavn down -> YouTube only
      const yt = await searchYouTubeMusic(q, limit, lang);
      return res.json({ query: q, lang, source, count: yt.length, songs: yt, debug: { saavn: 0, youtube: yt.length, saavnError: e.message } });
    }
  } catch (e: any) {
    res.status(502).json({ error: e.message || 'Search failed' });
  }
});

// ── YouTube-only endpoints (for direct use) ─────────────────────────────
musicRouter.get('/yt/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing q' });
  const limit = Math.min(Number(req.query.limit) || 12, 30);
  const lang = parseLang(req.query.lang);
  try {
    const songs = await searchYouTubeMusic(q, limit, lang);
    res.json({ query: q, lang, count: songs.length, songs });
  } catch (e: any) {
    res.status(502).json({ error: e.message || 'YouTube search failed' });
  }
});

musicRouter.get('/yt/top', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const lang = parseLang(req.query.lang);
  try {
    const songs = await getYouTubeTopSongs(lang, limit);
    res.json({ count: songs.length, songs, lang });
  } catch (e: any) {
    res.status(502).json({ error: e.message || 'YouTube top failed' });
  }
});

// YouTube audio proxy: GET /api/music/yt/stream?id=VIDEOID&lang=ne  (Range supported)
// Resolves InnerTube/Piped audio URL then pipes it (like /stream but for YouTube)
// If direct URL extraction is blocked by YouTube botguard (2024-2026), returns JSON with embed fallback
// so client can play via YouTube IFrame (official unlimited, no decipher needed)
musicRouter.get('/yt/stream', async (req, res) => {
  const id = String(req.query.id || '').trim();
  if (!id) return res.status(400).json({ error: 'Missing id' });
  const lang = parseLang(req.query.lang);
  const wantJson = String(req.query.format || '') === 'json' || String(req.headers.accept || '').includes('application/json') && !req.headers.range;
  try {
    const audioUrl = await getYouTubeStreamUrl(id, lang);
    if (!audioUrl) {
      // Fallback: tell client to use embed (iframe) — still unlimited via official YouTube embed
      const embedUrl = `https://www.youtube.com/embed/${encodeURIComponent(id)}?autoplay=1&playsinline=1&enablejsapi=1&origin=${encodeURIComponent(req.headers.origin || '')}`;
      const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
      const musicUrl = `https://music.youtube.com/watch?v=${encodeURIComponent(id)}`;
      // If client explicitly wants JSON, return it with 200
      if (wantJson || String(req.query.fallback || '') === '1') {
        return res.json({ videoId: id, embedUrl, watchUrl, musicUrl, fallback: 'embed', reason: 'Direct audio extract blocked by YouTube botguard — use embed iframe (unlimited)' });
      }
      // Otherwise still return JSON with 200 so <audio> can detect fallback via content-type
      // Check if request is from <audio> (Range) vs fetch — audio will expect audio/*, fetch expects json
      const acceptsJson = String(req.headers.accept || '').includes('json');
      if (acceptsJson) {
        return res.json({ videoId: id, embedUrl, watchUrl, musicUrl, fallback: 'embed', reason: 'Direct audio extract blocked — use embed' });
      }
      // For <audio> tag fallback, redirect to watch page embed is not playable as audio, so return JSON error with 200 and let client handle
      return res.status(200).json({ videoId: id, embedUrl, watchUrl, musicUrl, fallback: 'embed', reason: 'Direct audio extract blocked — use YouTube iframe' });
    }
    // If client wants redirect (?redirect=1) just redirect to direct URL (faster)
    if (String(req.query.redirect || '') === '1' || String(req.query.direct || '') === '1') {
      return res.redirect(302, audioUrl);
    }
    // Proxy with Range support
    const headers: Record<string, string> = { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' };
    if (req.headers.range) headers.Range = req.headers.range;
    // Some YouTube URLs require Range, forward it
    const upstream = await fetch(audioUrl, { headers });
    if (!upstream.ok && upstream.status !== 206) {
      // fallback: redirect instead of proxy if host blocks proxy fetch
      return res.redirect(302, audioUrl);
    }
    const h = new Headers();
    for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = upstream.headers.get(key);
      if (v) h.set(key, v);
    }
    if (!h.has('content-type')) h.set('content-type', 'audio/webm');
    if (!h.has('accept-ranges')) h.set('accept-ranges', 'bytes');
    h.set('cache-control', 'public, max-age=3600');
    // CORS for audio element
    h.set('access-control-allow-origin', '*');
    res.writeHead(upstream.status, Object.fromEntries(h.entries()));
    if (!upstream.body) return res.end();
    const body = upstream.body;
    let closed = false;
    req.on('close', () => { closed = true; body.cancel().catch(() => {}); });
    for await (const chunk of body) {
      if (closed || res.destroyed) break;
      res.write(Buffer.from(chunk));
    }
    res.end();
  } catch (e: any) {
    if (!res.headersSent) res.status(502).json({ error: e.message || 'YouTube stream failed' });
    else res.end();
  }
});

musicRouter.get('/song', async (req, res) => {
  const id = String(req.query.id || '').trim();
  if (!id) return res.status(400).json({ error: 'Missing id' });
  const song = await getSong(id);
  if (!song) return res.status(404).json({ error: 'Song not found' });
  res.json({ song });
});

musicRouter.get('/album', async (req, res) => {
  const q = String(req.query.id || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing id' });
  const album = await getAlbum(q);
  if (!album) return res.status(404).json({ error: 'Album not found' });
  res.json(album);
});

musicRouter.get('/playlist', async (req, res) => {
  const q = String(req.query.id || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing id' });
  const playlist = await getPlaylist(q);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
  res.json(playlist);
});

musicRouter.get('/lyrics', async (req, res) => {
  const id = String(req.query.id || '').trim();
  if (!id) return res.status(400).json({ error: 'Missing id' });
  const lyrics = await getLyrics(id);
  if (!lyrics) return res.status(404).json({ error: 'No lyrics available' });
  res.json({ lyrics });
});

// Audio proxy so the browser can <audio src> the Saavn CDN file without CORS/hotlink issues.
// Supports HTTP Range for seek + progressive playback.
musicRouter.get('/stream', async (req, res) => {
  const url = String(req.query.url || '');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid url' });
  }
  // only allow audio CDNs we expect
  if (!/(saavncdn|jiosaavn|akamaized|pscdn)\./i.test(parsed.hostname)) {
    return res.status(403).json({ error: 'Host not allowed' });
  }
  try {
    const headers: Record<string, string> = { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' };
    if (req.headers.range) headers.Range = req.headers.range;
    const upstream = await fetch(parsed.toString(), { headers });
    const h = new Headers();
    for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = upstream.headers.get(key);
      if (v) h.set(key, v);
    }
    if (!h.has('accept-ranges')) h.set('accept-ranges', 'bytes');
    h.set('cache-control', 'public, max-age=86400');
    res.writeHead(upstream.status, Object.fromEntries(h.entries()));
    if (!upstream.body) return res.end();
    const body = upstream.body;
    let closed = false;
    req.on('close', () => { closed = true; body.cancel().catch(() => {}); });
    // web ReadableStream is async-iterable in Node >=16.5
    for await (const chunk of body) {
      if (closed || res.destroyed) break;
      res.write(Buffer.from(chunk));
    }
    res.end();
  } catch (e: any) {
    if (!res.headersSent) res.status(502).json({ error: e.message || 'Stream failed' });
    else res.end();
  }
});
