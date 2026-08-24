import type { Song } from './jiosaavn.js';

// YouTube Music InnerTube — unofficial, unlimited, covers Nepali/Hindi/English 2024-2026
// No API key needed for YT web client; we use public InnerTube key used by ytmusicapi/muse/Verome.
// WEB_REMIX for search, ANDROID_MUSIC for player (no cipher, direct URLs).
const INNERTUBE_KEY = process.env.YT_INNERTUBE_KEY || 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WjF97hX4M';
const SEARCH_URL = `https://music.youtube.com/youtubei/v1/search?key=${INNERTUBE_KEY}&prettyPrint=false`;
const PLAYER_URL = `https://music.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}&prettyPrint=false`;

// Fallback Piped instances (Kavin.rocks is primary, fallback to other)
const PIPED_HOSTS = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.syncpundit.io',
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export type Lang = 'ne' | 'hi' | 'en' | 'auto';

function langToContext(lang: string): { gl: string; hl: string } {
  switch (lang) {
    case 'ne': return { gl: 'NP', hl: 'ne' };
    case 'hi': return { gl: 'IN', hl: 'hi' };
    case 'en': return { gl: 'US', hl: 'en' };
    default: return { gl: 'IN', hl: 'en' }; // IN covers Hindi+English+Nepali catalog well
  }
}

function getSearchContext(lang: string) {
  const { gl, hl } = langToContext(lang);
  return {
    client: {
      clientName: 'WEB_REMIX',
      clientVersion: '1.20240710.01.00',
      gl,
      hl,
      visitorData: '',
    },
    user: { lockedSafetyMode: false },
    request: { useSsl: true, internalExperimentFlags: [] },
  };
}

function getPlayerContext(lang: string) {
  const { gl, hl } = langToContext(lang);
  return {
    client: {
      clientName: 'ANDROID_MUSIC',
      clientVersion: '7.02.33',
      androidSdkVersion: 34,
      gl,
      hl,
    },
    user: { lockedSafetyMode: false },
    request: { useSsl: true },
  };
}

// ── Helpers to parse InnerTube search response ───────────────────────────

function extractTitle(mrlir: any): string {
  try {
    const flex = mrlir.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer;
    const runs = flex?.text?.runs;
    if (Array.isArray(runs) && runs[0]?.text) return String(runs[0].text).trim();
    if (flex?.text?.simpleText) return String(flex.text.simpleText).trim();
  } catch {}
  return 'Unknown';
}

function extractSubtitleInfo(mrlir: any): { artist: string | null; album: string | null; duration: string | null } {
  let artist: string | null = null;
  let album: string | null = null;
  let duration: string | null = null;
  try {
    const flex = mrlir.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer;
    const runs: any[] = flex?.text?.runs ?? [];
    // runs pattern: Artist • Album • Duration  (odd indices are " • ")
    const texts: string[] = runs.filter((r: any, i: number) => i % 2 === 0).map((r: any) => String(r.text).trim()).filter(Boolean);
    // Heuristic: last entry with ":" is duration
    if (texts.length && /^\d+:\d+$/.test(texts[texts.length - 1])) {
      duration = texts.pop()!;
    }
    if (texts.length >= 1) artist = texts[0] || null;
    if (texts.length >= 2) album = texts[1] || null;
    // Fallback: check fixedColumns for duration
    if (!duration) {
      const fixed = mrlir.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text;
      const ft = fixed?.simpleText || fixed?.runs?.[0]?.text;
      if (ft && /^\d+:\d+$/.test(String(ft).trim())) duration = String(ft).trim();
    }
  } catch {}
  return { artist, album, duration };
}

function extractVideoId(mrlir: any): string | null {
  try {
    if (mrlir.playlistItemData?.videoId) return String(mrlir.playlistItemData.videoId);
    const overlay = mrlir.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
    if (overlay) return String(overlay);
    const nav = mrlir.navigationEndpoint?.watchEndpoint?.videoId;
    if (nav) return String(nav);
    const flexNav = mrlir.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;
    if (flexNav) return String(flexNav);
    // deep search fallback
    const str = JSON.stringify(mrlir);
    const m = str.match(/"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/);
    if (m) return m[1];
  } catch {}
  return null;
}

function extractThumbnail(mrlir: any, videoId: string | null): string | null {
  try {
    const thumbs = mrlir.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails;
    if (Array.isArray(thumbs) && thumbs.length) {
      // pick largest
      const t = thumbs[thumbs.length - 1];
      if (t?.url) return String(t.url);
    }
  } catch {}
  if (videoId) return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  return null;
}

function durationToSeconds(d: string | null): string | null {
  if (!d || !/^\d+:\d+$/.test(d)) return null;
  const [m, s] = d.split(':').map(Number);
  return String(m * 60 + s);
}

function collectMrlirs(root: any): any[] {
  const acc: any[] = [];
  const stack: any[] = [root];
  const seen = new Set<any>();
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
    seen.add(cur);
    if (cur.musicResponsiveListItemRenderer) {
      acc.push(cur.musicResponsiveListItemRenderer);
      continue;
    }
    if (Array.isArray(cur)) {
      for (const v of cur) stack.push(v);
    } else {
      for (const k of Object.keys(cur)) {
        const v = (cur as any)[k];
        if (v && typeof v === 'object') stack.push(v);
      }
    }
  }
  return acc;
}

// ── Public: search YouTube Music ─────────────────────────────────────────

export async function searchYouTubeMusic(query: string, limit = 12, lang: string = 'auto'): Promise<Song[]> {
  const q = query.trim();
  if (!q) return [];
  // Add year hint for 2024-2026 freshness if not already in query? keep pure search
  const body: any = {
    context: getSearchContext(lang),
    query: q,
    // params for songs: EgWKAQIIAWoKEAoQAxAEEAkQBQ== (filter songs). If lang=ne/hi we keep broader to get Nepali folk etc
    // Use song filter for precision, fallback to no filter if empty
  };
  // Try with song filter first, fallback to unfiltered
  let songs: Song[] = [];
  for (const params of ['EgWKAQIIAWoKEAoQAxAEEAkQBQ==', undefined]) {
    try {
      const payload: any = { ...body };
      if (params) payload.params = params;
      const res = await fetch(SEARCH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': UA,
          Origin: 'https://music.youtube.com',
          Referer: 'https://music.youtube.com/',
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const mrlirs = collectMrlirs(data);
      // Filter to those that look like songs (have videoId and flexColumns)
      const seen = new Set<string>();
      const out: Song[] = [];
      for (const m of mrlirs) {
        const vid = extractVideoId(m);
        if (!vid || seen.has(vid)) continue;
        seen.add(vid);
        const title = extractTitle(m);
        if (!title || title === 'Unknown') continue;
        const { artist, album, duration } = extractSubtitleInfo(m);
        const thumb = extractThumbnail(m, vid);
        const durSec = durationToSeconds(duration);
        out.push({
          id: vid,
          title,
          album: album || null,
          primary_artists: artist || null,
          singers: artist || null,
          language: lang !== 'auto' ? lang : null,
          year: null,
          duration: durSec,
          image: thumb,
          // media_url is our proxy endpoint — client will call /api/music/yt/stream?id=vid
          media_url: `/api/music/yt/stream?id=${encodeURIComponent(vid)}&lang=${encodeURIComponent(lang)}`,
          perma_url: `https://music.youtube.com/watch?v=${vid}`,
          has_lyrics: false,
          // extra fields for unified handling
          // @ts-ignore
          source: 'youtube',
          // @ts-ignore
          videoId: vid,
        } as Song);
        if (out.length >= limit) break;
      }
      if (out.length) {
        songs = out;
        break;
      }
    } catch {
      continue;
    }
  }
  return songs.slice(0, limit);
}

// ── Public: get YouTube audio stream URL (direct) ────────────────────────
// NOTE: In 2024-2026 YouTube tightened WEB poToken. ANDROID_MUSIC still works for many tracks,
// but some YTMUSIC-only ATV tracks return UNPLAYABLE without web player decipher.
// We try: 1) ANDROID_MUSIC InnerTube 2) youtubei.js (handles decipher + n param) 3) Piped fallback
// If all fail, caller should use YouTube embed (iframe) — unlimited via official embed.

let _innertubePromise: Promise<any> | null = null;
async function getInnertube(): Promise<any> {
  if (_innertubePromise) return _innertubePromise;
  _innertubePromise = (async () => {
    try {
      const mod: any = await import('youtubei.js');
      const Innertube = mod.Innertube || mod.default?.Innertube || mod.default;
      if (!Innertube) return null;
      return await Innertube.create({ generate_session_locally: true });
    } catch { return null; }
  })();
  return _innertubePromise;
}

export async function getYouTubeStreamUrl(videoId: string, lang: string = 'auto'): Promise<string | null> {
  const vid = String(videoId).trim();
  if (!vid) return null;

  // 1) Try InnerTube ANDROID_MUSIC player — gives direct audio URLs without decipher for many tracks
  try {
    const res = await fetch(PLAYER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
        Origin: 'https://music.youtube.com',
      },
      body: JSON.stringify({
        context: getPlayerContext(lang),
        videoId: vid,
        racyCheckOk: true,
        contentCheckOk: true,
      }),
    });
    if (res.ok) {
      const data: any = await res.json();
      const streamingData = data?.streamingData;
      const formats: any[] = [
        ...(streamingData?.adaptiveFormats ?? []),
        ...(streamingData?.formats ?? []),
      ];
      let best: any = null;
      for (const f of formats) {
        if (!f.url) continue;
        const mime: string = String(f.mimeType || '');
        if (!mime.includes('audio')) continue;
        const br = Number(f.bitrate || 0);
        if (!best || br > Number(best.bitrate || 0)) best = f;
      }
      if (!best && formats.length) best = formats.find((f: any) => f.url) || null;
      if (best?.url) return String(best.url);
      if (data?.streamingData?.hlsManifestUrl) return String(data.streamingData.hlsManifestUrl);
    }
  } catch {}

  // 2) Try youtubei.js (handles decipher + n param, supports both youtube and ytmusic)
  try {
    const yt = await getInnertube();
    if (yt) {
      // Try regular YouTube first
      try {
        const info: any = await yt.getInfo(vid);
        const fmt: any = info?.chooseFormat?.({ type: 'audio', quality: 'best' });
        if (fmt) {
          const url: string = await fmt.decipher(yt.session.player);
          if (url && url.startsWith('http')) return url;
        }
        // fallback to streaming_data direct url
        const sd = info?.streaming_data || info?.streamingData;
        if (sd?.adaptive_formats?.[0]?.url) return String(sd.adaptive_formats[0].url);
        if (sd?.adaptiveFormats?.[0]?.url) return String(sd.adaptiveFormats[0].url);
      } catch {}
      // Try YTMusic client
      try {
        const mi: any = await yt.music.getInfo(vid);
        const fmt: any = mi?.chooseFormat?.({ type: 'audio', quality: 'best' });
        if (fmt) {
          const url: string = await fmt.decipher(yt.session.player);
          if (url && url.startsWith('http')) return url;
        }
      } catch {}
    }
  } catch {}

  // 3) Fallback to Piped API (deciphers, gives audioStreams) — many instances are Cloudflare-blocked in 2025
  for (const host of PIPED_HOSTS) {
    try {
      const r = await fetch(`${host}/streams/${encodeURIComponent(vid)}`, {
        headers: { 'User-Agent': UA },
      });
      if (!r.ok) continue;
      const d: any = await r.json();
      const audios: any[] = d?.audioStreams ?? [];
      if (!audios.length) continue;
      let best = audios[0];
      for (const a of audios) {
        if (Number(a.bitrate || 0) > Number(best.bitrate || 0)) best = a;
      }
      if (best?.url) return String(best.url);
      if (d?.hls) return String(d.hls);
    } catch {
      continue;
    }
  }
  return null;
}

// For unified top songs: YouTube trending is via charts? We can fake by searching trending queries per lang
export async function getYouTubeTopSongs(lang: string = 'auto', limit = 20): Promise<Song[]> {
  const queries: Record<string, string> = {
    ne: 'Nepali new songs 2025',
    hi: 'Hindi new songs 2025',
    en: 'Top English songs 2025',
    auto: 'Top songs 2025',
  };
  const q = queries[lang] || queries.auto;
  return searchYouTubeMusic(q, limit, lang);
}
