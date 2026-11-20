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

// src/browse/model.js
var TAB_IDS = ["inicio"];
var MAX_SLIDES = 6;
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
function slidesOf(rows) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const row of rows) {
    for (const item of row.items) {
      if (out.length >= MAX_SLIDES) return out;
      if (item.adult === true || seen.has(item.id) || !item.backdrop || !HTTPS.test(item.backdrop)) continue;
      const text = typeof item.overview === "string" ? item.overview.trim() : "";
      if (text === "") continue;
      seen.add(item.id);
      out.push({
        id: item.id,
        ref: item.ref,
        kind: item.kind,
        title: item.title,
        image: item.backdrop,
        text: text.length <= MAX_SLIDE_TEXT ? text : `${text.slice(0, MAX_SLIDE_TEXT - 1).trimEnd()}\u2026`
      });
    }
  }
  return out;
}
function railsOf(rows) {
  return rows.filter((r) => r.items && r.items.length > 0).slice(0, MAX_RAILS).map((r) => ({
    id: r.id,
    title: r.title,
    ...r.ref ? { ref: r.ref } : {},
    items: r.items.slice(0, MAX_RAIL_ITEMS).map(cardOf)
  }));
}
function tabOf(page) {
  const rows = page && Array.isArray(page.rows) ? page.rows : [];
  const rails = railsOf(rows);
  if (rails.length === 0) return null;
  return { slides: slidesOf(rows), rails };
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

// src/i18n.js
var WORDS = {
  es: {
    notFound: "No encontr\xE9 este t\xEDtulo en espa\xF1ol.",
    seasonMissing: "Latino todav\xEDa no tiene la temporada {season} de {title} en espa\xF1ol.",
    episodeMissing: "Latino todav\xEDa no tiene el cap\xEDtulo {episode} de la temporada {season} de {title} en espa\xF1ol.",
    notInSpanish: "no disponible en espa\xF1ol",
    sourcesDown: "Las fuentes en espa\xF1ol no responden ahora.",
    tmdbDown: "TMDB no responde ahora. Intenta de nuevo en un rato.",
    noPlayable: "Encontr\xE9 el t\xEDtulo, pero ninguna copia abri\xF3. Intenta de nuevo en un rato.",
    needResolver: "Para reproducir, abre Latino desde el men\xFA e instala el motor de reproducci\xF3n que te pedir\xE1.",
    copyFailed: "Esta copia no abri\xF3. Prueba con otro servidor.",
    lat: "Latino",
    esp: "Castellano",
    sub: "Subtitulado",
    direct: "Directo",
    keepOneSource: "Deja al menos una fuente encendida.",
    healthOk: "ok",
    healthFail: "falla",
    healthNone: "sin datos",
    healthOff: "apagada",
    probeDone: "Prob\xE9 las fuentes con un t\xEDtulo de prueba: {ok} responden, {fail} fallan.",
    probeNoTmdb: "No pude consultar TMDB para la prueba. Intenta de nuevo en un rato.",
    probeNone: "No hay fuentes encendidas para probar.",
    cacheCleared: "Listo: borr\xE9 {n} datos guardados.",
    cacheClearedOne: "Listo: borr\xE9 1 dato guardado.",
    prefsReset: "Restablec\xED tus preferencias.",
    rowMovies: "Estrenos en latino",
    rowSeries: "Series en latino",
    rowHackstore: "Reci\xE9n agregadas",
    rowHackstoreSeries: "Series reci\xE9n agregadas",
    panelTitle: "Latino",
    tabCopy: "Esta copia",
    tabSummary: "Resumen",
    tabAvail: "Disponibilidad",
    tabPrefs: "Preferencias",
    tabFail: "Si falla",
    tabError: "No se pudo cargar esta pesta\xF1a",
    nowPlaying: "Reproduciendo ahora",
    copyLang: "Idioma: {v}",
    copyQuality: "Calidad: {v}",
    copyServer: "Servidor: {v}",
    copySite: "Fuente: {v}",
    copyManual: "Cambiaste de copia: la elegida sola era {v}",
    copyChosen: "Elegida entre {n} copias",
    copyChosenOne: "Elegida entre 1 copia",
    copyNoInfo: "Todav\xEDa no s\xE9 qu\xE9 copia suena.",
    statResolution: "Imagen {v}",
    statNetwork: "Red {v}",
    statStalls: "Cortes en esta sesi\xF3n: {v}",
    netWifi: "Wi-Fi",
    netEthernet: "cable",
    netCellular: "datos m\xF3viles",
    netOther: "otra red",
    availNoTmdb: "Este t\xEDtulo no tiene ficha para revisar",
    availPartial: "Respuesta parcial: algunas fuentes no contestaron",
    availSeasons: "Temporadas sin versi\xF3n en espa\xF1ol: {v}",
    availNone: "Ninguna fuente contest\xF3 con copias de este t\xEDtulo",
    prefPreferred: "Idioma preferido",
    prefMaxQuality: "Calidad m\xE1xima",
    langLat: "Latino",
    langEsp: "Castellano",
    langSub: "Subtitulado",
    qAuto: "Autom\xE1tica",
    qUpTo: "Hasta {v}",
    qUpTo480: "Hasta 480p (ahorra datos)",
    prefAvoid: "Evitar {v}",
    prefAvoidHint: "Pasa al final de la lista, no se borra",
    prefReset: "Restablecer preferencias",
    prefResetConfirm: "\xBFVolver a tus ajustes de siempre?",
    prefApplies: "Se aplica al abrir la pr\xF3xima copia",
    prefSaved: "Listo: se aplica en la pr\xF3xima copia",
    nextEp: "Siguiente: T{s} \xB7 E{e}{tail}",
    nextSeason: "Siguiente: temporada {s}, E{e}{tail}",
    nextEnd: "Fin de la temporada {s}",
    nextSpanish: "en espa\xF1ol en {v}",
    nextSubOnly: "solo subtitulado",
    nextNone: "no encontrado en espa\xF1ol",
    nextChecking: "comprobando\u2026",
    prefNow: "Ahora: {v}",
    prefFirst: "{v} primero",
    prefUpTo: "hasta {v}",
    prefAutoQ: "calidad autom\xE1tica",
    prefAvoidList: "evitar: {v}",
    failTips: "Si una copia no abre: prueba otra desde el men\xFA Servidor, revisa tu Wi-Fi o int\xE9ntalo m\xE1s tarde.",
    availNoEpisode: "sin este cap\xEDtulo",
    availNoTitle: "sin esta pel\xEDcula",
    availSeasonGone: "Esta temporada no tiene versi\xF3n en espa\xF1ol",
    prefWins: "Lo que cambies aqu\xED manda sobre Ajustes hasta que uses Restablecer (abajo)",
    failAllGood: "Todo bien: en esta sesi\xF3n no ha fallado ninguna copia",
    failTimeout: "El servidor tard\xF3 en contestar",
    failNetwork: "No hubo conexi\xF3n con el servidor",
    failNotFound: "El servidor ya no tiene esta copia",
    failUnavailable: "El servidor no est\xE1 disponible ahora",
    failGeneric: "La copia no abri\xF3",
    failTried: "Copias probadas: {v}",
    failHowTo: "Abre el men\xFA Servidor del reproductor para elegir otra copia",
    failReport: "Avisar de esta copia",
    failReportConfirm: "Se enviar\xE1 un aviso t\xE9cnico sin datos personales",
    failReported: "Listo: se env\xEDa el aviso si tienes los reportes activados",
    failAlready: "Ya avis\xE9 de esta copia en las \xFAltimas 12 horas",
    failReportOff: "El aviso no est\xE1 activo en Ajustes",
    stallsHint: "Se ha cortado {n} veces: mira la pesta\xF1a Si falla",
    sumRating: "Calificaci\xF3n {v}",
    sumCast: "Reparto: {v}",
    tabHome: "Inicio",
    tabMovies: "Pel\xEDculas",
    tabSeries: "Series",
    brWatch: "Ver",
    dEpisodeN: "Episodio {n}",
    dSeasonN: "Temporada {n}",
    dSeasonsN: "{n} temporadas",
    dSeriesGo: "Ver episodios",
    dMore: "M\xE1s opciones",
    dCreators: "Creaci\xF3n: {v}",
    dDirector: "Direcci\xF3n: {v}",
    dCast: "Reparto",
    dEpisodes: "Episodios",
    dSimilar: "M\xE1s como esto",
    dSeeInKino: "Ver en Kino",
    brMore: "Ver m\xE1s",
    brInfo: "M\xE1s informaci\xF3n",
    brRecent: "Continuar viendo",
    brSearch: "Buscar",
    brSearchHint: "Buscar en Latino",
    brSearchTitle: "Buscar",
    brSearchedBefore: "Buscado recientemente",
    brNoResults: "No encontramos nada con esas palabras.",
    brSearchFailed: "No se pudo buscar. Revisa tu conexi\xF3n e int\xE9ntalo de nuevo.",
    brFailed: "No se pudo cargar esta secci\xF3n. Revisa tu conexi\xF3n e int\xE9ntalo de nuevo.",
    brRetry: "Reintentar",
    brEmpty: "A\xFAn no hay nada aqu\xED.",
    brBack: "Atr\xE1s",
    brClose: "Cerrar",
    brSettings: "Configuraci\xF3n",
    seriesGenre: "Series de {g}",
    badge_2160p: "4K",
    g_accion: "Acci\xF3n",
    g_comedia: "Comedia",
    g_drama: "Drama",
    g_terror: "Terror",
    g_suspense: "Suspenso",
    g_animacion: "Animaci\xF3n",
    g_crimen: "Crimen",
    g_aventura: "Aventura",
    g_romance: "Romance",
    g_familia: "Familia",
    g_misterio: "Misterio",
    "g_ciencia-ficcion": "Ciencia ficci\xF3n",
    g_fantasia: "Fantas\xEDa",
    "g_sci-fi-fantasy": "Ciencia ficci\xF3n y fantas\xEDa",
    "g_action-adventure": "Acci\xF3n y aventura",
    g_documental: "Documental",
    g_historia: "Historia",
    g_musica: "M\xFAsica",
    g_belica: "B\xE9lica",
    g_western: "Del Oeste",
    g_kids: "Infantil",
    "g_war-politics": "Guerra y pol\xEDtica",
    g_reality: "Reality"
  },
  en: {
    notFound: "I couldn't find this title in Spanish.",
    seasonMissing: "Latino doesn't have season {season} of {title} in Spanish yet.",
    episodeMissing: "Latino doesn't have episode {episode} of season {season} of {title} in Spanish yet.",
    notInSpanish: "not available in Spanish",
    sourcesDown: "The Spanish sources aren't answering right now.",
    tmdbDown: "TMDB isn't answering right now. Try again in a while.",
    noPlayable: "I found the title, but no copy opened. Try again in a while.",
    needResolver: "To play, open Latino from the menu and install the playback engine it asks for.",
    copyFailed: "This copy didn't open. Try another server.",
    lat: "Latin Spanish",
    esp: "Spain Spanish",
    sub: "Subtitled",
    direct: "Direct",
    keepOneSource: "Keep at least one source on.",
    healthOk: "ok",
    healthFail: "fails",
    healthNone: "no data",
    healthOff: "off",
    probeDone: "Tested the sources with a sample title: {ok} answer, {fail} fail.",
    probeNoTmdb: "I couldn't reach TMDB for the test. Try again in a while.",
    probeNone: "No sources are on to test.",
    cacheCleared: "Done: cleared {n} saved items.",
    cacheClearedOne: "Done: cleared 1 saved item.",
    prefsReset: "Your preferences are back to the defaults.",
    rowMovies: "New in Latin Spanish",
    rowSeries: "Series in Latin Spanish",
    rowHackstore: "Just added",
    rowHackstoreSeries: "Series just added",
    panelTitle: "Latino",
    tabCopy: "This copy",
    tabSummary: "Summary",
    tabAvail: "Availability",
    tabPrefs: "Preferences",
    tabFail: "If it fails",
    tabError: "This tab couldn't load",
    nowPlaying: "Playing now",
    copyLang: "Language: {v}",
    copyQuality: "Quality: {v}",
    copyServer: "Server: {v}",
    copySite: "Source: {v}",
    copyManual: "You switched copies: the automatic pick was {v}",
    copyChosen: "Chosen from {n} copies",
    copyChosenOne: "Chosen among 1 copy",
    copyNoInfo: "I don't know yet which copy is playing.",
    statResolution: "Picture {v}",
    statNetwork: "Network {v}",
    statStalls: "Stalls this session: {v}",
    netWifi: "Wi-Fi",
    netEthernet: "wired",
    netCellular: "mobile data",
    netOther: "other network",
    availNoTmdb: "This title has no page to check",
    availPartial: "Partial answer: some sources did not reply",
    availSeasons: "Seasons without a Spanish version: {v}",
    availNone: "No source answered with copies of this title",
    prefPreferred: "Preferred language",
    prefMaxQuality: "Maximum quality",
    langLat: "Latin Spanish",
    langEsp: "Castilian",
    langSub: "Subtitled",
    qAuto: "Automatic",
    qUpTo: "Up to {v}",
    qUpTo480: "Up to 480p (saves data)",
    prefAvoid: "Avoid {v}",
    prefAvoidHint: "Moves to the end of the list, never removed",
    prefReset: "Reset preferences",
    prefResetConfirm: "Go back to your usual settings?",
    prefApplies: "Applies when the next copy opens",
    prefSaved: "Done: applies on the next copy",
    nextEp: "Next: S{s} \xB7 E{e}{tail}",
    nextSeason: "Next: season {s}, E{e}{tail}",
    nextEnd: "End of season {s}",
    nextSpanish: "in Spanish on {v}",
    nextSubOnly: "subtitled only",
    nextNone: "not found in Spanish",
    nextChecking: "checking\u2026",
    prefNow: "Now: {v}",
    prefFirst: "{v} first",
    prefUpTo: "up to {v}",
    prefAutoQ: "automatic quality",
    prefAvoidList: "avoid: {v}",
    failTips: "If a copy won't open: try another from the Server menu, check your Wi-Fi or try again later.",
    availNoEpisode: "no copy of this episode",
    availNoTitle: "no copy of this film",
    availSeasonGone: "This season has no Spanish version",
    prefWins: "What you change here beats Settings until you use Reset (below)",
    failAllGood: "All good: no copy has failed in this session",
    failTimeout: "The server took too long to answer",
    failNetwork: "There was no connection to the server",
    failNotFound: "The server no longer has this copy",
    failUnavailable: "The server isn't available right now",
    failGeneric: "The copy didn't open",
    failTried: "Copies tried: {v}",
    failHowTo: "Open the player's Server menu to pick another copy",
    failReport: "Report this copy",
    failReportConfirm: "A technical notice with no personal data will be sent",
    failReported: "Done: the notice is sent if you have reports turned on",
    failAlready: "I already reported this copy in the last 12 hours",
    failReportOff: "Reporting isn't turned on in Settings",
    stallsHint: 'Playback has stalled {n} times: see the "If it fails" tab',
    sumRating: "Rating {v}",
    sumCast: "Cast: {v}",
    tabHome: "Home",
    tabMovies: "Movies",
    tabSeries: "Series",
    brWatch: "Watch",
    dEpisodeN: "Episode {n}",
    dSeasonN: "Season {n}",
    dSeasonsN: "{n} seasons",
    dSeriesGo: "Watch episodes",
    dMore: "More options",
    dCreators: "Created by: {v}",
    dDirector: "Directed by: {v}",
    dCast: "Cast",
    dEpisodes: "Episodes",
    dSimilar: "More like this",
    dSeeInKino: "Open in Kino",
    brMore: "See more",
    brInfo: "More info",
    brRecent: "Continue watching",
    brSearch: "Search",
    brSearchHint: "Search Latino",
    brSearchTitle: "Search",
    brSearchedBefore: "Recently searched",
    brNoResults: "Nothing matched those words.",
    brSearchFailed: "The search failed. Check your connection and try again.",
    brFailed: "This section could not be loaded. Check your connection and try again.",
    brRetry: "Retry",
    brEmpty: "Nothing here yet.",
    brBack: "Back",
    brClose: "Close",
    brSettings: "Settings",
    seriesGenre: "{g} series",
    badge_2160p: "4K",
    g_accion: "Action",
    g_comedia: "Comedy",
    g_drama: "Drama",
    g_terror: "Horror",
    g_suspense: "Thriller",
    g_animacion: "Animation",
    g_crimen: "Crime",
    g_aventura: "Adventure",
    g_romance: "Romance",
    g_familia: "Family",
    g_misterio: "Mystery",
    "g_ciencia-ficcion": "Science fiction",
    g_fantasia: "Fantasy",
    "g_sci-fi-fantasy": "Sci-fi and fantasy",
    "g_action-adventure": "Action and adventure",
    g_documental: "Documentary",
    g_historia: "History",
    g_musica: "Music",
    g_belica: "War",
    g_western: "Western",
    g_kids: "Kids",
    "g_war-politics": "War and politics",
    g_reality: "Reality"
  }
};
function langOf(kino2 = globalThis.kino) {
  return String(kino2 && kino2.lang || "").toLowerCase().startsWith("en") ? "en" : "es";
}
function t(key, kino2 = globalThis.kino) {
  const words = WORDS[langOf(kino2)];
  return words[key] ?? WORDS.es[key] ?? key;
}
function tf(key, vars, kino2 = globalThis.kino) {
  return t(key, kino2).replace(/\{(\w+)\}/g, (m, k) => vars && vars[k] != null ? String(vars[k]) : m);
}
var both = (key, vars) => {
  const one = (lang) => tf(key, vars && Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, typeof v === "function" ? v(lang) : v])), { lang });
  return { es: one("es"), en: one("en") };
};
var KEYS = { es: Object.keys(WORDS.es), en: Object.keys(WORDS.en) };

// src/browse/detail.js
var HTTPS2 = /^https:\/\//;
var MAX_EPISODES = 80;
var MAX_CAST = 12;
var LEAD_MAX = 140;
var TMDB_IMG = "https://image.tmdb.org/t/p/w342";
var twin = (key, field = "text", vars) => {
  const w = both(key, vars);
  return { [field]: w.es, [field + "En"]: w.en };
};
var same = (text) => ({ text, textEn: text });
var num = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};
var https = (v) => typeof v === "string" && HTTPS2.test(v) && v.length <= 2048 ? v : void 0;
var opensPage = (card) => !!card && (card.kind === "movie" || card.kind === "series") && typeof card.ref === "string" && card.ref.length < 600 && typeof card.id === "string";
var cardNode = (card, size, scope) => ({
  type: "titleCard",
  key: `${scope}-${card.id}`,
  size,
  item: card,
  ...opensPage(card) ? { onTap: { go: { title: { ref: card.ref, kind: card.kind, id: card.id, title: card.title } } } } : {}
});
var cardRow = (items, key, size) => ({ type: "SingleChildScrollView", key: key + "-s", direction: "horizontal", children: [{ type: "Row", key: key + "-r", gap: 12, children: items.map((c) => cardNode(c, size, key)) }] });
var cardGrid = (items, key) => ({ type: "GridView", key, columns: { compact: 3, expanded: 6 }, children: items.map((c) => cardNode(c, "medium", key)) });
function pushOf(arg) {
  let a = null;
  try {
    a = JSON.parse(String(arg));
  } catch (_) {
    a = null;
  }
  if (!a || typeof a.open !== "string" || typeof a.i !== "string" || a.k !== "movie" && a.k !== "series") return null;
  return { push: "detail", params: { open: a.open, i: a.i, t: typeof a.t === "string" ? a.t.slice(0, 100) : "", k: a.k, d: Number(a.d) || 0, y: Number(a.y) || 0 } };
}
function backdropsOf(images, first) {
  const base = "https://image.tmdb.org/t/p/w780";
  const list = (images && images.backdrops || []).filter((b) => b && typeof b.file_path === "string" && b.file_path.startsWith("/") && b.width >= 1e3).sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0)).map((b) => base + b.file_path);
  const out = [];
  for (const u of [first, ...list]) if (u && !out.some((x) => x.slice(x.lastIndexOf("/")) === u.slice(u.lastIndexOf("/")))) out.push(u);
  return out.slice(0, 6);
}
var hoursOf = (min) => {
  const m = num(min);
  return m > 0 ? m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min` : "";
};
var MONTHS = {
  es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
};
var dateText = (iso) => {
  const [y, m, d] = String(iso).split("-").map(Number);
  return m >= 1 && m <= 12 ? { es: `${d} ${MONTHS.es[m - 1]} ${y}`, en: `${MONTHS.en[m - 1]} ${d}, ${y}` } : { es: iso, en: iso };
};
async function loadDetail(args) {
  const kind = args.k === "movie" ? "movie" : "series";
  const tmdbId = Number(args.d) || 0;
  const year = Number(args.y) || 0;
  let meta = null;
  if (typeof kino.meta === "function") {
    if (tmdbId) meta = await kino.meta({ type: kind, ids: { tmdb: tmdbId } }).catch(() => null);
    if (!meta && kino.meta.byTitle === true && args.t) meta = await kino.meta({ type: kind, title: String(args.t), ...year >= 1870 && year <= 2100 ? { year } : {} }).catch(() => null);
  }
  if (!meta) throw Object.assign(new Error("no meta"), { code: "not_found" });
  const ids = meta.ids || (tmdbId ? { tmdb: tmdbId } : {});
  const d = {
    kind,
    title: String(meta.title || args.t || "").slice(0, 200),
    overview: String(meta.overview || ""),
    year: num(meta.year),
    backdrop: https(meta.backdrop) || https(meta.poster),
    logo: https(meta.logo),
    genres: (meta.genres || []).filter((g) => typeof g === "string").slice(0, 4),
    runtime: num(meta.runtimeMinutes),
    tagline: String(meta.tagline || ""),
    certification: String(meta.certification || ""),
    directors: (meta.directors || []).slice(0, 3),
    ratings: (meta.ratings || []).slice(0, 3),
    cast: (meta.cast || []).slice(0, MAX_CAST),
    ids,
    episodes: [],
    similar: []
  };
  if (kind === "series") {
    d.episodes = (Array.isArray(meta.episodes) ? meta.episodes : []).filter((e) => num(e.season) >= 1 && num(e.number) >= 1).slice(0, 600).map((e) => ({ s: num(e.season), n: num(e.number), title: String(e.title || "").slice(0, 120), overview: String(e.overview || "").slice(0, 110), still: https(e.still), air: /^\d{4}-\d{2}-\d{2}/.test(String(e.airDate || "")) ? String(e.airDate).slice(0, 10) : "" }));
  }
  if (ids.tmdb && typeof kino.tmdb === "function") {
    try {
      const credits = await kino.tmdb(`/${kind === "movie" ? "movie" : "tv"}/${ids.tmdb}/credits`, { language: "es-MX" });
      const cast = (credits && credits.cast || []).filter((c) => c && c.name).slice(0, MAX_CAST).map((c) => ({ name: String(c.name), character: String(c.character || ""), photo: typeof c.profile_path === "string" && c.profile_path.startsWith("/") ? "https://image.tmdb.org/t/p/w185" + c.profile_path : void 0 }));
      if (cast.length) d.cast = cast;
    } catch (_) {
    }
    try {
      d.images = backdropsOf(await kino.tmdb(`/${kind === "movie" ? "movie" : "tv"}/${ids.tmdb}/images`, { include_image_language: "null,es,en" }), d.backdrop);
    } catch (_) {
    }
    try {
      const data = await kino.tmdb(`/${kind === "movie" ? "movie" : "tv"}/${ids.tmdb}/recommendations`, { language: "es-MX" });
      d.similar = (data && data.results || []).filter((x) => x && x.id && (x.title || x.name) && x.poster_path).slice(0, 12).map((x) => ({
        id: (kind === "movie" ? "m-" : "s-") + x.id,
        ref: (kind === "movie" ? "m:" : "s:") + x.id,
        kind,
        title: String(x.title || x.name).slice(0, 200),
        poster: TMDB_IMG + x.poster_path,
        ids: { tmdb: x.id }
      }));
    } catch (_) {
    }
  }
  return d;
}
var heroSkeleton = () => ({ type: "Skeleton", key: "heroSkeleton", shape: "block", height: { compact: 200, expanded: 320 } });
var railSkeleton = () => ({
  type: "Column",
  key: "dskel1",
  gap: 8,
  children: [
    { type: "Skeleton", shape: "line", width: 120 },
    { type: "Row", gap: 12, children: [1, 2, 3].map((i) => ({ type: "Skeleton", shape: "card", key: `dsk${i}`, flex: 1 })) }
  ]
});
var sectionTitle = (key) => ({ type: "Text", ...twin(key), style: "h4" });
var episodeGo = (d, r) => ({ go: { title: { ref: r.ref, kind: "series", id: r.id, title: d.title } } });
function episodeRow(d, r, ep) {
  const facts = ep.air ? dateText(ep.air) : null;
  const heading = ep.title ? { text: `${ep.n}. ${ep.title}`, textEn: `${ep.n}. ${ep.title}` } : twin("dEpisodeN", "text", { n: ep.n });
  return {
    type: "Row",
    key: `ep-${ep.s}-${ep.n}`,
    gap: 12,
    crossAxisAlignment: "center",
    onTap: episodeGo(d, r),
    canRequestFocus: true,
    children: [
      { type: "Image", key: `epi-${ep.s}-${ep.n}`, width: 120, aspect: "16:9", fit: "cover", radius: "medium", ...ep.still ? { url: ep.still } : {}, fallback: { type: "Skeleton", shape: "block", height: 64 } },
      { type: "Column", flex: 1, gap: 4, children: [
        { type: "Text", bold: true, maxLines: 2, ...heading },
        ...facts ? [{ type: "Text", style: "caption", color: "muted", text: facts.es, textEn: facts.en }] : [],
        ...ep.overview ? [{ type: "Text", style: "caption", color: "muted", maxLines: 2, ...same(ep.overview) }] : []
      ] }
    ]
  };
}
function castItem(c) {
  const name = String(c.name || "").slice(0, 60);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return {
    type: "Column",
    key: "cast-" + name.replace(/[^A-Za-z0-9]/g, "").slice(0, 24) + "-" + String(c.character || "").length,
    width: 96,
    gap: 4,
    crossAxisAlignment: "center",
    canRequestFocus: true,
    children: [
      { type: "CircleAvatar", radius: 32, ...https(c.photo) ? { image: https(c.photo) } : {}, text: initials, textEn: initials },
      { type: "Text", ...same(name), style: "caption", maxLines: 2 },
      ...c.character ? [{ type: "Text", ...same(String(c.character).slice(0, 40)), style: "caption", color: "muted", maxLines: 1 }] : []
    ]
  };
}
function detailView({ r, entry, season, logo: logo2, back }) {
  const d = entry && entry.d;
  const appBar = { type: "AppBar", mergeWithKinoBar: true, dense: true, divider: false, leading: back, title: logo2 };
  const body = [];
  let hero2 = null;
  if (!entry) {
    hero2 = heroSkeleton();
    body.push(railSkeleton());
  } else if (!d) {
    body.push({ type: "MaterialBanner", key: "detailFailed", role: "error", ...twin("brFailed"), action: { ...twin("brRetry", "label"), onTap: "dretry" } });
    body.push({ type: "ElevatedButton", key: "dkino", icon: "play", ...twin("dSeeInKino", "labelText"), onPressed: { go: { title: { ref: r.ref, kind: r.kind, id: r.id, title: r.title } } } });
  } else {
    const series = d.kind === "series";
    const seasons = [...new Set(d.episodes.map((e) => e.s))].sort((a, b) => a - b);
    const shown = seasons.includes(season) ? season : seasons[0];
    const toKino = { go: { title: { ref: r.ref, kind: d.kind, id: r.id, title: r.title || d.title } } };
    const buttons = series ? [{ type: "ElevatedButton", key: "dplay", ...twin("dSeriesGo", "labelText"), icon: "play", autofocus: true, onPressed: toKino }] : [
      { type: "ElevatedButton", key: "dplay", ...twin("brWatch", "labelText"), icon: "play", autofocus: true, onPressed: { go: { play: { ref: r.ref, kind: "movie", id: r.id, title: d.title } } } },
      { type: "TextButton", key: "dmore", ...twin("dMore", "labelText"), onPressed: toKino }
    ];
    const lead = d.tagline || (d.overview.length <= LEAD_MAX ? d.overview : d.overview.slice(0, LEAD_MAX - 1).trimEnd() + "\u2026");
    const images = (d.images && d.images.length ? d.images : [d.backdrop || ""]).slice(0, 6);
    const slide = (image, i) => ({
      type: "heroCard",
      key: i ? "dhero-" + i : "dhero",
      h: { compact: 240, expanded: 320 },
      title: d.title,
      titleEn: d.title,
      ...lead ? same(lead) : {},
      ...image ? { image } : {},
      ...d.logo ? { logo: d.logo } : {},
      buttons: i ? buttons.map((b) => ({ ...b, key: b.key + "-" + i, autofocus: false })) : buttons
    });
    hero2 = images.length > 1 ? { type: "PageView", key: "hero" + images.length, autoPlayMs: 6e3, children: images.map(slide) } : slide(images[0], 0);
    const rating = d.ratings.find((x) => x.source === "imdb") || d.ratings.find((x) => x.source === "tmdb");
    const facts = [];
    if (rating) facts.push("\u2605 " + rating.value);
    if (d.year) facts.push(String(d.year));
    if (d.certification) facts.push(d.certification);
    if (d.runtime) facts.push(hoursOf(d.runtime));
    const es = facts.concat(series && seasons.length ? [both("dSeasonsN", { n: seasons.length }).es] : []);
    const en = facts.concat(series && seasons.length ? [both("dSeasonsN", { n: seasons.length }).en] : []);
    if (es.length) body.push({ type: "Text", key: "dfacts", style: "h4", text: es.join("  \xB7  "), textEn: en.join("  \xB7  ") });
    if (d.genres.length) body.push({ type: "Row", key: "dgenres", gap: 8, children: d.genres.map((g, i) => ({ type: "Badge", key: "dg-" + i, ...same(g) })) });
    if (d.overview) body.push({ type: "Text", key: "dsynopsis", canRequestFocus: true, ...same(d.overview) });
    if (d.directors.length) body.push({ type: "Text", ...twin(series ? "dCreators" : "dDirector", "text", { v: d.directors.join(", ") }), color: "muted" });
    if (d.cast.length) {
      body.push(sectionTitle("dCast"));
      body.push({ type: "SingleChildScrollView", key: "dcast", direction: "horizontal", children: [{ type: "Row", gap: 12, children: d.cast.map(castItem) }] });
    }
    if (series && seasons.length) {
      body.push(seasons.length > 1 ? { type: "DropdownButton", key: "dseason", value: String(shown), onChanged: "season", options: seasons.map((s) => {
        const w = both("dSeasonN", { n: s });
        return { value: String(s), label: w.es, labelEn: w.en };
      }) } : sectionTitle("dEpisodes"));
      for (const ep of d.episodes.filter((e) => e.s === shown).slice(0, MAX_EPISODES)) body.push(episodeRow(d, r, ep));
    }
    if (d.similar.length) {
      body.push(sectionTitle("dSimilar"));
      body.push(cardRow(d.similar, "dsimilar", "small"));
    }
  }
  return {
    type: "Scaffold",
    appBar,
    body: { type: "SingleChildScrollView", key: "detail-page", children: [...hero2 ? [hero2] : [], { type: "Column", padding: { compact: 12, expanded: 24 }, gap: 16, children: body }] },
    ...!entry ? { every: { ms: 1e3, event: "dtick" } } : {}
  };
}

// src/browse/view.js
var TAB_KEYS = { inicio: "tabHome", peliculas: "tabMovies", series: "tabSeries" };
var POLL_MS = 1500;
var SEARCH_CAP = 60;
var twin2 = (key, field = "text", vars) => {
  const w = both(key, vars);
  return { [field]: w.es, [field + "En"]: w.en };
};
var logo = () => ({ type: "Text", key: "logo", text: "Embed69", textEn: "Embed69", style: "h4" });
var tabBar = (active) => ({ type: "TabBar", key: "tabs", divider: false, value: active, onChanged: "tab", tabs: TAB_IDS.map((id) => ({ value: id, ...twin2(TAB_KEYS[id], "label") })) });
var railSkeleton2 = (n) => ({
  type: "Column",
  key: "skel" + n,
  gap: 8,
  children: [
    { type: "Skeleton", shape: "line", width: 120 },
    { type: "Row", gap: 12, sizes: ["compact"], children: [1, 2, 3].map((i) => ({ type: "Skeleton", shape: "card", key: `sk${n}c${i}`, flex: 1 })) },
    { type: "Row", gap: 12, sizes: ["medium", "expanded"], children: [1, 2, 3, 4, 5, 6].map((i) => ({ type: "Skeleton", shape: "card", key: `sk${n}w${i}`, flex: 1 })) }
  ]
});
var gridSkeleton = () => ({
  type: "Column",
  key: "gridSkeleton",
  gap: 12,
  children: [
    ...[1, 2].map((r) => ({ type: "Row", gap: 12, sizes: ["compact"], key: `gc${r}`, children: [1, 2, 3].map((i) => ({ type: "Skeleton", shape: "card", key: `gc${r}-${i}`, flex: 1 })) })),
    ...[1, 2].map((r) => ({ type: "Row", gap: 12, sizes: ["medium", "expanded"], key: `gw${r}`, children: [1, 2, 3, 4, 5, 6].map((i) => ({ type: "Skeleton", shape: "card", key: `gw${r}-${i}`, flex: 1 })) }))
  ]
});
var heroSkeleton2 = () => ({ type: "Skeleton", key: "heroSkeleton", shape: "block", height: { compact: 200, expanded: 320 } });
var slideNode = (s) => ({
  type: "heroCard",
  key: "slide-" + s.id,
  h: { compact: 200, expanded: 240 },
  ...s.logo ? { logo: s.logo } : {},
  title: s.title,
  text: s.text,
  image: s.image,
  buttons: [
    {
      type: "ElevatedButton",
      key: "watch-" + s.id,
      ...twin2("brWatch", "labelText"),
      icon: "play",
      onPressed: { go: { play: { ref: s.ref, kind: s.kind, id: s.id, title: s.title } } }
    },
    {
      type: "TextButton",
      key: "info-" + s.id,
      ...twin2("brInfo", "labelText"),
      onPressed: { go: { title: { ref: s.ref, kind: s.kind, id: s.id, title: s.title } } }
    }
  ]
});
var hero = (slides) => slides.length === 1 ? slideNode(slides[0]) : {
  type: "PageView",
  key: "hero" + slides.length,
  autoPlayMs: 6e3,
  children: slides.map(slideNode)
};
var rail = (r, key, titleOverride) => ({
  type: "Column",
  key,
  gap: 8,
  children: [
    { type: "Row", key: key + "-h", crossAxisAlignment: "center", children: [
      { type: "Text", style: "h4", flex: 1, text: titleOverride ? titleOverride.title : r.title, textEn: titleOverride ? titleOverride.titleEn : r.title },
      ...r.ref ? [{ type: "TextButton", key: key + "-more", ...twin2("brMore", "labelText"), onPressed: { go: { browse: { ref: r.ref, title: r.title } } } }] : []
    ] },
    cardRow(r.items, key, "medium")
  ]
});
function browseView({ tab, data, recent, pending, failed, device = "phone" }) {
  const tv = device === "tv";
  const gear = { type: "IconButton", key: "settingsButton", icon: "settings", ...twin2("brSettings", "labelText"), ...twin2("brSettings", "tooltip"), onPressed: { event: "go", arg: "settings" } };
  const active = TAB_IDS.includes(tab) ? tab : TAB_IDS[0];
  const body = [];
  if (data) {
    if (data.slides.length > 0) body.push(hero(data.slides));
    if (recent.length > 0) body.push(rail({ items: recent }, "recent", twin2("brRecent", "title")));
    for (const r of data.rails) body.push(rail(r, "rail-" + String(r.id).replace(/[^A-Za-z0-9_-]/g, "_")));
    if (data.rails.length === 0) body.push({ type: "Text", ...twin2("brEmpty", "text"), color: "muted" });
  } else if (failed) {
    body.push({
      type: "MaterialBanner",
      key: "loadFailed",
      role: "error",
      ...twin2("brFailed"),
      action: { ...twin2("brRetry", "label"), onTap: "retry" }
    });
  } else {
    body.push(heroSkeleton2(), railSkeleton2(1), railSkeleton2(2), railSkeleton2(3));
  }
  const isBanner = (n) => !!n && (n.type === "heroCard" || n.key === "heroSkeleton" || n.type === "PageView" && String(n.key).startsWith("hero"));
  const banner = body.length > 0 && isBanner(body[0]) ? body.shift() : null;
  return {
    type: "Scaffold",
    appBar: {
      type: "AppBar",
      // One bar instead of two (Kino 0.9.81+; an older Kino draws its own bar above and this one under it): the close button where
      // Kino's was and the plugin's logo where its name was (its name when the logo cannot be drawn), with no line under it.
      mergeWithKinoBar: true,
      dense: true,
      divider: false,
      leading: { type: "IconButton", key: "close", icon: "close", ...twin2("brClose", "labelText"), ...twin2("brClose", "tooltip"), onPressed: { go: { close: true } } },
      // On a TV the search is a button of the bar (a floating one is hard to reach with a remote); elsewhere it floats.
      actions: tv ? [{ type: "IconButton", key: "searchButton", icon: "search", ...twin2("brSearch", "labelText"), ...twin2("brSearch", "tooltip"), onPressed: { go: { searchScreen: true } } }, gear] : [gear],
      title: tv ? { type: "Row", key: "titleRow", gap: 24, crossAxisAlignment: "center", children: [logo(), tabBar(active)] } : logo()
    },
    ...tv ? {} : { floatingActionButton: { type: "FloatingActionButton", key: "searchFab", icon: "search", ...twin2("brSearch", "tooltip"), onPressed: { go: { searchScreen: true } } } },
    // The tabs stay pinned under the bar; only the rows scroll.
    body: { type: "Column", key: "page", children: [
      // The tabs line up with the bar's buttons and the cards below (a wide window and the TV pad their content by 24).
      ...tv ? [] : [{ type: "Column", key: "tabsRow", padding: { compact: 0, expanded: 24 }, children: [tabBar(active)] }],
      { type: "SingleChildScrollView", key: "browse-" + active, flex: 1, children: [...banner ? [banner] : [], { type: "Column", padding: { compact: 12, expanded: 24 }, gap: 16, children: body }] }
    ] },
    ...pending ? { every: { ms: POLL_MS, event: "tick" } } : {}
  };
}
function settingsView() {
  return {
    type: "Scaffold",
    appBar: {
      type: "AppBar",
      mergeWithKinoBar: true,
      dense: true,
      divider: false,
      leading: { type: "IconButton", key: "back", icon: "arrow_back", ...twin2("brBack", "labelText"), ...twin2("brBack", "tooltip"), onPressed: "back" },
      title: logo()
    },
    body: { type: "SingleChildScrollView", key: "settings-page", children: [{ type: "Column", padding: { compact: 12, expanded: 24 }, gap: 16, children: [{ type: "settings", key: "form" }] }] }
  };
}
function searchView({ query, status, items, history = [], device = "phone" }) {
  const tv = device === "tv";
  const searchForm = () => ({
    type: "Form",
    key: "searchForm",
    onSubmitted: "search",
    gap: 8,
    children: tv ? [{ type: "Row", key: "searchRow", gap: 16, crossAxisAlignment: "center", children: [
      { type: "TextField", key: "q", kind: "text", value: query, ...twin2("brSearchHint", "labelText"), maxLength: 100, autofocus: true, weight: 1 },
      { type: "ElevatedButton", key: "searchGo", ...twin2("brSearch", "labelText"), icon: "search", submit: true }
    ] }] : [
      { type: "TextField", key: "q", kind: "text", value: query, ...twin2("brSearchHint", "labelText"), maxLength: 100, autofocus: true },
      { type: "ElevatedButton", key: "searchGo", ...twin2("brSearch", "labelText"), icon: "search", submit: true }
    ]
  });
  const body = tv ? [] : [searchForm()];
  if (status === "fail") {
    body.push({ type: "MaterialBanner", key: "searchFailed", role: "error", ...twin2("brSearchFailed"), action: { ...twin2("brRetry", "label"), onTap: "sretry" } });
  } else if (status === "done" && items) {
    if (items.length === 0) body.push({ type: "Text", ...twin2("brNoResults", "text"), color: "muted" });
    else body.push(cardGrid(items.slice(0, SEARCH_CAP), "results"));
  } else if (status !== "idle") {
    body.push(gridSkeleton());
  } else if (history.length > 0) {
    body.push({ type: "Text", ...twin2("brSearchedBefore", "text"), style: "h4" });
    body.push(cardGrid(history.slice(0, SEARCH_CAP), "history"));
  }
  return {
    type: "Scaffold",
    appBar: {
      type: "AppBar",
      mergeWithKinoBar: true,
      dense: true,
      divider: false,
      leading: { type: "IconButton", key: "back", icon: "arrow_back", ...twin2("brBack", "labelText"), ...twin2("brBack", "tooltip"), onPressed: "back" },
      ...tv ? { title: searchForm() } : twin2("brSearchTitle", "title")
    },
    body: { type: "SingleChildScrollView", key: "search-page", children: [{ type: "Column", padding: { compact: 12, expanded: 24 }, gap: 16, children: body }] },
    ...status === "loading" ? { every: { ms: 1e3, event: "stick" } } : {}
  };
}
function detailPage({ r, entry, season }) {
  const back = { type: "IconButton", key: "back", icon: "arrow_back", ...twin2("brBack", "labelText"), ...twin2("brBack", "tooltip"), onPressed: "back" };
  return detailView({ r, entry, season, logo: logo(), back });
}

// src/browse/metaCache.js
var KEY = "meta1";
var MAX = 120;
var CALL_MS = 8e3;
var HTTPS3 = /^https:\/\//;
function makeMetaCache({ kino: kino2, clock = { now: () => Date.now() } }) {
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
    return { ...e.t > 0 ? { tmdb: e.t } : {}, ...e.l && HTTPS3.test(e.l) ? { logo: e.l } : {} };
  }
  function dress(cards) {
    return cards.map((c) => {
      const k = known(c.id);
      return k.tmdb && !(c.ids && c.ids.tmdb) ? { ...c, ids: { ...c.ids || {}, tmdb: k.tmdb } } : c;
    });
  }
  async function fill(cards, budgetMs) {
    if (!usable()) return 0;
    const b = read();
    const end = clock.now() + budgetMs;
    let asked = 0;
    for (const c of cards) {
      if (clock.now() + CALL_MS > end) break;
      if (!c || typeof c.id !== "string" || Object.hasOwn(b, c.id) || c.ids && c.ids.tmdb && c.noLogo) continue;
      const year = c.year !== void 0 ? { year: c.year } : {};
      try {
        const a = await kino2.meta({ type: c.kind === "series" ? "series" : "movie", title: c.title, ...year });
        b[c.id] = { t: a && a.ids && Number.isInteger(a.ids.tmdb) ? a.ids.tmdb : 0, l: a && typeof a.logo === "string" ? a.logo : "" };
      } catch (e) {
        if (e && e.code === "rate_limited") break;
        continue;
      }
      asked++;
    }
    if (asked > 0) write();
    return asked;
  }
  return { known, dress, fill, usable };
}

// src/browse/index.js
var TAB_KEY = "browseTab";
var SNAP_PREFIX = "browse1:";
var SNAP_TTL_MS = 7 * 24 * 3600 * 1e3;
var HOME_KEY = "home1";
var SNAP_MAX = 20 * 1024;
var RECENT_KEY = "recent1";
var RECENT_MAX = 12;
var HIST_KEY = "searchHist1";
var HIST_MAX = 24;
function makeBrowse({ kino: kino2, loadTab, searchTitles }) {
  const meta = makeMetaCache({ kino: kino2 });
  const enrich = (data) => data ? {
    slides: data.slides.map((s) => {
      const k = meta.known(s.id);
      return k.logo ? { ...s, logo: k.logo } : s;
    }),
    rails: data.rails.map((r) => ({ ...r, items: meta.dress(r.items) }))
  } : data;
  const memo = /* @__PURE__ */ new Map();
  const log = (...a) => {
    try {
      kino2.log("[latino]", ...a);
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
  function writeSnap(tab, data) {
    for (let per = 10; per >= 3; per -= 2) {
      const slim2 = { slides: data.slides, rails: data.rails.map((r) => ({ ...r, items: r.items.slice(0, per) })) };
      const text = JSON.stringify({ at: Date.now(), data: slim2 });
      if (text.length <= SNAP_MAX) {
        set(SNAP_PREFIX + tab, text, { ttlMs: SNAP_TTL_MS });
        return;
      }
    }
  }
  function homeSeed(tab) {
    if (tab !== "inicio") return null;
    try {
      const o = JSON.parse(get(HOME_KEY) || "null");
      return o && Array.isArray(o.rows) && o.rows.length ? tabOf({ rows: o.rows }) : null;
    } catch (_) {
      return null;
    }
  }
  const stored = () => {
    const t3 = get(TAB_KEY);
    return TAB_IDS.includes(t3) ? t3 : null;
  };
  const remember = (tab) => set(TAB_KEY, tab);
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
  const slim = (c) => ({ id: c.id, ref: c.ref, title: c.title, kind: c.kind, ...c.poster ? { poster: c.poster } : {} });
  function readHistory() {
    try {
      const a = JSON.parse(get(HIST_KEY) || "[]");
      return Array.isArray(a) ? a.filter((c) => c && typeof c.id === "string" && typeof c.ref === "string" && typeof c.title === "string").slice(0, HIST_MAX) : [];
    } catch (_) {
      return [];
    }
  }
  function rememberFound(cards) {
    try {
      const fresh = cards.filter((c) => c.adult !== true).slice(0, 12).map(slim);
      const ids = new Set(fresh.map((c) => c.id));
      set(HIST_KEY, JSON.stringify([...fresh, ...readHistory().filter((c) => !ids.has(c.id))].slice(0, HIST_MAX)));
    } catch (_) {
    }
  }
  let found = null;
  const details = /* @__PURE__ */ new Map();
  const paramsOf = (route) => route && route.params && typeof route.params === "object" ? route.params : {};
  const tabFromArgs = (route) => {
    const a = route && route.args && typeof route.args === "object" ? route.args : {};
    return TAB_IDS.includes(a.tab) ? a.tab : null;
  };
  function needed(tab, device) {
    const order = [tab, ...TAB_IDS.filter((t3) => t3 !== tab)];
    return order.filter((t3, i) => (i === 0 || device !== "tv") && !(memo.get(t3) && memo.get(t3).whole));
  }
  function view(ctx) {
    const st = ctx.state && typeof ctx.state === "object" ? ctx.state : {};
    if (ctx.route && ctx.route.name === "settings") return settingsView();
    if (ctx.route && ctx.route.name === "detail") {
      const p = paramsOf(ctx.route);
      if (typeof p.open === "string" && typeof p.i === "string") {
        return detailPage({ r: { ref: p.open, id: p.i, kind: p.k === "movie" ? "movie" : "series", title: typeof p.t === "string" ? p.t : "" }, entry: details.get(p.open) || null, season: Number(st.season) || 0 });
      }
    }
    if (ctx.route && ctx.route.name === "search") {
      const query = typeof st.sq === "string" ? st.sq : "";
      const items = found && found.q === query ? found.items : null;
      const status = query === "" ? "idle" : st.sstate === "fail" ? "fail" : items ? "done" : "loading";
      return searchView({ query, status, items, history: query === "" ? readHistory() : [], device: ctx.device });
    }
    const tab = TAB_IDS.includes(st.tab) ? st.tab : tabFromArgs(ctx.route) ?? stored() ?? TAB_IDS[0];
    const data = enrich(dataOf(tab));
    const loaded = TAB_IDS.map((t3) => memo.get(t3)).filter(Boolean).map((m) => m.data);
    const pending = Array.isArray(st.pending) && st.pending.length > 0;
    return browseView({ tab, data, recent: meta.dress(recentOf(readKeys(), loaded)), pending, failed: !!(st.failed && st.failed[tab]), device: ctx.device });
  }
  async function load(tab) {
    const page = await loadTab(tab);
    const data = tabOf(page);
    if (data) {
      memo.set(tab, { data, whole: true });
      writeSnap(tab, data);
    }
    return data !== null;
  }
  const events = {
    open({ route, state, device }) {
      const tab = tabFromArgs(route) ?? (TAB_IDS.includes(state.tab) ? state.tab : stored() ?? TAB_IDS[0]);
      for (const t3 of TAB_IDS) dataOf(t3);
      const out = { state: { tab, pending: needed(tab, device), failed: null } };
      const a = route && route.args && typeof route.args === "object" ? route.args : {};
      if (typeof a.open === "string" && typeof a.i === "string" && (a.k === "movie" || a.k === "series")) {
        out.route = { push: "detail", params: { open: a.open, i: a.i, t: typeof a.t === "string" ? a.t.slice(0, 100) : "", k: a.k, d: Number(a.d) || 0, y: Number(a.y) || 0 } };
        out.state.season = null;
      }
      return out;
    },
    // A card of the list was tapped: its page goes over the list.
    openTitle({ arg }) {
      const route = pushOf(arg);
      return route ? { route, state: { season: null } } : null;
    },
    // The page's timer: loads the title once, then no timer.
    async dtick({ route }) {
      const p = paramsOf(route);
      if (typeof p.open !== "string" || details.has(p.open)) return { state: { dv: Date.now() } };
      try {
        details.set(p.open, { d: await loadDetail({ t: p.t, k: p.k, d: p.d, y: p.y }) });
      } catch (e) {
        log("browse detail", e && e.code || "error");
        details.set(p.open, { d: null });
      }
      return { state: { dv: Date.now() } };
    },
    dretry({ route }) {
      details.delete(paramsOf(route).open);
      return { state: { dv: Date.now() } };
    },
    season({ value, arg }) {
      const n = parseInt(value != null ? value : arg, 10);
      return n > 0 ? { state: { season: n } } : null;
    },
    tab({ value, arg, state }) {
      const tab = TAB_IDS.includes(value) ? value : TAB_IDS.includes(arg) ? arg : null;
      if (!tab) return null;
      remember(tab);
      dataOf(tab);
      const failed = { ...state.failed || {} };
      delete failed[tab];
      const pending = [tab, ...Array.isArray(state.pending) ? state.pending.filter((t3) => t3 !== tab) : []];
      return { state: { tab, pending: memo.get(tab) && memo.get(tab).whole ? pending.slice(1) : pending, failed } };
    },
    retry({ state, device }) {
      const tab = TAB_IDS.includes(state.tab) ? state.tab : TAB_IDS[0];
      return { state: { failed: null, pending: [tab, ...needed(tab, device).filter((t3) => t3 !== tab)] } };
    },
    async tick({ state }) {
      const pending = Array.isArray(state.pending) ? state.pending : [];
      if (pending.length === 0) return null;
      const [next, ...rest] = pending;
      const failed = { ...state.failed || {} };
      if (next.startsWith("meta:")) {
        const m = memo.get(next.slice(5));
        if (m) await meta.fill([...m.data.slides.map((s) => ({ id: s.id, title: s.title, kind: s.kind })), ...m.data.rails.flatMap((r) => r.items.slice(0, 6).map((c) => ({ id: c.id, title: c.title, kind: c.kind })))], 12e3);
        return { state: { pending: rest } };
      }
      try {
        const ok = await load(next);
        if (!ok) failed[next] = true;
        else delete failed[next];
        if (ok && meta.usable()) rest.unshift("meta:" + next);
      } catch (e) {
        log("browse tab", e && e.code || "error");
        failed[next] = true;
      }
      return { state: { pending: rest, failed } };
    },
    // The floating button: straight to the search page, empty and ready for the words.
    openSearch() {
      return { route: { push: "search" }, state: { sq: "", sstate: null } };
    },
    search({ value, route }) {
      const q = value && typeof value.q === "string" ? value.q.trim().slice(0, 100) : "";
      if (q === "") return null;
      const state = { sq: q, sstate: "loading" };
      return route && route.name === "search" ? { state } : { route: { push: "search" }, state };
    },
    // The search page's timer: one search per press, then no timer.
    async stick({ state }) {
      const q = typeof state.sq === "string" ? state.sq : "";
      if (q === "" || state.sstate !== "loading") return null;
      try {
        const out = await searchTitles(q);
        found = { q, items: (Array.isArray(out) ? out : []).slice(0, 60).map(cardOf) };
        rememberFound(found.items);
        return { state: { sstate: "done" } };
      } catch (e) {
        log("browse search", e && e.code || "error");
        return { state: { sstate: "fail" } };
      }
    },
    sretry({ state }) {
      return typeof state.sq === "string" && state.sq !== "" ? { state: { sstate: "loading" } } : null;
    },
    // The gear: the plugin's settings are a page of their own, one Back away.
    go({ arg }) {
      return arg === "settings" ? { route: { push: "settings" }, state: { fromBrowse: true } } : null;
    },
    back({ state, route }) {
      if (route && route.name === "settings" && !state.fromBrowse) return { close: true };
      return { route: { pop: true }, state: { sq: null, sstate: null } };
    }
  };
  async function event(ev) {
    const handler = Object.hasOwn(events, ev.name) ? events[ev.name] : null;
    return handler ? await handler({ ...ev, state: ev.state || {} }) ?? null : null;
  }
  return { view, event, notePlayed };
}

// src/plugin.js
globalThis.__kinoDropPendingFetches = true;
if (typeof kino.meta !== "function") throw kino.error("unavailable", "kino.meta not available");
if (typeof kino.tmdb !== "function") throw kino.error("unavailable", "kino.tmdb not available");
var TMDB_IMG2 = "https://image.tmdb.org/t/p/";
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
    anime: "Anime",
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
    anime: "Anime",
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
function t2(key) {
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
    poster: raw.poster_path ? TMDB_IMG2 + "w500" + raw.poster_path : void 0,
    backdrop: raw.backdrop_path ? TMDB_IMG2 + "w1280" + raw.backdrop_path : void 0,
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
  { id: "now-playing", title: "nowPlaying", genre: "peliculas", ref: "list:movie:now_playing", kind: "movie", path: "/movie/now_playing" },
  { id: "upcoming", title: "upcoming", genre: "peliculas", ref: "list:movie:upcoming", kind: "movie", path: "/movie/upcoming" },
  { id: "top-movies", title: "topMovies", genre: "peliculas", ref: "list:movie:top_rated", kind: "movie", path: "/movie/top_rated" },
  { id: "trending-series", title: "trendingSeries", genre: "series", ref: "trend:tv", kind: "tv", path: "/trending/tv/week" },
  { id: "on-the-air", title: "onTheAir", genre: "series", ref: "list:tv:on_the_air", kind: "tv", path: "/tv/on_the_air" },
  { id: "top-series", title: "topSeries", genre: "series", ref: "list:tv:top_rated", kind: "tv", path: "/tv/top_rated" },
  { id: "g-action", title: "gAction", genre: "peliculas", ref: "genre:movie:28", kind: "movie", path: "/discover/movie", params: { with_genres: 28 } },
  { id: "g-comedy", title: "gComedy", genre: "peliculas", ref: "genre:movie:35", kind: "movie", path: "/discover/movie", params: { with_genres: 35 } },
  { id: "g-scifi", title: "gSciFi", genre: "peliculas", ref: "genre:movie:878", kind: "movie", path: "/discover/movie", params: { with_genres: 878 } },
  { id: "g-horror", title: "gHorror", genre: "peliculas", ref: "genre:movie:27", kind: "movie", path: "/discover/movie", params: { with_genres: 27 } },
  { id: "g-drama", title: "gDrama", genre: "peliculas", ref: "genre:movie:18", kind: "movie", path: "/discover/movie", params: { with_genres: 18 } },
  { id: "kids", title: "kids", genre: "infantil", ref: "genre:movie:10751", kind: "movie", path: "/discover/movie", params: { with_genres: 10751 } },
  { id: "docs", title: "docs", genre: "documentales", ref: "genre:movie:99", kind: "movie", path: "/discover/movie", params: { with_genres: 99 } },
  { id: "anime", title: "anime", genre: "anime", ref: "anime:tv", kind: "tv", path: "/discover/tv", params: { with_genres: 16, with_origin_country: "JP" } }
];
var DISCOVER = { sort_by: "popularity.desc", "vote_count.gte": 200 };
async function homeRow(row) {
  const res = await kino.tmdb(row.path, { ...row.path.startsWith("/discover") ? DISCOVER : {}, ...row.params || {} });
  const items = (res?.results || []).filter((r) => r.poster_path).slice(0, 20).map((r) => itemFromTmdb(r, row.kind));
  return items.length ? { id: row.id, title: t2(row.title), genre: row.genre, ref: row.ref, items } : null;
}
var HOME_BUDGET_MS = 14e3;
async function home() {
  const out = HOME_ROWS.map(() => null);
  let done = false;
  const all = Promise.all(HOME_ROWS.map((row, i) => homeRow(row).then((r) => {
    out[i] = r;
  }, () => {
  }))).then(() => {
    done = true;
  });
  const end = Date.now() + HOME_BUDGET_MS;
  while (!done && Date.now() < end) await Promise.race([all, kino.sleep(Math.min(250, Math.max(1, end - Date.now())))]);
  const rows = out.filter(Boolean);
  if (!rows.length) throw kino.error("unavailable", "no home row could be loaded", { userMessage: t2("unavailable") });
  return rows;
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
    const res = await kino.tmdb("/search/tv", { query: query.q });
    ranked = kino.rank.filterRelevant((res?.results || []).map((r) => itemFromTmdb(r, "tv")), titlesOf(query));
  } else if (type === "movie") {
    const res = await kino.tmdb("/search/movie", { query: query.q });
    ranked = kino.rank.filterRelevant((res?.results || []).map((r) => itemFromTmdb(r, "movie")), titlesOf(query));
  } else {
    const [movies, tv] = await Promise.all([
      kino.tmdb("/search/movie", { query: query.q }),
      kino.tmdb("/search/tv", { query: query.q })
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
  } else if (parts[0] === "anime" && parts[1] === "tv") {
    kind = "tv";
    path = "/discover/tv";
    params = { ...DISCOVER, with_genres: 16, with_origin_country: "JP", page };
  } else if (parts[0] === "genre" && (parts[1] === "movie" || parts[1] === "tv") && /^\d+$/.test(parts[2] || "")) {
    kind = parts[1];
    path = `/discover/${kind}`;
    params = { ...DISCOVER, with_genres: parts[2], page };
  } else {
    return { items: [] };
  }
  const res = await kino.tmdb(path, params);
  const items = (res?.results || []).filter((r) => r.poster_path).map((r) => itemFromTmdb(r, kind));
  const next = res?.page < res?.total_pages ? String(page + 1) : void 0;
  return { items, next };
}
async function categories() {
  const [mg, tg] = await Promise.all([kino.tmdb("/genre/movie/list"), kino.tmdb("/genre/tv/list")]);
  const cats = [];
  for (const g of (mg?.genres || []).slice(0, 12)) cats.push({ id: "gm" + g.id, title: g.name, ref: "genre:movie:" + g.id });
  for (const g of (tg?.genres || []).slice(0, 8)) cats.push({ id: "gt" + g.id, title: g.name + " (series)", ref: "genre:tv:" + g.id });
  return cats.slice(0, 24);
}
async function episodes(ref) {
  const tmdbId = ref.startsWith("s:") ? ref.slice(2) : ref;
  const meta = await kino.meta({ type: "series", ids: { tmdb: Number(tmdbId) } });
  if (!meta) throw kino.error("not_found", "series not found: tmdb " + tmdbId, { userMessage: t2("noMeta") });
  const imdbId = meta.ids?.imdb;
  if (!imdbId) throw kino.error("not_found", "no IMDB id for series tmdb:" + tmdbId, { userMessage: t2("noMeta") });
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
var SERVER_ORDER = ["streamwish", "voe", "vidhide"];
function languageOrder() {
  const pref = String(kino.config.get("language") || "lat");
  return pref === "esp" ? ["esp", "lat", "sub"] : pref === "sub" ? ["sub", "lat", "esp"] : ["lat", "esp", "sub"];
}
function ordered(copies) {
  const langs = languageOrder();
  const rank = (c) => langs.indexOf(c.lang) * 10 + Math.max(0, SERVER_ORDER.indexOf(c.server));
  return [...copies].sort((a, b) => rank(a) - rank(b));
}
var labelOf = (c) => `${t2(c.lang)} \xB7 ${SERVER_LABEL[c.server] || c.server}`;
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
  } catch (_) {
  }
  if (!kino.browser || typeof kino.browser.capture !== "function" || !budget || budget.captures <= 0) return null;
  budget.captures -= 1;
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
async function titleOf(ref) {
  if (ref.startsWith("ep:")) {
    const [, imdbId, season, episode] = ref.split(":");
    return { kind: "tv", imdbId, season: Number(season), episode: Number(episode) };
  }
  if (ref.startsWith("m:")) {
    const tmdbId = ref.slice(2);
    const imdbId = await imdbFor(tmdbId, "movie");
    if (!imdbId) throw kino.error("not_found", "no IMDB id for movie tmdb:" + tmdbId, { userMessage: t2("noMeta") });
    return { kind: "movie", imdbId };
  }
  throw kino.error("not_found", "unknown ref: " + ref.slice(0, 40));
}
var RESOLVER_REPO = "xuper-plugin/kino-plugin-kino-resolver";
var SUPPORT_URL = "https://ko-fi.com/xuperplugins";
async function resolverInstalled() {
  try {
    await kino.plugins.call("resolver", "normalizeHost", { url: "https://probe.invalid/" });
    return true;
  } catch (e) {
    return (e && e.code) !== "provider_missing";
  }
}
function supportNode(device) {
  if (device === "tv") return { type: "QrImage", value: SUPPORT_URL, size: "large", labelText: "Si te gusta mi trabajo, escan\xE9alo y ap\xF3yame", labelTextEn: "If you like my work, scan it and support me" };
  return { type: "ElevatedButton", key: "donate", icon: "heart", labelText: "Si te gusta mi trabajo, ap\xF3yame", labelTextEn: "If you like my work, support me", onPressed: { go: { url: { href: SUPPORT_URL } } } };
}
function installGateView(device) {
  return {
    type: "Scaffold",
    key: "embed69-install",
    body: { type: "SingleChildScrollView", key: "installScroll", children: [
      { type: "Column", padding: 24, gap: 16, crossAxisAlignment: "stretch", children: [
        { type: "Text", text: "Necesitas el motor de reproducci\xF3n", textEn: "You need the playback engine", style: "h3" },
        { type: "Text", color: "secondary", text: "Embed69 reproduce a trav\xE9s de Kino Resolver (gratis). Inst\xE1lalo una vez y sirve para este y para otros plugins de sitios.", textEn: "Embed69 plays through Kino Resolver (free). Install it once and it works here and in other site plugins." },
        { type: "ElevatedButton", key: "installResolver", labelText: "Instalar Kino Resolver", labelTextEn: "Install Kino Resolver", onPressed: { go: { installPlugin: { repo: RESOLVER_REPO } } } },
        supportNode(device)
      ] }
    ] }
  };
}
var browseInstance = null;
var browseScreen = () => browseInstance ?? (browseInstance = makeBrowse({
  kino,
  loadTab: async () => ({ rows: await home() }),
  searchTitles: (q) => search({ q })
}));
async function screen(ctx) {
  await null;
  const c = ctx && typeof ctx === "object" ? ctx : {};
  if (!(c.installed && c.installed[RESOLVER_REPO])) return installGateView(c.device);
  return browseScreen().view(c);
}
async function screenEvent(ev) {
  await null;
  return browseScreen().event(ev && typeof ev === "object" ? ev : {});
}
async function resolve(ref) {
  if (!await resolverInstalled()) throw kino.error("unavailable", "resolver missing", { userMessage: t2("needResolver") });
  const req = makeReq(kino, { deadline: Date.now() + RESOLVE_MS });
  if (ref.startsWith("cp:")) {
    const want = parseCopyRef(ref);
    if (!want) throw kino.error("not_found", "bad copy ref");
    const copy = (await listCopies(want.title, { kino, req })).find((c) => c.lang === want.lang && c.server === want.server);
    const stream = copy ? await open(copy, req, { captures: MAX_CAPTURES }) : null;
    if (!stream) throw kino.error("not_found", "copy not available: " + want.lang + "/" + want.server, { userMessage: t2("noStreams") });
    return stream;
  }
  const title = await titleOf(ref);
  const copies = ordered(await listCopies(title, { kino, req }));
  if (!copies.length) throw kino.error("not_found", "no copies for " + title.imdbId, { userMessage: t2("noStreams") });
  const budget = { captures: MAX_CAPTURES };
  let main = null;
  for (const c of copies) {
    const r = await open(c, req, budget);
    if (r) {
      main = r;
      break;
    }
  }
  if (!main) throw kino.error("not_found", "no copy opened for " + title.imdbId, { userMessage: t2("noStreams") });
  const rest = copies.slice(copies.findIndex((c) => labelOf(c) === main.label) + 1);
  const alternatives = rest.slice(0, MAX_COPIES).map((c) => ({ label: labelOf(c), ref: copyRef(title, c) }));
  return { ...main, ...alternatives.length ? { alternatives } : {} };
}
async function action(key) {
  if (key === "clearCache") {
    for (const k of kino.storage.keys()) {
      if (k.startsWith("imdb:")) kino.storage.remove(k);
    }
    return { message: t2("cacheCleared") };
  }
}
export {
  action,
  browse,
  categories,
  episodes,
  home,
  resolve,
  screen,
  screenEvent,
  search
};
