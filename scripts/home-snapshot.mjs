// Home snapshot (std 1.8.1): writes home/<tab>.json for every tab of this plugin's standard screen, from its own live
// loadTab, run in Node with the kit's kino (sdk/kino-shim.mjs). The GitHub Action .github/workflows/home-snapshot.yml runs it
// every 6 hours; the screen reads the files first and scrapes the site only when a file is missing, broken or over 24 h old.
// A rich Home that opens at once: the first tab gets at least MIN_ROWS rows (borrowed from the other tabs when the site's
// home has fewer), and with a TMDB key (KINO_TMDB_KEY, the repository's secret) every tab carries its slider ready made (the
// titles' TMDB backdrops and synopses in a hidden "slides" row) and its cards their TMDB ids, so the device asks TMDB nothing
// before it draws. A tab that comes back empty or fails keeps its previous file. Exit 1 only when no tab is usable.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createKino } from "../sdk/kino-shim.mjs";

const ROOT = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("kino-plugin.json", ROOT), "utf8"));
const { kino } = createKino(manifest, { lang: "es-CO", device: "phone" });
globalThis.kino = kino;

const plugin = await import(new URL("src/plugin.js", ROOT).href);
const std = await import(new URL("src/std/index.js", ROOT).href);
const { MAX_SLIDES } = await import(new URL("src/std/model.js", ROOT).href);
// The standard screen is made on the first screen() call; its gate (resolver missing) does not matter here.
try { await plugin.screen({ state: {}, device: "phone", installed: {} }); } catch (_) { /* the source is set before any await */ }
const source = std.snapshotSource();
if (!source) { console.error("no standard screen (std 1.8.1) in this plugin"); process.exit(1); }

const MIN_ROWS = 4; // the first tab (the Home) never opens with fewer rows than this when the other tabs have more
const SLIDE_CANDIDATES = 24; // titles asked to TMDB per tab for the slider, in row order
const KEEP_MS = 12 * 60 * 60 * 1000; // unchanged rows under this age are not rewritten: a commit only when the Home changed

// TMDB, asked here in Node (the kit's kino.meta only answers fixtures): search by title (and year), the first hit's id,
// backdrop and synopsis in Spanish. The key never reaches the output: every error line is scrubbed of it.
const KEY = String(process.env.KINO_TMDB_KEY || "").trim();
const tmdb = KEY.length > 0;
if (!tmdb) console.log("no TMDB key (KINO_TMDB_KEY): files without the ready slider");
const titleOf = source.titleOf || ((c) => c.title);
const typeOf = source.typeOf || ((c) => (c.kind === "series" ? "series" : "movie"));
const found = new Map();
async function lookup(c) {
  if (found.has(c.id)) return found.get(c.id);
  const tv = typeOf(c) === "series";
  const year = /^\d{4}$/.test(String(c.year || "")) ? String(c.year) : "";
  const q = new URLSearchParams({ api_key: KEY, query: String(titleOf(c) || "").slice(0, 200), language: "es-MX", include_adult: "false" });
  if (year) q.set(tv ? "first_air_date_year" : "year", year);
  let hit = null;
  try {
    const r = await fetch("https://api.themoviedb.org/3/search/" + (tv ? "tv" : "movie") + "?" + q, { signal: AbortSignal.timeout(10000) });
    if (r.ok) {
      // With the card's year, only a hit released within a year of it (a remake must not lend its older namesake's picture).
      const yearOk = (x) => !year || Math.abs(Number(String(x.release_date || x.first_air_date || "").slice(0, 4)) - Number(year)) <= 1;
      const top = ((await r.json()).results || []).find(yearOk);
      if (top && Number.isInteger(top.id)) {
        hit = { tmdb: top.id, ...(top.backdrop_path ? { backdrop: "https://image.tmdb.org/t/p/w1280" + top.backdrop_path } : {}),
          ...(top.overview ? { overview: String(top.overview).slice(0, 300) } : {}) };
      }
    }
  } catch (e) { console.log("TMDB: " + String((e && e.message) || e).split(KEY).join("***").slice(0, 120)); }
  found.set(c.id, hit);
  return hit;
}
const withIds = (c) => { const h = found.get(c.id); return h && !(c.ids && c.ids.tmdb) ? { ...c, ids: { ...(c.ids || {}), tmdb: h.tmdb } } : c; };

const cleanRows = (page) => (page && Array.isArray(page.rows) ? page.rows : []).filter((r) => r && Array.isArray(r.items) && r.items.length > 0);
const live = {};
async function loadLive(t) {
  try { live[t.id] = cleanRows(await source.loadTab(t.id)); } catch (e) { live[t.id] = null; console.log(`${t.id}: failed (${(e && e.code) || "error"}: ${String((e && e.message) || e).slice(0, 160)})`); }
}
for (const t of source.tabs) await loadLive(t);
// A tab that came back empty is asked once more at the end: the first tab of a fresh runner meets cold DNS and TLS, and a
// plugin that gives its rows a short budget (made for a phone) can run out before the site answers.
for (const t of source.tabs) if (!live[t.id] || live[t.id].length === 0) { console.log(`${t.id}: asked again`); await loadLive(t); }

// ---- only what plays (SNAPSHOT_CHECK=1, for a plugin whose Home is a TMDB list and not the site's own catalog) ----
// A title of a TMDB list may not be on the site at all: the card opens and nothing plays (measured 2026-11-24: 3 of 4 popular
// movies on SeriesMetro, 2 of 3 series on SeriesFlix). So each card is asked to the plugin itself, as a play would: its own
// resolve() (a series: its first episode) with a resolver that only records. A server listed = the site has it; `not_found` and
// none = it does not, and the card leaves the Home; anything else (a timeout, a limit) decides nothing. What was learned is kept
// in home/available.json (a title the site has: 14 days; one it lacks: 3 days, it may arrive), and a run checks at most
// SNAPSHOT_CHECKS cards it does not know yet, the first cards of each row first: a card not checked yet stays.
const CHECK = process.env.SNAPSHOT_CHECK === "1" && typeof plugin.resolve === "function";
const availFile = new URL("home/available.json", ROOT);
const known = (() => { try { return JSON.parse(readFileSync(availFile, "utf8")).items || {}; } catch (_) { return {}; } })();
const DAY = 24 * 60 * 60 * 1000;
const freshOf = (ref) => { const k = known[ref]; return k && Date.now() - Number(k.at) < (k.ok ? 14 : 3) * DAY ? k : null; };

/** kino.meta for the checks, answered by TMDB with the snapshot's key (the kit's own answers only fixtures). */
const tmdbJson = new Map();
async function tmdbGet(path, q = {}) {
  const u = new URL("https://api.themoviedb.org/3" + path);
  u.searchParams.set("api_key", KEY); u.searchParams.set("language", "es-MX");
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  if (tmdbJson.has(u.href)) return tmdbJson.get(u.href);
  let j = null;
  try { const r = await fetch(u, { signal: AbortSignal.timeout(10000) }); j = r.ok ? await r.json() : null; } catch (_) { j = null; }
  tmdbJson.set(u.href, j);
  return j;
}
async function metaByTmdb(type, id) {
  const tv = type === "series";
  const d = await tmdbGet(`/${tv ? "tv" : "movie"}/${id}`, { append_to_response: "external_ids" });
  if (!d || !d.id) return null;
  const imdb = d.imdb_id || (d.external_ids && d.external_ids.imdb_id);
  const out = { type, title: d.title || d.name, originalTitle: d.original_title || d.original_name,
    year: Number(String(d.release_date || d.first_air_date || "").slice(0, 4)) || undefined, ids: { tmdb: d.id, ...(imdb ? { imdb } : {}) } };
  // The first season is enough to find a first episode.
  if (tv) { const s = await tmdbGet(`/tv/${id}/season/1`); out.episodes = ((s && s.episodes) || []).map((e) => ({ season: e.season_number, number: e.episode_number, title: e.name })); }
  return out;
}
async function checkMeta(q = {}) {
  const type = q.type === "series" ? "series" : "movie";
  if (q.ids && q.ids.tmdb) return metaByTmdb(type, q.ids.tmdb);
  if (q.ids && q.ids.imdb) { const f = await tmdbGet(`/find/${q.ids.imdb}`, { external_source: "imdb_id" }); const hit = f && ((type === "series" ? f.tv_results : f.movie_results) || [])[0]; return hit ? metaByTmdb(type, hit.id) : null; }
  if (q.title) { const s = await tmdbGet(`/search/${type === "series" ? "tv" : "movie"}`, { query: q.title }); const hit = s && s.results && s.results[0]; return hit ? metaByTmdb(type, hit.id) : null; }
  return null;
}

/** true: the site has it; false: it does not; null: could not tell. One check at a time (the plugin reads the global kino). */
async function hasIt(card) {
  let listed = 0;
  const recorded = () => { throw Object.assign(new Error("snapshot: recorded"), { code: "provider_failed" }); };
  const plugins = { call: async (alias, call) => { if (call === "normalizeHost") return { host: "" }; if (call === "resolve") listed++; return recorded(); }, callAll: async () => [], providers: async () => [] };
  // A kino of its own: the kit gives each one a request allowance per minute.
  globalThis.kino = { ...createKino(manifest, { lang: "es-CO", device: "phone" }).kino, meta: checkMeta, plugins, browser: undefined };
  const late = (ms) => new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("late"), { code: "timeout" })), ms));
  try {
    let ref = card.ref;
    if (card.kind === "series") {
      const eps = await Promise.race([plugin.episodes(card.ref), late(20000)]);
      const list = Array.isArray(eps) ? eps : (eps && eps.episodes) || [];
      const ep = list.find((e) => e && e.ref);
      if (!ep) return false;
      ref = ep.ref;
    }
    await Promise.race([plugin.resolve(ref), late(25000)]);
    return true; // it resolved (a stream of the site's own), or at least listed a server before the recorder refused it
  } catch (e) {
    if (listed > 0) return true;
    return e && e.code === "not_found" ? false : null;
  } finally { globalThis.kino = kino; }
}

if (CHECK && tmdb) {
  const budget = Number(process.env.SNAPSHOT_CHECKS || 60);
  // The cards nobody knows about yet, the first of every row before the second of any.
  const todo = []; const queued = new Set();
  for (let pos = 0; pos < 60; pos++) for (const t of source.tabs) for (const r of live[t.id] || []) {
    const c = r.items[pos];
    if (c && c.ref && !r.hidden && !queued.has(c.ref) && !freshOf(c.ref)) { queued.add(c.ref); todo.push(c); }
  }
  let learned = 0, missing = 0;
  for (const c of todo.slice(0, budget)) {
    const ok = await hasIt(c);
    if (ok === null) continue;
    known[c.ref] = { ok, at: Date.now() };
    learned++; if (!ok) missing++;
  }
  // Forget what no row shows any more, so the file does not grow for ever.
  const shownRefs = new Set(); for (const t of source.tabs) for (const r of live[t.id] || []) for (const c of r.items) shownRefs.add(c.ref);
  for (const ref of Object.keys(known)) if (!shownRefs.has(ref) && Date.now() - Number(known[ref].at) > 14 * DAY) delete known[ref];
  if (learned) writeFileSync(availFile, JSON.stringify({ v: 1, items: known }) + "\n");
  let dropped = 0;
  for (const t of source.tabs) {
    if (!live[t.id]) continue;
    live[t.id] = live[t.id].map((r) => {
      if (r.hidden) return r;
      const items = r.items.filter((c) => { const k = freshOf(c.ref); return !(k && k.ok === false); });
      dropped += r.items.length - items.length;
      return { ...r, items };
    }).filter((r) => r.hidden || r.items.length >= 3); // a rail of one or two cards is not worth its place
  }
  console.log(`only what plays: ${learned} cards checked (${missing} not on the site, ${Math.max(0, todo.length - budget)} left for the next run), ${dropped} cards left out`);
}

/** The Home: its own rows, then the other tabs' rows it lacks (by title), until it has MIN_ROWS. */
function richHome(rows) {
  const out = rows.filter((r) => !r.hidden); // every row of its own: more than MIN_ROWS is welcome (owner, 2026-11-23)
  const titles = new Set(out.map((r) => String(r.title || "").toLowerCase()));
  for (const t of source.tabs.slice(1)) {
    for (const r of live[t.id] || []) {
      if (out.length >= MIN_ROWS) break;
      const key = String(r.title || "").toLowerCase();
      if (r.hidden || titles.has(key)) continue;
      titles.add(key);
      out.push({ ...r, id: t.id + "-" + r.id });
    }
  }
  return [...rows.filter((r) => r.hidden), ...out];
}

/** The tab's slider ready made: up to MAX_SLIDES titles with a TMDB backdrop, in a hidden row (std feeds slides only from it). */
async function withSlides(rows) {
  if (!tmdb) return rows;
  const visible = rows.filter((r) => !r.hidden);
  const seen = new Set();
  const cards = [];
  for (const r of visible) for (const c of r.items.slice(0, 8)) if (!seen.has(c.id) && c.adult !== true) { seen.add(c.id); cards.push(c); }
  const asked = cards.slice(0, SLIDE_CANDIDATES);
  for (let i = 0; i < asked.length; i += 4) await Promise.all(asked.slice(i, i + 4).map(lookup));
  const dressed = rows.map((r) => ({ ...r, items: r.items.map(withIds) }));
  if (rows.some((r) => r.items.some((i) => i.backdrop))) return dressed; // the site has its own backdrops: std uses them
  const slides = [];
  for (const c of cards) {
    if (slides.length >= MAX_SLIDES) break;
    const k = found.get(c.id);
    if (k && k.backdrop) slides.push({ ...withIds(c), backdrop: k.backdrop, ...(k.overview ? { overview: k.overview } : {}) });
  }
  return slides.length ? [{ id: "slides", title: "Destacados", hidden: true, items: slides }, ...dressed] : dressed;
}

const dir = new URL("home/", ROOT);
mkdirSync(dir, { recursive: true });
let usable = 0;
for (const [i, t] of source.tabs.entries()) {
  const file = new URL(encodeURIComponent(t.id) + ".json", dir);
  const old = existsSync(file) ? (() => { try { return JSON.parse(readFileSync(file, "utf8")); } catch (_) { return null; } })() : null;
  let rows = live[t.id];
  if (!rows || rows.length === 0) { console.log(`${t.id}: no rows, previous file kept`); if (old) usable++; continue; }
  if (i === 0) rows = richHome(rows);
  rows = await withSlides(rows);
  usable++;
  if (old && JSON.stringify(old.rows) === JSON.stringify(rows) && Date.now() - Number(old.at) < KEEP_MS) { console.log(`${t.id}: unchanged`); continue; }
  writeFileSync(file, JSON.stringify({ v: std.SNAPSHOT_VERSION, tab: t.id, at: Date.now(), rows }) + "\n");
  const shown = rows.filter((r) => !r.hidden);
  const slides = rows.find((r) => r.hidden && r.id === "slides");
  console.log(`${t.id}: ${shown.length} rows, ${shown.reduce((n, r) => n + r.items.length, 0)} titles, ${slides ? slides.items.length : 0} slides`);
}
// home/index.json: this plugin's tabs, in order (Da-Video's Contenido reads it to know which files to fetch). Rewritten only
// when the tabs change, and kept even when no tab could be loaded this run.
const indexFile = new URL("index.json", dir);
const index = { v: std.SNAPSHOT_VERSION, tabs: source.tabs.map((t) => ({ id: t.id, label: t.label || t.id, ...(t.labelEn ? { labelEn: t.labelEn } : {}) })) };
const oldIndex = existsSync(indexFile) ? readFileSync(indexFile, "utf8") : "";
if (oldIndex.trim() !== JSON.stringify(index)) { writeFileSync(indexFile, JSON.stringify(index) + "\n"); console.log("index: " + index.tabs.map((t) => t.id).join(", ")); }
process.exit(usable > 0 ? 0 : 1);
