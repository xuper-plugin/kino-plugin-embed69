// The browse screen's trees: a pure view of what index.js holds. A tab that is not in yet draws skeletons shaped like what
// will replace them, so nothing jumps when the rows arrive. Every text is in both languages.
import { both } from "../i18n.js";
import { TAB_IDS } from "./model.js";
import { detailView, cardRow } from "./detail.js";

const TAB_KEYS = { inicio: "tabHome", peliculas: "tabMovies", series: "tabSeries" };
const POLL_MS = 1_500;

/** `key` in both languages as a node's twin texts: `{ [field]: Spanish, [field + "En"]: English }`. */
export const twin = (key, field = "text", vars) => {
  const w = both(key, vars);
  return { [field]: w.es, [field + "En"]: w.en };
};

const logo = () => ({ type: "Text", key: "logo", text: "Embed69", textEn: "Embed69", style: "h4" });
const tabBar = (active) => ({ type: "TabBar", key: "tabs", divider: false, value: active, onChanged: "tab", tabs: TAB_IDS.map((id) => ({ value: id, ...twin(TAB_KEYS[id], "label") })) });

/** The skeleton of one rail: a heading bar and a row of poster cards (three on a phone, six on a wide window). */
const railSkeleton = (n) => ({
  type: "Column", key: "skel" + n, gap: 8, children: [
    { type: "Skeleton", shape: "line", width: 120 },
    { type: "Row", gap: 12, sizes: ["compact"], children: [1, 2, 3].map((i) => ({ type: "Skeleton", shape: "card", key: `sk${n}c${i}`, flex: 1 })) },
    { type: "Row", gap: 12, sizes: ["medium", "expanded"], children: [1, 2, 3, 4, 5, 6].map((i) => ({ type: "Skeleton", shape: "card", key: `sk${n}w${i}`, flex: 1 })) },
  ],
});

const heroSkeleton = () => ({ type: "Skeleton", key: "heroSkeleton", shape: "block", height: { compact: 200, expanded: 320 } });

const slideNode = (s) => ({
  type: "heroCard", key: "slide-" + s.id, h: { compact: 200, expanded: 240 }, ...(s.logo ? { logo: s.logo } : {}), title: s.title, text: s.text, image: s.image,
  buttons: [
    { type: "ElevatedButton", key: "watch-" + s.id, ...twin("brWatch", "labelText"), icon: "play",
      onPressed: { go: { play: { ref: s.ref, kind: s.kind, id: s.id, title: s.title } } } },
    { type: "TextButton", key: "info-" + s.id, ...twin("brInfo", "labelText"),
      onPressed: { go: { title: { ref: s.ref, kind: s.kind, id: s.id, title: s.title } } } },
  ],
});

// The key carries the number of slides: Kino's pager (0.9.81) keeps the count of its first drawing, and a slider that goes from one
// number of slides to another closed the app with "Index 4 out of bounds for length 4". A new key is a new pager.
const hero = (slides) => (slides.length === 1 ? slideNode(slides[0]) : {
  type: "PageView", key: "hero" + slides.length, autoPlayMs: 6_000, children: slides.map(slideNode),
});

const rail = (r, key, titleOverride) => ({
  type: "Column", key, gap: 8, children: [
    { type: "Row", key: key + "-h", crossAxisAlignment: "center", children: [
      { type: "Text", style: "h4", flex: 1, text: titleOverride ? titleOverride.title : r.title, textEn: titleOverride ? titleOverride.titleEn : r.title },
      ...(r.ref ? [{ type: "TextButton", key: key + "-more", ...twin("brMore", "labelText"), onPressed: { go: { browse: { ref: r.ref, title: r.title } } } }] : []),
    ] },
    cardRow(r.items, key, "medium"),
  ],
});

/**
 * `data`: `{ slides, rails }` of the active tab, or null while it is not in. `recent`: the cards of the played titles.
 * `pending`: some tab is still being fetched (the timer polls only then). `failed`: the active tab could not load.
 */
export function browseView({ tab, data, recent, pending, failed, searching = false, device = "phone" }) {
  const tv = device === "tv";
  const gear = { type: "IconButton", key: "settingsButton", icon: "settings", ...twin("brSettings", "labelText"), ...twin("brSettings", "tooltip"), onPressed: { event: "go", arg: "settings" } };
  const active = TAB_IDS.includes(tab) ? tab : TAB_IDS[0];
  const body = [];
  if (data) {
    if (data.slides.length > 0) body.push(hero(data.slides));
    if (recent.length > 0) body.push(rail({ items: recent }, "recent", twin("brRecent", "title")));
    for (const r of data.rails) body.push(rail(r, "rail-" + String(r.id).replace(/[^A-Za-z0-9_-]/g, "_")));
    if (data.rails.length === 0) body.push({ type: "Text", ...twin("brEmpty", "text"), color: "muted" });
  } else if (failed) {
    body.push({ type: "MaterialBanner", key: "loadFailed", role: "error", ...twin("brFailed"),
      action: { ...twin("brRetry", "label"), onTap: "retry" } });
  } else {
    body.push(heroSkeleton(), railSkeleton(1), railSkeleton(2), railSkeleton(3));
  }
  const isBanner = (n) => !!n && (n.type === "heroCard" || n.key === "heroSkeleton" || (n.type === "PageView" && String(n.key).startsWith("hero")));
  const banner = body.length > 0 && isBanner(body[0]) ? body.shift() : null; // the main picture goes edge to edge, right under the bar
  // The bar is either the normal one (logo, and the tabs beside it on a TV) or, once the search button is pressed, a box in the bar
  // whose words go to Kino's own search of this plugin; the back button where Close was closes the box and brings the bar back.
  const appBar = searching
    ? {
        type: "AppBar", mergeWithKinoBar: true, dense: true, divider: false,
        leading: { type: "IconButton", key: "searchBack", icon: "arrow_back", ...twin("brBack", "labelText"), ...twin("brBack", "tooltip"), onPressed: "closeSearch" },
        title: { type: "TextField", key: "q", kind: "search", autofocus: true, ...twin("brSearchHint", "hintText"), maxLength: 100, onSubmitted: "search", trailingIcon: "search", ...twin("brSearch", "trailingLabel"), onTrailingTap: "search" },
      }
    : {
        type: "AppBar", mergeWithKinoBar: true, dense: true, divider: false,
        leading: { type: "IconButton", key: "close", icon: "close", ...twin("brClose", "labelText"), ...twin("brClose", "tooltip"), onPressed: { go: { close: true } } },
        // On a TV the search is a button of the bar (a floating one is hard to reach with a remote); elsewhere it floats.
        actions: tv ? [{ type: "IconButton", key: "searchButton", icon: "search", ...twin("brSearch", "labelText"), ...twin("brSearch", "tooltip"), onPressed: "openSearch" }, gear] : [gear],
        // On a TV the tabs sit in the bar beside the logo (one row, one D-pad strip); elsewhere they are pinned under it.
        title: tv ? { type: "Row", key: "titleRow", gap: 24, crossAxisAlignment: "center", children: [logo(), tabBar(active)] } : logo(),
      };
  return {
    type: "Scaffold",
    appBar,
    ...(tv || searching ? {} : { floatingActionButton: { type: "FloatingActionButton", key: "searchFab", icon: "search", ...twin("brSearch", "tooltip"), onPressed: "openSearch" } }),
    // The tabs stay pinned under the bar; only the rows scroll.
    body: { type: "Column", key: "page", children: [
      // The tabs line up with the bar's buttons and the cards below (a wide window and the TV pad their content by 24).
      ...(tv ? [] : [{ type: "Column", key: "tabsRow", padding: { compact: 0, expanded: 24 }, children: [tabBar(active)] }]),
      { type: "SingleChildScrollView", key: "browse-" + active, flex: 1, children: [...(banner ? [banner] : []), { type: "Column", padding: { compact: 12, expanded: 24 }, gap: 16, children: body }] },
    ] },
    ...(pending ? { every: { ms: POLL_MS, event: "tick" } } : {}),
  };
}

/**
 * The settings page (route "settings"): the same one bar, then Kino's own form of the plugin's settings (language and quality,
 * sources, the test and clear actions). `back` pops to the browse screen, or closes when the page was opened on its own.
 */
export function settingsView() {
  return {
    type: "Scaffold",
    appBar: {
      type: "AppBar", mergeWithKinoBar: true, dense: true, divider: false,
      leading: { type: "IconButton", key: "back", icon: "arrow_back", ...twin("brBack", "labelText"), ...twin("brBack", "tooltip"), onPressed: "back" },
      title: logo(),
    },
    body: { type: "SingleChildScrollView", key: "settings-page", children: [{ type: "Column", padding: { compact: 12, expanded: 24 }, gap: 16, children: [{ type: "settings", key: "form" }] }] },
  };
}

/** The title page (route "detail"): the same one bar, with Back where Close was. */
export function detailPage({ r, entry, season }) {
  const back = { type: "IconButton", key: "back", icon: "arrow_back", ...twin("brBack", "labelText"), ...twin("brBack", "tooltip"), onPressed: "back" };
  return detailView({ r, entry, season, logo: logo(), back });
}
