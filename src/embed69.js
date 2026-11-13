// Embed69: https://embed69.org/f/<imdb>[-<s>x<ee>] lists, per language, hosts whose links are AES-256-CBC encrypted; the key
// comes from a small proof of work whose challenge, difficulty and salt sit in the page.
import { extractorFor } from "./extractors/index.js";
import { normLang } from "./util/lang.js";

export const SITE = "https://embed69.org";
const HEADERS = { Referer: "https://sololatino.net/" }; // the site only answers requests that come from its partner

// Hashes are synchronous and cannot be interrupted: past this many the page is not worth a TV's time.
const POW_CAP = 100000;
const MAX_DIFFICULTY = 4;

/**
 * Smallest n such that sha256(challenge + n) (hex) starts with `difficulty` zeros; null past `cap`. Synchronous and
 * allocation-light: a difficulty of 3 takes a few thousand hashes.
 */
export function solvePow(kino, challenge, difficulty, cap = POW_CAP) {
  const zeros = "0".repeat(difficulty);
  for (let n = 0; n <= cap; n++) if (kino.crypto.hash("sha256", challenge + n).startsWith(zeros)) return n;
  return null;
}

/** A link is base64 of 16 IV bytes followed by the AES-256-CBC ciphertext; returns the plain text. */
export function decryptLink(kino, keyHex, b64) {
  const raw = atob(b64);
  let ivHex = "";
  for (let i = 0; i < 16; i++) ivHex += raw.charCodeAt(i).toString(16).padStart(2, "0");
  return kino.crypto.decrypt("aes-256-cbc", { key: keyHex, keyEncoding: "hex", iv: ivHex, ivEncoding: "hex", data: btoa(raw.slice(16)) });
}

const quoted = (html, name) => { const m = new RegExp(name + "\\s*=\\s*'([^']*)'").exec(html); return m ? m[1] : null; };

/** The site's page path for a title: `<imdb>` or `<imdb>-<season>x<ee>`; null when it cannot be asked. */
export function pathFor(title) {
  if (!title || !/^tt\d{5,12}$/.test(String(title.imdbId || ""))) return null;
  if (title.kind !== "tv") return title.imdbId;
  const s = Number(title.season), e = Number(title.episode);
  if (title.season == null || title.episode == null || !Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e < 1) return null;
  return `${title.imdbId}-${s}x${String(e).padStart(2, "0")}`;
}

const PAGE_MIN_MS = 4000;   // less than this left: a hidden-browser read cannot finish
const PAGE_MAX_MS = 22000;  // Anubis' check takes a few seconds on a phone; kino.browser.page allows up to 25 s
const PAGE_TTL_MS = 10 * 60 * 1000;
const pageCache = new Map(); // url -> { at, html }: each hidden read opens a fresh page, so a title's lazy copies reuse the first

const isCheckPage = (html) => /anubis_challenge|anubis-main/i.test(html);

/**
 * The site's page for a title as HTML, or null. Tries a plain request first; when the site answers its Anubis check page (it
 * wants a browser's script to run) the hidden browser (`kino.browser.page`, manifest `"browser": "pages"`) loads it, waits for
 * the real page (the one with the proof of work) and returns that. Without a browser, or when it is blocked, null: no copies.
 */
async function readPage(url, { kino, req }) {
  const hit = pageCache.get(url);
  if (hit && Date.now() - hit.at < PAGE_TTL_MS) return hit.html;
  let r = null;
  try { r = await req(url, { headers: HEADERS }); } catch (_) { /* a failed plain request still has the browser */ }
  let html = r && r.ok ? r.text() : null;
  if (html && !isCheckPage(html)) return html; // the plain request is cheap: only the hidden-browser read is cached
  if (!(kino.browser && typeof kino.browser.page === "function")) return null;
  const ms = Math.min(PAGE_MAX_MS, req.left() - 2500);
  if (ms < PAGE_MIN_MS) return null;
  try {
    const p = await kino.browser.page(url, { waitFor: "POW_CHALLENGE", timeoutMs: ms });
    html = p && typeof p.html === "string" ? p.html : null;
  } catch (e) {
    if (kino.log) kino.log("embed69: browser.page " + (e && e.code ? e.code : "failed") + " for " + url);
    return null;
  }
  if (!html || isCheckPage(html) && !/POW_CHALLENGE/.test(html)) return null;
  pageCache.set(url, { at: Date.now(), html });
  return html;
}

/**
 * The copies of a title that this plugin can open: `{ lang: "lat"|"esp"|"sub", server, embedUrl }` for every link on a host an
 * extractor knows. Empty when the site has nothing, answers an error, or its page is not the shape this reads.
 */
export async function listCopies(title, { kino, req }) {
  const path = pathFor(title);
  if (!path) return [];
  const html = await readPage(`${SITE}/f/${path}`, { kino, req });
  if (!html) return [];
  const data = /let\s+dataLink\s*=\s*(\[.+\]);/.exec(html);
  const challenge = quoted(html, "POW_CHALLENGE"), salt = quoted(html, "POW_SALT");
  const difficulty = Number((/POW_DIFFICULTY\s*=\s*(\d+)/.exec(html) || [])[1]);
  if (!data || !challenge || salt == null || !Number.isInteger(difficulty)) return [];
  let langs;
  try { langs = JSON.parse(data[1]); } catch (_) { return []; }
  if (difficulty > MAX_DIFFICULTY) return []; // a TV must never spin hundreds of thousands of synchronous hashes
  const n = solvePow(kino, challenge, difficulty);
  if (n == null) return [];
  const keyHex = kino.crypto.hash("sha256", challenge + n + salt);
  const out = [];
  for (const l of langs) {
    const lang = normLang(l && l.video_language);
    if (!lang) continue;
    for (const e of (l && l.sortedEmbeds) || []) {
      if (!e || e.servername === "download" || typeof e.link !== "string") continue;
      let url;
      try { url = decryptLink(kino, keyHex, e.link); } catch (_) { continue; } // a link that does not decrypt is skipped
      const known = /^https?:\/\//i.test(url) ? extractorFor(url) : null;
      if (known && !out.some((c) => c.embedUrl === url)) out.push({ lang, server: known.name, embedUrl: url });
    }
  }
  return out;
}
