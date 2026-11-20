// Embed69: https://embed69.org/f/<imdb>[-<s>x<ee>] lists, per language, hosts whose links are AES-256-CBC encrypted; the key is
// SHA-256(LINK_CHALLENGE + LINK_SALT), both quoted in the page, and each decrypted link is wrapped in backticks (until 2026-11 it
// was a proof of work). The site also sits behind Anubis (a proof-of-work anti-bot); getThroughAnubis solves that in the background.
import { getThroughAnubis } from "./anubis.js";
import { normLang } from "./util/lang.js";

export const SITE = "https://embed69.org";
const HEADERS = { Referer: "https://sololatino.net/" }; // the site only answers requests that come from its partner

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

/**
 * The copies of a title: `{ lang: "lat"|"esp"|"sub", server, embedUrl }` for every host embed69 lists (the shared kino-resolver
 * opens each embedUrl; the hidden browser is the fallback). Empty when the site has nothing, answers an error, or its page is not
 * the shape this reads. embed69 sits behind Anubis — getThroughAnubis solves the proof of work so a plain fetch reads the page.
 */
export async function listCopies(title, { kino, req }) {
  const path = pathFor(title);
  if (!path) return [];
  const html = await getThroughAnubis(kino, req, `${SITE}/f/${path}`, { headers: HEADERS });
  if (!html) return [];
  const data = /let\s+dataLink\s*=\s*(\[.+\]);/.exec(html);
  const challenge = quoted(html, "LINK_CHALLENGE"), salt = quoted(html, "LINK_SALT");
  if (!data || !challenge || salt == null) return [];
  let langs;
  try { langs = JSON.parse(data[1]); } catch (_) { return []; }
  const keyHex = kino.crypto.hash("sha256", challenge + salt);
  const out = [];
  for (const l of langs) {
    const lang = normLang(l && l.video_language);
    if (!lang) continue;
    for (const e of (l && l.sortedEmbeds) || []) {
      if (!e || e.servername === "download" || typeof e.link !== "string") continue;
      let url;
      try { url = decryptLink(kino, keyHex, e.link).replace(/`/g, "").trim(); } catch (_) { continue; } // a link that does not decrypt is skipped
      if (/^https?:\/\//i.test(url) && !out.some((c) => c.embedUrl === url)) out.push({ lang, server: String(e.servername || ""), embedUrl: url });
    }
  }
  return out;
}
