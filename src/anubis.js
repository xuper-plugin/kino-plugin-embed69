// Anubis (techaro.lol / within.website) is a proof-of-work anti-bot proxy that embed69.org deployed in 2026-11:
// a request to a gated page gets a "Making sure you're not a bot!" challenge page instead of the content. The
// page carries the challenge in a `<script id="anubis_challenge">` JSON block; a browser runs the site's JS to
// solve a small SHA-256 proof of work, posts the answer to `/.within.website/x/cmd/anubis/api/pass-challenge`,
// and is handed an auth cookie that unlocks the real page. This does the same in the background with `kino.crypto`,
// so `kino.fetch` (no browser) can read the page. Kino keeps the cookies between requests, so only the first gated
// request of a session pays the proof of work; the rest ride the cookie.

const API = "/.within.website/x/cmd/anubis/api/pass-challenge";

/** The Anubis challenge of a page — `{ data, id, difficulty }` — or null when the page is not an Anubis challenge. */
export function anubisChallenge(html) {
  const m = /<script id="anubis_challenge"[^>]*>([\s\S]*?)<\/script>/.exec(String(html || ""));
  if (!m) return null;
  let j;
  try { j = JSON.parse(m[1]); } catch (_) { return null; }
  const c = j && j.challenge, r = j && j.rules;
  if (!c || typeof c.randomData !== "string" || typeof c.id !== "string" || !r) return null;
  const difficulty = Number(r.difficulty);
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 6) return null;
  return { data: c.randomData, id: c.id, difficulty };
}

/** The smallest nonce whose SHA-256(data + nonce) (hex) begins with `difficulty` zeros, with that hash; null past the cap. */
export function solveAnubis(kino, data, difficulty) {
  const zeros = "0".repeat(difficulty);
  for (let nonce = 0; nonce < 20000000; nonce++) {
    const hash = kino.crypto.hash("sha256", data + nonce);
    if (hash.startsWith(zeros)) return { hash, nonce };
  }
  return null;
}

/**
 * Fetch `url` and, when it answers an Anubis challenge, solve the proof of work and fetch it again through the gate;
 * returns the final page's HTML, or null when the request failed. `req(url, opts)` is the plugin's requester (its
 * cookies are kept by Kino between calls, which is what carries the verification + auth cookies through the gate).
 */
export async function getThroughAnubis(kino, req, url, opts) {
  const started = Date.now();
  let r = await req(url, opts);
  if (!r.ok) return null;
  let html = await r.text();
  const ch = anubisChallenge(html);
  if (!ch) return html; // not gated
  const sol = solveAnubis(kino, ch.data, ch.difficulty);
  if (!sol) return html; // could not solve: serversOf gets the challenge page and returns []
  const origin = new URL(url).origin;
  const elapsed = Math.max(1000, Date.now() - started);
  const pass = `${origin}${API}?id=${encodeURIComponent(ch.id)}&response=${sol.hash}&nonce=${sol.nonce}&redir=${encodeURIComponent(url)}&elapsedTime=${elapsed}`;
  try { const rp = await req(pass, opts); if (rp && typeof rp.text === "function") await rp.text(); } catch (_) { /* the cookie may still have been set */ }
  const r2 = await req(url, opts);
  if (!r2 || !r2.ok) return html;
  return r2.text();
}
