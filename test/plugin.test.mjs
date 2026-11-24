// node --test test/plugin.test.mjs
// Offline: a fake embed69.org (LINK_CHALLENGE + AES-256-CBC links, and its Anubis check page, made here), a stub of `kino`, and a
// stub of the shared kino-resolver door (`kino.plugins.call("resolver","resolve")`).
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
let resolverImpl = () => ({ streams: [] }); // the shared kino-resolver's door, stubbed per test
let resolverPresent = true;                 // whether the resolver is installed (what the normalizeHost probe reports)
globalThis.kino = {
  lang: "es",
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  config: { get: (k) => config[k] },
  fetch: async (url, opts = {}) => {
    calls.push({ url, opts });
    const p = pages[url] ?? pages[new URL(url).origin + "/*"];
    if (!p) return { ok: false, status: 404, text: () => "", json: () => ({}) };
    const r = typeof p === "function" ? p(url, opts) : p;
    const status = r.status ?? 200;
    return { ok: status < 400, status, text: () => r.body, json: () => JSON.parse(r.body) };
  },
  plugins: {
    call: async (name, method, arg) => {
      if (name === "resolver") {
        if (method === "normalizeHost") { if (!resolverPresent) throw globalThis.kino.error("provider_missing", "not installed"); return {}; }
        if (method === "resolve") return resolverImpl(arg);
      }
      throw globalThis.kino.error("provider_missing", "no provider " + name);
    },
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

beforeEach(() => { calls.length = 0; tmdbCalls.length = 0; logs = []; config = {}; pages = {}; tmdbImpl = async () => ({ results: [] }); metaImpl = async () => null; resolverImpl = defaultResolver; resolverPresent = true; });

// ---- a fake embed69.org (LINK_CHALLENGE scheme, 2026-11) ----

const CHALLENGE = "abc123", SALT = "salt9";
const KEY = createHash("sha256").update(CHALLENGE + SALT).digest();
// The site wraps each decrypted link in backticks; the plugin strips them.
const encrypt = (url) => { const iv = randomBytes(16); const c = createCipheriv("aes-256-cbc", KEY, iv); return Buffer.concat([iv, c.update("`" + url + "`", "utf8"), c.final()]).toString("base64"); };
/** The site's page for a title: one block per language, each with its players. */
const sitePage = (blocks) => `<html><script>
const LINK_CHALLENGE = '${CHALLENGE}'; const LINK_SALT = '${SALT}';
let dataLink = ${JSON.stringify(blocks.map(([lang, embeds]) => ({ video_language: lang, sortedEmbeds: embeds.map(([servername, url]) => ({ servername, link: encrypt(url) })) })))};
</script></html>`;

const SW = (id) => `https://hglink.to/e/${id}`, VH = (id) => `https://morencius.com/embed/${id}`, VOE = (id) => `https://voe.sx/e/${id}`;
/** The shared resolver, stubbed: it opens a known embed to a predictable m3u8 named after the embed's id. */
const streamFor = (url) => { const m = /\/(?:e|embed)\/([\w-]+)/.exec(String(url || "")); return m ? `https://cdn.example/${m[1]}.m3u8` : null; };
const defaultResolver = ({ url }) => { const s = streamFor(url); return s ? { streams: [{ url: s, kind: "hls" }] } : { streams: [] }; };

/** The site page for a title at its path. */
function serve(path, blocks, extra = {}) {
  pages = { ["https://embed69.org/f/" + path]: { body: sitePage(blocks) }, ...extra };
}
const ALL = [
  ["LAT", [["streamwish", SW("swlat")], ["vidhide", VH("vhlat")], ["voe", VOE("voelat")]]],
  ["ESP", [["streamwish", SW("swesp")]]],
  ["SUB", [["streamwish", SW("swsub")]]],
];

const manifest = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8"));

test("the manifest is valid, consumes the shared resolver, and declares the site and the players' hosts", () => {
  const out = validateManifest(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8"));
  assert.ok(!out.errors?.length, JSON.stringify(out.errors));
  for (const h of ["embed69.org", "hglink.to", "vibuxer.com", "morencius.com", "voe.sx"]) assert.ok(manifest.hosts.includes(h), h);
  assert.equal(manifest.apiVersion, 30);
  assert.ok(manifest.consumes && manifest.consumes.resolver, "consumes the resolver");
  assert.deepEqual(manifest.recommends, ["xuper-plugin/kino-plugin-kino-resolver"]);
  assert.equal(manifest.browser, true); // capture is the fallback for a gate host the resolver's inline pass cannot crack
  assert.ok(manifest.capabilities.includes("download"));
});

test("a movie asks /f/<imdb> with the partner's Referer and plays the first copy the resolver opens: Latino on VidHide (measured fastest)", async () => {
  metaImpl = async () => ({ ids: { imdb: "tt0133093" } });
  serve("tt0133093", ALL);
  const a = await plugin.resolve("m:603");
  assert.equal(calls[0].url, "https://embed69.org/f/tt0133093");
  assert.equal(calls[0].opts.headers.Referer, "https://sololatino.net/");
  assert.equal(a.url, "https://cdn.example/vhlat.m3u8");
  assert.equal(a.label, "Latino · VidHide");
  assert.equal(a.mime, "application/vnd.apple.mpegurl");
  assert.match(a.headers["User-Agent"], /Mozilla/);
});

test("every request carries a browser User-Agent, beside the source's own headers", async () => {
  metaImpl = async () => ({ ids: { imdb: "tt0133093" } });
  serve("tt0133093", ALL);
  await plugin.resolve("m:603");
  assert.ok(calls.length >= 1);
  for (const c of calls) assert.match(c.opts.headers["User-Agent"], /^Mozilla\/5\.0 .*Chrome/, c.url);
  assert.equal(calls[0].opts.headers.Referer, "https://sololatino.net/");
});

test("the other copies are lazy refs, preferred language first, faster servers first", async () => {
  metaImpl = async () => ({ ids: { imdb: "tt0133093" } });
  serve("tt0133093", ALL);
  const a = await plugin.resolve("m:603");
  assert.deepEqual(a.alternatives.map((x) => x.label), ["Latino · StreamWish", "Latino · Voe", "Castellano · StreamWish", "Subtitulado · StreamWish"]);
  assert.deepEqual(a.alternatives.map((x) => x.ref), [
    "cp:movie:tt0133093:lat:streamwish", "cp:movie:tt0133093:lat:voe", "cp:movie:tt0133093:esp:streamwish", "cp:movie:tt0133093:sub:streamwish"]);
  assert.ok(a.alternatives.every((x) => x.ref.length <= 512 && !x.url));
});

test("the language setting puts Castellano or Subtitulado first", async () => {
  metaImpl = async () => ({ ids: { imdb: "tt0133093" } });
  serve("tt0133093", ALL);
  config = { language: "esp" };
  const a = await plugin.resolve("m:603");
  assert.equal(a.label, "Castellano · StreamWish");
  assert.equal(a.alternatives[0].label, "Latino · VidHide");
  config = { language: "sub" };
  assert.equal((await plugin.resolve("m:603")).label, "Subtitulado · StreamWish");
});

test("a lazy copy opens just that server; one the site no longer lists is not_found", async () => {
  serve("tt0133093", ALL);
  const a = await plugin.resolve("cp:movie:tt0133093:lat:vidhide");
  assert.equal(a.url, "https://cdn.example/vhlat.m3u8");
  assert.equal(a.label, "Latino · VidHide");
  assert.equal(a.alternatives, undefined);
  await assert.rejects(() => plugin.resolve("cp:movie:tt0133093:sub:voe"), (e) => e.code === "not_found" && e.userMessage === "No se encontraron fuentes para este título.");
  await assert.rejects(() => plugin.resolve("cp:garbage"), (e) => e.code === "not_found");
});

test("a copy the resolver cannot open is skipped: the next one plays, and the one that failed is not offered again", async () => {
  metaImpl = async () => ({ ids: { imdb: "tt0133093" } });
  serve("tt0133093", ALL);
  resolverImpl = ({ url }) => (url === VH("vhlat") ? { streams: [] } : defaultResolver({ url }));
  const a = await plugin.resolve("m:603");
  assert.equal(a.label, "Latino · StreamWish"); // VidHide failed, StreamWish is next in order
  assert.ok(!a.alternatives.some((x) => x.label === "Latino · VidHide"), "the one that failed is not offered again");
});

test("it learns which server opens for this person and tries it first next time", async () => {
  metaImpl = async () => ({ ids: { imdb: "tt0133093" } });
  serve("tt0133093", ALL);
  const before = globalThis.kino.storage;
  const mem = new Map();
  globalThis.kino.storage = { get: (k) => mem.get(k) ?? null, set: (k, v) => mem.set(k, String(v)), keys: () => [...mem.keys()], remove: (k) => mem.delete(k) };
  try {
    // VidHide (the measured first) gives nothing twice: StreamWish plays and earns wins, VidHide losses.
    resolverImpl = ({ url }) => (/vhlat/.test(url) ? { streams: [] } : defaultResolver({ url }));
    assert.equal((await plugin.resolve("m:603")).label, "Latino · StreamWish");
    assert.equal((await plugin.resolve("m:603")).label, "Latino · StreamWish");
    // Now every server would open; the learned order asks StreamWish first instead of VidHide.
    resolverImpl = defaultResolver;
    calls.length = 0;
    const a = await plugin.resolve("m:603");
    assert.equal(a.label, "Latino · StreamWish", "the server that has opened is tried first");
  } finally { globalThis.kino.storage = before; }
});

test("a file the resolver reports dead is not sent to the hidden browser (no 20 s wasted on a deleted upload)", async () => {
  metaImpl = async () => ({ ids: { imdb: "tt0133093" } });
  serve("tt0133093", [["LAT", [["voe", VOE("voelat")], ["streamwish", SW("swlat")]]]]);
  resolverImpl = ({ url }) => (/voelat/.test(url) ? { streams: [], error: "dead" } : { streams: [] });
  const captured = [];
  globalThis.kino.browser = { capture: async (u) => { captured.push(u); return { media: [] }; } };
  try {
    await assert.rejects(() => plugin.resolve("m:603"), (e) => e.code === "not_found");
    assert.ok(!captured.some((u) => /voelat/.test(u)), "the dead VOE upload is never captured");
    assert.equal(captured.length, 1, "the one capture of the budget went to StreamWish, and a failed capture still spends it");
  } finally { delete globalThis.kino.browser; }
});

test("when the resolver opens nothing and there is no browser, the person reads a readable error", async () => {
  metaImpl = async () => ({ ids: { imdb: "tt100000" } });
  serve("tt100000", [["LAT", [["voe", VOE("voelat")]]]]);
  resolverImpl = () => ({ streams: [] });
  await assert.rejects(() => plugin.resolve("m:1"), (e) => e.code === "not_found" && e.userMessage === "No se encontraron fuentes para este título.");
});

test("when the resolver is not installed, the person is told to install the playback engine (not a silent failure)", async () => {
  metaImpl = async () => ({ ids: { imdb: "tt0133093" } });
  serve("tt0133093", ALL);
  resolverPresent = false;
  await assert.rejects(() => plugin.resolve("m:603"), (e) => e.code === "unavailable" && /motor de reproducción/.test(e.userMessage || ""));
});

test("a gate host the resolver opens nothing for is captured in the hidden browser (the resolver being installed)", async () => {
  metaImpl = async () => ({ ids: { imdb: "tt0133093" } });
  serve("tt0133093", [["LAT", [["voe", VOE("voelat")]]]]);
  resolverImpl = () => ({ streams: [] }); // resolver installed, but no inline stream for this host
  globalThis.kino.browser = { capture: async () => ({ media: [{ url: "https://cdn.example/v/master.m3u8" }] }) };
  try {
    const a = await plugin.resolve("m:603");
    assert.equal(a.url, "https://cdn.example/v/master.m3u8");
    assert.equal(a.label, "Latino · Voe");
  } finally { delete globalThis.kino.browser; }
});

test("the screen is the install gate until the resolver is installed, then the rich browse screen", async () => {
  const gate = JSON.stringify(await plugin.screen({ device: "phone", installed: {} }));
  assert.match(gate, /Instalar Kino Resolver/);
  assert.match(gate, /installPlugin/);
  assert.match(gate, /"key":"donate"/);
  const browse = JSON.stringify(await plugin.screen({ device: "phone", installed: { "xuper-plugin/kino-plugin-kino-resolver": true } }));
  assert.match(browse, /[Ss]caffold/);
  assert.ok(!/Instalar Kino Resolver/.test(browse), "installed -> the browse screen, not the gate");
});

test("screenEvent drives the browse screen without throwing", async () => {
  tmdbImpl = async () => ({ results: [{ id: 1, title: "A", poster_path: "/a.jpg" }], page: 1, total_pages: 1 });
  await plugin.screenEvent({ event: "tab", arg: "inicio" }); // a tab change: must not throw
  await plugin.screenEvent({ event: "search", arg: "naruto" });
  assert.ok(true);
});

test("an episode asks /f/<imdb>-<s>x<ee> and its lazy refs name season and episode", async () => {
  serve("tt0903747-2x05", ALL);
  const a = await plugin.resolve("ep:tt0903747:2:5");
  assert.equal(calls[0].url, "https://embed69.org/f/tt0903747-2x05");
  assert.equal(a.alternatives[0].ref, "cp:ep:tt0903747:2:5:lat:streamwish");
  const lazy = await plugin.resolve("cp:ep:tt0903747:2:5:esp:streamwish");
  assert.equal(lazy.url, "https://cdn.example/swesp.m3u8");
});

test("nothing listed or an error page ends in not_found", async () => {
  metaImpl = async () => ({ ids: { imdb: "tt0133093" } });
  pages = { "https://embed69.org/f/tt0133093": { body: `{"error":"not found"}` } };
  await assert.rejects(() => plugin.resolve("m:603"), (e) => e.code === "not_found");
  pages = { "https://embed69.org/f/tt0133093": { status: 404, body: "" } };
  await assert.rejects(() => plugin.resolve("m:603"), (e) => e.code === "not_found");
  await assert.rejects(() => plugin.resolve("nonsense"), (e) => e.code === "not_found");
});

test("a title with no IMDB id is not asked", async () => {
  metaImpl = async () => null;
  await assert.rejects(() => plugin.resolve("m:99"), (e) => e.code === "not_found" && e.userMessage === "No se encontró información de este título.");
  assert.equal(calls.length, 0);
});

test("links that do not decrypt are left out, and so is the site's download button", async () => {
  metaImpl = async () => ({ ids: { imdb: "tt0133093" } });
  serve("tt0133093", [["LAT", [["download", "https://dl.example/file.mp4"], ["streamwish", SW("swlat")]]]]);
  const a = await plugin.resolve("m:603");
  assert.equal(a.label, "Latino · StreamWish");
  assert.equal(a.alternatives, undefined);
});

// ---- embed69's Anubis check page: the background solver gets past it ----

const ANUBIS = `<html><script id="anubis_challenge" type="application/json">{"rules":{"algorithm":"fast","difficulty":1},"challenge":{"randomData":"anubisdata","id":"anubis-id"}}</script><div id="anubis-main"></div></html>`;

test("when the site answers its Anubis check page, the background solver passes it and the copies open", async () => {
  metaImpl = async () => ({ ids: { imdb: "tt0111161" } });
  const real = sitePage(ALL);
  let passed = false;
  pages = {
    "https://embed69.org/f/tt0111161": () => ({ body: passed ? real : ANUBIS }),
    "https://embed69.org/*": (url) => { if (/pass-challenge/.test(url)) { passed = true; return { body: "" }; } return { body: passed ? real : ANUBIS }; },
  };
  const a = await plugin.resolve("m:604");
  assert.ok(calls.some((c) => /pass-challenge/.test(c.url)), "the solver posted the proof of work");
  assert.equal(a.url, "https://cdn.example/vhlat.m3u8");
  assert.equal(a.label, "Latino · VidHide");
});

test("Anubis the solver cannot pass ends in not_found instead of crashing", async () => {
  metaImpl = async () => ({ ids: { imdb: "tt0050083" } });
  pages = { "https://embed69.org/f/tt0050083": { body: ANUBIS }, "https://embed69.org/*": { body: ANUBIS } };
  await assert.rejects(() => plugin.resolve("m:606"), (e) => e.code === "not_found");
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

test("every genre tile has an https TMDB art URL; an unknown genre has none", async () => {
  const movie = [28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402];
  const tv = [10759, 16, 35, 80, 99, 18, 10751, 9648];
  tmdbImpl = async (path) => ({ genres: (path === "/genre/movie/list" ? movie : tv).map((id) => ({ id, name: "G" + id })) });
  const cats = await plugin.categories();
  assert.equal(cats.length, 20);
  for (const c of cats) assert.match(c.art, /^https:\/\/image\.tmdb\.org\/t\/p\/w780\/[A-Za-z0-9]+\.jpg$/, c.id);
  tmdbImpl = async () => ({ genres: [{ id: 999999, name: "Nuevo" }] });
  const odd = await plugin.categories();
  assert.equal(odd[0].art, undefined);
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

test("every title carries its genres, so the Home can file it in a row per genre", async () => {
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
