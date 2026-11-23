// @ts-check
// Kino plugin: Embed69 — movies and series in Latino, Castilian or subtitled, through embed69.org. The site lists, per title, the
// players of every language (StreamWish, VidHide, Voe); each is opened with its extractor and played as a stream. The catalog
// (home, search, browse, episodes) comes from TMDB through kino.tmdb, which needs no host.
//
// The same source the Latino plugin carries (src/sources/embed69.js there); this one stands alone, with its own extractors.
//
// Declared hosts: embed69.org and the players'. `streamHosts: "any"` is for the CDNs the players redirect to, and `browser` for
// Voe, whose rotating domain and "confirm you are human" page only a real browser (Kino's hidden page) gets through.

import { listCopies, SITE, hasTitle } from "./embed69.js";
import { makeReq, UA } from "./util/http.js";
import { makeStandardScreen } from "./std/index.js";
import { LOGO, LOGO_ASPECT } from "./logo.js";

/**
 * kino.tmdb in the person's language. Kino fills the language from the call's turn, and a call from the screen's timers has no
 * turn: TMDB then answered in English (the browse screen's hero read "On Halloween night…" on a Spanish Kino, Redmi 2026-11-22).
 */
const tmdb = (path, params = {}) => kino.tmdb(path, { language: String(kino.lang || "").toLowerCase().startsWith("en") ? "en-US" : "es-MX", ...params });

// Kino waits for every request a call left running before it delivers the call's answer; ask it to drop them once the call settles.
globalThis.__kinoDropPendingFetches = true;

// kino.meta and kino.tmdb exist from Kino 0.9.53; the guards are here for the SDK validator.
if (typeof kino.meta !== "function") throw kino.error("unavailable", "kino.meta not available");
if (typeof kino.tmdb !== "function") throw kino.error("unavailable", "kino.tmdb not available");

const TMDB_IMG = "https://image.tmdb.org/t/p/";
const DAY_MS = 24 * 60 * 60 * 1000;
/** One resolve: the page (a proof of work and a request) and a few players, each bounded by its own request time. */
const RESOLVE_MS = 40000;
const MAX_COPIES = 8;
const MAX_CAPTURES = 1;
const CAPTURE_MS = 20000;
const HLS = "application/vnd.apple.mpegurl";

// ---- i18n ----

const STRINGS = {
  es: {
    unavailable: "El servicio no está disponible en este momento.",
    noStreams: "No se encontraron fuentes para este título.",
    gone: "Los enlaces de este título caducaron o se borraron.",
    noMeta: "No se encontró información de este título.",
    trendingMovies: "Películas populares",
    trendingSeries: "Series populares",
    nowPlaying: "En cines ahora",
    upcoming: "Próximos estrenos",
    topMovies: "Películas mejor valoradas",
    onTheAir: "Series en emisión",
    topSeries: "Series mejor valoradas",
    kids: "Para los niños",
    docs: "Documentales",
    anime: "Anime",
    gAction: "Acción",
    gComedy: "Comedia",
    gSciFi: "Ciencia ficción",
    gHorror: "Terror",
    gDrama: "Drama",
    cacheCleared: "Caché de IDs vaciada.",
    lat: "Latino",
    esp: "Castellano",
    sub: "Subtitulado",
    needResolver: "Para reproducir, abre Embed69 desde el menú e instala el motor de reproducción que te pedirá.",
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
    needResolver: "To play, open Embed69 from the menu and install the playback engine it asks for.",
  },
};

function t(key) {
  const lang = String(kino.lang || "es").startsWith("en") ? "en" : "es";
  return (STRINGS[lang] || STRINGS.es)[key] || key;
}

// ---- TMDB catalog helpers ----

// TMDB's genre ids as names Kino knows (movie and TV ids). The Home files every title by its genres, one row per genre across
// all plugins, so a title that carries none lands in the bare "Películas" / "Series" rows: that is why a Home with only the
// row's own `genre` showed two rows. Kids, news and talk are types for Kino, not genres: the "kids" row covers them.
const TMDB_GENRES = {
  28: "Acción", 12: "Aventura", 16: "Animación", 35: "Comedia", 80: "Crimen", 99: "Documentales", 18: "Drama", 10751: "Familia",
  14: "Fantasía", 36: "Historia", 27: "Terror", 9648: "Misterio", 10749: "Romance", 878: "Ciencia ficción", 53: "Suspenso",
  10752: "Bélica", 37: "Western", 10759: "Acción", 10765: "Ciencia ficción", 10766: "Drama", 10764: "Reality", 10768: "Bélica",
};

/** The Kino genre names of a TMDB result (`genre_ids`), without repeats, at most 5. */
function genresOf(raw) {
  const names = new Set();
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
    year: (raw.release_date || raw.first_air_date || "").slice(0, 4) || undefined,
    poster: raw.poster_path ? TMDB_IMG + "w500" + raw.poster_path : undefined,
    backdrop: raw.backdrop_path ? TMDB_IMG + "w1280" + raw.backdrop_path : undefined,
    overview: raw.overview || undefined,
    rating: raw.vote_average > 0 ? Math.round(raw.vote_average * 10) / 10 : undefined,
    ids: { tmdb: tmdbId },
    genres: genresOf(raw).length ? genresOf(raw) : undefined,
  };
}

// A TMDB id → an IMDB id, cached 30 days
async function imdbFor(tmdbId, type) {
  const key = "imdb:" + type + ":" + tmdbId;
  const hit = kino.storage.get(key);
  if (hit) return hit;
  const meta = await kino.meta({ type, ids: { tmdb: Number(tmdbId) } });
  const imdb = meta?.ids?.imdb ?? null;
  if (imdb) kino.storage.set(key, imdb, { ttlMs: 30 * DAY_MS });
  return imdb;
}

const titlesOf = (query) => [query.q, query.originalTitle, ...(query.altTitles || [])].filter(Boolean);

// ---- home ----

/**
 * The Home rows, in order. `genre` is one of Kino's ten ids (it lines the rows up with other plugins' in the Categorías tab) and
 * `ref` makes the row browsable ("Ver más"). `path` is the TMDB list behind it; `params` narrow it (a genre of /discover).
 */
const HOME_ROWS = [
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
  { id: "anime", title: "anime", genre: "anime", ref: "anime:tv", kind: "tv", path: "/discover/tv", params: { with_genres: 16, with_origin_country: "JP" } },
];

// A discover list sorted by popularity is full of titles nobody has voted on: ask for some votes.
const DISCOVER = { sort_by: "popularity.desc", "vote_count.gte": 200 };

async function homeRow(row) {
  const res = await tmdb(row.path, { ...(row.path.startsWith("/discover") ? DISCOVER : {}), ...(row.params || {}) });
  // a row of posters: what has none looks broken
  const items = (res?.results || []).filter((r) => r.poster_path).slice(0, 20).map((r) => itemFromTmdb(r, row.kind));
  return items.length ? { id: row.id, title: t(row.title), genre: row.genre, ref: row.ref, items } : null;
}

/** Kino cuts a Home at 20 s: the rows still loading by then are left off and the ones that loaded are shown. */
const HOME_BUDGET_MS = 14000;

/** The rows of the browse screen's Películas and Series tabs: the Home rows of that kind (anime goes with Series). */
const TAB_ROWS = {
  peliculas: HOME_ROWS.filter((r) => r.kind === "movie"),
  series: HOME_ROWS.filter((r) => r.kind === "tv"),
};

export async function home() {
  return rowsWithin(HOME_ROWS);
}

/** [defs] loaded each on its own: one that fails or comes back empty is left out, the rest are still shown (by HOME_BUDGET_MS). */
async function rowsWithin(defs) {
  const out = defs.map(() => null);
  let done = false;
  const all = Promise.all(defs.map((row, i) => homeRow(row).then((r) => { out[i] = r; }, () => {}))).then(() => { done = true; });
  const end = Date.now() + HOME_BUDGET_MS;
  while (!done && Date.now() < end) await Promise.race([all, kino.sleep(Math.min(250, Math.max(1, end - Date.now())))]);
  const rows = out.filter(Boolean);
  if (!rows.length) throw kino.error("unavailable", "no home row could be loaded", { userMessage: t("unavailable") });
  return rows;
}

// ---- search ----

// embed69.org has no catalog of its own, so a TMDB search is filtered to only the titles it actually has (the top
// SEARCH_CHECK_CAP by relevance are checked against embed69, to stay inside kino.meta's rate budget).
const SEARCH_CHECK_CAP = 18;

/** Keep only the titles embed69.org actually has, in the ranked order. */
async function availableOnly(items, req) {
  const checks = await Promise.all(items.slice(0, SEARCH_CHECK_CAP).map(async (item) => {
    const m = /^[ms]:(\d+)$/.exec(item.ref || "");
    if (!m) return null;
    try {
      const imdb = await imdbFor(m[1], item.kind === "series" ? "series" : "movie");
      return imdb && (await hasTitle(kino, req, imdb, item.kind)) ? item : null;
    } catch (_) { return null; }
  }));
  return checks.filter(Boolean);
}

export async function search(query) {
  if (!String(query.q || "").trim()) return [];
  const req = makeReq(kino, { deadline: Date.now() + 30000 });
  const type = query.type;
  let ranked;
  if (type === "series") {
    const res = await tmdb("/search/tv", { query: query.q });
    ranked = kino.rank.filterRelevant((res?.results || []).map((r) => itemFromTmdb(r, "tv")), titlesOf(query));
  } else if (type === "movie") {
    const res = await tmdb("/search/movie", { query: query.q });
    ranked = kino.rank.filterRelevant((res?.results || []).map((r) => itemFromTmdb(r, "movie")), titlesOf(query));
  } else {
    const [movies, tv] = await Promise.all([
      tmdb("/search/movie", { query: query.q }),
      tmdb("/search/tv", { query: query.q }),
    ]);
    const all = [
      ...(movies?.results || []).map((r) => itemFromTmdb(r, "movie")),
      ...(tv?.results || []).map((r) => itemFromTmdb(r, "tv")),
    ];
    ranked = kino.rank.sortBySimilarity(all, titlesOf(query));
  }
  return availableOnly(ranked, req);
}

// ---- browse ----

export async function browse(ref, cursor) {
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
    // Japanese animation: TMDB has no anime flag, but animation from Japan is what the Home row means
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

  const res = await tmdb(path, params);
  const items = (res?.results || []).filter((r) => r.poster_path).map((r) => itemFromTmdb(r, kind));
  const next = res?.page < res?.total_pages ? String(page + 1) : undefined;
  return { items, next };
}

// ---- categories ----

export async function categories() {
  const [mg, tg] = await Promise.all([tmdb("/genre/movie/list"), tmdb("/genre/tv/list")]);
  const cats = [];
  for (const g of (mg?.genres || []).slice(0, 12)) cats.push({ id: "gm" + g.id, title: g.name, ref: "genre:movie:" + g.id });
  for (const g of (tg?.genres || []).slice(0, 8)) cats.push({ id: "gt" + g.id, title: g.name + " (series)", ref: "genre:tv:" + g.id });
  return cats.slice(0, 24);
}

// ---- episodes ----

export async function episodes(ref) {
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
      runtimeMinutes: meta.runtimeMinutes,
    },
    episodes: (meta.episodes || []).map((ep) => ({
      season: ep.season,
      number: ep.number,
      // the IMDB id rides in the ref so resolve() does not need kino.meta again
      ref: "ep:" + imdbId + ":" + ep.season + ":" + ep.number,
      title: ep.title,
      still: ep.still,
      overview: ep.overview,
      airDate: ep.airDate,
    })),
  };
}

// ---- resolve ----

const SERVER_LABEL = { streamwish: "StreamWish", vidhide: "VidHide", voe: "Voe" };
/**
 * Fastest first, measured live on 2026-11-22 (4 titles, 33 copies, through kino-resolver 0.0.20): VidHide opened 11/11 in ~1.3 s,
 * StreamWish 11/11 in ~3.1 s, VOE 0/11 inline (it asks the visitor to prove they are human, so it only plays through the
 * hidden browser, ~20 s). VidHide used to be last because its old domain (vidhidefast) timed out; the resolver now reaches it
 * through a live mirror. This is the starting order: the learned score below moves the servers that open for this person up.
 */
const SERVER_ORDER = ["vidhide", "streamwish", "voe"];

// ---- learned server reliability (kept in storage; inside a language, the server that opens for this person is tried first) ----
const STATS_KEY = "srvStats";
const STATS_CAP = 24; // halve the counts past this, so a server that recovers climbs back
function readStats() { try { const o = JSON.parse(kino.storage.get(STATS_KEY) || "{}"); return o && typeof o === "object" ? o : {}; } catch (_) { return {}; } }
/** Laplace-smoothed success rate of a server (unknown = 0.5). */
function scoreOf(id, stats) { const s = stats[id] || { ok: 0, fail: 0 }; return (s.ok + 1) / (s.ok + s.fail + 2); }
/** Record that a server opened (ok=true) or not; never throws. */
function noteServer(id, ok) {
  try {
    const stats = readStats();
    const s = stats[id] || { ok: 0, fail: 0 };
    s[ok ? "ok" : "fail"] += 1;
    if (s.ok + s.fail > STATS_CAP) { s.ok = Math.round(s.ok / 2); s.fail = Math.round(s.fail / 2); }
    stats[id] = s;
    kino.storage.set(STATS_KEY, JSON.stringify(stats));
  } catch (_) { /* the stats are a nicety */ }
}

// A capture costs up to 20 s whether or not it finds the video: spend the budget on the attempt, and only start one if a whole
// page still fits before this resolve's deadline.
const CAPTURE_PAGE_MS = CAPTURE_MS + 3000;
function takeCapture(budget) {
  if (!budget || budget.captures <= 0 || (budget.deadline && budget.deadline - Date.now() < CAPTURE_PAGE_MS)) return false;
  budget.captures -= 1;
  return true;
}

/** The languages in the order the person prefers them (the "language" setting), the other two after it. */
function languageOrder() {
  const pref = String(kino.config.get("language") || "lat");
  return pref === "esp" ? ["esp", "lat", "sub"] : pref === "sub" ? ["sub", "lat", "esp"] : ["lat", "esp", "sub"];
}

/** The copies: preferred language first; inside a language, the server that has opened for this person (learned), then the
 *  measured speed order. The lazy refs name lang + server, so reordering never breaks a saved copy ref. */
function ordered(copies) {
  const langs = languageOrder();
  const stats = readStats();
  const order = (s) => { const i = SERVER_ORDER.indexOf(s); return i < 0 ? SERVER_ORDER.length : i; };
  const rank = (c) => Math.max(0, langs.indexOf(c.lang)) * 100 + (1 - scoreOf(c.server, stats)) * 20 + order(c.server);
  return [...copies].sort((a, b) => rank(a) - rank(b));
}

const labelOf = (c) => `${t(c.lang)} · ${SERVER_LABEL[c.server] || c.server}`;

/** A lazy copy's ref: "cp:movie:<imdb>:<lang>:<server>" or "cp:ep:<imdb>:<season>:<episode>:<lang>:<server>". */
function copyRef(title, c) {
  return title.kind === "tv"
    ? `cp:ep:${title.imdbId}:${title.season}:${title.episode}:${c.lang}:${c.server}`
    : `cp:movie:${title.imdbId}:${c.lang}:${c.server}`;
}

/** The title and the wanted copy out of a lazy ref, or null. */
function parseCopyRef(ref) {
  const p = ref.split(":");
  if (p[1] === "movie" && p.length === 5) return { title: { kind: "movie", imdbId: p[2] }, lang: p[3], server: p[4] };
  if (p[1] === "ep" && p.length === 7) return { title: { kind: "tv", imdbId: p[2], season: Number(p[3]), episode: Number(p[4]) }, lang: p[5], server: p[6] };
  return null;
}

/** A Stream from an extractor's answer; the player sends okhttp's User-Agent unless told otherwise and the CDNs answer 403 to it. */
function toStream(s, c) {
  const out = { url: s.url, label: labelOf(c), headers: { "User-Agent": UA, ...(s.headers && typeof s.headers === "object" ? s.headers : {}) } };
  if (s.mime) out.mime = s.mime;
  const subs = Array.isArray(s.subtitles) ? s.subtitles.filter((x) => x && x.lang && x.url) : [];
  if (subs.length) out.subtitles = subs;
  if (Number.isFinite(s.durationMs) && s.durationMs > 0) out.durationMs = Math.round(s.durationMs);
  return out;
}

/** One copy opened through the shared kino-resolver (its provider door), with the hidden browser as the fallback; null when none. */
async function open(c, req, budget) {
  try {
    const res = await kino.plugins.call("resolver", "resolve", { url: c.embedUrl, referer: SITE + "/" });
    const s = (res && Array.isArray(res.streams) ? res.streams : []).find((x) => x && x.url);
    if (s) {
      const headers = {};
      if (s.referer) headers.Referer = s.referer;
      if (Array.isArray(s.headers)) for (const h of s.headers) if (h && h.name) headers[h.name] = String(h.value);
      return toStream({ url: s.url, headers, mime: s.kind === "hls" ? HLS : (/\.mp4(\?|$)/i.test(s.url) ? "video/mp4" : HLS), subtitles: res.subtitles, durationMs: s.durationMs }, c);
    }
    // The resolver read the hoster's page and the file is gone: a hidden browser would only find the same "deleted" page.
    if (res && res.error === "dead") return null;
  } catch (_) { /* provider_missing / failed: the hidden browser may still reach it */ }
  if (!kino.browser || typeof kino.browser.capture !== "function" || !takeCapture(budget)) return null;
  try {
    const page = await kino.browser.capture(c.embedUrl, { timeoutMs: CAPTURE_MS, match: "\\.m3u8|\\.mp4", headers: { Referer: SITE + "/" } });
    const media = (page && page.media) || [];
    const best = media.find((x) => /m3u8/i.test(x.url)) || media[0];
    if (!best) return null;
    return toStream({ url: best.url, headers: best.headers || { Referer: c.embedUrl }, mime: best.mime || (/\.mp4/i.test(best.url) ? "video/mp4" : HLS) }, c);
  } catch (e) {
    kino.log("[embed69] capture", (e && e.code) || "failed");
    return null;
  }
}

/** The title a ref names: "m:<tmdb>" or "ep:<imdb>:<season>:<episode>". */
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

// ---- the screen: the standard xuper-plugin screen (src/std) ----

/** True when the shared kino-resolver is installed (a cheap door probe; only provider_missing means "not installed"). */
async function resolverInstalled() {
  try { await kino.plugins.call("resolver", "normalizeHost", { url: "https://probe.invalid/" }); return true; }
  catch (e) { return (e && e.code) !== "provider_missing"; }
}

// Embed69 delegates every hoster to kino-resolver (the hidden-browser capture is only a fallback), so it does not play without it: the screen is the install gate while it is missing, and resolve() refuses.
let std = null;
const standard = () => (std ??= makeStandardScreen({ snapshot: "xuper-plugin/kino-plugin-embed69",
  kino, name: "Embed69", logo: LOGO, logoAspect: LOGO_ASPECT, needsResolver: true, hasSettings: true,
  tabs: [
    { id: "inicio", label: "Inicio", labelEn: "Home" },
    { id: "peliculas", label: "Películas", labelEn: "Movies" },
    { id: "series", label: "Series", labelEn: "Series" },
  ],
  loadTab: async (tab) => ({ rows: TAB_ROWS[tab] ? await rowsWithin(TAB_ROWS[tab]) : await home() }),
}));

export async function screen(ctx) {
  await null;
  return standard().screen(ctx && typeof ctx === "object" ? ctx : {});
}

export async function screenEvent(ev) {
  await null;
  return standard().screenEvent(ev && typeof ev === "object" ? ev : {});
}

export async function resolve(ref) {
  if (!(await resolverInstalled())) throw kino.error("unavailable", "resolver missing", { userMessage: t("needResolver") });
  const req = makeReq(kino, { deadline: Date.now() + RESOLVE_MS });

  // One copy picked from the Servidor menu (or reached by the automatic fallback): just that one
  if (ref.startsWith("cp:")) {
    const want = parseCopyRef(ref);
    if (!want) throw kino.error("not_found", "bad copy ref");
    const copy = (await listCopies(want.title, { kino, req })).find((c) => c.lang === want.lang && c.server === want.server);
    const stream = copy ? await open(copy, req, { captures: MAX_CAPTURES, deadline: Date.now() + RESOLVE_MS }) : null;
    if (copy) noteServer(copy.server, !!stream);
    if (!stream) throw kino.error("not_found", "copy not available: " + want.lang + "/" + want.server, { userMessage: t("noStreams") });
    return stream;
  }

  const title = await titleOf(ref);
  const copies = ordered(await listCopies(title, { kino, req }));
  if (!copies.length) throw kino.error("not_found", "no copies for " + title.imdbId, { userMessage: t("noStreams") });

  // The first copy that opens plays; the rest are lazy copies, opened only if the person (or the fallback) reaches them. One
  // capture is shared across the attempt, so a title whose hosts are all gated still tries one in the hidden browser.
  const budget = { captures: MAX_CAPTURES, deadline: Date.now() + RESOLVE_MS };
  let main = null;
  for (const c of copies) {
    const r = await open(c, req, budget);
    noteServer(c.server, !!r); // learn which server opens, for next time
    if (r) { main = r; break; }
  }
  if (!main) throw kino.error("not_found", "no copy opened for " + title.imdbId, { userMessage: t("noStreams") });
  const rest = copies.slice(copies.findIndex((c) => labelOf(c) === main.label) + 1);
  const alternatives = rest.slice(0, MAX_COPIES).map((c) => ({ label: labelOf(c), ref: copyRef(title, c) }));
  return { ...main, ...(alternatives.length ? { alternatives } : {}) };
}

// ---- settings actions ----

export async function action(key) {
  if (key === "clearCache") {
    for (const k of kino.storage.keys()) {
      if (k.startsWith("imdb:")) kino.storage.remove(k);
    }
    return { message: t("cacheCleared") };
  }
}

// std 1.7.0: the catalog door -- the author's other plugins (Da-Video) find titles here through Kino, and Kino opens and
// plays what they find in this plugin, with its own resolve.
import { catalogDoor } from "./std/catalog.js";
export const proto_catalog_search = catalogDoor(search);
