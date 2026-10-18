import { HLS_MIME, GONE } from "./shared.js";

export const HOSTS = ["voe.sx"];
const JUNK = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];
const rot13 = (s) => s.replace(/[a-z]/gi, (c) => { const b = c <= "Z" ? 65 : 97; return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b); });

/** The player page's payload: ROT13, junk tokens out, base64, shift -3, reverse, base64, JSON. */
export function decodeVoe(enc) {
  let s = rot13(enc);
  for (const j of JUNK) s = s.split(j).join("");
  s = atob(s);
  s = [...s].map((c) => String.fromCharCode(c.charCodeAt(0) - 3)).join("");
  s = [...s].reverse().join("");
  // atob yields one char per byte; re-read those bytes as UTF-8.
  return JSON.parse(decodeURIComponent(escape(atob(s))));
}

const redirectOf = (html) => (/window\.location\.href\s*=\s*'([^']+)'/.exec(html) || [])[1] || null;

/** Whether this Kino can capture with the hidden browser (approved `browser`, Kino 0.9.54's capture). */
export const canCapture = (kino) => !!(kino && kino.browser && kino.browser.captureAll === true && typeof kino.browser.capture === "function");

const CAPTURE_MS = 12000;
const MIN_CAPTURE_MS = 3000; // less than this left: a capture cannot finish, so it is not started

/**
 * The embed played in the hidden browser: the page loads from voe.sx (declared) and follows its rotating domain itself, and
 * answers like a real browser to the "confirm you are human" page a plain request gets. Null when there is no time or no video.
 */
async function capture(embedUrl, req, kino) {
  const ms = Math.min(CAPTURE_MS, (req.left ? req.left() : CAPTURE_MS) - 300);
  if (ms < MIN_CAPTURE_MS) { kino.log("[embed69]", "voe", "no time to capture"); return null; }
  let cap;
  try {
    cap = await kino.browser.capture(embedUrl, { match: "\\.m3u8|\\.mp4", timeoutMs: ms });
  } catch (e) {
    kino.log("[embed69]", "voe capture", (e && e.code) || "error");
    return null;
  }
  const m = cap && Array.isArray(cap.media) ? cap.media.find((x) => x && typeof x.url === "string" && /^https?:\/\//i.test(x.url)) : null;
  if (!m) { kino.log("[embed69]", "voe capture", "no media"); return null; }
  const mime = m.mime || (/\.mp4(?:[?#]|$)/i.test(m.url) ? "video/mp4" : HLS_MIME);
  return { url: m.url, mime, headers: { Referer: embedUrl, ...(m.headers || {}) } };
}

/**
 * voe.sx redirects to a rotating domain the manifest cannot list, so the page is only reachable through the hidden browser;
 * without one this copy cannot open.
 */
export async function extract(embedUrl, req, kino) {
  const log = (...a) => { if (kino) kino.log("[embed69]", "voe", ...a); };
  const first = await req(embedUrl, { headers: { Referer: embedUrl } });
  if (first.status === 404 || first.status === 410) { log("gone, embed", first.status); return GONE; }
  if (!first.ok) { log("embed", first.status); return null; }
  const html = first.text();
  if (redirectOf(html)) {
    if (canCapture(kino)) return capture(embedUrl, req, kino);
    log("rotating host, no browser");
    return null;
  }
  const j = /<script type="application\/json">\s*\["([^"]+)"\]/.exec(html);
  if (j) {
    try {
      const d = decodeVoe(j[1]);
      const url = d.source || d.direct_access_url;
      if (url) return { url, mime: /\.mp4/.test(url) ? "video/mp4" : HLS_MIME, headers: { Referer: embedUrl } };
    } catch (_) { /* fall back to the plain markers below */ }
  }
  const h = /'hls'\s*:\s*'([^']+)'/.exec(html) || /(https?:\/\/[^"'\s]+\.mp4[^"'\s]*)/.exec(html);
  if (!h) { log("no stream in page"); return null; }
  return { url: h[1], headers: { Referer: embedUrl } };
}
