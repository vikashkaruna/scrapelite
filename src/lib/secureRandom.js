// secureRandom.js — the one source of random ids in browser and Node code.
//
// Math.random() is predictable, and several ids built from it travel as
// identifiers the server trusts to tell callers apart (the usage session id,
// share slugs, the guest-trial id). CodeQL flags each of those flows
// (js/insecure-randomness). Web Crypto is available in every browser DatIQ
// supports and in Node 24 as `globalThis.crypto`, so there is no fallback to
// Math.random — a fallback would reintroduce exactly the weakness this removes.

function cryptoApi() {
  const c = globalThis.crypto;
  if (!c?.getRandomValues) throw new Error("Web Crypto is unavailable; cannot generate a secure id.");
  return c;
}

/** `n` cryptographically random bytes. */
export function randomBytes(n) {
  return cryptoApi().getRandomValues(new Uint8Array(n));
}

/** A random UUID v4. */
export function randomUuid() {
  const c = cryptoApi();
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * `length` characters drawn uniformly from `alphabet`. Rejection sampling, so
 * an alphabet whose size does not divide 256 gets no bias toward early symbols.
 */
export function randomString(length, alphabet = "abcdefghijklmnopqrstuvwxyz0123456789") {
  const n = alphabet.length;
  if (!n || n > 256) throw new Error("alphabet must have 1-256 symbols");
  const limit = 256 - (256 % n);
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(Math.max(16, length * 2))) {
      if (byte < limit) out += alphabet[byte % n];
      if (out.length === length) break;
    }
  }
  return out;
}
