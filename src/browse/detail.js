// The title page of the browse screen (route "detail"): a banner with the title's logo, the facts, the synopsis, the cast, the seasons
// with their episodes and similar titles. A card, a slide or a result opens it through the item's `open` (the screen starts again
// with `args.open` and `open` answers `route.push`, so Back returns to the list). Kino's own page stays one press away ("Ver
// episodios" for a series, "Más opciones" for a movie): favourites, lists, downloads and the player's sources live there, and an
// episode opens it too, because a plugin screen cannot play a single episode by itself. Pure view of what index.js keeps.
import { both } from "../i18n.js";

const HTTPS = /^https:\/\//;
const MAX_EPISODES = 80;
const MAX_CAST = 12;
const LEAD_MAX = 140;
const TMDB_IMG = "https://image.tmdb.org/t/p/w342";

/** `key` in both languages as a node's twin texts: `{ [field]: Spanish, [field + "En"]: English }`. */
const twin = (key, field = "text", vars) => {
  const w = both(key, vars);
  return { [field]: w.es, [field + "En"]: w.en };
};
const same = (text) => ({ text, textEn: text });
const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
const https = (v) => (typeof v === "string" && HTTPS.test(v) && v.length <= 2048 ? v : undefined);

/** `{ kind, id }` of a title ref ("m:603", "s:1399"), or null for any other ref. */
export function titleRefOf(ref) {
  const m = /^([ms]):(\d{1,10})$/.exec(String(ref || ""));
  return m ? { kind: m[1] === "m" ? "movie" : "series", id: Number(m[2]) } : null;
}

/** A card with the `open` that starts the screen again on its page; a card without a TMDB title ref keeps Kino's own page. */
const opensPage = (card) => !!card && (card.kind === "movie" || card.kind === "series") && typeof card.ref === "string" && card.ref.length < 600 && typeof card.id === "string";

/** One poster card; a movie or a series opens its page through the screen's own `openTitle` event (the card's tap), anything else keeps Kino's page. */
export const cardNode = (card, size, scope) => ({
  type: "titleCard", key: `${scope}-${card.id}`, size, item: card,
  ...(opensPage(card) ? { onTap: { event: "openTitle", arg: JSON.stringify(openArgs(card)) } } : {}),
});

/** A horizontal row of poster cards under [key]. */
export const cardRow = (items, key, size) => ({ type: "SingleChildScrollView", key: key + "-s", direction: "horizontal", children: [{ type: "Row", key: key + "-r", gap: 12, children: items.map((c) => cardNode(c, size, key)) }] });

/** A grid of poster cards. */
export const cardGrid = (items, key) => ({ type: "GridView", key, columns: { compact: 3, expanded: 6 }, children: items.map((c) => cardNode(c, "medium", key)) });

/** The args an `openTitle` event carries back into a route push: only the fields `openArgs` writes. */
export function pushOf(arg) {
  let a = null;
  try { a = JSON.parse(String(arg)); } catch (_) { a = null; }
  if (!a || typeof a.open !== "string" || typeof a.i !== "string" || (a.k !== "movie" && a.k !== "series")) return null;
  return { push: "detail", params: { open: a.open, i: a.i, t: typeof a.t === "string" ? a.t.slice(0, 100) : "", k: a.k, d: Number(a.d) || 0, y: Number(a.y) || 0 } };
}


/** TMDB's backdrops of a title (wide pictures), best voted first: the banner becomes a slider when there is more than one. [first] is the one Kino already gave. */
function backdropsOf(images, first) {
  const base = "https://image.tmdb.org/t/p/w780";
  const list = ((images && images.backdrops) || []).filter((b) => b && typeof b.file_path === "string" && b.file_path.startsWith("/") && b.width >= 1000)
    .sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0)).map((b) => base + b.file_path);
  const out = [];
  for (const u of [first, ...list]) if (u && !out.some((x) => x.slice(x.lastIndexOf("/")) === u.slice(u.lastIndexOf("/")))) out.push(u);
  return out.slice(0, 6);
}

/** What the page needs of a card: its ref and id (Kino's page and the play go carry them back), its name, kind and year, and its TMDB id when it has one. */
export function openArgs(card) {
  const r = titleRefOf(card.ref);
  const tmdb = r ? r.id : card.ids && Number.isInteger(card.ids.tmdb) ? card.ids.tmdb : 0;
  const year = card.year ? num(card.year) : 0;
  return { open: card.ref, i: card.id, t: String(card.title || "").slice(0, 100), k: card.kind, ...(tmdb ? { d: tmdb } : {}), ...(year ? { y: year } : {}) };
}

const hoursOf = (min) => {
  const m = num(min);
  return m > 0 ? (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`) : "";
};

const MONTHS = {
  es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};
const dateText = (iso) => {
  const [y, m, d] = String(iso).split("-").map(Number);
  return m >= 1 && m <= 12 ? { es: `${d} ${MONTHS.es[m - 1]} ${y}`, en: `${MONTHS.en[m - 1]} ${d}, ${y}` } : { es: iso, en: iso };
};

/**
 * What the page shows for [args] (`{ t: title, k: kind, d?: TMDB id, y?: year }`): Kino's own answer for the title's TMDB id when the
 * card has one, else for its name and year, plus TMDB's similar titles. Throws when Kino knows nothing about it.
 */
export async function loadDetail(args) {
  const kind = args.k === "movie" ? "movie" : "series";
  const tmdbId = Number(args.d) || 0;
  const year = Number(args.y) || 0;
  let meta = null;
  if (typeof kino.meta === "function") {
    if (tmdbId) meta = await kino.meta({ type: kind, ids: { tmdb: tmdbId } }).catch(() => null);
    if (!meta && kino.meta.byTitle === true && args.t) meta = await kino.meta({ type: kind, title: String(args.t), ...(year >= 1870 && year <= 2100 ? { year } : {}) }).catch(() => null);
  }
  if (!meta) throw Object.assign(new Error("no meta"), { code: "not_found" });
  const ids = meta.ids || (tmdbId ? { tmdb: tmdbId } : {});
  const d = {
    kind,
    title: String(meta.title || args.t || "").slice(0, 200),
    overview: String(meta.overview || ""),
    year: num(meta.year),
    backdrop: https(meta.backdrop) || https(meta.poster),
    logo: https(meta.logo),
    genres: (meta.genres || []).filter((g) => typeof g === "string").slice(0, 4),
    runtime: num(meta.runtimeMinutes),
    tagline: String(meta.tagline || ""),
    certification: String(meta.certification || ""),
    directors: (meta.directors || []).slice(0, 3),
    ratings: (meta.ratings || []).slice(0, 3),
    cast: (meta.cast || []).slice(0, MAX_CAST),
    ids,
    episodes: [],
    similar: [],
  };
  if (kind === "series") {
    d.episodes = (Array.isArray(meta.episodes) ? meta.episodes : [])
      .filter((e) => num(e.season) >= 1 && num(e.number) >= 1)
      .slice(0, 600)
      .map((e) => ({ s: num(e.season), n: num(e.number), title: String(e.title || "").slice(0, 120), overview: String(e.overview || "").slice(0, 110), still: https(e.still), air: /^\d{4}-\d{2}-\d{2}/.test(String(e.airDate || "")) ? String(e.airDate).slice(0, 10) : "" }));
  }
  if (ids.tmdb && typeof kino.tmdb === "function") {
    // Kino's answer carries the cast as names only when TMDB has one: the photos come from TMDB's credits.
    try {
      const credits = await kino.tmdb(`/${kind === "movie" ? "movie" : "tv"}/${ids.tmdb}/credits`, { language: "es-MX" });
      const cast = ((credits && credits.cast) || []).filter((c) => c && c.name).slice(0, MAX_CAST).map((c) => ({ name: String(c.name), character: String(c.character || ""), photo: typeof c.profile_path === "string" && c.profile_path.startsWith("/") ? "https://image.tmdb.org/t/p/w185" + c.profile_path : undefined }));
      if (cast.length) d.cast = cast;
    } catch (_) { /* the names stay */ }
    try {
      d.images = backdropsOf(await kino.tmdb(`/${kind === "movie" ? "movie" : "tv"}/${ids.tmdb}/images`, { include_image_language: "null,es,en" }), d.backdrop);
    } catch (_) { /* the one picture stays */ }
    try {
      const data = await kino.tmdb(`/${kind === "movie" ? "movie" : "tv"}/${ids.tmdb}/recommendations`, { language: "es-MX" });
      d.similar = ((data && data.results) || []).filter((x) => x && x.id && (x.title || x.name) && x.poster_path).slice(0, 12).map((x) => ({
        id: (kind === "movie" ? "m-" : "s-") + x.id, ref: (kind === "movie" ? "m:" : "s:") + x.id, kind, title: String(x.title || x.name).slice(0, 200),
        poster: TMDB_IMG + x.poster_path, ids: { tmdb: x.id },
      }));
    } catch (_) { /* no similar row */ }
  }
  return d;
}

const heroSkeleton = () => ({ type: "Skeleton", key: "heroSkeleton", shape: "block", height: { compact: 200, expanded: 320 } });
const railSkeleton = () => ({
  type: "Column", key: "dskel1", gap: 8, children: [
    { type: "Skeleton", shape: "line", width: 120 },
    { type: "Row", gap: 12, children: [1, 2, 3].map((i) => ({ type: "Skeleton", shape: "card", key: `dsk${i}`, flex: 1 })) },
  ],
});

const sectionTitle = (key) => ({ type: "Text", ...twin(key), style: "h4" });

/** The tap on an episode: Kino's page of the series (this plugin's own, with its sources). */
const episodeGo = (d, r) => ({ go: { title: { ref: r.ref, kind: "series", id: r.id, title: d.title } } });

function episodeRow(d, r, ep) {
  const facts = ep.air ? dateText(ep.air) : null;
  const heading = ep.title ? { text: `${ep.n}. ${ep.title}`, textEn: `${ep.n}. ${ep.title}` } : twin("dEpisodeN", "text", { n: ep.n });
  return {
    type: "Row", key: `ep-${ep.s}-${ep.n}`, gap: 12, crossAxisAlignment: "center", onTap: episodeGo(d, r), canRequestFocus: true,
    children: [
      { type: "Image", key: `epi-${ep.s}-${ep.n}`, width: 120, aspect: "16:9", fit: "cover", radius: "medium", ...(ep.still ? { url: ep.still } : {}), fallback: { type: "Skeleton", shape: "block", height: 64 } },
      { type: "Column", flex: 1, gap: 4, children: [
        { type: "Text", bold: true, maxLines: 2, ...heading },
        ...(facts ? [{ type: "Text", style: "caption", color: "muted", text: facts.es, textEn: facts.en }] : []),
        ...(ep.overview ? [{ type: "Text", style: "caption", color: "muted", maxLines: 2, ...same(ep.overview) }] : []),
      ] },
    ],
  };
}

function castItem(c) {
  const name = String(c.name || "").slice(0, 60);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return {
    type: "Column", key: "cast-" + name.replace(/[^A-Za-z0-9]/g, "").slice(0, 24) + "-" + String(c.character || "").length, width: 96, gap: 4, crossAxisAlignment: "center", canRequestFocus: true, children: [
      { type: "CircleAvatar", radius: 32, ...(https(c.photo) ? { image: https(c.photo) } : {}), text: initials, textEn: initials },
      { type: "Text", ...same(name), style: "caption", maxLines: 2 },
      ...(c.character ? [{ type: "Text", ...same(String(c.character).slice(0, 40)), style: "caption", color: "muted", maxLines: 1 }] : []),
    ],
  };
}

/**
 * The tree of the title route. `r`: `{ ref, id }` of the page's title; `entry`: `{ d }` loaded (d null: it failed) or null while it
 * loads; `season`: the chosen season (0 = the first); `back`/`logo`: the screen's own back button and logo nodes.
 */
export function detailView({ r, entry, season, logo, back }) {
  const d = entry && entry.d;
  const appBar = { type: "AppBar", mergeWithKinoBar: true, dense: true, divider: false, leading: back, title: logo };
  const body = [];
  let hero = null; // the banner goes edge to edge: outside the padded column
  if (!entry) {
    hero = heroSkeleton();
    body.push(railSkeleton());
  } else if (!d) {
    body.push({ type: "MaterialBanner", key: "detailFailed", role: "error", ...twin("brFailed"), action: { ...twin("brRetry", "label"), onTap: "dretry" } });
    body.push({ type: "ElevatedButton", key: "dkino", icon: "play", ...twin("dSeeInKino", "labelText"), onPressed: { go: { title: { ref: r.ref, kind: r.kind, id: r.id, title: r.title } } } });
  } else {
    const series = d.kind === "series";
    const seasons = [...new Set(d.episodes.map((e) => e.s))].sort((a, b) => a - b);
    const shown = seasons.includes(season) ? season : seasons[0];
    const toKino = { go: { title: { ref: r.ref, kind: d.kind, id: r.id, title: r.title || d.title } } };
    const buttons = series
      ? [{ type: "ElevatedButton", key: "dplay", ...twin("dSeriesGo", "labelText"), icon: "play", autofocus: true, onPressed: toKino }]
      : [
        { type: "ElevatedButton", key: "dplay", ...twin("brWatch", "labelText"), icon: "play", autofocus: true, onPressed: { go: { play: { ref: r.ref, kind: "movie", id: r.id, title: d.title } } } },
        { type: "TextButton", key: "dmore", ...twin("dMore", "labelText"), onPressed: toKino },
      ];
    const lead = d.tagline || (d.overview.length <= LEAD_MAX ? d.overview : d.overview.slice(0, LEAD_MAX - 1).trimEnd() + "…");
    const images = (d.images && d.images.length ? d.images : [d.backdrop || ""]).slice(0, 6);
    const slide = (image, i) => ({
      type: "heroCard", key: i ? "dhero-" + i : "dhero", h: { compact: 240, expanded: 320 }, title: d.title, titleEn: d.title, ...(lead ? same(lead) : {}),
      ...(image ? { image } : {}), ...(d.logo ? { logo: d.logo } : {}), buttons: i ? buttons.map((b) => ({ ...b, key: b.key + "-" + i, autofocus: false })) : buttons,
    });
    // The key carries the number of slides: Kino's pager keeps the count of its first drawing.
    hero = images.length > 1 ? { type: "PageView", key: "hero" + images.length, autoPlayMs: 6000, children: images.map(slide) } : slide(images[0], 0);
    const rating = d.ratings.find((x) => x.source === "imdb") || d.ratings.find((x) => x.source === "tmdb");
    const facts = [];
    if (rating) facts.push("★ " + rating.value);
    if (d.year) facts.push(String(d.year));
    if (d.certification) facts.push(d.certification);
    if (d.runtime) facts.push(hoursOf(d.runtime));
    const es = facts.concat(series && seasons.length ? [both("dSeasonsN", { n: seasons.length }).es] : []);
    const en = facts.concat(series && seasons.length ? [both("dSeasonsN", { n: seasons.length }).en] : []);
    if (es.length) body.push({ type: "Text", key: "dfacts", style: "h4", text: es.join("  ·  "), textEn: en.join("  ·  ") });
    if (d.genres.length) body.push({ type: "Row", key: "dgenres", gap: 8, children: d.genres.map((g, i) => ({ type: "Badge", key: "dg-" + i, ...same(g) })) });
    if (d.overview) body.push({ type: "Text", key: "dsynopsis", canRequestFocus: true, ...same(d.overview) });
    if (d.directors.length) body.push({ type: "Text", ...twin(series ? "dCreators" : "dDirector", "text", { v: d.directors.join(", ") }), color: "muted" });
    if (d.cast.length) {
      body.push(sectionTitle("dCast"));
      body.push({ type: "SingleChildScrollView", key: "dcast", direction: "horizontal", children: [{ type: "Row", gap: 12, children: d.cast.map(castItem) }] });
    }
    if (series && seasons.length) {
      body.push(seasons.length > 1
        ? { type: "DropdownButton", key: "dseason", value: String(shown), onChanged: "season", options: seasons.map((s) => { const w = both("dSeasonN", { n: s }); return { value: String(s), label: w.es, labelEn: w.en }; }) }
        : sectionTitle("dEpisodes"));
      for (const ep of d.episodes.filter((e) => e.s === shown).slice(0, MAX_EPISODES)) body.push(episodeRow(d, r, ep));
    }
    if (d.similar.length) {
      body.push(sectionTitle("dSimilar"));
      body.push(cardRow(d.similar, "dsimilar", "small"));
    }
  }
  return {
    type: "Scaffold", appBar,
    body: { type: "SingleChildScrollView", key: "detail-page", children: [...(hero ? [hero] : []), { type: "Column", padding: { compact: 12, expanded: 24 }, gap: 16, children: body }] },
    ...(!entry ? { every: { ms: 1000, event: "dtick" } } : {}),
  };
}
