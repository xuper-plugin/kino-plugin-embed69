import { UA } from "../util/http.js";
import { miss, fileM3u8, hlsKey, findIn, pageText, pageExtras, HLS_MIME } from "./shared.js";

export const HOSTS = ["hlswish.com", "streamwish.com", "streamwish.to", "strwish.com", "wishembed.com", "filelions.com", "hglink.to", "vibuxer.com"];

export async function extract(embedUrl, req, kino) {
  const u = new URL(embedUrl);
  if (u.hostname === "hglink.to") u.hostname = "vibuxer.com";
  const referer = u.origin + "/";
  const html = await pageText(req, u.href, { Referer: referer }, kino, "streamwish");
  if (html == null) return null;
  const url = findIn(html, (t) => hlsKey(t, ["hls4", "hls2", "hls3"], u.origin) || fileM3u8(t, u.origin));
  if (!url) return miss(kino, "streamwish", "no playlist in page");
  return { url, mime: HLS_MIME, headers: { "User-Agent": UA, Referer: referer }, ...pageExtras(html, u.origin) };
}
