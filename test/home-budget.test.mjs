// A Home whose slow TMDB rows never come back is cut at the budget and shows what loaded.
import test from "node:test";
import assert from "node:assert/strict";

let clock = 0;
let tmdbImpl = async () => ({ results: [] });
globalThis.kino = {
  lang: "es",
  config: { get: () => undefined },
  storage: { get: () => null, set() {}, keys: () => [], remove() {} },
  tmdb: (p, q) => tmdbImpl(p, q),
  sleep: async () => { clock += 1; await new Promise((r) => setImmediate(r)); }, // a tick per wait
  log() {}, meta: async () => null, rank: {},
  error: (code, message, opts = {}) => Object.assign(new Error(message), { code, ...opts }),
};
const realNow = Date.now;
const plugin = await import("../src/plugin.js");
const results = Array.from({ length: 5 }, (_, i) => ({ id: 1 + i, title: "T" + i, name: "T" + i, release_date: "2024-01-01", poster_path: "/p.jpg" }));

test("the plugin asks Kino to drop the requests a call leaves running", () => {
  assert.equal(globalThis.__kinoDropPendingFetches, true);
});

test("a row that never answers is left off and the others are shown at the budget", async () => {
  clock = 0;
  Date.now = () => 1e12 + clock;
  tmdbImpl = async (path) => (path.startsWith("/tv/") ? new Promise(() => {}) : { results });
  try {
    const rows = await plugin.home();
    assert.ok(rows.length >= 5 && rows.length < 15, "rows: " + rows.length);
    assert.ok(clock <= 15000, "gave up at the budget, clock " + clock);
  } finally { Date.now = realNow; }
});

test("when nothing loads in time the Home says it is unavailable", async () => {
  clock = 0;
  Date.now = () => 1e12 + clock;
  tmdbImpl = () => new Promise(() => {});
  try {
    await assert.rejects(() => plugin.home(), (e) => e.code === "unavailable");
  } finally { Date.now = realNow; }
});
