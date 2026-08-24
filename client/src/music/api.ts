// VERCEL UNIFIED MODE: VITE_SERVER_URL is empty (same-origin /api/*) -> perfect on Vercel.
// For Render separate backend, Vercel env should set VITE_SERVER_URL=https://...onrender.com
export const SERVER_URL = (import.meta as any).env.VITE_SERVER_URL ?? '';

// Render free tier sleeps after 15 min; first hit takes ~30s to wake up
// On Vercel same-origin, cold start is ~1s so we keep a shorter timeout in prod.
const isVercelSameOrigin = !SERVER_URL && typeof window !== 'undefined' && window.location.hostname.endsWith('.vercel.app');
const COLD_START_TIMEOUT = isVercelSameOrigin ? 15000 : 45000;
const RETRY_DELAY_MS = 3000;

export type MusicLang = 'ne' | 'hi' | 'en' | 'auto';
export type MusicSource = 'auto' | 'saavn' | 'youtube' | 'all';

export interface Song {
  id: string;
  title: string;
  album: string | null;
  primary_artists: string | null;
  singers: string | null;
  language: string | null;
  year: string | null;
  duration: string | null;
  image: string | null;
  media_url: string;
  perma_url: string | null;
  has_lyrics: boolean;
  // youtube extra (present when source=youtube)
  source?: 'saavn' | 'youtube';
  videoId?: string;
}

// Route through our server proxy: avoids CDN hotlink/CORS quirks and enables seeking
export function streamUrl(song: Song): string {
  // YouTube songs already point to our /api/music/yt/stream proxy (media_url = /api/music/yt/stream?id=...)
  if (song.media_url.includes('/api/music/yt/stream')) {
    return `${SERVER_URL}${song.media_url}`;
  }
  // Saavn detection via source field fallback
  if ((song as any).source === 'youtube' && (song as any).videoId) {
    return `${SERVER_URL}/api/music/yt/stream?id=${encodeURIComponent((song as any).videoId)}`;
  }
  // Vercel same-origin: go through proxy so Range/seek + CORS works
  if (!SERVER_URL) {
    // if media_url is already a proxy path, still prefix nothing (same origin)
    if (song.media_url.startsWith('/')) return song.media_url;
    return `/api/music/stream?url=${encodeURIComponent(song.media_url)}`;
  }
  return `${SERVER_URL}/api/music/stream?url=${encodeURIComponent(song.media_url)}`;
}

function isColdStartError(e: any): boolean {
  const msg = String(e?.message || e).toLowerCase();
  return (
    e?.name === 'AbortError' ||
    msg.includes('abort') ||
    msg.includes('timeout') ||
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504')
  );
}

async function getJson<T>(path: string, timeoutMs = COLD_START_TIMEOUT, retries = 1): Promise<T> {
  // On Vercel same-origin (SERVER_URL === ''), relative /api/* is CORRECT – no warning needed.
  if (!SERVER_URL && typeof window !== 'undefined' && !window.location.hostname.includes('localhost') && !window.location.hostname.endsWith('.vercel.app')) {
    console.warn('[music api] VITE_SERVER_URL is empty and not on Vercel — fetch will use relative path.');
  }
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${SERVER_URL}${path}`, { signal: ctrl.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg = (data as any)?.error || `Request failed (${res.status})`;
        // Retry on 502/503/504 which Render returns while waking
        if (attempt < retries && (res.status === 502 || res.status === 503 || res.status === 504)) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        throw new Error(errMsg);
      }
      return data as T;
    } catch (e: any) {
      if (attempt < retries && isColdStartError(e)) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      throw e;
    } finally {
      clearTimeout(t);
    }
  }
  throw new Error('Request failed after retries');
}

export async function searchMusic(query: string, limit = 16, lang: MusicLang = 'auto', source: MusicSource = 'auto'): Promise<Song[]> {
  const d = await getJson<{ songs: Song[] }>(`/api/music/search?q=${encodeURIComponent(query)}&limit=${limit}&lang=${lang}&source=${source}`);
  return d.songs ?? [];
}

export async function searchYouTubeMusic(query: string, limit = 12, lang: MusicLang = 'auto'): Promise<Song[]> {
  const d = await getJson<{ songs: Song[] }>(`/api/music/yt/search?q=${encodeURIComponent(query)}&limit=${limit}&lang=${lang}`);
  return d.songs ?? [];
}

export async function fetchTopSongs(limit = 20, lang: MusicLang = 'auto', source: MusicSource = 'auto'): Promise<Song[]> {
  const d = await getJson<{ songs: Song[] }>(`/api/music/top?limit=${limit}&lang=${lang}&source=${source}`);
  return d.songs ?? [];
}

export async function fetchLyrics(id: string): Promise<string | null> {
  try {
    const d = await getJson<{ lyrics: string }>(`/api/music/lyrics?id=${id}`);
    return d.lyrics;
  } catch {
    return null;
  }
}

export function fmtTime(secs: number | null | undefined): string {
  if (!secs || !isFinite(secs)) return '--:--';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
