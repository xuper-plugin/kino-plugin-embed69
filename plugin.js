var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/extractors/streamwish.js
var streamwish_exports = {};
__export(streamwish_exports, {
  HOSTS: () => HOSTS,
  extract: () => extract
});

// src/util/http.js
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
var REQUEST_MS = 8e3;
var MIN_MS = 1500;
function makeReq(kino2, { deadline }) {
  const req = async (url, opts = {}) => {
    const left = deadline - Date.now();
    if (left < MIN_MS) throw kino2.error("timeout", "no time left for " + new URL(url).hostname);
    return kino2.fetch(url, { headers: { "User-Agent": UA, ...opts.headers || {} }, method: opts.method, body: opts.body, timeoutMs: Math.min(REQUEST_MS, left) });
  };
  req.left = () => Math.max(0, deadline - Date.now());
  return req;
}

// src/util/unpack.js
var ALPHA = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
var toNum = (s, radix) => [...s].reduce((n, ch) => n * radix + ALPHA.indexOf(ch), 0);
function unpack(source) {
  const m = /}\s*\(\s*'((?:\\'|[^'])*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:\\'|[^'])*)'\.split\('\|'\)/.exec(source || "");
  if (!m) return null;
  const payload = m[1].replace(/\\'/g, "'");
  const radix = Number(m[2]);
  const keys = m[4].split("|");
  if (radix < 2 || radix > 62) return null;
  return payload.replace(/\b[0-9a-zA-Z]+\b/g, (w) => {
    const i = toNum(w, radix);
    return Number.isInteger(i) && i >= 0 && keys[i] ? keys[i] : w;
  });
}

// src/extractors/shared.js
var HLS_MIME = "application/vnd.apple.mpegurl";
function fileM3u8(text, base) {
  const m = /\bfile\s*:\s*["']([^"']+\.m3u8[^"']*)["']/.exec(text || "");
  return m ? absolute(m[1], base) : null;
}
function hlsKey(text, keys, base) {
  for (const k of keys) {
    const m = new RegExp(`["']${k}["']\\s*:\\s*["']([^"']+)["']`).exec(text || "");
    if (m) return absolute(m[1].replace(/\\\//g, "/"), base);
  }
  return null;
}
function absolute(href, base) {
  try {
    return new URL(href, base).href;
  } catch (_) {
    return null;
  }
}
function findIn(html, pick) {
  return pick(html) || pick(unpack(html) || "") || null;
}
function miss(kino2, server, reason) {
  if (kino2 && typeof kino2.log === "function") kino2.log("[embed69]", server, reason);
  return null;
}
var GONE = Object.freeze({ gone: true });
var GONE_TEXT = /no longer available|has been deleted|expired or has been deleted|file (was )?not found|video (was )?not found/i;
function isGone(html) {
  const visible = String(html || "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  return GONE_TEXT.test(visible);
}
async function pageText(req, url, headers, kino2, server) {
  const r = await req(url, { headers });
  if (r.status === 404 || r.status === 410) {
    miss(kino2, server || "embed", "gone, status " + r.status);
    return GONE;
  }
  return r.ok ? r.text() : miss(kino2, server || "embed", "status " + r.status);
}
var LANG_CODES = [
  [/^(español|espanol|spanish|castellano|latino|spa|esp?)\b/i, "es"],
  [/^(english|inglés|ingles|eng?)\b/i, "en"],
  [/^(portugu[eê]s|portuguese|pt)\b/i, "pt"],
  // never a bare "por": "Por defecto" is not Portuguese
  [/^(fran[cç]ais|french|franc[eé]s|fre|fra|fr)\b/i, "fr"],
  [/^(italiano|italian|ita|it)\b/i, "it"],
  [/^(deutsch|german|alem[aá]n|ger|deu|de)\b/i, "de"]
];
function langCode(label) {
  const s = String(label || "").trim();
  for (const [re, code] of LANG_CODES) if (re.test(s)) return code;
  return null;
}
function captionTracks(text, base) {
  const m = /["']?\btracks["']?\s*:\s*\[([\s\S]*?)\]/.exec(text || "");
  if (!m) return [];
  const out = [];
  for (const [obj] of m[1].matchAll(/\{[^{}]*\}/g)) {
    const field = (k) => (new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"']*)["']`).exec(obj) || [])[1] || "";
    const kind = field("kind").toLowerCase();
    if (kind && kind !== "captions" && kind !== "subtitles") continue;
    const file = field("file");
    const format = (/\.(vtt|srt)(?:[?#]|$)/i.exec(file) || [])[1];
    const label = field("label");
    const lang = langCode(label);
    const url = format && lang ? absolute(file, base) : null;
    if (!url || out.some((t2) => t2.url === url)) continue;
    out.push({ lang, url, label, format: format.toLowerCase() });
  }
  return out;
}
function durationMsOf(text) {
  const re = /(?<![-\w])duration["']?\s*:\s*["']?(\d+(?:\.\d+)?)(?![\d.])(?!\s*m?s\b)/g;
  for (const m of String(text || "").matchAll(re)) {
    const ms = Math.round(Number(m[1]) * 1e3);
    if (ms >= 6e4) return ms;
  }
  return null;
}
function pageExtras(html, base) {
  const unpacked = unpack(html) || "";
  const subs = captionTracks(html, base);
  const subtitles = subs.length ? subs : captionTracks(unpacked, base);
  const durationMs = durationMsOf(html) || durationMsOf(unpacked);
  return { ...subtitles.length ? { subtitles } : {}, ...durationMs ? { durationMs } : {} };
}

// src/extractors/streamwish.js
var HOSTS = ["hlswish.com", "streamwish.com", "streamwish.to", "strwish.com", "wishembed.com", "filelions.com", "hglink.to", "vibuxer.com"];
async function extract(embedUrl, req, kino2) {
  const u = new URL(embedUrl);
  if (u.hostname === "hglink.to") u.hostname = "vibuxer.com";
  const referer = u.origin + "/";
  const html = await pageText(req, u.href, { Referer: referer }, kino2, "streamwish");
  if (html === GONE) return GONE;
  if (html == null) return null;
  const url = findIn(html, (t2) => hlsKey(t2, ["hls4", "hls2", "hls3"], u.origin) || fileM3u8(t2, u.origin));
  if (!url) return isGone(html) ? (miss(kino2, "streamwish", "gone: the file was deleted or expired"), GONE) : miss(kino2, "streamwish", "no playlist in page");
  return { url, mime: HLS_MIME, headers: { "User-Agent": UA, Referer: referer }, ...pageExtras(html, u.origin) };
}

// src/extractors/vidhide.js
var vidhide_exports = {};
__export(vidhide_exports, {
  HOSTS: () => HOSTS2,
  extract: () => extract2
});
var HOSTS2 = ["vidhide.com", "vidhidepro.com", "vidhideplus.com", "dintezuvio.com", "minochinos.com", "filelions.to", "morencius.com"];
async function extract2(embedUrl, req, kino2) {
  const u = new URL(embedUrl);
  const html = await pageText(req, embedUrl, { Referer: u.origin + "/" }, kino2, "vidhide");
  if (html === GONE) return GONE;
  if (html == null) return null;
  const url = findIn(html, (t2) => hlsKey(t2, ["hls4", "hls2"], u.origin) || fileM3u8(t2, u.origin));
  if (!url) return isGone(html) ? (miss(kino2, "vidhide", "gone: the file was deleted or expired"), GONE) : miss(kino2, "vidhide", "no playlist in page");
  return { url, mime: HLS_MIME, headers: { Referer: u.origin + "/", Origin: u.origin }, ...pageExtras(html, u.origin) };
}

// src/extractors/voe.js
var voe_exports = {};
__export(voe_exports, {
  HOSTS: () => HOSTS3,
  canCapture: () => canCapture,
  decodeVoe: () => decodeVoe,
  extract: () => extract3
});
var HOSTS3 = ["voe.sx"];
var JUNK = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];
var rot13 = (s) => s.replace(/[a-z]/gi, (c) => {
  const b = c <= "Z" ? 65 : 97;
  return String.fromCharCode((c.charCodeAt(0) - b + 13) % 26 + b);
});
function decodeVoe(enc) {
  let s = rot13(enc);
  for (const j of JUNK) s = s.split(j).join("");
  s = atob(s);
  s = [...s].map((c) => String.fromCharCode(c.charCodeAt(0) - 3)).join("");
  s = [...s].reverse().join("");
  return JSON.parse(decodeURIComponent(escape(atob(s))));
}
var redirectOf = (html) => (/window\.location\.href\s*=\s*'([^']+)'/.exec(html) || [])[1] || null;
var canCapture = (kino2) => !!(kino2 && kino2.browser && kino2.browser.captureAll === true && typeof kino2.browser.capture === "function");
var CAPTURE_MS = 12e3;
var MIN_CAPTURE_MS = 3e3;
async function capture(embedUrl, req, kino2) {
  const ms = Math.min(CAPTURE_MS, (req.left ? req.left() : CAPTURE_MS) - 300);
  if (ms < MIN_CAPTURE_MS) {
    kino2.log("[embed69]", "voe", "no time to capture");
    return null;
  }
  let cap;
  try {
    cap = await kino2.browser.capture(embedUrl, { match: "\\.m3u8|\\.mp4", timeoutMs: ms });
  } catch (e) {
    kino2.log("[embed69]", "voe capture", e && e.code || "error");
    return null;
  }
  const m = cap && Array.isArray(cap.media) ? cap.media.find((x) => x && typeof x.url === "string" && /^https?:\/\//i.test(x.url)) : null;
  if (!m) {
    kino2.log("[embed69]", "voe capture", "no media");
    return null;
  }
  const mime = m.mime || (/\.mp4(?:[?#]|$)/i.test(m.url) ? "video/mp4" : HLS_MIME);
  return { url: m.url, mime, headers: { Referer: embedUrl, ...m.headers || {} } };
}
async function extract3(embedUrl, req, kino2) {
  const log = (...a) => {
    if (kino2) kino2.log("[embed69]", "voe", ...a);
  };
  const first = await req(embedUrl, { headers: { Referer: embedUrl } });
  if (first.status === 404 || first.status === 410) {
    log("gone, embed", first.status);
    return GONE;
  }
  if (!first.ok) {
    log("embed", first.status);
    return null;
  }
  const html = first.text();
  if (redirectOf(html)) {
    if (canCapture(kino2)) return capture(embedUrl, req, kino2);
    log("rotating host, no browser");
    return null;
  }
  const j = /<script type="application\/json">\s*\["([^"]+)"\]/.exec(html);
  if (j) {
    try {
      const d = decodeVoe(j[1]);
      const url = d.source || d.direct_access_url;
      if (url) return { url, mime: /\.mp4/.test(url) ? "video/mp4" : HLS_MIME, headers: { Referer: embedUrl } };
    } catch (_) {
    }
  }
  const h = /'hls'\s*:\s*'([^']+)'/.exec(html) || /(https?:\/\/[^"'\s]+\.mp4[^"'\s]*)/.exec(html);
  if (!h) {
    log("no stream in page");
    return null;
  }
  return { url: h[1], headers: { Referer: embedUrl } };
}

// src/extractors/index.js
var TABLE = { streamwish: streamwish_exports, vidhide: vidhide_exports, voe: voe_exports };
function extractorFor(embedUrl) {
  let host;
  try {
    host = new URL(embedUrl).hostname.replace(/^www\./, "");
  } catch (_) {
    return null;
  }
  for (const [name, mod] of Object.entries(TABLE)) {
    if (mod.HOSTS.some((h) => host === h || host.endsWith("." + h))) return { name, extract: mod.extract };
  }
  return null;
}
var HOSTS4 = Object.values(TABLE).flatMap((m) => m.HOSTS);

// src/util/lang.js
function normLang(text) {
  const s = String(text || "").toLowerCase();
  if (/\b(sub|subs|vose|subtitulado|subtitulada)\b/.test(s)) return "sub";
  if (/\b(lat|latino|latam|mx|mex|col|es-mx)\b/.test(s)) return "lat";
  if (/\b(cast|castellano|esp|español|espanol|es-es|spain)\b/.test(s)) return "esp";
  if (/(?:^|[^a-z0-9ñ])(españa|espana)(?:$|[^a-z0-9ñ])/.test(s)) return "esp";
  return null;
}

// src/embed69.js
var SITE = "https://embed69.org";
var HEADERS = { Referer: "https://sololatino.net/" };
var POW_CAP = 1e5;
var MAX_DIFFICULTY = 4;
function solvePow(kino2, challenge, difficulty, cap = POW_CAP) {
  const zeros = "0".repeat(difficulty);
  for (let n = 0; n <= cap; n++) if (kino2.crypto.hash("sha256", challenge + n).startsWith(zeros)) return n;
  return null;
}
function decryptLink(kino2, keyHex, b64) {
  const raw = atob(b64);
  let ivHex = "";
  for (let i = 0; i < 16; i++) ivHex += raw.charCodeAt(i).toString(16).padStart(2, "0");
  return kino2.crypto.decrypt("aes-256-cbc", { key: keyHex, keyEncoding: "hex", iv: ivHex, ivEncoding: "hex", data: btoa(raw.slice(16)) });
}
var quoted = (html, name) => {
  const m = new RegExp(name + "\\s*=\\s*'([^']*)'").exec(html);
  return m ? m[1] : null;
};
function pathFor(title) {
  if (!title || !/^tt\d{5,12}$/.test(String(title.imdbId || ""))) return null;
  if (title.kind !== "tv") return title.imdbId;
  const s = Number(title.season), e = Number(title.episode);
  if (title.season == null || title.episode == null || !Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e < 1) return null;
  return `${title.imdbId}-${s}x${String(e).padStart(2, "0")}`;
}
async function listCopies(title, { kino: kino2, req }) {
  const path = pathFor(title);
  if (!path) return [];
  const r = await req(`${SITE}/f/${path}`, { headers: HEADERS });
  if (!r.ok) return [];
  const html = r.text();
  const data = /let\s+dataLink\s*=\s*(\[.+\]);/.exec(html);
  const challenge = quoted(html, "POW_CHALLENGE"), salt = quoted(html, "POW_SALT");
  const difficulty = Number((/POW_DIFFICULTY\s*=\s*(\d+)/.exec(html) || [])[1]);
  if (!data || !challenge || salt == null || !Number.isInteger(difficulty)) return [];
  let langs;
  try {
    langs = JSON.parse(data[1]);
  } catch (_) {
    return [];
  }
  if (difficulty > MAX_DIFFICULTY) return [];
  const n = solvePow(kino2, challenge, difficulty);
  if (n == null) return [];
  const keyHex = kino2.crypto.hash("sha256", challenge + n + salt);
  const out = [];
  for (const l of langs) {
    const lang = normLang(l && l.video_language);
    if (!lang) continue;
    for (const e of l && l.sortedEmbeds || []) {
      if (!e || e.servername === "download" || typeof e.link !== "string") continue;
      let url;
      try {
        url = decryptLink(kino2, keyHex, e.link);
      } catch (_) {
        continue;
      }
      const known = /^https?:\/\//i.test(url) ? extractorFor(url) : null;
      if (known && !out.some((c) => c.embedUrl === url)) out.push({ lang, server: known.name, embedUrl: url });
    }
  }
  return out;
}

// src/plugin.js
if (typeof kino.meta !== "function") throw kino.error("unavailable", "kino.meta not available");
if (typeof kino.tmdb !== "function") throw kino.error("unavailable", "kino.tmdb not available");
var TMDB_IMG = "https://image.tmdb.org/t/p/";
var DAY_MS = 24 * 60 * 60 * 1e3;
var RESOLVE_MS = 4e4;
var MAX_COPIES = 8;
var STRINGS = {
  es: {
    unavailable: "El servicio no est\xE1 disponible en este momento.",
    noStreams: "No se encontraron fuentes para este t\xEDtulo.",
    gone: "Los enlaces de este t\xEDtulo caducaron o se borraron.",
    noMeta: "No se encontr\xF3 informaci\xF3n de este t\xEDtulo.",
    trendingMovies: "Pel\xEDculas populares",
    trendingSeries: "Series populares",
    nowPlaying: "En cines ahora",
    upcoming: "Pr\xF3ximos estrenos",
    topMovies: "Pel\xEDculas mejor valoradas",
    onTheAir: "Series en emisi\xF3n",
    topSeries: "Series mejor valoradas",
    kids: "Para los ni\xF1os",
    docs: "Documentales",
    anime: "Anime",
    gAction: "Acci\xF3n",
    gComedy: "Comedia",
    gSciFi: "Ciencia ficci\xF3n",
    gHorror: "Terror",
    gDrama: "Drama",
    cacheCleared: "Cach\xE9 de IDs vaciada.",
    lat: "Latino",
    esp: "Castellano",
    sub: "Subtitulado"
  },
  en: {
    unavailable: "The service is not available right now.",
    noStreams: "No streams found for this title.",
    gone: "This title's links expired or were deleted.",
    noMeta: "No metadata found for this title.",
    trendingMovies: "Trending movies",
    trendingSeries: "Trending series",
    nowPlaying: "In theaters now",
    upcoming: "Coming soon",
    topMovies: "Top rated movies",
    onTheAir: "Series on the air",
    topSeries: "Top rated series",
    kids: "For kids",
    docs: "Documentaries",
    anime: "Anime",
    gAction: "Action",
    gComedy: "Comedy",
    gSciFi: "Science fiction",
    gHorror: "Horror",
    gDrama: "Drama",
    cacheCleared: "ID cache cleared.",
    lat: "Latin",
    esp: "Castilian",
    sub: "Subtitled"
  }
};
function t(key) {
  const lang = String(kino.lang || "es").startsWith("en") ? "en" : "es";
  return (STRINGS[lang] || STRINGS.es)[key] || key;
}
var TMDB_GENRES = {
  28: "Acci\xF3n",
  12: "Aventura",
  16: "Animaci\xF3n",
  35: "Comedia",
  80: "Crimen",
  99: "Documentales",
  18: "Drama",
  10751: "Familia",
  14: "Fantas\xEDa",
  36: "Historia",
  27: "Terror",
  9648: "Misterio",
  10749: "Romance",
  878: "Ciencia ficci\xF3n",
  53: "Suspenso",
  10752: "B\xE9lica",
  37: "Western",
  10759: "Acci\xF3n",
  10765: "Ciencia ficci\xF3n",
  10766: "Drama",
  10764: "Reality",
  10768: "B\xE9lica"
};
function genresOf(raw) {
  const names = /* @__PURE__ */ new Set();
  for (const id of Array.isArray(raw.genre_ids) ? raw.genre_ids : []) if (TMDB_GENRES[id]) names.add(TMDB_GENRES[id]);
  return [...names].slice(0, 5);
}
function itemFromTmdb(raw, kind) {
  const isMovie = kind === "movie";
  const tmdbId = raw.id;
  return {
    id: (isMovie ? "m" : "s") + tmdbId,
    ref: (isMovie ? "m:" : "s:") + tmdbId,
    title: String(raw.title || raw.name || ""),
    kind: isMovie ? "movie" : "series",
    year: (raw.release_date || raw.first_air_date || "").slice(0, 4) || void 0,
    poster: raw.poster_path ? TMDB_IMG + "w500" + raw.poster_path : void 0,
    backdrop: raw.backdrop_path ? TMDB_IMG + "w1280" + raw.backdrop_path : void 0,
    overview: raw.overview || void 0,
    rating: raw.vote_average > 0 ? Math.round(raw.vote_average * 10) / 10 : void 0,
    ids: { tmdb: tmdbId },
    genres: genresOf(raw).length ? genresOf(raw) : void 0
  };
}
async function imdbFor(tmdbId, type) {
  const key = "imdb:" + type + ":" + tmdbId;
  const hit = kino.storage.get(key);
  if (hit) return hit;
  const meta = await kino.meta({ type, ids: { tmdb: Number(tmdbId) } });
  const imdb = meta?.ids?.imdb ?? null;
  if (imdb) kino.storage.set(key, imdb, { ttlMs: 30 * DAY_MS });
  return imdb;
}
var titlesOf = (query) => [query.q, query.originalTitle, ...query.altTitles || []].filter(Boolean);
var HOME_ROWS = [
  { id: "trending-movies", title: "trendingMovies", genre: "peliculas", ref: "trend:movie", kind: "movie", path: "/trending/movie/week" },
  { id: "now-playing", title: "nowPlaying", genre: "peliculas", ref: "list:movie:now_playing", kind: "movie", path: "/movie/now_playing" },
  { id: "upcoming", title: "upcoming", genre: "peliculas", ref: "list:movie:upcoming", kind: "movie", path: "/movie/upcoming" },
  { id: "top-movies", title: "topMovies", genre: "peliculas", ref: "list:movie:top_rated", kind: "movie", path: "/movie/top_rated" },
  { id: "trending-series", title: "trendingSeries", genre: "series", ref: "trend:tv", kind: "tv", path: "/trending/tv/week" },
  { id: "on-the-air", title: "onTheAir", genre: "series", ref: "list:tv:on_the_air", kind: "tv", path: "/tv/on_the_air" },
  { id: "top-series", title: "topSeries", genre: "series", ref: "list:tv:top_rated", kind: "tv", path: "/tv/top_rated" },
  { id: "g-action", title: "gAction", genre: "peliculas", ref: "genre:movie:28", kind: "movie", path: "/discover/movie", params: { with_genres: 28 } },
  { id: "g-comedy", title: "gComedy", genre: "peliculas", ref: "genre:movie:35", kind: "movie", path: "/discover/movie", params: { with_genres: 35 } },
  { id: "g-scifi", title: "gSciFi", genre: "peliculas", ref: "genre:movie:878", kind: "movie", path: "/discover/movie", params: { with_genres: 878 } },
  { id: "g-horror", title: "gHorror", genre: "peliculas", ref: "genre:movie:27", kind: "movie", path: "/discover/movie", params: { with_genres: 27 } },
  { id: "g-drama", title: "gDrama", genre: "peliculas", ref: "genre:movie:18", kind: "movie", path: "/discover/movie", params: { with_genres: 18 } },
  { id: "kids", title: "kids", genre: "infantil", ref: "genre:movie:10751", kind: "movie", path: "/discover/movie", params: { with_genres: 10751 } },
  { id: "docs", title: "docs", genre: "documentales", ref: "genre:movie:99", kind: "movie", path: "/discover/movie", params: { with_genres: 99 } },
  { id: "anime", title: "anime", genre: "anime", ref: "anime:tv", kind: "tv", path: "/discover/tv", params: { with_genres: 16, with_origin_country: "JP" } }
];
var DISCOVER = { sort_by: "popularity.desc", "vote_count.gte": 200 };
async function homeRow(row) {
  const res = await kino.tmdb(row.path, { ...row.path.startsWith("/discover") ? DISCOVER : {}, ...row.params || {} });
  const items = (res?.results || []).filter((r) => r.poster_path).slice(0, 20).map((r) => itemFromTmdb(r, row.kind));
  return items.length ? { id: row.id, title: t(row.title), genre: row.genre, ref: row.ref, items } : null;
}
async function home() {
  const settled = await Promise.allSettled(HOME_ROWS.map(homeRow));
  const rows = settled.map((r) => r.status === "fulfilled" ? r.value : null).filter(Boolean);
  if (!rows.length) throw kino.error("unavailable", "no home row could be loaded", { userMessage: t("unavailable") });
  return rows;
}
async function search(query) {
  if (!String(query.q || "").trim()) return [];
  const type = query.type;
  if (type === "series") {
    const res = await kino.tmdb("/search/tv", { query: query.q });
    return kino.rank.filterRelevant((res?.results || []).map((r) => itemFromTmdb(r, "tv")), titlesOf(query));
  }
  if (type === "movie") {
    const res = await kino.tmdb("/search/movie", { query: query.q });
    return kino.rank.filterRelevant((res?.results || []).map((r) => itemFromTmdb(r, "movie")), titlesOf(query));
  }
  const [movies, tv] = await Promise.all([
    kino.tmdb("/search/movie", { query: query.q }),
    kino.tmdb("/search/tv", { query: query.q })
  ]);
  const all = [
    ...(movies?.results || []).map((r) => itemFromTmdb(r, "movie")),
    ...(tv?.results || []).map((r) => itemFromTmdb(r, "tv"))
  ];
  return kino.rank.sortBySimilarity(all, titlesOf(query));
}
async function browse(ref, cursor) {
  const page = cursor ? Number(cursor) : 1;
  let path, params = { page }, kind;
  const parts = String(ref).split(":");
  if (parts[0] === "trend" && (parts[1] === "movie" || parts[1] === "tv")) {
    kind = parts[1];
    path = `/trending/${kind}/week`;
  } else if (parts[0] === "list" && (parts[1] === "movie" || parts[1] === "tv") && /^[a-z_]+$/.test(parts[2] || "")) {
    kind = parts[1];
    path = `/${kind}/${parts[2]}`;
  } else if (parts[0] === "popular" && (parts[1] === "movie" || parts[1] === "tv")) {
    kind = parts[1];
    path = `/${kind}/popular`;
  } else if (parts[0] === "anime" && parts[1] === "tv") {
    kind = "tv";
    path = "/discover/tv";
    params = { ...DISCOVER, with_genres: 16, with_origin_country: "JP", page };
  } else if (parts[0] === "genre" && (parts[1] === "movie" || parts[1] === "tv") && /^\d+$/.test(parts[2] || "")) {
    kind = parts[1];
    path = `/discover/${kind}`;
    params = { ...DISCOVER, with_genres: parts[2], page };
  } else {
    return { items: [] };
  }
  const res = await kino.tmdb(path, params);
  const items = (res?.results || []).filter((r) => r.poster_path).map((r) => itemFromTmdb(r, kind));
  const next = res?.page < res?.total_pages ? String(page + 1) : void 0;
  return { items, next };
}
async function categories() {
  const [mg, tg] = await Promise.all([kino.tmdb("/genre/movie/list"), kino.tmdb("/genre/tv/list")]);
  const cats = [];
  for (const g of (mg?.genres || []).slice(0, 12)) cats.push({ id: "gm" + g.id, title: g.name, ref: "genre:movie:" + g.id });
  for (const g of (tg?.genres || []).slice(0, 8)) cats.push({ id: "gt" + g.id, title: g.name + " (series)", ref: "genre:tv:" + g.id });
  return cats.slice(0, 24);
}
async function episodes(ref) {
  const tmdbId = ref.startsWith("s:") ? ref.slice(2) : ref;
  const meta = await kino.meta({ type: "series", ids: { tmdb: Number(tmdbId) } });
  if (!meta) throw kino.error("not_found", "series not found: tmdb " + tmdbId, { userMessage: t("noMeta") });
  const imdbId = meta.ids?.imdb;
  if (!imdbId) throw kino.error("not_found", "no IMDB id for series tmdb:" + tmdbId, { userMessage: t("noMeta") });
  kino.storage.set("imdb:series:" + tmdbId, imdbId, { ttlMs: 30 * DAY_MS });
  return {
    series: {
      title: meta.title,
      poster: meta.poster,
      backdrop: meta.backdrop,
      overview: meta.overview,
      genres: meta.genres,
      year: meta.year,
      ids: meta.ids,
      runtimeMinutes: meta.runtimeMinutes
    },
    episodes: (meta.episodes || []).map((ep) => ({
      season: ep.season,
      number: ep.number,
      // the IMDB id rides in the ref so resolve() does not need kino.meta again
      ref: "ep:" + imdbId + ":" + ep.season + ":" + ep.number,
      title: ep.title,
      still: ep.still,
      overview: ep.overview,
      airDate: ep.airDate
    }))
  };
}
var SERVER_LABEL = { streamwish: "StreamWish", vidhide: "VidHide", voe: "Voe" };
var SERVER_ORDER = ["streamwish", "voe", "vidhide"];
function languageOrder() {
  const pref = String(kino.config.get("language") || "lat");
  return pref === "esp" ? ["esp", "lat", "sub"] : pref === "sub" ? ["sub", "lat", "esp"] : ["lat", "esp", "sub"];
}
function ordered(copies) {
  const langs = languageOrder();
  const rank = (c) => langs.indexOf(c.lang) * 10 + Math.max(0, SERVER_ORDER.indexOf(c.server));
  return [...copies].sort((a, b) => rank(a) - rank(b));
}
var labelOf = (c) => `${t(c.lang)} \xB7 ${SERVER_LABEL[c.server] || c.server}`;
function copyRef(title, c) {
  return title.kind === "tv" ? `cp:ep:${title.imdbId}:${title.season}:${title.episode}:${c.lang}:${c.server}` : `cp:movie:${title.imdbId}:${c.lang}:${c.server}`;
}
function parseCopyRef(ref) {
  const p = ref.split(":");
  if (p[1] === "movie" && p.length === 5) return { title: { kind: "movie", imdbId: p[2] }, lang: p[3], server: p[4] };
  if (p[1] === "ep" && p.length === 7) return { title: { kind: "tv", imdbId: p[2], season: Number(p[3]), episode: Number(p[4]) }, lang: p[5], server: p[6] };
  return null;
}
function toStream(s, c) {
  const out = { url: s.url, label: labelOf(c), headers: { "User-Agent": UA, ...s.headers && typeof s.headers === "object" ? s.headers : {} } };
  if (s.mime) out.mime = s.mime;
  const subs = Array.isArray(s.subtitles) ? s.subtitles.filter((x) => x && x.lang && x.url) : [];
  if (subs.length) out.subtitles = subs;
  if (Number.isFinite(s.durationMs) && s.durationMs > 0) out.durationMs = Math.round(s.durationMs);
  return out;
}
async function open(c, req) {
  const ex = extractorFor(c.embedUrl);
  if (!ex) return null;
  try {
    const s = await ex.extract(c.embedUrl, req, kino);
    if (s && s.gone) return GONE;
    return s && typeof s.url === "string" && s.url ? toStream(s, c) : null;
  } catch (e) {
    kino.log("[embed69]", c.server, e && e.code || "extract_failed");
    return null;
  }
}
async function titleOf(ref) {
  if (ref.startsWith("ep:")) {
    const [, imdbId, season, episode] = ref.split(":");
    return { kind: "tv", imdbId, season: Number(season), episode: Number(episode) };
  }
  if (ref.startsWith("m:")) {
    const tmdbId = ref.slice(2);
    const imdbId = await imdbFor(tmdbId, "movie");
    if (!imdbId) throw kino.error("not_found", "no IMDB id for movie tmdb:" + tmdbId, { userMessage: t("noMeta") });
    return { kind: "movie", imdbId };
  }
  throw kino.error("not_found", "unknown ref: " + ref.slice(0, 40));
}
async function resolve(ref) {
  const req = makeReq(kino, { deadline: Date.now() + RESOLVE_MS });
  if (ref.startsWith("cp:")) {
    const want = parseCopyRef(ref);
    if (!want) throw kino.error("not_found", "bad copy ref");
    const copy = (await listCopies(want.title, { kino, req })).find((c) => c.lang === want.lang && c.server === want.server);
    const stream = copy ? await open(copy, req) : null;
    if (stream === GONE) throw kino.error("not_found", "copy gone: " + want.lang + "/" + want.server, { userMessage: t("gone") });
    if (!stream) throw kino.error("not_found", "copy not available: " + want.lang + "/" + want.server, { userMessage: t("noStreams") });
    return stream;
  }
  const title = await titleOf(ref);
  const copies = ordered(await listCopies(title, { kino, req }));
  if (!copies.length) throw kino.error("not_found", "no copies for " + title.imdbId, { userMessage: t("noStreams") });
  let main = null;
  let tried = 0;
  const goneLangs = /* @__PURE__ */ new Set();
  let timedOut = false;
  for (const c of copies) {
    if (goneLangs.has(c.lang)) continue;
    tried++;
    const r = await open(c, req);
    if (r === GONE) {
      goneLangs.add(c.lang);
      continue;
    }
    if (r) {
      main = r;
      break;
    }
    timedOut = true;
  }
  if (!main) {
    const everyOneGone = goneLangs.size > 0 && !timedOut;
    throw kino.error("not_found", (everyOneGone ? "links gone for " : "no copy opened for ") + title.imdbId, { userMessage: t(everyOneGone ? "gone" : "noStreams") });
  }
  const rest = copies.slice(copies.findIndex((c) => labelOf(c) === main.label) + 1).filter((c) => !goneLangs.has(c.lang));
  const alternatives = rest.slice(0, MAX_COPIES).map((c) => ({ label: labelOf(c), ref: copyRef(title, c) }));
  return { ...main, ...alternatives.length ? { alternatives } : {} };
}
async function action(key) {
  if (key === "clearCache") {
    for (const k of kino.storage.keys()) {
      if (k.startsWith("imdb:")) kino.storage.remove(k);
    }
    return { message: t("cacheCleared") };
  }
}
export {
  action,
  browse,
  categories,
  episodes,
  home,
  resolve,
  search
};
