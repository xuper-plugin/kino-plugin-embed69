// src/anubis.js
var API = "/.within.website/x/cmd/anubis/api/pass-challenge";
function anubisChallenge(html) {
  const m = /<script id="anubis_challenge"[^>]*>([\s\S]*?)<\/script>/.exec(String(html || ""));
  if (!m) return null;
  let j;
  try {
    j = JSON.parse(m[1]);
  } catch (_) {
    return null;
  }
  const c = j && j.challenge, r = j && j.rules;
  if (!c || typeof c.randomData !== "string" || typeof c.id !== "string" || !r) return null;
  const difficulty = Number(r.difficulty);
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 6) return null;
  return { data: c.randomData, id: c.id, difficulty };
}
function solveAnubis(kino2, data, difficulty) {
  const zeros = "0".repeat(difficulty);
  for (let nonce = 0; nonce < 2e7; nonce++) {
    const hash = kino2.crypto.hash("sha256", data + nonce);
    if (hash.startsWith(zeros)) return { hash, nonce };
  }
  return null;
}
async function getThroughAnubis(kino2, req, url, opts) {
  const started = Date.now();
  let r = await req(url, opts);
  if (!r.ok) return null;
  let html = await r.text();
  const ch = anubisChallenge(html);
  if (!ch) return html;
  const sol = solveAnubis(kino2, ch.data, ch.difficulty);
  if (!sol) return html;
  const origin = new URL(url).origin;
  const elapsed = Math.max(1e3, Date.now() - started);
  const pass = `${origin}${API}?id=${encodeURIComponent(ch.id)}&response=${sol.hash}&nonce=${sol.nonce}&redir=${encodeURIComponent(url)}&elapsedTime=${elapsed}`;
  try {
    const rp = await req(pass, opts);
    if (rp && typeof rp.text === "function") await rp.text();
  } catch (_) {
  }
  const r2 = await req(url, opts);
  if (!r2 || !r2.ok) return html;
  return r2.text();
}

// src/util/lang.js
function normLang(text) {
  const s = String(text || "").toLowerCase();
  if (/\b(sub|subs|vose|subtitulado|subtitulada)\b/.test(s)) return "sub";
  if (/\b(lat|latino|latam|mx|mex|col|es-mx)\b/.test(s)) return "lat";
  if (/\b(cast|castellano|esp|español|espanol|es-es|spain)\b/.test(s)) return "esp";
  if (/(?:^|[^a-z0-9ñ])(españa|espana)(?:$|[^a-z0-9ñ])/.test(s)) return "esp";
  return null;
}

// src/embed69.js
var SITE = "https://embed69.org";
var HEADERS = { Referer: "https://sololatino.net/" };
function decryptLink(kino2, keyHex, b64) {
  const raw = atob(b64);
  let ivHex = "";
  for (let i = 0; i < 16; i++) ivHex += raw.charCodeAt(i).toString(16).padStart(2, "0");
  return kino2.crypto.decrypt("aes-256-cbc", { key: keyHex, keyEncoding: "hex", iv: ivHex, ivEncoding: "hex", data: btoa(raw.slice(16)) });
}
var quoted = (html, name) => {
  const m = new RegExp(name + "\\s*=\\s*'([^']*)'").exec(html);
  return m ? m[1] : null;
};
function pathFor(title) {
  if (!title || !/^tt\d{5,12}$/.test(String(title.imdbId || ""))) return null;
  if (title.kind !== "tv") return title.imdbId;
  const s = Number(title.season), e = Number(title.episode);
  if (title.season == null || title.episode == null || !Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e < 1) return null;
  return `${title.imdbId}-${s}x${String(e).padStart(2, "0")}`;
}
async function listCopies(title, { kino: kino2, req }) {
  const path = pathFor(title);
  if (!path) return [];
  const html = await getThroughAnubis(kino2, req, `${SITE}/f/${path}`, { headers: HEADERS });
  if (!html) return [];
  const data = /let\s+dataLink\s*=\s*(\[.+\]);/.exec(html);
  const challenge = quoted(html, "LINK_CHALLENGE"), salt = quoted(html, "LINK_SALT");
  if (!data || !challenge || salt == null) return [];
  let langs;
  try {
    langs = JSON.parse(data[1]);
  } catch (_) {
    return [];
  }
  const keyHex = kino2.crypto.hash("sha256", challenge + salt);
  const out = [];
  for (const l of langs) {
    const lang = normLang(l && l.video_language);
    if (!lang) continue;
    for (const e of l && l.sortedEmbeds || []) {
      if (!e || e.servername === "download" || typeof e.link !== "string") continue;
      let url;
      try {
        url = decryptLink(kino2, keyHex, e.link).replace(/`/g, "").trim();
      } catch (_) {
        continue;
      }
      if (/^https?:\/\//i.test(url) && !out.some((c) => c.embedUrl === url)) out.push({ lang, server: String(e.servername || ""), embedUrl: url });
    }
  }
  return out;
}
async function hasTitle(kino2, req, imdbId, kind) {
  if (!/^tt\d{5,12}$/.test(String(imdbId || ""))) return false;
  const path = kind === "series" || kind === "tv" ? `${imdbId}-1x01` : imdbId;
  const html = await getThroughAnubis(kino2, req, `${SITE}/f/${path}`, { headers: HEADERS });
  return !!html && /let\s+dataLink\s*=\s*\[/.test(html);
}

// src/util/http.js
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
var REQUEST_MS = 8e3;
var MIN_MS = 1500;
function makeReq(kino2, { deadline }) {
  const req = async (url, opts = {}) => {
    const left = deadline - Date.now();
    if (left < MIN_MS) throw kino2.error("timeout", "no time left for " + new URL(url).hostname);
    return kino2.fetch(url, { headers: { "User-Agent": UA, ...opts.headers || {} }, method: opts.method, body: opts.body, timeoutMs: Math.min(REQUEST_MS, left) });
  };
  req.left = () => Math.max(0, deadline - Date.now());
  return req;
}

// src/std/model.js
var MAX_SLIDES = 5;
var MAX_RAILS = 8;
var MAX_RAIL_ITEMS = 20;
var MAX_SLIDE_TEXT = 160;
var HTTPS = /^https:\/\//;
function cardOf(item) {
  const out = { id: item.id, ref: item.ref, title: item.title, kind: item.kind };
  if (item.poster && HTTPS.test(item.poster)) out.poster = item.poster;
  if (item.backdrop && HTTPS.test(item.backdrop)) out.backdrop = item.backdrop;
  if (item.badges) out.badges = item.badges;
  if (item.rating !== void 0) out.rating = item.rating;
  if (item.year !== void 0) out.year = item.year;
  if (item.ids && item.ids.tmdb) out.ids = { tmdb: item.ids.tmdb };
  if (item.lang) out.lang = item.lang;
  if (item.adult === true) out.adult = true;
  return out;
}
var slidesOf = (rows) => pickSlides(rows, (item) => item.backdrop);
var posterSlidesOf = (rows) => pickSlides(rows, (item) => item.poster);
function slideText(overview, item = {}) {
  const text = typeof overview === "string" ? overview.trim() : "";
  if (text === "") return [item.year, item.rating ? "\u2605 " + item.rating : null].filter(Boolean).join(" \xB7 ");
  return text.length <= MAX_SLIDE_TEXT ? text : `${text.slice(0, MAX_SLIDE_TEXT - 1).trimEnd()}\u2026`;
}
function pickSlides(rows, pictureOf) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const row of rows) {
    for (const item of row.items || []) {
      if (out.length >= MAX_SLIDES) return out;
      const image = pictureOf(item);
      if (item.adult === true || seen.has(item.id) || !image || !HTTPS.test(image)) continue;
      seen.add(item.id);
      out.push({ id: item.id, ref: item.ref, kind: item.kind, title: item.title, image, text: slideText(item.overview, item) });
    }
  }
  return out;
}
var uniform = (items) => items.every((i) => i.backdrop) ? items : items.map(({ backdrop, ...rest }) => rest);
function railsOf(rows) {
  return rows.filter((r) => !r.hidden && r.items && r.items.length > 0).slice(0, MAX_RAILS).map((r) => ({
    id: r.id,
    title: r.title,
    ...r.titleEn ? { titleEn: r.titleEn } : {},
    ...r.ref ? { ref: r.ref } : {},
    items: uniform(r.items.slice(0, MAX_RAIL_ITEMS).map(cardOf))
  }));
}
function tabOf(page) {
  const rows = page && Array.isArray(page.rows) ? page.rows : [];
  const rails = railsOf(rows);
  if (rails.length === 0) return null;
  return { slides: slidesOf(rows), posterSlides: posterSlidesOf(rows), rails };
}
function playedKey(ref) {
  const m = /^(?:m|s|e):(\d{1,10})(?::|$)/.exec(String(ref || ""));
  return m ? `t:${m[1]}` : String(ref || "");
}
function recentOf(keys, tabs) {
  if (keys.length === 0) return [];
  const byKey = /* @__PURE__ */ new Map();
  for (const data of tabs) {
    for (const rail2 of data.rails) {
      for (const card of rail2.items) {
        const ks = [card.ref];
        if (card.ids && card.ids.tmdb) ks.push(`t:${card.ids.tmdb}`);
        for (const k of ks) if (!byKey.has(k)) byKey.set(k, card);
      }
    }
  }
  const out = [];
  const used = /* @__PURE__ */ new Set();
  for (const key of keys) {
    const card = byKey.get(key);
    if (card && !used.has(card.id)) {
      used.add(card.id);
      out.push(card);
    }
  }
  return out;
}

// src/std/strings.js
var WORDS = {
  watch: ["Ver", "Watch"],
  info: ["M\xE1s informaci\xF3n", "More info"],
  recent: ["Continuar viendo", "Continue watching"],
  search: ["Buscar", "Search"],
  searchHint: ["Buscar en {name}", "Search {name}"],
  failed: ["No se pudo cargar esta secci\xF3n. Revisa tu conexi\xF3n e int\xE9ntalo de nuevo.", "This section could not be loaded. Check your connection and try again."],
  retry: ["Reintentar", "Retry"],
  empty: ["A\xFAn no hay nada aqu\xED.", "Nothing here yet."],
  back: ["Atr\xE1s", "Back"],
  close: ["Cerrar", "Close"],
  settings: ["Ajustes", "Settings"],
  resultsTitle: ["Resultados: {q}", "Results: {q}"],
  resultsIn: ["En {name}", "In {name}"],
  resultsSearching: ["Buscando en {name}\u2026", "Searching {name}\u2026"],
  resultsFailed: ["{name} no respondi\xF3 esta vez.", "{name} did not answer this time."],
  noResults: ["No encontramos nada con esas palabras en tus plugins.", "Nothing in your plugins matched those words."],
  supportTv: ["Si te gusta mi trabajo, escan\xE9alo y ap\xF3yame", "If you like my work, scan it and support me"],
  support: ["Si te gusta mi trabajo, ap\xF3yame", "If you like my work, support me"],
  gateTitle: ["Necesitas el motor de reproducci\xF3n", "You need the playback engine"],
  gateText: [
    "{name} reproduce a trav\xE9s de Kino Resolver (gratis). Inst\xE1lalo una vez y sirve para este y para otros plugins de sitios.",
    "{name} plays through Kino Resolver (free). Install it once and it works here and in other site plugins."
  ],
  gateInstall: ["Instalar Kino Resolver", "Install Kino Resolver"]
};
var fill = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => vars && vars[k] != null ? String(vars[k]) : m);
function twin(key, field = "text", vars) {
  const [es, en] = WORDS[key];
  const pick = (i) => vars && Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, Array.isArray(v) ? v[i] : v]));
  return { [field]: fill(es, pick(0)), [field + "En"]: fill(en, pick(1)) };
}
var STRING_KEYS = Object.keys(WORDS);

// src/std/view.js
var SUPPORT_URL = "https://ko-fi.com/xuperplugins";
var RESOLVER_REPO = "xuper-plugin/kino-plugin-kino-resolver";
var POLL_MS = 1500;
function brand(cfg) {
  return {
    type: "Row",
    key: "brand",
    gap: 12,
    crossAxisAlignment: "center",
    children: [
      ...cfg.logo ? [{ type: "Image", key: "logo", url: cfg.logo, aspect: cfg.logoAspect || "1:1", fit: "contain", h: 32, alt: cfg.name, altEn: cfg.nameEn || cfg.name }] : [],
      { type: "Text", key: "name", style: "h4", text: cfg.name, textEn: cfg.nameEn || cfg.name }
    ]
  };
}
var tabBar = (tabs, active) => ({
  type: "TabBar",
  key: "tabs",
  divider: false,
  value: active,
  onChanged: "tab",
  tabs: tabs.map((t2) => ({ value: t2.id, label: t2.label, labelEn: t2.labelEn || t2.label }))
});
var iconButton = (key, icon, word, onPressed) => ({ type: "IconButton", key, icon, ...twin(word, "labelText"), ...twin(word, "tooltip"), onPressed });
var searchOpenOps = (tabsInBar) => [
  { hide: "close" },
  { hide: "brand" },
  { hide: "searchButton" },
  { hide: "settingsButton" },
  ...tabsInBar ? [{ hide: "tabs" }] : [],
  { show: "closeSearch" },
  { show: "q" },
  { focus: "q" }
];
var searchClosedOps = (tabsInBar) => [
  { hide: "closeSearch" },
  { hide: "q" },
  { clear: "q" },
  { show: "close" },
  { show: "brand" },
  { show: "searchButton" },
  { show: "settingsButton" },
  ...tabsInBar ? [{ show: "tabs" }] : []
];
var leaveButton = (cfg) => cfg.backArrow ? iconButton("close", "arrow_back", "back", { go: { close: true } }) : iconButton("close", "close", "close", { go: { close: true } });
function supportNode(device) {
  if (device === "tv") return { type: "QrImage", key: "donate", value: SUPPORT_URL, size: "large", ...twin("supportTv", "labelText") };
  return { type: "ElevatedButton", key: "donate", icon: "heart", ...twin("support", "labelText"), onPressed: { go: { url: { href: SUPPORT_URL } } } };
}
var bar = ({ leading, title, actions = [] }) => ({ type: "AppBar", mergeWithKinoBar: true, dense: true, divider: false, leading, title, actions });
var railSkeleton = (n) => ({
  type: "Column",
  key: "skel" + n,
  gap: 8,
  children: [
    { type: "Skeleton", shape: "line", width: 120 },
    { type: "Row", gap: 12, sizes: ["compact"], children: [1, 2, 3].map((i) => ({ type: "Skeleton", shape: "card", key: `sk${n}c${i}`, flex: 1 })) },
    { type: "Row", gap: 12, sizes: ["medium", "expanded"], children: [1, 2, 3, 4, 5, 6].map((i) => ({ type: "Skeleton", shape: "card", key: `sk${n}w${i}`, flex: 1 })) }
  ]
});
var heroSkeleton = () => ({ type: "Skeleton", key: "heroSkeleton", shape: "block", height: { compact: 200, expanded: 320 } });
var titleOf = (s) => ({ ref: s.ref, kind: s.kind, id: s.id, title: s.title });
var withHeaders = (headers) => headers ? { headers } : {};
var slideNode = (s, headers) => ({
  type: "heroCard",
  key: "slide-" + s.id,
  h: { compact: 200, expanded: 240 },
  ...s.logo ? { logo: s.logo } : {},
  title: s.title,
  text: s.text,
  image: s.image,
  ...withHeaders(headers),
  buttons: [
    { type: "ElevatedButton", key: "watch-" + s.id, ...twin("watch", "labelText"), icon: "play", onPressed: { go: { play: titleOf(s) } } },
    { type: "TextButton", key: "info-" + s.id, ...twin("info", "labelText"), onPressed: { go: { title: titleOf(s) } } }
  ]
});
var hero = (slides, headers) => slides.length === 1 ? slideNode(slides[0], headers) : {
  type: "PageView",
  key: "hero" + slides.length,
  autoPlayMs: 6e3,
  children: slides.map((s) => slideNode(s, headers))
};
var rail = (r, key, words, headers) => ({
  type: "titleRail",
  key,
  ...words || { title: r.title, titleEn: r.titleEn || r.title },
  ...r.ref ? { ref: r.ref } : {},
  items: r.items,
  ...withHeaders(headers)
});
function browseView(cfg, { tab, data, recent, pending, failed, searching = false, device = "phone", own = null, ownActions = [] }) {
  const tv = device === "tv";
  const tabs = own ? [cfg.tabs[0]] : cfg.tabs;
  const active = tabs.some((t2) => t2.id === tab) ? tab : tabs[0].id;
  const withTabs = tabs.length > 1;
  const body = [];
  const ownBlocks = own && !Array.isArray(own) && Array.isArray(own.blocks) ? own.blocks : null;
  if (ownBlocks) {
  } else if (own) {
    body.push(...own);
  } else if (data) {
    const h = cfg.imageHeaders;
    if (data.slides.length > 0) body.push(hero(data.slides, h));
    if (recent.length > 0) body.push(rail({ items: recent }, "recent", twin("recent", "title"), h));
    for (const r of data.rails) body.push(rail(r, "rail-" + String(r.id).replace(/[^A-Za-z0-9_-]/g, "_"), null, h));
    if (data.rails.length === 0) body.push({ type: "Text", key: "empty", ...twin("empty"), color: "muted" });
  } else if (failed) {
    body.push({ type: "MaterialBanner", key: "loadFailed", role: "error", ...twin("failed"), action: { ...twin("retry", "label"), onTap: "retry" } });
  } else {
    body.push(heroSkeleton(), railSkeleton(1), railSkeleton(2), railSkeleton(3));
  }
  const isBanner = (n) => !!n && (n.type === "heroCard" || n.key === "heroSkeleton" || n.type === "PageView" && String(n.key).startsWith("hero"));
  const banner = body.length > 0 && isBanner(body[0]) ? body.shift() : null;
  const tabsInBar = tv && withTabs;
  const appBar = bar({
    leading: leaveButton(cfg),
    title: { type: "Row", key: "titleRow", gap: tabsInBar ? 24 : 8, crossAxisAlignment: "center", children: [
      { ...iconButton("closeSearch", "arrow_back", "back", { ui: searchClosedOps(tabsInBar), event: "searchClosed" }), hidden: true },
      brand(cfg),
      ...tabsInBar ? [tabBar(tabs, active)] : [],
      {
        type: "TextField",
        key: "q",
        hidden: true,
        flex: 1,
        kind: "search",
        maxLength: 200,
        ...twin("searchHint", "hintText", { name: [cfg.name, cfg.nameEn || cfg.name] }),
        onSubmitted: "search",
        trailingIcon: "search",
        ...twin("search", "trailingLabel"),
        onTrailingTap: "search"
      }
    ] },
    actions: [
      // barSearch: false (std 1.7.0): the plugin draws its own search field in its page instead of the bar's icon.
      ...cfg.barSearch ? [iconButton("searchButton", "search", "search", { ui: searchOpenOps(tabsInBar), event: "searchOpened" })] : [],
      // std 1.9.0: the page's own bar buttons (page.actions), before the settings gear.
      ...Array.isArray(ownActions) ? ownActions : [],
      iconButton("settingsButton", "settings", "settings", "openSettings")
    ]
  });
  return {
    type: "Scaffold",
    ...searching ? { onBack: { ui: searchClosedOps(tabsInBar), event: "searchClosed" } } : {},
    appBar,
    body: { type: "Column", key: "page", children: [
      ...withTabs && !tv ? [{ type: "Column", key: "tabsRow", padding: { compact: 0, expanded: 24 }, children: [tabBar(tabs, active)] }] : [],
      { type: "SingleChildScrollView", key: "browse-" + active, flex: 1, children: ownBlocks ? ownBlocks.filter((b) => b && Array.isArray(b.nodes) && b.nodes.length).flatMap((b, i) => b.edge ? b.nodes : [{ type: "Column", key: "block-" + i, padding: { compact: 12, expanded: 24 }, gap: 16, crossAxisAlignment: "stretch", children: b.nodes }]) : [...banner ? [banner] : [], { type: "Column", padding: { compact: 12, expanded: 24 }, gap: 16, children: body }] }
    ] },
    ...pending ? { every: { ms: POLL_MS, event: "tick" } } : {}
  };
}
function resultsView(cfg, { q, order, names, pending, found, device = "phone" }) {
  const body = [];
  let shown = 0;
  order.forEach((repo, i) => {
    const name = [names[repo] || repo, names[repo] || repo];
    if (pending.includes(repo)) {
      body.push({ type: "Column", key: "wait-" + i, gap: 8, children: [{ type: "Text", key: "waitText-" + i, color: "muted", ...twin("resultsSearching", "text", { name }) }, railSkeleton(i)] });
      return;
    }
    const r = found.get(repo);
    if (!r || !r.ok) {
      body.push({ type: "Text", key: "failed-" + i, color: "muted", ...twin("resultsFailed", "text", { name }) });
      return;
    }
    if (!r.items.length) return;
    shown++;
    body.push(rail({ items: r.items }, "found-" + i, twin("resultsIn", "title", { name }), cfg.imageHeaders));
  });
  if (!pending.length && shown === 0 && order.some((r) => {
    const x = found.get(r);
    return x && x.ok;
  })) body.unshift({ type: "Text", key: "noResults", ...twin("noResults") });
  return {
    type: "Scaffold",
    appBar: bar({ leading: iconButton("back", "arrow_back", "back", "back"), title: { type: "Text", key: "resultsTitle", style: "h4", ...twin("resultsTitle", "text", { q }) } }),
    body: { type: "SingleChildScrollView", key: "results-page", children: [{ type: "Column", padding: { compact: 12, expanded: 24 }, gap: 16, children: body }] },
    ...pending.length ? { every: { ms: 1500, event: "tick" } } : {}
  };
}
function settingsView(cfg, device = "phone") {
  return {
    type: "Scaffold",
    appBar: bar({ leading: iconButton("back", "arrow_back", "back", "back"), title: brand(cfg) }),
    body: { type: "SingleChildScrollView", key: "settings-page", children: [{ type: "Column", padding: { compact: 12, expanded: 24 }, gap: 16, children: [
      ...cfg.hasSettings ? [{ type: "settings", key: "form" }, { type: "Divider", key: "supportDivider" }] : [],
      supportNode(device)
    ] }] }
  };
}
function gateView(cfg, device = "phone") {
  const name = [cfg.name, cfg.nameEn || cfg.name];
  return {
    type: "Scaffold",
    appBar: bar({ leading: leaveButton(cfg), title: brand(cfg) }),
    body: { type: "Column", key: "gate", mainAxisAlignment: "center", crossAxisAlignment: "center", padding: 24, gap: 16, children: [
      { type: "Text", key: "gateTitle", style: "h3", ...twin("gateTitle") },
      { type: "Text", key: "gateText", style: "p", ...twin("gateText", "text", { name }) },
      { type: "ElevatedButton", key: "installResolver", ...twin("gateInstall", "labelText"), onPressed: { go: { installPlugin: { repo: RESOLVER_REPO } } } },
      supportNode(device)
    ] }
  };
}

// src/std/metaCache.js
var KEY = "meta3";
var MAX = 160;
var CONCURRENCY = 3;
var OVERVIEW_MAX = 160;
var HTTPS2 = /^https:\/\//;
function makeMetaCache({ kino: kino2, titleOf: titleOf3 = (c) => c.title, typeOf = (c) => c.kind === "series" ? "series" : "movie", tmdbPictures = false, clock = { now: () => Date.now() } }) {
  const usable = () => {
    try {
      return typeof kino2.meta === "function" && kino2.meta.byTitle === true;
    } catch (_) {
      return false;
    }
  };
  let book = null;
  function read() {
    if (book) return book;
    try {
      const o = JSON.parse(kino2.storage.get(KEY) || "null");
      book = o && typeof o === "object" && !Array.isArray(o) ? o : {};
    } catch (_) {
      book = {};
    }
    return book;
  }
  function write() {
    try {
      const ids = Object.keys(book);
      if (ids.length > MAX) for (const id of ids.slice(0, ids.length - MAX)) delete book[id];
      kino2.storage.set(KEY, JSON.stringify(book));
    } catch (_) {
    }
  }
  function known(id) {
    const e = read()[id];
    if (!e) return {};
    return {
      ...e.t > 0 ? { tmdb: e.t } : {},
      ...e.l && HTTPS2.test(e.l) ? { logo: e.l } : {},
      ...e.p && HTTPS2.test(e.p) ? { poster: e.p } : {},
      ...e.b && HTTPS2.test(e.b) ? { backdrop: e.b } : {},
      ...typeof e.o === "string" && e.o ? { overview: e.o } : {}
    };
  }
  const asked = (id) => Object.hasOwn(read(), id);
  function dress(cards) {
    return cards.map((c) => {
      const k = known(c.id);
      const poster = tmdbPictures && k.poster ? k.poster : null;
      if (!k.tmdb && !poster) return c;
      return { ...c, ...k.tmdb && !(c.ids && c.ids.tmdb) ? { ids: { ...c.ids || {}, tmdb: k.tmdb } } : {}, ...poster ? { poster } : {} };
    });
  }
  async function fill2(cards, budgetMs) {
    if (!usable()) return 0;
    const b = read();
    const end = clock.now() + budgetMs;
    let count = 0;
    let stop = false;
    const seen = /* @__PURE__ */ new Set();
    const todo = cards.filter((c) => {
      if (!c || typeof c.id !== "string" || seen.has(c.id) || Object.hasOwn(b, c.id) || c.ids && c.ids.tmdb && c.noLogo) return false;
      seen.add(c.id);
      return true;
    });
    let next = 0;
    const str = (v, max) => typeof v === "string" ? v.slice(0, max) : "";
    const worker = async () => {
      while (!stop && next < todo.length && clock.now() < end) {
        const c = todo[next++];
        const year = c.year !== void 0 ? { year: c.year } : {};
        try {
          const a = await kino2.meta({ type: typeOf(c), title: titleOf3(c), ...year });
          b[c.id] = {
            t: a && a.ids && Number.isInteger(a.ids.tmdb) ? a.ids.tmdb : 0,
            l: str(a && a.logo, 2048),
            p: str(a && a.poster, 2048),
            b: str(a && a.backdrop, 2048),
            o: str(a && a.overview, OVERVIEW_MAX)
          };
          count++;
        } catch (e) {
          if (e && e.code === "rate_limited") stop = true;
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (count > 0) write();
    return count;
  }
  return { known, asked, dress, fill: fill2, usable, tmdbPictures };
}

// src/std/index.js
var TAB_KEY = "browseTab";
var SNAP_PREFIX = "browse1:";
var SNAP_TTL_MS = 7 * 24 * 3600 * 1e3;
var SNAP_MAX = 20 * 1024;
var SNAPS_TOTAL = 96 * 1024;
var RECENT_KEY = "recent1";
var RECENT_MAX = 12;
var Q_MAX = 200;
var META_TICK_MS = 3e3;
var META_TICK_CARDS = 24;
var INFLIGHT_KEY = "std:inflight";
var INFLIGHT_STALE_MS = 18e3;
var MAX_META_TICKS = 10;
var DEFAULT_TABS = [{ id: "inicio", label: "Inicio", labelEn: "Home" }];
var SNAPSHOT_VERSION = 1;
var SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1e3;
var SNAPSHOT_TIMEOUT_MS = 8e3;
var snapshotUrl = (repo, tab) => "https://raw.githubusercontent.com/" + repo + "/main/home/" + encodeURIComponent(tab) + ".json";
function snapshotRows(text, tab, now = Date.now()) {
  let o;
  try {
    o = JSON.parse(String(text));
  } catch (_) {
    return null;
  }
  if (!o || o.v !== SNAPSHOT_VERSION || o.tab !== tab || !Array.isArray(o.rows) || o.rows.length === 0) return null;
  const at = Number(o.at);
  if (!Number.isFinite(at) || now - at > SNAPSHOT_MAX_AGE_MS || at - now > 60 * 60 * 1e3) return null;
  return o.rows;
}
var lastSource = null;
function makeStandardScreen({ kino: kino2, name, nameEn, logo = null, logoAspect = "1:1", needsResolver, hasSettings, tabs, loadTab, homeKey = null, titleOf: titleOf3, typeOf, tmdbPictures = false, imageHeaders = null, searchHere = null, page = null, barSearch = true, backArrow = true, snapshot = null }) {
  const cfg = { name, nameEn, logo, logoAspect, imageHeaders, hasSettings: !!hasSettings, barSearch: barSearch !== false, backArrow: backArrow !== false, tabs: Array.isArray(tabs) && tabs.length > 0 ? tabs : DEFAULT_TABS };
  const TAB_IDS = cfg.tabs.map((t2) => t2.id);
  lastSource = { tabs: cfg.tabs, loadTab, titleOf: titleOf3, typeOf };
  async function fromSnapshot(tab) {
    if (typeof snapshot !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(snapshot)) return null;
    try {
      const r = await kino2.fetch(snapshotUrl(snapshot, tab), { timeoutMs: SNAPSHOT_TIMEOUT_MS });
      if (!r || !r.ok) return null;
      const rows = snapshotRows(await r.text(), tab);
      return rows ? { rows } : null;
    } catch (_) {
      return null;
    }
  }
  const meta = makeMetaCache({ kino: kino2, titleOf: titleOf3, typeOf, tmdbPictures });
  function slidesFromMeta(rails) {
    const out = [];
    for (const r of rails) {
      for (const c of r.items) {
        if (out.length >= MAX_SLIDES) return out;
        const k = meta.known(c.id);
        if (!k.backdrop || c.adult === true || out.some((x) => x.id === c.id)) continue;
        out.push({ id: c.id, ref: c.ref, kind: c.kind, title: c.title, image: k.backdrop, text: slideText(k.overview, c), ...k.logo ? { logo: k.logo } : {} });
      }
    }
    return out;
  }
  const enrich = (data) => {
    if (!data) return data;
    const own = data.slides.map((s) => {
      const k = meta.known(s.id);
      const image = tmdbPictures && k.backdrop ? k.backdrop : null;
      return k.logo || image ? { ...s, ...k.logo ? { logo: k.logo } : {}, ...image ? { image } : {} } : s;
    });
    const learned = own.length > 0 ? [] : slidesFromMeta(data.rails);
    return {
      // The site's own backdrops, else TMDB's, else the posters: every plugin has a hero.
      slides: own.length > 0 ? own : learned.length > 0 ? learned : data.posterSlides || [],
      rails: data.rails.map((r) => ({ ...r, items: meta.dress(r.items) }))
    };
  };
  const metaTicks = /* @__PURE__ */ new Map();
  const found = /* @__PURE__ */ new Map();
  const SOURCES_PER_TICK = 3;
  const asFound = (a, index) => ({
    ok: !!(a && a.ok),
    items: a && a.ok && Array.isArray(a.items) ? a.items.filter((x) => x && x.id && x.ref && x.title).slice(0, 40).map((x) => ({ ...x, id: ("p" + index + "~" + x.id).slice(0, 128), origin: a.repo })) : []
  });
  const memo = /* @__PURE__ */ new Map();
  const log = (...a) => {
    try {
      kino2.log("[std]", ...a);
    } catch (_) {
    }
  };
  const get = (k) => {
    try {
      return kino2.storage.get(k);
    } catch (_) {
      return null;
    }
  };
  const set = (k, v, opts) => {
    try {
      kino2.storage.set(k, v, opts);
    } catch (_) {
    }
  };
  function readSnap(tab) {
    try {
      const o = JSON.parse(get(SNAP_PREFIX + tab) || "null");
      return o && Date.now() - o.at < SNAP_TTL_MS && o.data && Array.isArray(o.data.rails) ? o.data : null;
    } catch (_) {
      return null;
    }
  }
  const snapMax = Math.min(SNAP_MAX, Math.floor(SNAPS_TOTAL / TAB_IDS.length));
  function writeSnap(tab, data) {
    for (let per = 10; per >= 3; per -= 2) {
      const slim = { slides: data.slides, posterSlides: data.posterSlides || [], rails: data.rails.map((r) => ({ ...r, items: r.items.slice(0, per) })) };
      const text = JSON.stringify({ at: Date.now(), data: slim });
      if (text.length <= snapMax) {
        set(SNAP_PREFIX + tab, text, { ttlMs: SNAP_TTL_MS });
        return;
      }
    }
  }
  function homeSeed(tab) {
    if (!homeKey || tab !== TAB_IDS[0]) return null;
    try {
      const o = JSON.parse(get(homeKey) || "null");
      return o && Array.isArray(o.rows) && o.rows.length ? tabOf({ rows: o.rows }) : null;
    } catch (_) {
      return null;
    }
  }
  const stored = () => {
    const t2 = get(TAB_KEY);
    return TAB_IDS.includes(t2) ? t2 : null;
  };
  function dataOf(tab) {
    if (memo.has(tab)) return memo.get(tab).data;
    const snap = readSnap(tab) || homeSeed(tab);
    if (snap) {
      memo.set(tab, { data: snap, whole: false });
      return snap;
    }
    return null;
  }
  const readKeys = () => {
    try {
      const a = JSON.parse(get(RECENT_KEY) || "[]");
      return Array.isArray(a) ? a.filter((k) => typeof k === "string") : [];
    } catch (_) {
      return [];
    }
  };
  function notePlayed(ref) {
    try {
      const key = playedKey(ref);
      if (key === "" || key.startsWith("x|")) return;
      const keys = readKeys();
      if (keys[0] === key) return;
      set(RECENT_KEY, JSON.stringify([key, ...keys.filter((k) => k !== key)].slice(0, RECENT_MAX)));
    } catch (_) {
    }
  }
  const tabFromArgs = (route) => {
    const a = route && route.args && typeof route.args === "object" ? route.args : {};
    return TAB_IDS.includes(a.tab) ? a.tab : null;
  };
  function needed(tab) {
    return memo.get(tab) && memo.get(tab).whole ? [] : [tab];
  }
  function screen2(ctx) {
    const c = ctx || {};
    const device = c.device || "phone";
    if (needsResolver && !(c.installed && c.installed[RESOLVER_REPO])) return gateView(cfg, device);
    if (c.route && c.route.name === "settings") return settingsView(cfg, device);
    if (searchHere && c.route && c.route.name === "results") {
      const st0 = c.state && typeof c.state === "object" ? c.state : {};
      return resultsView(cfg, {
        q: String(st0.rq || ""),
        order: Array.isArray(st0.rorder) ? st0.rorder : [],
        names: st0.rnames || {},
        pending: Array.isArray(st0.rpending) ? st0.rpending : [],
        found,
        device
      });
    }
    const st = c.state && typeof c.state === "object" ? c.state : {};
    const tab = TAB_IDS.includes(st.tab) ? st.tab : tabFromArgs(c.route) ?? stored() ?? TAB_IDS[0];
    const data = enrich(dataOf(tab));
    const loaded = TAB_IDS.map((t2) => memo.get(t2)).filter(Boolean).map((m) => m.data);
    const pending = Array.isArray(st.pending) && st.pending.length > 0;
    const searching = st.searching === true;
    if (page) {
      const tree = browseView(cfg, {
        tab: TAB_IDS[0],
        data: null,
        recent: [],
        pending: false,
        failed: false,
        searching,
        device,
        own: page.view({ ...c, state: st }) || [],
        ownActions: page.actions ? page.actions({ ...c, state: st }) || [] : []
      });
      const every = page.every ? page.every({ ...c, state: st }) : null;
      return every ? { ...tree, every } : tree;
    }
    return browseView(cfg, { tab, data, recent: meta.dress(recentOf(readKeys(), loaded)), pending, failed: !!(st.failed && st.failed[tab]), searching, device });
  }
  function cutShort() {
    try {
      const o = JSON.parse(get(INFLIGHT_KEY) || "null");
      if (!o || typeof o.tab !== "string") return null;
      if (Date.now() - Number(o.at) < INFLIGHT_STALE_MS) return null;
      kino2.storage.remove(INFLIGHT_KEY);
      return o.tab;
    } catch (_) {
      return null;
    }
  }
  async function load(tab) {
    set(INFLIGHT_KEY, JSON.stringify({ tab, at: Date.now() }));
    let page2;
    try {
      page2 = await fromSnapshot(tab) || await loadTab(tab);
    } finally {
      try {
        kino2.storage.remove(INFLIGHT_KEY);
      } catch (_) {
      }
    }
    const data = tabOf(page2);
    if (data) {
      memo.set(tab, { data, whole: true });
      writeSnap(tab, data);
    }
    return data !== null;
  }
  const events = {
    async open(ev) {
      if (page) {
        let patch = {};
        try {
          patch = (page.open ? await page.open(ev) : {}) || {};
        } catch (e) {
          log("page open", e && e.code || "error");
        }
        return { state: { ...patch, tab: TAB_IDS[0], pending: [], failed: null } };
      }
      return events.openTabs(ev);
    },
    openTabs({ route, state, device }) {
      const tab = tabFromArgs(route) ?? (TAB_IDS.includes(state.tab) ? state.tab : stored() ?? TAB_IDS[0]);
      for (const t2 of TAB_IDS) dataOf(t2);
      return { state: { tab, pending: needed(tab), failed: null } };
    },
    tab({ value, arg, state }) {
      const tab = TAB_IDS.includes(value) ? value : TAB_IDS.includes(arg) ? arg : null;
      if (!tab) return null;
      set(TAB_KEY, tab);
      dataOf(tab);
      const failed = { ...state.failed || {} };
      delete failed[tab];
      const pending = [tab, ...Array.isArray(state.pending) ? state.pending.filter((t2) => t2 !== tab) : []];
      return { state: { tab, pending: memo.get(tab) && memo.get(tab).whole ? pending.slice(1) : pending, failed } };
    },
    retry({ state }) {
      const tab = TAB_IDS.includes(state.tab) ? state.tab : TAB_IDS[0];
      const queued = Array.isArray(state.pending) ? state.pending.filter((t2) => t2 !== tab) : [];
      return { state: { failed: null, pending: [tab, ...queued] } };
    },
    async tick({ state, route }) {
      if (searchHere && route && route.name === "results") {
        const rp = Array.isArray(state.rpending) ? state.rpending : [];
        if (rp.length === 0) return null;
        const batch = rp.slice(0, SOURCES_PER_TICK);
        const order = Array.isArray(state.rorder) ? state.rorder : [];
        let answers = [];
        try {
          answers = await searchHere.searchIn(String(state.rq || ""), batch);
        } catch (e) {
          log("results", (e && e.code || "error") + " " + String(e && e.message || "").slice(0, 200));
        }
        for (const repo of batch) {
          const a = (Array.isArray(answers) ? answers : []).find((x) => x && x.repo === repo);
          found.set(repo, asFound(a, order.indexOf(repo)));
        }
        return { state: { rpending: rp.slice(SOURCES_PER_TICK) } };
      }
      const pending = Array.isArray(state.pending) ? state.pending : [];
      if (pending.length === 0) return null;
      const [next, ...rest] = pending;
      const failed = { ...state.failed || {} };
      if (next.startsWith("meta:")) {
        const tab = next.slice(5);
        const m = memo.get(tab);
        if (!m) return { state: { pending: rest } };
        const ask = (x) => ({ id: x.id, title: x.title, kind: x.kind, ...x.year !== void 0 ? { year: x.year } : {} });
        const noOwnSlides = m.data.slides.length === 0;
        const cards = [...m.data.slides.map(ask), ...m.data.rails.flatMap((r) => r.items.slice(0, noOwnSlides ? MAX_SLIDES * 3 : 6).map(ask))].filter((c) => !meta.asked(c.id)).slice(0, META_TICK_CARDS);
        const count = await meta.fill(cards, META_TICK_MS);
        const ticks = (metaTicks.get(tab) || 0) + 1;
        metaTicks.set(tab, ticks);
        const again = noOwnSlides && count > 0 && ticks < MAX_META_TICKS && slidesFromMeta(m.data.rails).length < MAX_SLIDES && cards.some((c) => !meta.asked(c.id));
        return { state: { pending: again ? [next, ...rest] : rest } };
      }
      if (cutShort() === next) {
        log("tab", next, "cut short by Kino last time");
        failed[next] = true;
        return { state: { pending: rest, failed } };
      }
      try {
        const ok = await load(next);
        if (!ok) failed[next] = true;
        else delete failed[next];
        if (ok && meta.usable()) rest.unshift("meta:" + next);
      } catch (e) {
        log("tab", e && e.code || "error");
        failed[next] = true;
      }
      return { state: { pending: rest, failed } };
    },
    // The words go to Kino's own search, with this plugin as the source; the bar is put back as it was, locally.
    // The search button's own event (after its local ops): while searching, the tree declares onBack, so Back closes the box.
    searchOpened() {
      return { state: { searching: true } };
    },
    // The box was closed (its arrow, or Back through onBack, already ran the local ops): the flag and the ops go, so the next
    // tree declares no onBack and draws the bar's defaults.
    searchClosed() {
      return { state: { searching: false, ui: null } };
    },
    async search({ value, state, device }) {
      const typed = value && typeof value === "object" ? value.q : value;
      const raw = typed != null && String(typed).trim() !== "" ? typed : state.inputs && state.inputs.q;
      const q = String(raw == null ? "" : raw).trim().slice(0, Q_MAX);
      if (!q) return null;
      const closed = searchClosedOps(device === "tv" && TAB_IDS.length > 1);
      if (searchHere) {
        let sources = [];
        try {
          sources = await searchHere.sources() || [];
        } catch (e) {
          log("sources", e && e.code || "error");
        }
        const order = sources.map((x) => x.repo).filter((r) => typeof r === "string");
        found.clear();
        return { route: { push: "results" }, ui: closed, state: {
          searching: false,
          ui: null,
          rq: q,
          rorder: order,
          rnames: Object.fromEntries(sources.map((x) => [x.repo, String(x.name || x.repo)])),
          rpending: order
        } };
      }
      return { go: { search: { q } }, ui: closed, state: { searching: false, ui: null } };
    },
    openSettings() {
      return { route: { push: "settings" }, state: { fromBrowse: true } };
    },
    back({ state, route }) {
      if (route && route.name === "settings" && !state.fromBrowse) return { close: true };
      return { route: { pop: true }, state: { fromBrowse: false } };
    }
  };
  async function screenEvent2(ev) {
    const e = ev || {};
    const name2 = e.name != null ? e.name : e.event;
    const own = page && page.events && typeof name2 === "string" && Object.hasOwn(page.events, name2) && !Object.hasOwn(events, name2) ? page.events[name2] : null;
    if (own) return await own({ ...e, state: e.state || {} }) ?? null;
    const handler = typeof name2 === "string" && name2 !== "openTabs" && Object.hasOwn(events, name2) ? events[name2] : null;
    return handler ? await handler({ ...e, state: e.state || {} }) ?? null : null;
  }
  return { screen: screen2, screenEvent: screenEvent2, notePlayed };
}

// src/logo.js
var LOGO = "data:image/png;base64,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";
var LOGO_ASPECT = "1:1";

// src/std/catalog.js
var CATALOG_MAX = 40;
var CATALOG_EPISODES_MAX = 500;
var OVERVIEW_MAX2 = 300;
var HTTPS3 = /^https:\/\//;
function catalogItems(found) {
  const out = [];
  const list = Array.isArray(found) ? found : found && Array.isArray(found.items) ? found.items : [];
  for (const it of list) {
    if (out.length >= CATALOG_MAX) break;
    if (!it || typeof it.id !== "string" || !it.id || typeof it.ref !== "string" || !it.ref || typeof it.title !== "string" || !it.title) continue;
    const item = { id: it.id, ref: it.ref, title: it.title, kind: typeof it.kind === "string" && it.kind ? it.kind : "movie" };
    if (typeof it.poster === "string" && HTTPS3.test(it.poster)) item.poster = it.poster;
    if (typeof it.backdrop === "string" && HTTPS3.test(it.backdrop)) item.backdrop = it.backdrop;
    if (it.year !== void 0 && it.year !== null && String(it.year)) item.year = String(it.year);
    if (typeof it.overview === "string" && it.overview.trim()) item.overview = it.overview.trim().slice(0, OVERVIEW_MAX2);
    const tmdb2 = it.ids && Number.isInteger(it.ids.tmdb) ? it.ids.tmdb : Number.isInteger(it.tmdb) ? it.tmdb : 0;
    if (tmdb2 > 0) item.tmdb = tmdb2;
    out.push(item);
  }
  return out;
}
function catalogQuery(arg) {
  const q = String(arg && arg.q || "").trim().slice(0, 200);
  const type = arg && (arg.type === "movie" || arg.type === "series") ? arg.type : "any";
  const tmdbId = arg && Number.isInteger(arg.tmdb) && arg.tmdb > 0 ? arg.tmdb : 0;
  return { q, type, season: 0, episode: 0, tmdbId, year: 0, originalTitle: "", altTitles: [], cursor: null };
}
function catalogDoor(search2) {
  return async (arg) => {
    const query = catalogQuery(arg);
    if (!query.q) return [];
    return catalogItems(await search2(query));
  };
}
function wholeNumber(v) {
  if (Number.isInteger(v)) return v;
  if (typeof v === "string" && /^\s*\d+\s*$/.test(v)) return parseInt(v, 10);
  return null;
}
function catalogEpisodes(list) {
  const rows = Array.isArray(list) ? list : list && Array.isArray(list.episodes) ? list.episodes : [];
  const out = [];
  for (const e of rows) {
    if (out.length >= CATALOG_EPISODES_MAX) break;
    if (!e) continue;
    const number = wholeNumber(e.number);
    if (number === null || number < 1 || typeof e.ref !== "string" || !e.ref) continue;
    const season = e.season === void 0 || e.season === null ? 1 : wholeNumber(e.season);
    if (season === null || season < 0) continue;
    const row = { season, number, ref: e.ref };
    if (typeof e.title === "string" && e.title) row.title = e.title;
    out.push(row);
  }
  return out;
}
function catalogEpisodesDoor(episodes2) {
  return async (arg) => {
    const ref = arg && typeof arg.ref === "string" ? arg.ref.trim() : "";
    if (!ref) return [];
    return catalogEpisodes(await episodes2(ref));
  };
}

// src/plugin.js
var tmdb = (path, params = {}) => kino.tmdb(path, { language: String(kino.lang || "").toLowerCase().startsWith("en") ? "en-US" : "es-MX", ...params });
globalThis.__kinoDropPendingFetches = true;
if (typeof kino.meta !== "function") throw kino.error("unavailable", "kino.meta not available");
if (typeof kino.tmdb !== "function") throw kino.error("unavailable", "kino.tmdb not available");
var TMDB_IMG = "https://image.tmdb.org/t/p/";
var DAY_MS = 24 * 60 * 60 * 1e3;
var RESOLVE_MS = 4e4;
var MAX_COPIES = 8;
var MAX_CAPTURES = 1;
var CAPTURE_MS = 2e4;
var HLS = "application/vnd.apple.mpegurl";
var STRINGS = {
  es: {
    unavailable: "El servicio no est\xE1 disponible en este momento.",
    noStreams: "No se encontraron fuentes para este t\xEDtulo.",
    gone: "Los enlaces de este t\xEDtulo caducaron o se borraron.",
    noMeta: "No se encontr\xF3 informaci\xF3n de este t\xEDtulo.",
    trendingMovies: "Pel\xEDculas populares",
    trendingSeries: "Series populares",
    nowPlaying: "En cines ahora",
    upcoming: "Pr\xF3ximos estrenos",
    topMovies: "Pel\xEDculas mejor valoradas",
    onTheAir: "Series en emisi\xF3n",
    topSeries: "Series mejor valoradas",
    kids: "Para los ni\xF1os",
    docs: "Documentales",
    anime: "Anime popular",
    animeNew: "Anime: nuevos episodios",
    animeMovies: "Pel\xEDculas de anime",
    gAction: "Acci\xF3n",
    gComedy: "Comedia",
    gSciFi: "Ciencia ficci\xF3n",
    gHorror: "Terror",
    gDrama: "Drama",
    cacheCleared: "Cach\xE9 de IDs vaciada.",
    lat: "Latino",
    esp: "Castellano",
    sub: "Subtitulado",
    needResolver: "Para reproducir, abre Embed69 desde el men\xFA e instala el motor de reproducci\xF3n que te pedir\xE1."
  },
  en: {
    unavailable: "The service is not available right now.",
    noStreams: "No streams found for this title.",
    gone: "This title's links expired or were deleted.",
    noMeta: "No metadata found for this title.",
    trendingMovies: "Trending movies",
    trendingSeries: "Trending series",
    nowPlaying: "In theaters now",
    upcoming: "Coming soon",
    topMovies: "Top rated movies",
    onTheAir: "Series on the air",
    topSeries: "Top rated series",
    kids: "For kids",
    docs: "Documentaries",
    anime: "Popular anime",
    animeNew: "Anime: new episodes",
    animeMovies: "Anime movies",
    gAction: "Action",
    gComedy: "Comedy",
    gSciFi: "Science fiction",
    gHorror: "Horror",
    gDrama: "Drama",
    cacheCleared: "ID cache cleared.",
    lat: "Latin",
    esp: "Castilian",
    sub: "Subtitled",
    needResolver: "To play, open Embed69 from the menu and install the playback engine it asks for."
  }
};
function t(key) {
  const lang = String(kino.lang || "es").startsWith("en") ? "en" : "es";
  return (STRINGS[lang] || STRINGS.es)[key] || key;
}
var TMDB_GENRES = {
  28: "Acci\xF3n",
  12: "Aventura",
  16: "Animaci\xF3n",
  35: "Comedia",
  80: "Crimen",
  99: "Documentales",
  18: "Drama",
  10751: "Familia",
  14: "Fantas\xEDa",
  36: "Historia",
  27: "Terror",
  9648: "Misterio",
  10749: "Romance",
  878: "Ciencia ficci\xF3n",
  53: "Suspenso",
  10752: "B\xE9lica",
  37: "Western",
  10759: "Acci\xF3n",
  10765: "Ciencia ficci\xF3n",
  10766: "Drama",
  10764: "Reality",
  10768: "B\xE9lica"
};
function genresOf(raw) {
  const names = /* @__PURE__ */ new Set();
  for (const id of Array.isArray(raw.genre_ids) ? raw.genre_ids : []) if (TMDB_GENRES[id]) names.add(TMDB_GENRES[id]);
  return [...names].slice(0, 5);
}
function itemFromTmdb(raw, kind) {
  const isMovie = kind === "movie";
  const tmdbId = raw.id;
  return {
    id: (isMovie ? "m" : "s") + tmdbId,
    ref: (isMovie ? "m:" : "s:") + tmdbId,
    title: String(raw.title || raw.name || ""),
    kind: isMovie ? "movie" : "series",
    year: (raw.release_date || raw.first_air_date || "").slice(0, 4) || void 0,
    poster: raw.poster_path ? TMDB_IMG + "w500" + raw.poster_path : void 0,
    backdrop: raw.backdrop_path ? TMDB_IMG + "w1280" + raw.backdrop_path : void 0,
    overview: raw.overview || void 0,
    rating: raw.vote_average > 0 ? Math.round(raw.vote_average * 10) / 10 : void 0,
    ids: { tmdb: tmdbId },
    genres: genresOf(raw).length ? genresOf(raw) : void 0
  };
}
async function imdbFor(tmdbId, type) {
  const key = "imdb:" + type + ":" + tmdbId;
  const hit = kino.storage.get(key);
  if (hit) return hit;
  const meta = await kino.meta({ type, ids: { tmdb: Number(tmdbId) } });
  const imdb = meta?.ids?.imdb ?? null;
  if (imdb) kino.storage.set(key, imdb, { ttlMs: 30 * DAY_MS });
  return imdb;
}
var titlesOf = (query) => [query.q, query.originalTitle, ...query.altTitles || []].filter(Boolean);
var HOME_ROWS = [
  { id: "trending-movies", title: "trendingMovies", genre: "peliculas", ref: "trend:movie", kind: "movie", path: "/trending/movie/week" },
  { id: "trending-series", title: "trendingSeries", genre: "series", ref: "trend:tv", kind: "tv", path: "/trending/tv/week" },
  // Anime (owner, 2026-11-24): what is airing now first, then the popular series and the films. TMDB has no anime flag:
  // Japanese-language animation is what these rows mean. They come early so Kino's per-plugin Home quota reaches them.
  { id: "anime-new", title: "animeNew", genre: "anime", ref: "anime:new", kind: "tv", path: "/discover/tv", params: () => animeNewParams() },
  { id: "anime", title: "anime", genre: "anime", ref: "anime:tv", kind: "tv", path: "/discover/tv", params: () => ANIME },
  { id: "anime-movies", title: "animeMovies", genre: "anime", ref: "anime:movie", kind: "movie", path: "/discover/movie", params: () => ANIME },
  { id: "now-playing", title: "nowPlaying", genre: "peliculas", ref: "list:movie:now_playing", kind: "movie", path: "/movie/now_playing" },
  { id: "upcoming", title: "upcoming", genre: "peliculas", ref: "list:movie:upcoming", kind: "movie", path: "/movie/upcoming" },
  { id: "top-movies", title: "topMovies", genre: "peliculas", ref: "list:movie:top_rated", kind: "movie", path: "/movie/top_rated" },
  { id: "on-the-air", title: "onTheAir", genre: "series", ref: "list:tv:on_the_air", kind: "tv", path: "/tv/on_the_air" },
  { id: "top-series", title: "topSeries", genre: "series", ref: "list:tv:top_rated", kind: "tv", path: "/tv/top_rated" },
  { id: "g-action", title: "gAction", genre: "peliculas", ref: "genre:movie:28", kind: "movie", path: "/discover/movie", params: { with_genres: 28 } },
  { id: "g-comedy", title: "gComedy", genre: "peliculas", ref: "genre:movie:35", kind: "movie", path: "/discover/movie", params: { with_genres: 35 } },
  { id: "g-scifi", title: "gSciFi", genre: "peliculas", ref: "genre:movie:878", kind: "movie", path: "/discover/movie", params: { with_genres: 878 } },
  { id: "g-horror", title: "gHorror", genre: "peliculas", ref: "genre:movie:27", kind: "movie", path: "/discover/movie", params: { with_genres: 27 } },
  { id: "g-drama", title: "gDrama", genre: "peliculas", ref: "genre:movie:18", kind: "movie", path: "/discover/movie", params: { with_genres: 18 } },
  { id: "kids", title: "kids", genre: "infantil", ref: "genre:movie:10751", kind: "movie", path: "/discover/movie", params: { with_genres: 10751 } },
  { id: "docs", title: "docs", genre: "documentales", ref: "genre:movie:99", kind: "movie", path: "/discover/movie", params: { with_genres: 99 } }
];
var DISCOVER = { sort_by: "popularity.desc", "vote_count.gte": 200 };
var ANIME = { with_genres: 16, with_original_language: "ja" };
var ANIME_NEW_DAYS = 7;
function animeNewParams(now = Date.now()) {
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  return { ...ANIME, "air_date.gte": day(now - ANIME_NEW_DAYS * DAY_MS), "air_date.lte": day(now), "vote_count.gte": 10 };
}
async function homeRow(row) {
  const params = typeof row.params === "function" ? row.params() : row.params || {};
  const res = await tmdb(row.path, { ...row.path.startsWith("/discover") ? DISCOVER : {}, ...params });
  const items = (res?.results || []).filter((r) => r.poster_path).slice(0, 20).map((r) => itemFromTmdb(r, row.kind));
  return items.length ? { id: row.id, title: t(row.title), genre: row.genre, ref: row.ref, items } : null;
}
var HOME_BUDGET_MS = 14e3;
var TAB_ROWS = {
  peliculas: HOME_ROWS.filter((r) => r.kind === "movie"),
  series: HOME_ROWS.filter((r) => r.kind === "tv")
};
async function home() {
  return rowsWithin(HOME_ROWS);
}
async function rowsWithin(defs) {
  const out = defs.map(() => null);
  let done = false;
  let known = null;
  const knownAsked = availability().then((k) => {
    known = k;
  }, () => {
  });
  const all = Promise.all([...defs.map((row, i) => homeRow(row).then((r) => {
    out[i] = r;
  }, () => {
  })), knownAsked]).then(() => {
    done = true;
  });
  const end = Date.now() + HOME_BUDGET_MS;
  while (!done && Date.now() < end) await Promise.race([all, kino.sleep(Math.min(250, Math.max(1, end - Date.now())))]);
  const rows = onlyWhatPlays(out.filter(Boolean), known);
  if (!rows.length) throw kino.error("unavailable", "no home row could be loaded", { userMessage: t("unavailable") });
  return rows;
}
var AVAILABLE_URL = "https://raw.githubusercontent.com/xuper-plugin/kino-plugin-embed69/main/home/available.json";
var AVAILABLE_KEY = "home:available";
var AVAILABLE_FRESH_MS = 3 * 60 * 60 * 1e3;
var AVAILABLE_KEEP_MS = 7 * DAY_MS;
var AVAILABLE_TIMEOUT_MS = 6e3;
var STRICT_GENRES = ["anime"];
async function availability() {
  let stored = null;
  try {
    stored = JSON.parse(kino.storage.get(AVAILABLE_KEY) || "null");
  } catch (_) {
    stored = null;
  }
  if (stored && Date.now() - Number(stored.at) < AVAILABLE_FRESH_MS) return knownSets(stored);
  try {
    if (typeof kino.fetch !== "function") throw new Error("no fetch");
    const r = await kino.fetch(AVAILABLE_URL, { timeoutMs: AVAILABLE_TIMEOUT_MS });
    const items = r && r.ok ? (JSON.parse(await r.text()) || {}).items : null;
    if (!items || typeof items !== "object") throw new Error("no items");
    const yes = [], no = [];
    for (const [ref, k] of Object.entries(items)) if (k && typeof k.ok === "boolean") (k.ok ? yes : no).push(ref);
    stored = { at: Date.now(), yes, no };
    try {
      kino.storage.set(AVAILABLE_KEY, JSON.stringify(stored), { ttlMs: AVAILABLE_KEEP_MS });
    } catch (_) {
    }
  } catch (_) {
  }
  return stored ? knownSets(stored) : null;
}
var knownSets = (o) => ({ yes: new Set(o.yes || []), no: new Set(o.no || []) });
function onlyWhatPlays(rows, known) {
  if (globalThis.__kinoHomeSnapshot) return rows;
  const strict = (r) => STRICT_GENRES.includes(r.genre);
  const kept = rows.map((r) => ({ ...r, items: r.items.filter((i) => strict(r) ? !!known && known.yes.has(i.ref) : !(known && known.no.has(i.ref))) }));
  const special = new Set(kept.filter(strict).flatMap((r) => r.items.map((i) => i.ref)));
  return kept.map((r) => strict(r) ? r : { ...r, items: r.items.filter((i) => !special.has(i.ref)) }).filter((r) => r.items.length > 0);
}
var SEARCH_CHECK_CAP = 18;
async function availableOnly(items, req) {
  const checks = await Promise.all(items.slice(0, SEARCH_CHECK_CAP).map(async (item) => {
    const m = /^[ms]:(\d+)$/.exec(item.ref || "");
    if (!m) return null;
    try {
      const imdb = await imdbFor(m[1], item.kind === "series" ? "series" : "movie");
      return imdb && await hasTitle(kino, req, imdb, item.kind) ? item : null;
    } catch (_) {
      return null;
    }
  }));
  return checks.filter(Boolean);
}
async function search(query) {
  if (!String(query.q || "").trim()) return [];
  const req = makeReq(kino, { deadline: Date.now() + 3e4 });
  const type = query.type;
  let ranked;
  if (type === "series") {
    const res = await tmdb("/search/tv", { query: query.q });
    ranked = kino.rank.filterRelevant((res?.results || []).map((r) => itemFromTmdb(r, "tv")), titlesOf(query));
  } else if (type === "movie") {
    const res = await tmdb("/search/movie", { query: query.q });
    ranked = kino.rank.filterRelevant((res?.results || []).map((r) => itemFromTmdb(r, "movie")), titlesOf(query));
  } else {
    const [movies, tv] = await Promise.all([
      tmdb("/search/movie", { query: query.q }),
      tmdb("/search/tv", { query: query.q })
    ]);
    const all = [
      ...(movies?.results || []).map((r) => itemFromTmdb(r, "movie")),
      ...(tv?.results || []).map((r) => itemFromTmdb(r, "tv"))
    ];
    ranked = kino.rank.sortBySimilarity(all, titlesOf(query));
  }
  return availableOnly(ranked, req);
}
async function browse(ref, cursor) {
  const page = cursor ? Number(cursor) : 1;
  let path, params = { page }, kind;
  const parts = String(ref).split(":");
  if (parts[0] === "trend" && (parts[1] === "movie" || parts[1] === "tv")) {
    kind = parts[1];
    path = `/trending/${kind}/week`;
  } else if (parts[0] === "list" && (parts[1] === "movie" || parts[1] === "tv") && /^[a-z_]+$/.test(parts[2] || "")) {
    kind = parts[1];
    path = `/${kind}/${parts[2]}`;
  } else if (parts[0] === "popular" && (parts[1] === "movie" || parts[1] === "tv")) {
    kind = parts[1];
    path = `/${kind}/popular`;
  } else if (parts[0] === "anime" && (parts[1] === "tv" || parts[1] === "movie" || parts[1] === "new")) {
    kind = parts[1] === "movie" ? "movie" : "tv";
    path = "/discover/" + kind;
    params = { ...DISCOVER, ...parts[1] === "new" ? animeNewParams() : ANIME, page };
  } else if (parts[0] === "genre" && (parts[1] === "movie" || parts[1] === "tv") && /^\d+$/.test(parts[2] || "")) {
    kind = parts[1];
    path = `/discover/${kind}`;
    params = { ...DISCOVER, with_genres: parts[2], page };
  } else {
    return { items: [] };
  }
  const res = await tmdb(path, params);
  const items = (res?.results || []).filter((r) => r.poster_path).map((r) => itemFromTmdb(r, kind));
  const next = res?.page < res?.total_pages ? String(page + 1) : void 0;
  return { items, next };
}
var TILE_ART_SIZE = "w780";
var MOVIE_ART = {
  28: "/gqrnQA6Xppdl8vIb2eJc58VC1tW.jpg",
  // Action: Mad Max: Fury Road
  12: "/zPACwR32amTNvzId9qyapCWXYDJ.jpg",
  // Adventure: Raiders of the Lost Ark
  16: "/g7CHF8gTLGooTbP4GznIGwaqAGL.jpg",
  // Animation: Coco
  35: "/jK65srQczOKTpW62wPxwwKztGgE.jpg",
  // Comedy: The Grand Budapest Hotel
  80: "/ejdD20cdHNFAYAN2DlqPToXKyzx.jpg",
  // Crime: The Godfather
  99: "/sW7VOrkHKYIeV9PaYc5IqGU2XK8.jpg",
  // Documentary: My Octopus Teacher
  18: "/pNjh59JSxChQktamG3LMp9ZoQzp.jpg",
  // Drama: The Shawshank Redemption
  10751: "/iJgNOTSBNrC90U2xyYq9ln0b35o.jpg",
  // Family: Paddington 2
  14: "/oiwc338EoBgS4sEI2ixAny4KQKg.jpg",
  // Fantasy: The Fellowship of the Ring
  36: "/m4MGxxEgAMqIX9x8MCg5pYeyYjU.jpg",
  // History: The King's Speech
  27: "/nHRUtBwFNnNN70vcQ7lAsjc2T6S.jpg",
  // Horror: A Quiet Place
  10402: "/dcvbs8z0GEXslC1kCT77x19XDeR.jpg",
  // Music: Bohemian Rhapsody
  9648: "/4HWAQu28e2yaWrtupFPGFkdNU7V.jpg",
  // Mystery: Knives Out
  10749: "/zdXnJqBaGFVtLoPNuMeKfEYUViZ.jpg",
  // Romance: The Notebook
  878: "/xJHokMbljvjADYdit5fK5VQsXEG.jpg",
  // Science Fiction: Interstellar
  53: "/iWak7wT0j6ycCc8lKr4NBz9c7n5.jpg",
  // Thriller: Gone Girl
  10752: "/bdD39MpSVhKjxarTxLSfX6baoMP.jpg",
  // War: Saving Private Ryan
  37: "/x4biAVdPVCghBlsVIzB6NmbghIz.jpg"
  // Western: The Good, the Bad and the Ugly
};
var TV_ART = {
  10759: "/yUOFocKDW7MCC5isx4FK8A68QFp.jpg",
  // Action & Adventure: Lost
  16: "/qcSHGC5BfoqBoP99PzDIERYG5Qm.jpg",
  // Animation: The Simpsons
  35: "/l0qVZIpXtIo7km9u5Yqh0nKPOr5.jpg",
  // Comedy: Friends
  80: "/xGexTKCJDkl12dTW4YCBDXWb1AD.jpg",
  // Crime: Money Heist
  99: "/sW7VOrkHKYIeV9PaYc5IqGU2XK8.jpg",
  // Documentary: My Octopus Teacher
  18: "/jP0Rhj9OTPDAwQlHQwOLFDdeE8t.jpg",
  // Drama: Grey's Anatomy
  10751: "/iJgNOTSBNrC90U2xyYq9ln0b35o.jpg",
  // Family: Paddington 2
  9648: "/4HWAQu28e2yaWrtupFPGFkdNU7V.jpg",
  // Mystery: Knives Out
  10765: "/9P4IIMYY3HifqeruZq0ZZ9g7YUi.jpg",
  // Sci-Fi & Fantasy: Stranger Things
  10768: "/bdD39MpSVhKjxarTxLSfX6baoMP.jpg",
  // War & Politics: Saving Private Ryan
  37: "/x4biAVdPVCghBlsVIzB6NmbghIz.jpg"
  // Western: The Good, the Bad and the Ugly
};
var tileArt = (table, genreId) => table[genreId] ? TMDB_IMG + TILE_ART_SIZE + table[genreId] : void 0;
async function categories() {
  const [mg, tg] = await Promise.all([tmdb("/genre/movie/list"), tmdb("/genre/tv/list")]);
  const cats = [];
  for (const g of (mg?.genres || []).slice(0, 12)) cats.push(withArt({ id: "gm" + g.id, title: g.name, ref: "genre:movie:" + g.id }, tileArt(MOVIE_ART, g.id)));
  for (const g of (tg?.genres || []).slice(0, 8)) cats.push(withArt({ id: "gt" + g.id, title: g.name + " (series)", ref: "genre:tv:" + g.id }, tileArt(TV_ART, g.id)));
  return cats.slice(0, 24);
}
var withArt = (tile, art) => art ? { ...tile, art } : tile;
async function episodes(ref) {
  const tmdbId = ref.startsWith("s:") ? ref.slice(2) : ref;
  const meta = await kino.meta({ type: "series", ids: { tmdb: Number(tmdbId) } });
  if (!meta) throw kino.error("not_found", "series not found: tmdb " + tmdbId, { userMessage: t("noMeta") });
  const imdbId = meta.ids?.imdb;
  if (!imdbId) throw kino.error("not_found", "no IMDB id for series tmdb:" + tmdbId, { userMessage: t("noMeta") });
  kino.storage.set("imdb:series:" + tmdbId, imdbId, { ttlMs: 30 * DAY_MS });
  return {
    series: {
      title: meta.title,
      poster: meta.poster,
      backdrop: meta.backdrop,
      overview: meta.overview,
      genres: meta.genres,
      year: meta.year,
      ids: meta.ids,
      runtimeMinutes: meta.runtimeMinutes
    },
    episodes: (meta.episodes || []).map((ep) => ({
      season: ep.season,
      number: ep.number,
      // the IMDB id rides in the ref so resolve() does not need kino.meta again
      ref: "ep:" + imdbId + ":" + ep.season + ":" + ep.number,
      title: ep.title,
      still: ep.still,
      overview: ep.overview,
      airDate: ep.airDate
    }))
  };
}
var SERVER_LABEL = { streamwish: "StreamWish", vidhide: "VidHide", voe: "Voe" };
var SERVER_ORDER = ["vidhide", "streamwish", "voe"];
var STATS_KEY = "srvStats";
var STATS_CAP = 24;
function readStats() {
  try {
    const o = JSON.parse(kino.storage.get(STATS_KEY) || "{}");
    return o && typeof o === "object" ? o : {};
  } catch (_) {
    return {};
  }
}
function scoreOf(id, stats) {
  const s = stats[id] || { ok: 0, fail: 0 };
  return (s.ok + 1) / (s.ok + s.fail + 2);
}
function noteServer(id, ok) {
  try {
    const stats = readStats();
    const s = stats[id] || { ok: 0, fail: 0 };
    s[ok ? "ok" : "fail"] += 1;
    if (s.ok + s.fail > STATS_CAP) {
      s.ok = Math.round(s.ok / 2);
      s.fail = Math.round(s.fail / 2);
    }
    stats[id] = s;
    kino.storage.set(STATS_KEY, JSON.stringify(stats));
  } catch (_) {
  }
}
var CAPTURE_PAGE_MS = CAPTURE_MS + 3e3;
function takeCapture(budget) {
  if (!budget || budget.captures <= 0 || budget.deadline && budget.deadline - Date.now() < CAPTURE_PAGE_MS) return false;
  budget.captures -= 1;
  return true;
}
function languageOrder() {
  const pref = String(kino.config.get("language") || "lat");
  return pref === "esp" ? ["esp", "lat", "sub"] : pref === "sub" ? ["sub", "lat", "esp"] : ["lat", "esp", "sub"];
}
function ordered(copies) {
  const langs = languageOrder();
  const stats = readStats();
  const order = (s) => {
    const i = SERVER_ORDER.indexOf(s);
    return i < 0 ? SERVER_ORDER.length : i;
  };
  const rank = (c) => Math.max(0, langs.indexOf(c.lang)) * 100 + (1 - scoreOf(c.server, stats)) * 20 + order(c.server);
  return [...copies].sort((a, b) => rank(a) - rank(b));
}
var labelOf = (c) => `${t(c.lang)} \xB7 ${SERVER_LABEL[c.server] || c.server}`;
function copyRef(title, c) {
  return title.kind === "tv" ? `cp:ep:${title.imdbId}:${title.season}:${title.episode}:${c.lang}:${c.server}` : `cp:movie:${title.imdbId}:${c.lang}:${c.server}`;
}
function parseCopyRef(ref) {
  const p = ref.split(":");
  if (p[1] === "movie" && p.length === 5) return { title: { kind: "movie", imdbId: p[2] }, lang: p[3], server: p[4] };
  if (p[1] === "ep" && p.length === 7) return { title: { kind: "tv", imdbId: p[2], season: Number(p[3]), episode: Number(p[4]) }, lang: p[5], server: p[6] };
  return null;
}
function toStream(s, c) {
  const out = { url: s.url, label: labelOf(c), headers: { "User-Agent": UA, ...s.headers && typeof s.headers === "object" ? s.headers : {} } };
  if (s.mime) out.mime = s.mime;
  const subs = Array.isArray(s.subtitles) ? s.subtitles.filter((x) => x && x.lang && x.url) : [];
  if (subs.length) out.subtitles = subs;
  if (Number.isFinite(s.durationMs) && s.durationMs > 0) out.durationMs = Math.round(s.durationMs);
  return out;
}
async function open(c, req, budget) {
  try {
    const res = await kino.plugins.call("resolver", "resolve", { url: c.embedUrl, referer: SITE + "/" });
    const s = (res && Array.isArray(res.streams) ? res.streams : []).find((x) => x && x.url);
    if (s) {
      const headers = {};
      if (s.referer) headers.Referer = s.referer;
      if (Array.isArray(s.headers)) {
        for (const h of s.headers) if (h && h.name) headers[h.name] = String(h.value);
      }
      return toStream({ url: s.url, headers, mime: s.kind === "hls" ? HLS : /\.mp4(\?|$)/i.test(s.url) ? "video/mp4" : HLS, subtitles: res.subtitles, durationMs: s.durationMs }, c);
    }
    if (res && res.error === "dead") return null;
  } catch (_) {
  }
  if (!kino.browser || typeof kino.browser.capture !== "function" || !takeCapture(budget)) return null;
  try {
    const page = await kino.browser.capture(c.embedUrl, { timeoutMs: CAPTURE_MS, match: "\\.m3u8|\\.mp4", headers: { Referer: SITE + "/" } });
    const media = page && page.media || [];
    const best = media.find((x) => /m3u8/i.test(x.url)) || media[0];
    if (!best) return null;
    return toStream({ url: best.url, headers: best.headers || { Referer: c.embedUrl }, mime: best.mime || (/\.mp4/i.test(best.url) ? "video/mp4" : HLS) }, c);
  } catch (e) {
    kino.log("[embed69] capture", e && e.code || "failed");
    return null;
  }
}
async function titleOf2(ref) {
  if (ref.startsWith("ep:")) {
    const [, imdbId, season, episode] = ref.split(":");
    return { kind: "tv", imdbId, season: Number(season), episode: Number(episode) };
  }
  if (ref.startsWith("m:")) {
    const tmdbId = ref.slice(2);
    const imdbId = await imdbFor(tmdbId, "movie");
    if (!imdbId) throw kino.error("not_found", "no IMDB id for movie tmdb:" + tmdbId, { userMessage: t("noMeta") });
    return { kind: "movie", imdbId };
  }
  throw kino.error("not_found", "unknown ref: " + ref.slice(0, 40));
}
async function resolverInstalled() {
  try {
    await kino.plugins.call("resolver", "normalizeHost", { url: "https://probe.invalid/" });
    return true;
  } catch (e) {
    return (e && e.code) !== "provider_missing";
  }
}
var std = null;
var standard = () => std ?? (std = makeStandardScreen({
  snapshot: "xuper-plugin/kino-plugin-embed69",
  kino,
  name: "Embed69",
  logo: LOGO,
  logoAspect: LOGO_ASPECT,
  needsResolver: true,
  hasSettings: true,
  tabs: [
    { id: "inicio", label: "Inicio", labelEn: "Home" },
    { id: "peliculas", label: "Pel\xEDculas", labelEn: "Movies" },
    { id: "series", label: "Series", labelEn: "Series" }
  ],
  loadTab: async (tab) => ({ rows: TAB_ROWS[tab] ? await rowsWithin(TAB_ROWS[tab]) : await home() })
}));
async function screen(ctx) {
  await null;
  return standard().screen(ctx && typeof ctx === "object" ? ctx : {});
}
async function screenEvent(ev) {
  await null;
  return standard().screenEvent(ev && typeof ev === "object" ? ev : {});
}
async function resolve(ref) {
  if (!await resolverInstalled()) throw kino.error("unavailable", "resolver missing", { userMessage: t("needResolver") });
  const req = makeReq(kino, { deadline: Date.now() + RESOLVE_MS });
  if (ref.startsWith("cp:")) {
    const want = parseCopyRef(ref);
    if (!want) throw kino.error("not_found", "bad copy ref");
    const copy = (await listCopies(want.title, { kino, req })).find((c) => c.lang === want.lang && c.server === want.server);
    const stream = copy ? await open(copy, req, { captures: MAX_CAPTURES, deadline: Date.now() + RESOLVE_MS }) : null;
    if (copy) noteServer(copy.server, !!stream);
    if (!stream) throw kino.error("not_found", "copy not available: " + want.lang + "/" + want.server, { userMessage: t("noStreams") });
    return stream;
  }
  const title = await titleOf2(ref);
  const copies = ordered(await listCopies(title, { kino, req }));
  if (!copies.length) throw kino.error("not_found", "no copies for " + title.imdbId, { userMessage: t("noStreams") });
  const budget = { captures: MAX_CAPTURES, deadline: Date.now() + RESOLVE_MS };
  let main = null;
  for (const c of copies) {
    const r = await open(c, req, budget);
    noteServer(c.server, !!r);
    if (r) {
      main = r;
      break;
    }
  }
  if (!main) throw kino.error("not_found", "no copy opened for " + title.imdbId, { userMessage: t("noStreams") });
  const rest = copies.slice(copies.findIndex((c) => labelOf(c) === main.label) + 1);
  const alternatives = rest.slice(0, MAX_COPIES).map((c) => ({ label: labelOf(c), ref: copyRef(title, c) }));
  return { ...main, ...alternatives.length ? { alternatives } : {} };
}
async function action(key) {
  if (key === "clearCache") {
    for (const k of kino.storage.keys()) {
      if (k.startsWith("imdb:")) kino.storage.remove(k);
    }
    return { message: t("cacheCleared") };
  }
}
var proto_catalog_search = catalogDoor(search);
var proto_catalog_episodes = catalogEpisodesDoor(episodes);
export {
  STRICT_GENRES,
  action,
  animeNewParams,
  browse,
  categories,
  episodes,
  home,
  onlyWhatPlays,
  proto_catalog_episodes,
  proto_catalog_search,
  resolve,
  screen,
  screenEvent,
  search
};
