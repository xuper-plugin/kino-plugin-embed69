// What the browse screen shows, from the section pages the catalog already builds (catalog.js sectionPage): the featured
// slides, the rails of a tab and the cards. Pure functions; index.js keeps the results and view.js draws them.

export const MAX_SLIDES = 5;
export const MAX_RAILS = 8;
export const MAX_RAIL_ITEMS = 20;
const MAX_SLIDE_TEXT = 160;
const HTTPS = /^https:\/\//;

/** The card Kino draws: the fields a rail needs and nothing else (the tree and the stored copy stay small). */
export function cardOf(item) {
  const out = { id: item.id, ref: item.ref, title: item.title, kind: item.kind };
  if (item.poster && HTTPS.test(item.poster)) out.poster = item.poster;
  if (item.backdrop && HTTPS.test(item.backdrop)) out.backdrop = item.backdrop;
  if (item.badges) out.badges = item.badges;
  if (item.rating !== undefined) out.rating = item.rating;
  if (item.year !== undefined) out.year = item.year;
  if (item.ids && item.ids.tmdb) out.ids = { tmdb: item.ids.tmdb };
  if (item.lang) out.lang = item.lang;
  if (item.adult === true) out.adult = true; // Kino shows it only while the 18+ code is unlocked
  return out;
}

/**
 * Up to MAX_SLIDES featured titles: the first items, in row order, that have a backdrop, one per title (every plugin has a hero:
 * the synopsis is shown when the item has one, and is not required).
 * The synopsis is kept on the slide only (a card carries none).
 */
export function slidesOf(rows) {
  const byBackdrop = pickSlides(rows, (item) => item.backdrop);
  // A source with no backdrops at all still gets its hero, from the posters.
  return byBackdrop.length > 0 ? byBackdrop : pickSlides(rows, (item) => item.poster);
}

function pickSlides(rows, pictureOf) {
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    for (const item of row.items || []) {
      if (out.length >= MAX_SLIDES) return out;
      const image = pictureOf(item);
      if (item.adult === true || seen.has(item.id) || !image || !HTTPS.test(image)) continue;
      const text = typeof item.overview === "string" ? item.overview.trim() : "";
      seen.add(item.id);
      out.push({
        id: item.id, ref: item.ref, kind: item.kind, title: item.title, image,
        text: text === "" ? [item.year, item.rating ? "★ " + item.rating : null].filter(Boolean).join(" · ")
          : text.length <= MAX_SLIDE_TEXT ? text : `${text.slice(0, MAX_SLIDE_TEXT - 1).trimEnd()}…`,
      });
    }
  }
  return out;
}

/** The tab's rails: its rows trimmed to what a screen draws. */
export function railsOf(rows) {
  return rows.filter((r) => r.items && r.items.length > 0).slice(0, MAX_RAILS).map((r) => ({
    id: r.id, title: r.title, ...(r.ref ? { ref: r.ref } : {}), items: r.items.slice(0, MAX_RAIL_ITEMS).map(cardOf),
  }));
}

/** One tab as the screen draws it, from a section page (`{ rows }`); null when it has no row. */
export function tabOf(page) {
  const rows = page && Array.isArray(page.rows) ? page.rows : [];
  const rails = railsOf(rows);
  if (rails.length === 0) return null;
  return { slides: slidesOf(rows), rails };
}

/** The key a played ref is remembered under: a TMDB title (a movie, a series or one of its episodes) by its id, else the ref. */
export function playedKey(ref) {
  const m = /^(?:m|s|e):(\d{1,10})(?::|$)/.exec(String(ref || ""));
  return m ? `t:${m[1]}` : String(ref || "");
}

/** The titles played, newest first, found in [tabs] (the loaded tab data) by ref or TMDB id; a title not on screen is not shown. */
export function recentOf(keys, tabs) {
  if (keys.length === 0) return [];
  const byKey = new Map();
  for (const data of tabs) {
    for (const rail of data.rails) {
      for (const card of rail.items) {
        const ks = [card.ref];
        if (card.ids && card.ids.tmdb) ks.push(`t:${card.ids.tmdb}`);
        for (const k of ks) if (!byKey.has(k)) byKey.set(k, card);
      }
    }
  }
  const out = [];
  const used = new Set();
  for (const key of keys) {
    const card = byKey.get(key);
    if (card && !used.has(card.id)) { used.add(card.id); out.push(card); }
  }
  return out;
}
