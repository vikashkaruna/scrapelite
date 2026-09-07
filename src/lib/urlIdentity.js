// Canonical URL identity used by destination integrations.

export function canonicalSourceUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value).trim());
    if (!/^https?:$/i.test(url.protocol)) return "";
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return "";
  }
}

export function sourceUrlField(fieldMap, fallback = "URL") {
  if (!fieldMap || typeof fieldMap !== "object") return fallback;
  const entries = Object.entries(fieldMap);
  if (entries.length === 0) return fallback;

  // 1. Explicit key: "url" (object shape { key: "url" } or string "url")
  const keyEntry = entries.find(([, def]) => (typeof def === "object" ? def?.key === "url" : def === "url"));
  if (keyEntry) return keyEntry[0];

  // 2. Declared type: "url" (e.g. { type: "url" } or "url")
  const typeEntry = entries.find(([, def]) => (typeof def === "object" ? def?.type === "url" : def === "url"));
  if (typeEntry) return typeEntry[0];

  // 3. Name heuristic (case-insensitive column name)
  const nameEntry = entries.find(([name]) =>
    /^(url|link|source|website|site|source[_\s]?url|page[_\s]?url)$/i.test(name.trim())
  );
  if (nameEntry) return nameEntry[0];

  // 4. If fallback exists in fieldMap, return fallback
  if (Object.prototype.hasOwnProperty.call(fieldMap, fallback)) return fallback;

  return fallback;
}
