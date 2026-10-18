import * as streamwish from "./streamwish.js";
import * as vidhide from "./vidhide.js";
import * as voe from "./voe.js";
const TABLE = { streamwish, vidhide, voe };

/** `{ name, extract(embedUrl, req, kino) }` for an embed's host, or null when no extractor knows it. */
export function extractorFor(embedUrl) {
  let host;
  try { host = new URL(embedUrl).hostname.replace(/^www\./, ""); } catch (_) { return null; }
  for (const [name, mod] of Object.entries(TABLE)) {
    if (mod.HOSTS.some((h) => host === h || host.endsWith("." + h))) return { name, extract: mod.extract };
  }
  return null;
}
export const HOSTS = Object.values(TABLE).flatMap((m) => m.HOSTS);
