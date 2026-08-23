import CryptoJS from 'crypto-js';

// Music logic ported from Harsh-23/Musify (lib/API/saavn.dart) combined with
// cyberboysumanjay/JioSaavnAPI (helper.py DES decryption).
const SEARCH_BASE_URL = 'https://www.jiosaavn.com/api.php?app_version=5.18.3&api_version=4&readable_version=5.18.3&v=79&_format=json&query=';
const SONG_DETAILS_BASE_URL = 'https://www.jiosaavn.com/api.php?app_version=5.18.3&api_version=4&readable_version=5.18.3&v=79&_format=json&__call=song.getDetails&pids=';
const TOP_SONGS_URL = 'https://www.jiosaavn.com/api.php?__call=webapi.get&token=8MT-LQlP35c_&type=playlist&p=1&n=30&includeMetaTags=0&ctx=web6dot0&api_version=4&_format=json&_marker=0';
const ALBUM_DETAILS_BASE_URL = 'https://www.jiosaavn.com/api.php?__call=content.getAlbumDetails&_format=json&cc=in&_marker=0%3F_marker%3D0&albumid=';
const PLAYLIST_DETAILS_BASE_URL = 'https://www.jiosaavn.com/api.php?__call=playlist.getDetails&_format=json&cc=in&_marker=0%3F_marker%3D0&listid=';
const LYRICS_BASE_URL = 'https://www.jiosaavn.com/api.php?__call=lyrics.getLyrics&lyrics_id=';
const DES_KEY = '38346591';

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

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function saavnGet(url: string): Promise<any> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`JioSaavn request failed (${res.status})`);
  const text = await res.text();
  return parseUnicodeJson(text);
}

// JioSaavn sometimes prefixes JSON with an HTML comment "<!-- -->" — Musify splits on "-->".
// Also, titles like `(From "Movie")` break strict JSON; patch quotes before parsing.
function parseUnicodeJson(text: string): any {
  let body = text.includes('-->') ? text.split('-->').pop()! : text;
  try {
    return JSON.parse(body);
  } catch {
    body = body.replace(/\(From "([^"]+)"\)/g, "(From '$1')");
    return JSON.parse(body);
  }
}

function formatString(s: unknown): string {
  if (typeof s !== 'string') return s == null ? '' : String(s);
  return s
    .replace(/&quot;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<');
}

// Same DES-ECB key as Musify's DesPlugin.decrypt("38346591", ...) / helper.decrypt_url().
// Pure-JS via crypto-js because OpenSSL 3 dropped legacy DES from node:crypto.
export function decryptUrl(encryptedUrl: string): string {
  const key = CryptoJS.enc.Utf8.parse(DES_KEY);
  const decrypted = CryptoJS.DES.decrypt(
    { ciphertext: CryptoJS.enc.Base64.parse(encryptedUrl.trim()) } as CryptoJS.lib.CipherParams,
    key,
    { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 },
  );
  return decrypted.toString(CryptoJS.enc.Utf8).replace('_96.mp4', '_320.mp4');
}

// Musify resolves the decrypted URL with a no-redirect HEAD request and takes Location.
async function resolveRedirect(url: string): Promise<string> {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': UA } });
    const location = res.headers.get('location');
    return res.status >= 300 && res.status < 400 && location ? location : url;
  } catch {
    return url;
  }
}

function upgradeImage(img: unknown): string | null {
  if (typeof img !== 'string') return null;
  return img.replace('150x150', '500x500').replace('50x50', '500x500');
}

// The api_version=4 endpoint nests fields under more_info; the older cc=in endpoint is flat.
// Support both shapes so every endpoint benefits from one formatter.
function formatSong(data: any): Song {
  const info = data?.more_info ?? {};
  const pick = (a: any, b: any) => {
    const v = a !== undefined && a !== null && a !== '' ? a : b;
    return v === undefined || v === null || v === '' ? null : v;
  };
  const encrypted = data.encrypted_media_url ?? info.encrypted_media_url;
  if (!encrypted) throw new Error('Song has no playable media url');

  let mediaUrl = decryptUrl(encrypted);
  if ((data['320kbps'] ?? info['320kbps']) !== 'true') mediaUrl = mediaUrl.replace('_320.mp4', '_160.mp4');

  const artistMapPrimary = info?.artistMap?.primary_artists;
  const primaryArtists = Array.isArray(artistMapPrimary)
    ? artistMapPrimary.map((a: any) => formatString(a.name)).join(', ')
    : pick(data.primary_artists, info.primary_artists);

  return {
    id: String(data.id),
    title: formatString(pick(data.song, data.title)),
    album: formatString(pick(data.album, info.album)) || null,
    primary_artists: primaryArtists ? formatString(primaryArtists) : null,
    singers: formatString(pick(data.singers, info.singers)) || null,
    language: pick(data.language, info.language),
    year: pick(data.year, info.year),
    duration: pick(data.duration, info.duration),
    image: upgradeImage(data.image),
    media_url: mediaUrl,
    perma_url: pick(data.perma_url, null),
    has_lyrics: (data.has_lyrics ?? info.has_lyrics) === 'true',
  };
}

function isSaavnUrl(query: string): boolean {
  return query.startsWith('http') && query.includes('saavn.com');
}

export async function getSongId(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, method: 'POST', body: new URLSearchParams({ bitrate: '320' }) });
  const text = await res.text();
  const pidMatch = text.match(/"pid":"([^"]+)"/);
  if (pidMatch) return pidMatch[1];
  const songIdMatch = text.match(/"song":{"type":"[^"]*","id":"([^"]+)"/);
  if (songIdMatch) return songIdMatch[1];
  throw new Error('Could not extract song id from JioSaavn URL');
}

export async function getSong(id: string): Promise<Song | null> {
  try {
    const response = await saavnGet(SONG_DETAILS_BASE_URL + id);
    const raw = response[id];
    if (!raw) return null;
    const song = formatSong(raw);
    song.media_url = await resolveRedirect(song.media_url);
    return song;
  } catch {
    return null;
  }
}

export async function searchSongs(query: string, limit = 12): Promise<Song[]> {
  if (isSaavnUrl(query)) {
    const id = query.includes('/song/') ? await getSongId(query) : query;
    const s = await getSong(id);
    return s ? [s] : [];
  }
  // Musify fetchSongsList(): autocomplete.get then hydrate each hit via song.getDetails
  const response = await saavnGet(SEARCH_BASE_URL + encodeURIComponent(query) + '&__call=autocomplete.get');
  const ids: string[] = (response?.songs?.data ?? []).map((s: any) => s.id).slice(0, limit);
  const songs = await Promise.all(ids.map(getSong));
  return songs.filter((s): s is Song => !!s);
}

// Musify topSongs(): official "Top songs" playlist via webapi.get token
export async function getTopSongs(limit = 20): Promise<Song[]> {
  try {
    const d = await saavnGet(TOP_SONGS_URL);
    const list: any[] = d?.list ?? [];
    const ids = list.map((s: any) => s.id).slice(0, limit);
    const songs = await Promise.all(ids.map(getSong));
    return songs.filter((s): s is Song => !!s);
  } catch {
    return [];
  }
}

export async function getAlbum(albumId: string): Promise<{ name: string; image: string | null; songs: Song[] } | null> {
  try {
    const d = await saavnGet(ALBUM_DETAILS_BASE_URL + albumId);
    if (!d || !d.songs) return null;
    return {
      name: formatString(d.title || d.name),
      image: upgradeImage(d.image),
      songs: d.songs.map(formatSong),
    };
  } catch {
    return null;
  }
}

export async function getPlaylist(listId: string): Promise<{ name: string; image: string | null; songs: Song[] } | null> {
  try {
    const d = await saavnGet(PLAYLIST_DETAILS_BASE_URL + listId);
    if (!d || !d.songs) return null;
    return {
      name: formatString(d.listname || d.firstname || 'Playlist'),
      image: upgradeImage(d.image),
      songs: d.songs.map(formatSong),
    };
  } catch {
    return null;
  }
}

export async function getLyrics(id: string): Promise<string | null> {
  try {
    const d = await saavnGet(LYRICS_BASE_URL + id + '&ctx=web6dot0&api_version=4&_format=json');
    return d?.lyrics ? formatString(d.lyrics).replace(/<br\s*\/?>/gi, '\n') : null;
  } catch {
    return null;
  }
}
