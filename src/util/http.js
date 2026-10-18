export const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** The longest one request may take; the player's embeds answer in a second or two, or not at all. */
const REQUEST_MS = 8000;
/** Less than this left: a request cannot finish, so it is not sent. */
const MIN_MS = 1500;

/**
 * A requester for one resolve: `req(url, { headers, method, body })` is `kino.fetch` with a deadline spread over its requests;
 * `req.left()` is the time left in ms (voe uses it to size its hidden-browser capture).
 */
export function makeReq(kino, { deadline }) {
  const req = async (url, opts = {}) => {
    const left = deadline - Date.now();
    if (left < MIN_MS) throw kino.error("timeout", "no time left for " + new URL(url).hostname);
    // Without a browser's User-Agent the app sends okhttp's, and the players answer a page with no playlist in it (measured on StreamWish)
    return kino.fetch(url, { headers: { "User-Agent": UA, ...(opts.headers || {}) }, method: opts.method, body: opts.body, timeoutMs: Math.min(REQUEST_MS, left) });
  };
  req.left = () => Math.max(0, deadline - Date.now());
  return req;
}
