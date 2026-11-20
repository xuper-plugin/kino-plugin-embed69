// src/anubis.js
var API = "/.within.website/x/cmd/anubis/api/pass-challenge";
function anubisChallenge(html) {
  const m = /<script id="anubis_challenge"[^>]*>([\s\S]*?)<\/script>/.exec(String(html || ""));
  if (!m) return null;
  let j;
  try {
    j = JSON.parse(m[1]);
  } catch (_) {
    return null;
  }
  const c = j && j.challenge, r = j && j.rules;
  if (!c || typeof c.randomData !== "string" || typeof c.id !== "string" || !r) return null;
  const difficulty = Number(r.difficulty);
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 6) return null;
  return { data: c.randomData, id: c.id, difficulty };
}
function solveAnubis(kino2, data, difficulty) {
  const zeros = "0".repeat(difficulty);
  for (let nonce = 0; nonce < 2e7; nonce++) {
    const hash = kino2.crypto.hash("sha256", data + nonce);
    if (hash.startsWith(zeros)) return { hash, nonce };
  }
  return null;
}
async function getThroughAnubis(kino2, req, url, opts) {
  const started = Date.now();
  let r = await req(url, opts);
  if (!r.ok) return null;
  let html = await r.text();
  const ch = anubisChallenge(html);
  if (!ch) return html;
  const sol = solveAnubis(kino2, ch.data, ch.difficulty);
  if (!sol) return html;
  const origin = new URL(url).origin;
  const elapsed = Math.max(1e3, Date.now() - started);
  const pass = `${origin}${API}?id=${encodeURIComponent(ch.id)}&response=${sol.hash}&nonce=${sol.nonce}&redir=${encodeURIComponent(url)}&elapsedTime=${elapsed}`;
  try {
    const rp = await req(pass, opts);
    if (rp && typeof rp.text === "function") await rp.text();
  } catch (_) {
  }
  const r2 = await req(url, opts);
  if (!r2 || !r2.ok) return html;
  return r2.text();
}

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
  const html = await getThroughAnubis(kino2, req, `${SITE}/f/${path}`, { headers: HEADERS });
  if (!html) return [];
  const data = /let\s+dataLink\s*=\s*(\[.+\]);/.exec(html);
  const challenge = quoted(html, "LINK_CHALLENGE"), salt = quoted(html, "LINK_SALT");
  if (!data || !challenge || salt == null) return [];
  let langs;
  try {
    langs = JSON.parse(data[1]);
  } catch (_) {
    return [];
  }
  const keyHex = kino2.crypto.hash("sha256", challenge + salt);
  const out = [];
  for (const l of langs) {
    const lang = normLang(l && l.video_language);
    if (!lang) continue;
    for (const e of l && l.sortedEmbeds || []) {
      if (!e || e.servername === "download" || typeof e.link !== "string") continue;
      let url;
      try {
        url = decryptLink(kino2, keyHex, e.link).replace(/`/g, "").trim();
      } catch (_) {
        continue;
      }
      if (/^https?:\/\//i.test(url) && !out.some((c) => c.embedUrl === url)) out.push({ lang, server: String(e.servername || ""), embedUrl: url });
    }
  }
  return out;
}

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

// src/plugin.js
globalThis.__kinoDropPendingFetches = true;
if (typeof kino.meta !== "function") throw kino.error("unavailable", "kino.meta not available");
if (typeof kino.tmdb !== "function") throw kino.error("unavailable", "kino.tmdb not available");
var TMDB_IMG = "https://image.tmdb.org/t/p/";
var DAY_MS = 24 * 60 * 60 * 1e3;
var RESOLVE_MS = 4e4;
var MAX_COPIES = 8;
var MAX_CAPTURES = 1;
var CAPTURE_MS = 2e4;
var HLS = "application/vnd.apple.mpegurl";
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
    sub: "Subtitulado",
    needResolver: "Para reproducir, abre Embed69 desde el men\xFA e instala el motor de reproducci\xF3n que te pedir\xE1."
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
    sub: "Subtitled",
    needResolver: "To play, open Embed69 from the menu and install the playback engine it asks for."
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
var HOME_BUDGET_MS = 14e3;
async function home() {
  const out = HOME_ROWS.map(() => null);
  let done = false;
  const all = Promise.all(HOME_ROWS.map((row, i) => homeRow(row).then((r) => {
    out[i] = r;
  }, () => {
  }))).then(() => {
    done = true;
  });
  const end = Date.now() + HOME_BUDGET_MS;
  while (!done && Date.now() < end) await Promise.race([all, kino.sleep(Math.min(250, Math.max(1, end - Date.now())))]);
  const rows = out.filter(Boolean);
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
async function open(c, req, budget) {
  try {
    const res = await kino.plugins.call("resolver", "resolve", { url: c.embedUrl, referer: SITE + "/" });
    const s = (res && Array.isArray(res.streams) ? res.streams : []).find((x) => x && x.url);
    if (s) {
      const headers = {};
      if (s.referer) headers.Referer = s.referer;
      if (Array.isArray(s.headers)) {
        for (const h of s.headers) if (h && h.name) headers[h.name] = String(h.value);
      }
      return toStream({ url: s.url, headers, mime: s.kind === "hls" ? HLS : /\.mp4(\?|$)/i.test(s.url) ? "video/mp4" : HLS, subtitles: res.subtitles, durationMs: s.durationMs }, c);
    }
  } catch (_) {
  }
  if (!kino.browser || typeof kino.browser.capture !== "function" || !budget || budget.captures <= 0) return null;
  budget.captures -= 1;
  try {
    const page = await kino.browser.capture(c.embedUrl, { timeoutMs: CAPTURE_MS, match: "\\.m3u8|\\.mp4", headers: { Referer: SITE + "/" } });
    const media = page && page.media || [];
    const best = media.find((x) => /m3u8/i.test(x.url)) || media[0];
    if (!best) return null;
    return toStream({ url: best.url, headers: best.headers || { Referer: c.embedUrl }, mime: best.mime || (/\.mp4/i.test(best.url) ? "video/mp4" : HLS) }, c);
  } catch (e) {
    kino.log("[embed69] capture", e && e.code || "failed");
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
var RESOLVER_REPO = "xuper-plugin/kino-plugin-kino-resolver";
var SUPPORT_URL = "https://ko-fi.com/xuperplugins";
async function resolverInstalled() {
  try {
    await kino.plugins.call("resolver", "normalizeHost", { url: "https://probe.invalid/" });
    return true;
  } catch (e) {
    return (e && e.code) !== "provider_missing";
  }
}
function supportNode(device) {
  if (device === "tv") return { type: "QrImage", value: SUPPORT_URL, size: "large", labelText: "Si te gusta mi trabajo, escan\xE9alo y ap\xF3yame", labelTextEn: "If you like my work, scan it and support me" };
  return { type: "ElevatedButton", key: "donate", icon: "heart", labelText: "Si te gusta mi trabajo, ap\xF3yame", labelTextEn: "If you like my work, support me", onPressed: { go: { url: { href: SUPPORT_URL } } } };
}
function installGateView(device) {
  return {
    type: "Scaffold",
    key: "embed69-install",
    body: { type: "SingleChildScrollView", key: "installScroll", children: [
      { type: "Column", padding: 24, gap: 16, crossAxisAlignment: "stretch", children: [
        { type: "Text", text: "Necesitas el motor de reproducci\xF3n", textEn: "You need the playback engine", style: "h3" },
        { type: "Text", color: "secondary", text: "Embed69 reproduce a trav\xE9s de Kino Resolver (gratis). Inst\xE1lalo una vez y sirve para este y para otros plugins de sitios.", textEn: "Embed69 plays through Kino Resolver (free). Install it once and it works here and in other site plugins." },
        { type: "ElevatedButton", key: "installResolver", labelText: "Instalar Kino Resolver", labelTextEn: "Install Kino Resolver", onPressed: { go: { installPlugin: { repo: RESOLVER_REPO } } } },
        supportNode(device)
      ] }
    ] }
  };
}
function readyView(device) {
  return {
    type: "Scaffold",
    key: "embed69-ready",
    body: { type: "SingleChildScrollView", key: "readyScroll", children: [
      { type: "Column", padding: 24, gap: 16, crossAxisAlignment: "stretch", children: [
        { type: "Text", text: "Todo listo", textEn: "All set", style: "h3" },
        { type: "Text", color: "secondary", text: "Explora Embed69 desde el inicio de Kino o busca un t\xEDtulo.", textEn: "Browse Embed69 from Kino's home, or search for a title." },
        supportNode(device)
      ] }
    ] }
  };
}
async function screen(ctx) {
  await null;
  const c = ctx && typeof ctx === "object" ? ctx : {};
  return c.installed && c.installed[RESOLVER_REPO] ? readyView(c.device) : installGateView(c.device);
}
async function screenEvent() {
  await null;
  return {};
}
async function resolve(ref) {
  if (!await resolverInstalled()) throw kino.error("unavailable", "resolver missing", { userMessage: t("needResolver") });
  const req = makeReq(kino, { deadline: Date.now() + RESOLVE_MS });
  if (ref.startsWith("cp:")) {
    const want = parseCopyRef(ref);
    if (!want) throw kino.error("not_found", "bad copy ref");
    const copy = (await listCopies(want.title, { kino, req })).find((c) => c.lang === want.lang && c.server === want.server);
    const stream = copy ? await open(copy, req, { captures: MAX_CAPTURES }) : null;
    if (!stream) throw kino.error("not_found", "copy not available: " + want.lang + "/" + want.server, { userMessage: t("noStreams") });
    return stream;
  }
  const title = await titleOf(ref);
  const copies = ordered(await listCopies(title, { kino, req }));
  if (!copies.length) throw kino.error("not_found", "no copies for " + title.imdbId, { userMessage: t("noStreams") });
  const budget = { captures: MAX_CAPTURES };
  let main = null;
  for (const c of copies) {
    const r = await open(c, req, budget);
    if (r) {
      main = r;
      break;
    }
  }
  if (!main) throw kino.error("not_found", "no copy opened for " + title.imdbId, { userMessage: t("noStreams") });
  const rest = copies.slice(copies.findIndex((c) => labelOf(c) === main.label) + 1);
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
  screen,
  screenEvent,
  search
};
