export function normLang(text) {
  const s = String(text || "").toLowerCase();
  // Check subtitle tokens FIRST (subtitled copies have original audio)
  if (/\b(sub|subs|vose|subtitulado|subtitulada)\b/.test(s)) return "sub";
  if (/\b(lat|latino|latam|mx|mex|col|es-mx)\b/.test(s)) return "lat";
  if (/\b(cast|castellano|esp|español|espanol|es-es|spain)\b/.test(s)) return "esp";
  // Handle españa/espana with proper boundary for ñ (JS \b is ASCII-only)
  if (/(?:^|[^a-z0-9ñ])(españa|espana)(?:$|[^a-z0-9ñ])/.test(s)) return "esp";
  return null;
}
