// node --test test/plugin.test.mjs
// Offline: a fake embed69.org (a real proof of work and AES-256-CBC links, made here), fake players and a stub of `kino`.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { validateManifest } from "../sdk/contract.mjs";

const calls = [];
let config = {};
const tmdbCalls = [];
let tmdbImpl = async () => ({ results: [] });
let metaImpl = async () => null;
let pages = {};          // url -> { status?, body } (a function answers per request)
let logs = [];
globalThis.kino = {
  lang: "es",
  config: { get: (k) => config[k] },
  fetch: async (url, opts = {}) => {
    calls.push({ url, opts });
    const p = pages[url] ?? pages[new URL(url).origin + "/*"];
    if (!p) return { ok: false, status: 404, text: () => "", json: () => ({}) };
    const r = typeof p === "function" ? p(url, opts) : p;
    const status = r.status ?? 200;
    return { ok: status < 400, status, text: () => r.body, json: () => JSON.parse(r.body) };
  },
  crypto: {
    hash: (alg, text) => createHash(alg).update(text).digest("hex"),
    decrypt: (alg, { key, keyEncoding, iv, ivEncoding, data }) => {
      const d = createDecipheriv(alg, Buffer.from(key, keyEncoding), Buffer.from(iv, ivEncoding));
      return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
    },
  },
  storage: { get: () => null, set() {}, keys: () => [], remove() {} },
  log: (...a) => logs.push(a.join(" ")),
  tmdb: async (path, params) => { tmdbCalls.push({ path, params }); return tmdbImpl(path, params); },
  meta: (q) => metaImpl(q), rank: {},
  error: (code, message, opts = {}) => Object.assign(new Error(message), { code, ...opts }),
};
const plugin = await import("../plugin.js");

beforeEach(() => { calls.length = 0; tmdbCalls.length = 0; logs = []; config = {}; pages = {}; tmdbImpl = async () => ({ results: [] }); metaImpl = async () => null; });

// ---- a fake embed69.org ----

const CHALLENGE = "abc123", SALT = "salt9", DIFFICULTY = 2;
const pow = (() => { for (let n = 0; ; n++) if (createHash("sha256").update(CHALLENGE + n).digest("hex").startsWith("0".repeat(DIFFICULTY))) return n; })();
const KEY = createHash("sha256").update(CHALLENGE + pow + SALT).digest();
const encrypt = (url) => { const iv = randomBytes(16); const c = createCipheriv("aes-256-cbc", KEY, iv); return Buffer.concat([iv, c.update(url, "utf8"), c.final()]).toString("base64"); };
/** The site's page for a title: one block per language, each with its players. */
const sitePage = (blocks, { difficulty = DIFFICULTY } = {}) => `<html><script>
const POW_CHALLENGE = '${CHALLENGE}'; const POW_SALT = '${SALT}'; const POW_DIFFICULTY = ${difficulty};
let dataLink = ${JSON.stringify(blocks.map(([lang, embeds]) => ({ video_language: lang, sortedEmbeds: embeds.map(([servername, url]) => ({ servername, link: encrypt(url) })) })))};
</script></html>`;

const SW = (id) => `https://hglink.to/e/${id}`, VH = (id) => `https://morencius.com/embed/${id}`, VOE = (id) => `https://voe.sx/e/${id}`;
const WISH_PAGE = (name) => `{"hls4":"https://vibuxer.com/stream/${name}/master.m3u8"}`;
const HIDE_PAGE = (name) => `{"hls4":"https://morencius.com/stream/${name}/master.m3u8"}`;
/** Everything a title needs: the site page and the players of its copies. */
function serve(path, blocks, extra = {}) {
  pages = {
    ["https://embed69.org/f/" + path]: { body: sitePage(blocks) },
    "https://vibuxer.com/e/swlat": { body: WISH_PAGE("lat") },
    "https://vibuxer.com/e/swesp": { body: WISH_PAGE("esp") },
    "https://vibuxer.com/e/swsub": { body: WISH_PAGE("sub") },
    "https://morencius.com/embed/vhlat": { body: HIDE_PAGE("lat") },
    "https://voe.sx/e/voelat": { body: `<script>window.location.href = 'https://rotating.example/e/voelat'</script>` },
    ...extra,
  };
}
const ALL = [
  ["LAT", [["streamwish", SW("swlat")], ["vidhide", VH("vhlat")], ["voe", VOE("voelat")]]],
  ["ESP", [["streamwish", SW("swesp")]]],
  ["SUB", [["streamwish", SW("swsub")]]],
];

const manifest = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8"));

test("the manifest is valid for Kino and declares the site and every player's hosts", () => {
  const out = validateManifest(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8"));
  assert.ok(!out.errors?.length, JSON.stringify(out.errors));
  for (const h of ["embed69.org", "hglink.to", "vibuxer.com", "morencius.com", "voe.sx"]) assert.ok(manifest.hosts.includes(h), h);
  assert.equal(manifest.browser, true);
  assert.ok(manifest.capabilities.includes("download"));
});

test("a movie asks /f/<imdb> with the partner's Referer and plays the first copy that opens: Latino on StreamWish", async () => {
  metaImpl = async () => ({ ids: { imdb: "tt0133093" } });
  serve("tt0133093", ALL);
  const a = await plugin.resolve("m:603");
  assert.equal(calls[0].url, "https://embed69.org/f/tt0133093");
  assert.equal(calls[0].opts.headers.Referer, "https://sololatino.net/");
  assert.equal(a.url, "https://vibuxer.com/stream/lat/master.m3u8");
  assert.equal(a.label, "Latino · StreamWish");
  assert.equal(a.mime, "application/vnd.apple.mpegurl");
  assert.match(a.headers["User-Agent"], /Mozilla/);
  assert.equal(a.headers.Referer, "https://vibuxer.com/");
});

test("every request carries a browser User-Agent (the players answer okhttp's with a page that has no playlist), beside the source's own headers", async () => {
  metaImpl = async () => ({ ids: { imdb: "tt0133093" } });
  serve("tt0133093", ALL);
  await plugin.resolve("m:603");
  assert.ok(calls.length >= 2);
  for (const c of calls) assert.match(c.opts.headers["User-Agent"], /^Mozilla\/5\.0 .*Chrome/, c.url);
  assert.equal(calls[0].opts.headers.Referer, "https://sololatino.net/");
});

test("the other copies are lazy refs, preferred language first, faster servers first", async () => {
  metaImpl = async () => ({ ids: { imdb: "tt0133093" } });
  serve("tt0133093", ALL);
  const a = await plugin.resolve("m:603");
  assert.deepEqual(a.alternatives.map((x) => x.label), ["Latino · VidHide", "Latino · Voe", "Castellano · StreamWish", "Subtitulado · StreamWish"]);
  assert.deepEqual(a.alternatives.map((x) => x.ref), [
    "cp:movie:tt0133093:lat:vidhide", "cp:movie:tt0133093:lat:voe", "cp:movie:tt0133093:esp:streamwish", "cp:movie:tt0133093:sub:streamwish"]);
  assert.ok(a.alternatives.every((x) => x.ref.length <= 512 && !x.url));
  assert.ok(!calls.some((c) => c.url.includes("morencius.com")), "a lazy copy is not opened up front");
});

test("the language setting puts Castellano or Subtitulado first", async () => {
  metaImpl = async () => ({ ids: { imdb: "tt0133093" } });
  serve("tt0133093", ALL);
  config = { language: "esp" };
  const a = await plugin.resolve("m:603");
  assert.equal(a.label, "Castellano · StreamWish");
  assert.equal(a.alternatives[0].label, "Latino · StreamWish");
  config = { language: "sub" };
  assert.equal((await plugin.resolve("m:603")).label, "Subtitulado · StreamWish");
});

test("a lazy copy opens just that server; one the site no longer lists is not_found", async () => {
  serve("tt0133093", ALL);
  const a = await plugin.resolve("cp:movie:tt0133093:lat:vidhide");
  assert.equal(a.url, "https://morencius.com/stream/lat/master.m3u8");
  assert.equal(a.label, "Latino · VidHide");
  assert.equal(a.alternatives, undefined);
  await assert.rejects(() => plugin.resolve("cp:movie:tt0133093:sub:voe"), (e) => e.code === "not_found" && e.userMessage === "No se encontraron fuentes para este título.");
  await assert.rejects(() => plugin.resolve("cp:garbage"), (e) => e.code === "not_found");
});

test("a copy whose player shows nothing is skipped: the next one plays", async () => {
  metaImpl = async () => ({ ids: { imdb: "tt0133093" } });
  serve("tt0133093", ALL, { "https://vibuxer.com/e/swlat": { status: 500, body: "" } });
  const a = await plugin.resolve("m:603");
  assert.equal(a.label, "Latino · VidHide");
  assert.ok(!a.alternatives.some((x) => x.label === "Latino · StreamWish"), "the one that failed is not offered again");
});

test("Voe without the hidden browser cannot open; with nothing else, the person reads a readable error", async () => {
  metaImpl = async () => ({ ids: { imdb: "tt1" + "0".repeat(5) } });
  serve("tt100000", [["LAT", [["voe", VOE("voelat")]]]]);
  await assert.rejects(() => plugin.resolve("m:1"), (e) => e.code === "not_found" && e.userMessage === "No se encontraron fuentes para este título.");
});

test("Voe through the hidden browser plays what the page shows", async () => {
  metaImpl = async () => ({ ids: { imdb: "tt0133093" } });
  serve("tt0133093", [["LAT", [["voe", VOE("voelat")]]]]);
  globalThis.kino.browser = { captureAll: true, capture: async () => ({ media: [{ url: "https://cdn.example/v/master.m3u8" }] }) };
  try {
    const a = await plugin.resolve("m:603");
    assert.equal(a.url, "https://cdn.example/v/master.m3u8");
    assert.equal(a.label, "Latino · Voe");
  } finally { delete globalThis.kino.browser; }
});

test("an episode asks /f/<imdb>-<s>x<ee> and its lazy refs name season and episode", async () => {
  serve("tt0903747-2x05", ALL);
  const a = await plugin.resolve("ep:tt0903747:2:5");
  assert.equal(calls[0].url, "https://embed69.org/f/tt0903747-2x05");
  assert.equal(a.alternatives[0].ref, "cp:ep:tt0903747:2:5:lat:vidhide");
  const lazy = await plugin.resolve("cp:ep:tt0903747:2:5:esp:streamwish");
  assert.equal(lazy.url, "https://vibuxer.com/stream/esp/master.m3u8");
});

test("nothing listed, an error page or a difficulty a TV should not grind through all end in not_found", async () => {
  metaImpl = async () => ({ ids: { imdb: "tt0133093" } });
  pages = { "https://embed69.org/f/tt0133093": { body: `{"error":"not found"}` } };
  await assert.rejects(() => plugin.resolve("m:603"), (e) => e.code === "not_found");
  pages = { "https://embed69.org/f/tt0133093": { status: 404, body: "" } };
  await assert.rejects(() => plugin.resolve("m:603"), (e) => e.code === "not_found");
  pages = { "https://embed69.org/f/tt0133093": { body: sitePage(ALL, { difficulty: 9 }) } };
  await assert.rejects(() => plugin.resolve("m:603"), (e) => e.code === "not_found");
  await assert.rejects(() => plugin.resolve("nonsense"), (e) => e.code === "not_found");
});

test("a title with no IMDB id is not asked", async () => {
  metaImpl = async () => null;
  await assert.rejects(() => plugin.resolve("m:99"), (e) => e.code === "not_found" && e.userMessage === "No se encontró información de este título.");
  assert.equal(calls.length, 0);
});

test("links on hosts no extractor knows are left out, and so is the site's download button", async () => {
  metaImpl = async () => ({ ids: { imdb: "tt0133093" } });
  serve("tt0133093", [["LAT", [["download", "https://dl.example/file.mp4"], ["netu", "https://netu.example/e/1"], ["streamwish", SW("swlat")]]]]);
  const a = await plugin.resolve("m:603");
  assert.equal(a.label, "Latino · StreamWish");
  assert.equal(a.alternatives, undefined);
});

// ---- categories ----

test("the categories are TMDB's genres, movies first, each browsable as genre:<kind>:<id>", async () => {
  tmdbImpl = async (path) => path === "/genre/movie/list"
    ? { genres: [{ id: 28, name: "Acción" }, { id: 35, name: "Comedia" }] }
    : { genres: [{ id: 10759, name: "Action & Adventure" }] };
  const cats = await plugin.categories();
  assert.deepEqual(cats.map((c) => c.ref), ["genre:movie:28", "genre:movie:35", "genre:tv:10759"]);
  assert.deepEqual(cats.map((c) => c.title), ["Acción", "Comedia", "Action & Adventure (series)"]);
  assert.equal(new Set(cats.map((c) => c.id)).size, cats.length);
  tmdbImpl = async () => ({ results: [{ id: 1, title: "A", poster_path: "/a.jpg" }], page: 1, total_pages: 2 });
  const page = await plugin.browse("genre:movie:28", null);
  assert.equal(page.items.length, 1);
  assert.equal(page.next, "2");
  assert.equal(tmdbCalls.at(-1).params.with_genres, "28");
});

test("the cache action empties only the IMDB ids", async () => {
  const removed = [];
  const before = globalThis.kino.storage;
  globalThis.kino.storage = { get: () => null, set() {}, keys: () => ["imdb:movie:1", "other", "imdb:series:2"], remove: (k) => removed.push(k) };
  try { assert.equal((await plugin.action("clearCache")).message, "Caché de IDs vaciada."); } finally { globalThis.kino.storage = before; }
  assert.deepEqual(removed, ["imdb:movie:1", "imdb:series:2"]);
});

// ---- home and browse ----

const GENRES = ["peliculas", "series", "anime", "infantil", "documentales", "deportes", "noticias", "musica", "entretenimiento", "otros"];
const titles = (n, withPoster = true) => Array.from({ length: n }, (_, i) => ({ id: 1000 + i, title: "T" + i, name: "T" + i, release_date: "2024-01-01", ...(withPoster ? { poster_path: "/p" + i + ".jpg" } : {}) }));

test("home has many rows, each with a genre Kino knows, a ref to browse and at most 20 titles", async () => {
  tmdbImpl = async () => ({ results: titles(40), page: 1, total_pages: 5 });
  const rows = await plugin.home();
  assert.ok(rows.length >= 10 && rows.length <= 20, "rows: " + rows.length);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  for (const r of rows) {
    assert.ok(GENRES.includes(r.genre), r.id + " genre " + r.genre);
    assert.ok(r.ref && r.title && r.items.length > 0 && r.items.length <= 20, r.id);
    assert.ok(r.items.every((i) => i.poster && i.ref && i.kind));
  }
  assert.ok(rows.some((r) => r.genre === "series") && rows.some((r) => r.genre === "infantil") && rows.some((r) => r.genre === "documentales"));
  assert.ok(tmdbCalls.length <= 20, "one TMDB call per row, within Kino's 20 per 10 s: " + tmdbCalls.length);
});

test("every title carries its genres, so the Home can file it in a row per genre (not only 'Películas' and 'Series')", async () => {
  tmdbImpl = async () => ({ results: [{ id: 1, title: "A", poster_path: "/a.jpg", genre_ids: [28, 878, 12, 99999], release_date: "2024-01-01" }, { id: 2, title: "B", poster_path: "/b.jpg", genre_ids: [10759, 10765, 18] }, { id: 3, title: "C", poster_path: "/c.jpg" }] });
  const items = (await plugin.home())[0].items;
  assert.deepEqual(items[0].genres, ["Acción", "Ciencia ficción", "Aventura"]);
  assert.deepEqual(items[1].genres, ["Acción", "Ciencia ficción", "Drama"]);
  assert.equal(items[2].genres, undefined);
  assert.ok((await plugin.browse("list:movie:top_rated", null)).items[0].genres.length > 0);
});

test("the genre rows are discover lists with some votes behind them", async () => {
  tmdbImpl = async () => ({ results: titles(5) });
  await plugin.home();
  const action = tmdbCalls.find((c) => c.params?.with_genres === 28);
  assert.equal(action.path, "/discover/movie");
  assert.equal(action.params["vote_count.gte"], 200);
});

test("a row that fails or has no posters is left out, the others are still shown", async () => {
  tmdbImpl = async (path) => {
    if (path === "/movie/upcoming") throw new Error("boom");
    if (path === "/movie/top_rated") return { results: titles(5, false) };
    return { results: titles(5) };
  };
  const rows = await plugin.home();
  assert.ok(!rows.some((r) => r.id === "upcoming" || r.id === "top-movies"));
  assert.ok(rows.length >= 10);
});

test("when no row can be loaded the person gets a readable error", async () => {
  tmdbImpl = async () => { throw new Error("down"); };
  await assert.rejects(() => plugin.home(), (e) => e.code === "unavailable" && e.userMessage === "El servicio no está disponible en este momento.");
});

test("rows are named in the person's language", async () => {
  tmdbImpl = async () => ({ results: titles(3) });
  globalThis.kino.lang = "en";
  try { assert.equal((await plugin.home())[0].title, "Trending movies"); } finally { globalThis.kino.lang = "es"; }
});

test("every home row's ref opens its own list in Ver más, page after page", async () => {
  tmdbImpl = async (path, params) => ({ results: titles(30), page: params.page, total_pages: 3 });
  const rows = await plugin.home();
  for (const row of rows) {
    tmdbCalls.length = 0;
    const first = await plugin.browse(row.ref, null);
    assert.ok(first.items.length > 0, row.ref);
    assert.equal(first.next, "2", row.ref);
    assert.equal(tmdbCalls[0].path, HOME_PATHS[row.id], row.ref + " -> " + tmdbCalls[0].path);
    const last = await plugin.browse(row.ref, "3");
    assert.equal(last.next, undefined);
  }
  assert.deepEqual(await plugin.browse("nonsense", null), { items: [] });
  assert.deepEqual(await plugin.browse("list:movie:../account", null), { items: [] });
});

const HOME_PATHS = {
  "trending-movies": "/trending/movie/week", "now-playing": "/movie/now_playing", upcoming: "/movie/upcoming", "top-movies": "/movie/top_rated",
  "trending-series": "/trending/tv/week", "on-the-air": "/tv/on_the_air", "top-series": "/tv/top_rated",
  "g-action": "/discover/movie", "g-comedy": "/discover/movie", "g-scifi": "/discover/movie", "g-horror": "/discover/movie",
  "g-drama": "/discover/movie", kids: "/discover/movie", docs: "/discover/movie", anime: "/discover/tv",
};
