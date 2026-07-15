// publicUrl.js — guard server-side fetchers from being used to reach private
// infrastructure. This is intentionally dependency-free so every Netlify
// function that accepts a user URL can share the same policy.

import { isIP } from "node:net";

const MAX_URL_LENGTH = 2_048;

function isPrivateIpv4(hostname) {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(hostname) {
  const host = hostname.toLowerCase();
  // Loopback, unspecified, IPv4-mapped loopback/private ranges, unique-local,
  // and link-local addresses must never be fetched from a serverless function.
  if (host === "::" || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb")) {
    return true;
  }
  const mapped = /^::ffff:(.+)$/.exec(host);
  if (!mapped) return false;

  // WHATWG URL normalizes `::ffff:127.0.0.1` to `::ffff:7f00:1`.
  // Convert either representation back to dotted IPv4 before applying the
  // private-range policy, otherwise mapped loopback addresses bypass it.
  const suffix = mapped[1];
  if (/^\d+\.\d+\.\d+\.\d+$/.test(suffix)) return isPrivateIpv4(suffix);
  const groups = suffix.split(":");
  if (groups.length !== 2 || !groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return false;
  const high = Number.parseInt(groups[0], 16);
  const low = Number.parseInt(groups[1], 16);
  const ipv4 = [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
  return isPrivateIpv4(ipv4);
}

function isBlockedHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  const type = isIP(host);
  return (type === 4 && isPrivateIpv4(host)) || (type === 6 && isPrivateIpv6(host));
}

/**
 * Validate an untrusted URL before a server-side fetch.
 *
 * This blocks non-HTTP schemes and literal/private network addresses. DNS
 * rebinding protection requires an egress proxy or resolver-aware transport and
 * remains a deployment-level control; callers should not treat this as a full
 * network policy.
 */
export function validatePublicHttpUrl(input) {
  const value = String(input || "").trim();
  if (!value || value.length > MAX_URL_LENGTH) {
    return { ok: false, error: "A valid public HTTP(S) URL is required." };
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "A valid public HTTP(S) URL is required." };
  }

  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || isBlockedHostname(url.hostname)) {
    return { ok: false, error: "A valid public HTTP(S) URL is required." };
  }

  return { ok: true, url: url.href };
}

/**
 * Fetch a validated public URL without allowing the runtime to automatically
 * follow a redirect into private infrastructure. Each redirect target is
 * revalidated before it is requested.
 */
export async function fetchPublicHttpUrl(input, options = {}, maxRedirects = 3) {
  let validated = validatePublicHttpUrl(input);
  if (!validated.ok) throw new Error(validated.error);

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const response = await fetch(validated.url, { ...options, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    if (redirects === maxRedirects) throw new Error("Too many redirects.");

    validated = validatePublicHttpUrl(new URL(location, validated.url).href);
    if (!validated.ok) throw new Error(validated.error);
  }

  throw new Error("Too many redirects.");
}
