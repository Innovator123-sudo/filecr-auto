const SERVER_URL = (import.meta as any).env.VITE_SERVER_URL || '';

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
}

// Route through our server proxy: avoids CDN hotlink/CORS quirks and enables seeking
export function streamUrl(song: Song): string {
  return `${SERVER_URL}/api/music/stream?url=${encodeURIComponent(song.media_url)}`;
}

async function getJson<T>(path: string, timeoutMs = 25000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${SERVER_URL}${path}`, { signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any)?.error || `Request failed (${res.status})`);
    return data as T;
  } finally {
    clearTimeout(t);
  }
}

export async function searchMusic(query: string, limit = 16): Promise<Song[]> {
  const d = await getJson<{ songs: Song[] }>(`/api/music/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  return d.songs ?? [];
}

export async function fetchTopSongs(limit = 20): Promise<Song[]> {
  const d = await getJson<{ songs: Song[] }>(`/api/music/top?limit=${limit}`);
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
