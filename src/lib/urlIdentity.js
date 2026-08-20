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
  const entry = Object.entries(fieldMap || {}).find(([, def]) => def?.key === "url");
  return entry?.[0] || fallback;
}
