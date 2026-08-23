import { Router } from 'express';
import { searchSongs, getSong, getAlbum, getPlaylist, getLyrics, getTopSongs } from './jiosaavn.js';

export const musicRouter = Router();

// Musify's "Top songs" — powers Bot DJ auto-play + homepage suggestions
musicRouter.get('/top', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const songs = await getTopSongs(limit);
  res.json({ count: songs.length, songs });
});

musicRouter.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing q' });
  const limit = Math.min(Number(req.query.limit) || 12, 30);
  try {
    const songs = await searchSongs(q, limit);
    res.json({ query: q, count: songs.length, songs });
  } catch (e: any) {
    res.status(502).json({ error: e.message || 'JioSaavn fetch failed' });
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
