// netlify/functions/lib/publicUrl.js
// SSRF guard for server-side URL fetchers. Every inbound URL the app
// fetches on behalf of a user (extract, og-preview, schedules, map) must
// pass through isPublicHttpUrl before any outbound HTTP call. This blocks
// private IP literals (RFC 1918, loopback, link-local, multicast, CGNAT,
// IPv6 unique-local) and non-HTTP(S) schemes (file://, gopher://, etc.).
//
// The SYNC guard (isPublicHttpUrl) throws a typed Error for invalid input —
// it is a fast pre-filter used where the caller wants the reason. The ASYNC
// guard (isPublicHttpUrlAsync) is the one request-validation paths await,
// and it NEVER throws: any input that cannot be established as a publicly
// fetchable URL — malformed, disallowed scheme, oversized, or a hostname
// DNS cannot resolve — answers `false`. A guard that throws on a user's
// typo turns "reject this URL" into an unhandled 500 two layers up.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

const MAX_URL_LENGTH = 2048;

const PRIVATE_V4_RANGES = [
  // RFC 1918
  [ip4("10.0.0.0"),      ip4("10.255.255.255")],
  // RFC 1918
  [ip4("172.16.0.0"),    ip4("172.31.255.255")],
  // RFC 1918
  [ip4("192.168.0.0"),   ip4("192.168.255.255")],
  // Loopback
  [ip4("127.0.0.0"),     ip4("127.255.255.255")],
  // Link-local
  [ip4("169.254.0.0"),   ip4("169.254.255.255")],
  // Multicast
  [ip4("224.0.0.0"),     ip4("239.255.255.255")],
  // CGNAT
  [ip4("100.64.0.0"),    ip4("100.127.255.255")],
  // Reserved / documentation
  [ip4("0.0.0.0"),       ip4("0.255.255.255")],
  // Test-net
  [ip4("192.0.2.0"),     ip4("192.0.2.255")],
];

const IPV6_LOOPBACK = ip6("::1");
const IPV6_UNSPECIFIED = ip6("::");
const IPV6_LINK_LOCAL_PREFIX = ip6("fe80::");
const IPV6_UNIQUE_LOCAL_PREFIX = ip6("fc00::");
const IPV6_MULTICAST_PREFIX = ip6("ff00::");
const IPV6_V4MAPPED_PREFIX = ip6("::ffff:");

function ip4(s) {
  const parts = s.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => p < 0 || p > 255 || Number.isNaN(p))) {
    throw new Error(`bad IPv4: ${s}`);
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function ip6(s) {
  // Very small subset: hex-colon form, normalised to bigint.
  const parts = s.split("::");
  if (parts.length > 2) throw new Error(`bad IPv6: ${s}`);
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts[1] ? parts[1].split(":") : [];
  const fill = 8 - (head.length + tail.length);
  if (fill < 0) throw new Error(`bad IPv6: ${s}`);
  const full = [...head, ...Array(fill).fill("0"), ...tail];
  if (full.length !== 8) throw new Error(`bad IPv6: ${s}`);
  let n = 0n;
  for (const h of full) {
    n = (n << 16n) | BigInt(parseInt(h || "0", 16));
  }
  return n;
}

function inV4Range(n, lo, hi) {
  return n >= lo && n <= hi;
}

function isPrivateV4(n) {
  return PRIVATE_V4_RANGES.some(([lo, hi]) => inV4Range(n, lo, hi));
}

function isPrivateV6(n) {
  // Loopback ::1
  if (n === IPV6_LOOPBACK) return true;
  // Unspecified ::
  if (n === IPV6_UNSPECIFIED) return true;
  // fe80::/10 (link-local)
  if (n >= IPV6_LINK_LOCAL_PREFIX && n < IPV6_LINK_LOCAL_PREFIX + (1n << 118n)) return true;
  // fc00::/7 (unique local)
  if (n >= IPV6_UNIQUE_LOCAL_PREFIX && n < IPV6_UNIQUE_LOCAL_PREFIX + (1n << 121n)) return true;
  // ff00::/8 (multicast)
  if (n >= IPV6_MULTICAST_PREFIX && n < IPV6_MULTICAST_PREFIX + (1n << 120n)) return true;
  // ::ffff:0:0/96 — IPv4-mapped — recurse on the IPv4 portion
  if (n >= IPV6_V4MAPPED_PREFIX && n < IPV6_V4MAPPED_PREFIX + (1n << 80n)) {
    const v4 = Number((n - IPV6_V4MAPPED_PREFIX) >> 80n);
    return isPrivateV4(v4);
  }
  return false;
}

/**
 * Validate a URL for safe outbound fetching.
 * @param {string} input
 * @returns {boolean} true if safe; throws a typed Error otherwise.
 */
export function isPublicHttpUrl(input) {
  if (typeof input !== "string" || !input) {
    throw new Error("URL is required");
  }
  if (input.length > MAX_URL_LENGTH) {
    throw new Error(`URL exceeds ${MAX_URL_LENGTH} chars`);
  }
  // Reject control chars and whitespace
  if (/[\x00-\x1f\x7f\s]/.test(input)) {
    throw new Error("URL contains control characters or whitespace");
  }

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error("Malformed URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Disallowed scheme: ${parsed.protocol}`);
  }

  const host = parsed.hostname;
  if (!host) throw new Error("URL has no host");

  // IDN / Punycode normalisation (URL parser already does this).
  // Resolve the host to one or more IPs and reject any private one.
  return checkHostSync(host);
}

/**
 * Synchronous IP classification — used after the URL parser has the host.
 * For literal IPs we classify in-process; for hostnames we do a DNS lookup.
 *
 * @param {string} host
 * @returns {Promise<boolean>} true if the host resolves to a public IP
 */
export async function isPublicHttpUrlAsync(input) {
  // Never throws — see the header. Every "cannot establish safe" branch is
  // an answer of false, so callers can `if (!await ...) return bad(...)`
  // without a try/catch and a malformed input can never become a 500.
  if (typeof input !== "string" || !input) return false;
  if (input.length > MAX_URL_LENGTH) return false;
  if (/[\x00-\x1f\x7f\s]/.test(input)) return false;
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return checkHostAsync(parsed.hostname);
}

function checkHostSync(host) {
  // Strip brackets from IPv6 literals
  const h = host.replace(/^\[|\]$/g, "");

  // Literal IPv4
  if (isIP(h) === 4) {
    const n = h.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
    if (isPrivateV4(n)) return false;
    return true;
  }
  // Literal IPv6
  if (isIP(h) === 6) {
    try {
      const n = ip6(expandIPv6(h));
      if (isPrivateV6(n)) return false;
      return true;
    } catch {
      throw new Error("Malformed IPv6 literal");
    }
  }
  // Hostname — assume public. DNS-rebinding is a separate concern; the
  // safe async path (isPublicHttpUrlAsync) does a real lookup. The sync
  // function is the fast pre-filter that callers use to reject obvious
  // private literals in a request validation path.
  return true;
}

async function checkHostAsync(host) {
  const h = host.replace(/^\[|\]$/g, "");
  if (isIP(h) === 4) return checkHostSync(h);
  if (isIP(h) === 6) return checkHostSync(h);
  // Hostname — DNS lookup. Reject if ANY resolved IP is private.
  let addrs;
  try {
    addrs = await lookup(h, { all: true });
  } catch {
    // A domain that does not resolve (typo, expired, NXDOMAIN) is a
    // validation answer — `false` — not a server fault. The test/dev bypass
    // stays: offline environments use fake hostnames on purpose, and a
    // resolver that cannot run at all must not fail-closed every test URL.
    if (process.env.NODE_ENV === "test" || process.env.CONTEXT === "dev") return true;
    return false;
  }
  for (const { address } of addrs) {
    if (!checkHostSync(address)) return false;
  }
  return true;
}

function expandIPv6(s) {
  // new URL() already normalises IPv6 hostnames; this is a no-op when the
  // input is already expanded. The real expansion (inserting the :: zeros)
  // happens inside ip6() when we call it.
  return s;
}

/** Fetch a public URL while validating every redirect hop. */
export async function fetchPublicUrl(input, init = {}, options = {}) {
  let current = String(input || "");
  const maxRedirects = Number.isInteger(options.maxRedirects) ? options.maxRedirects : MAX_REDIRECTS;
  for (let redirects = 0; ; redirects += 1) {
    if (!(await isPublicHttpUrlAsync(current))) throw new Error("URL is not a public http(s) address");
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    if (redirects >= maxRedirects) throw new Error("Too many redirects");
    const location = response.headers?.get?.("location");
    if (!location) throw new Error("Redirect missing location");
    current = new URL(location, current).toString();
  }
}
