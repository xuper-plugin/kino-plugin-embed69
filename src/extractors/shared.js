import { unpack } from "../util/unpack.js";

export const HLS_MIME = "application/vnd.apple.mpegurl";

/** `file:"<url>"` whose url is an m3u8 (the page also holds subtitle/poster `file:` values). */
export function fileM3u8(text, base) {
  const m = /\bfile\s*:\s*["']([^"']+\.m3u8[^"']*)["']/.exec(text || "");
  return m ? absolute(m[1], base) : null;
}

/** First of `"hlsN":"<url>"` for the given keys, in order. */
export function hlsKey(text, keys, base) {
  for (const k of keys) {
    const m = new RegExp(`["']${k}["']\\s*:\\s*["']([^"']+)["']`).exec(text || "");
    if (m) return absolute(m[1].replace(/\\\//g, "/"), base);
  }
  return null;
}

export function absolute(href, base) {
  try { return new URL(href, base).href; } catch (_) { return null; }
}

/** Runs `pick` on the page text, then on its unpacked player script. */
export function findIn(html, pick) {
  return pick(html) || pick(unpack(html) || "") || null;
}

/** Logs why an extractor found no stream (when it has a kino) and returns null. */
export function miss(kino, server, reason) {
  if (kino && typeof kino.log === "function") kino.log("[embed69]", server, reason);
  return null;
}

/**
 * What an extractor answers when the host says the file is gone (deleted or expired): not a failure to retry or wait for, so
 * the caller can skip the rest of that language and say why when nothing else is left. Never a stream: it has no `url`.
 */
export const GONE = Object.freeze({ gone: true });

/** The text a host's player page shows for a file it no longer has ("File is no longer available as it expired or has been deleted"). */
const GONE_TEXT = /no longer available|has been deleted|expired or has been deleted|file (was )?not found|video (was )?not found/i;

/** Whether this embed page is the host's "gone" page: its visible text (scripts and styles left out) says so. */
export function isGone(html) {
  const visible = String(html || "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  return GONE_TEXT.test(visible);
}

/** Fetches the embed page; GONE when the host answers 404 or 410, null (the status logged) for any other error. */
export async function pageText(req, url, headers, kino, server) {
  const r = await req(url, { headers });
  if (r.status === 404 || r.status === 410) { miss(kino, server || "embed", "gone, status " + r.status); return GONE; }
  return r.ok ? r.text() : miss(kino, server || "embed", "status " + r.status);
}

// Caption-track labels as JW Player pages write them, to the ISO 639-1 code Kino needs.
const LANG_CODES = [
  [/^(español|espanol|spanish|castellano|latino|spa|esp?)\b/i, "es"],
  [/^(english|inglés|ingles|eng?)\b/i, "en"],
  [/^(portugu[eê]s|portuguese|pt)\b/i, "pt"], // never a bare "por": "Por defecto" is not Portuguese
  [/^(fran[cç]ais|french|franc[eé]s|fre|fra|fr)\b/i, "fr"],
  [/^(italiano|italian|ita|it)\b/i, "it"],
  [/^(deutsch|german|alem[aá]n|ger|deu|de)\b/i, "de"],
];

/** The ISO code for a caption label ("Spanish" -> "es"), or null when it cannot be told. */
export function langCode(label) {
  const s = String(label || "").trim();
  for (const [re, code] of LANG_CODES) if (re.test(s)) return code;
  return null;
}

/** Caption tracks of a JW `tracks: [...]` list; thumbnails and unlabelled or unmappable tracks are left out. */
export function captionTracks(text, base) {
  const m = /["']?\btracks["']?\s*:\s*\[([\s\S]*?)\]/.exec(text || "");
  if (!m) return [];
  const out = [];
  for (const [obj] of m[1].matchAll(/\{[^{}]*\}/g)) {
    const field = (k) => (new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"']*)["']`).exec(obj) || [])[1] || "";
    const kind = field("kind").toLowerCase();
    if (kind && kind !== "captions" && kind !== "subtitles") continue;
    const file = field("file");
    const format = (/\.(vtt|srt)(?:[?#]|$)/i.exec(file) || [])[1];
    const label = field("label");
    const lang = langCode(label);
    const url = format && lang ? absolute(file, base) : null;
    if (!url || out.some((t) => t.url === url)) continue;
    out.push({ lang, url, label, format: format.toLowerCase() });
  }
  return out;
}

/**
 * JW `duration: "3849.88"` (seconds) in ms, or null. CSS (`transition-duration: 0.3s`), values with a
 * unit and anything under a minute (an animation, not a video) are not a duration.
 */
export function durationMsOf(text) {
  const re = /(?<![-\w])duration["']?\s*:\s*["']?(\d+(?:\.\d+)?)(?![\d.])(?!\s*m?s\b)/g;
  for (const m of String(text || "").matchAll(re)) {
    const ms = Math.round(Number(m[1]) * 1000);
    if (ms >= 60000) return ms;
  }
  return null;
}

/** `{ subtitles?, durationMs? }` the player page reveals, from the page or its unpacked script; only keys it found. */
export function pageExtras(html, base) {
  const unpacked = unpack(html) || "";
  const subs = captionTracks(html, base);
  const subtitles = subs.length ? subs : captionTracks(unpacked, base);
  const durationMs = durationMsOf(html) || durationMsOf(unpacked);
  return { ...(subtitles.length ? { subtitles } : {}), ...(durationMs ? { durationMs } : {}) };
}
