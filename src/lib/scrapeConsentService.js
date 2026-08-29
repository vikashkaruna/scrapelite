// src/lib/scrapeConsentService.js — the client half of "I have permission to
// extract this site".
//
// Deliberately thin, and deliberately WITHOUT a localStorage copy. That is the
// opposite of consentService.js, which keeps one because analytics consent has
// to be read synchronously in <head> before any network call could return.
// Nothing here is on a critical path like that, and a browser-side copy of a
// permission claim would be worse than useless: /api/extract re-reads the real
// record server-side on every request, so a stale local "yes" could only ever
// mislead the UI into promising something the server will refuse.
//
// The host normalisation below is a display/dedup convenience only. The server
// normalises independently in netlify/functions/lib/scrapeConsent.js and that
// is the version that decides.

import { apiClient } from "./apiClient.js";

/** Lowercase, strip a leading "www.". Mirrors normalizeConsentHost() on the
 *  server; kept in sync so the UI names the same host the grant is stored under. */
export function consentHostOf(input) {
  if (!input) return "";
  let host = String(input).trim().toLowerCase();
  try {
    host = host.includes("://") ? new URL(host).hostname.toLowerCase() : host;
  } catch { return ""; }
  return host.replace(/\.$/, "").replace(/^www\./, "");
}

/** Is there an unexpired attestation for this host? Never throws — an
 *  unreachable endpoint reads as "no grant", which is the safe direction. */
export async function hasConsentFor(host) {
  const h = consentHostOf(host);
  if (!h) return false;
  try {
    const res = await apiClient.getScrapeConsent(h);
    return res?.granted === true;
  } catch {
    return false;
  }
}

/** Record the attestation. Throws on failure so the modal can surface why. */
export async function grantConsentFor(host, source = "extract_refusal") {
  const h = consentHostOf(host);
  if (!h) throw new Error("A valid website address is required.");
  return apiClient.grantScrapeConsent(h, source);
}

/** Withdraw it. */
export async function revokeConsentFor(host) {
  const h = consentHostOf(host);
  if (!h) throw new Error("A valid website address is required.");
  return apiClient.revokeScrapeConsent(h);
}

/** All unexpired attestations for the signed-in user. */
export async function listConsents() {
  try {
    const res = await apiClient.getScrapeConsent();
    return Array.isArray(res?.consents) ? res.consents : [];
  } catch {
    return [];
  }
}

// ── Pre-flight hint ──────────────────────────────────────────────────────────
// Hosts we know disallow every crawler in their robots.txt. This exists ONLY to
// warn someone in the composer before they spend a request; it is never
// enforcement and never authoritative. robots.txt on the server is the single
// source of truth, it is fetched live, and it can change — so this list being
// wrong costs a stale hint, nothing more. Do not branch any real decision on it.
export const KNOWN_DISALLOWED_HOSTS = [
  { host: "linkedin.com", label: "LinkedIn" },
  { host: "facebook.com", label: "Facebook" },
  { host: "instagram.com", label: "Instagram" },
  { host: "x.com", label: "X" },
  { host: "twitter.com", label: "X (Twitter)" },
  { host: "quora.com", label: "Quora" },
];

/**
 * If this input names a site we know blocks crawlers, return { host, label }.
 * Matches the host and its subdomains, so www.linkedin.com and
 * in.linkedin.com both hit — unlike a consent GRANT, which deliberately does
 * not span subdomains. A warning may be broad; a permission may not.
 */
export function knownDisallowedHost(input) {
  const h = consentHostOf(input);
  if (!h) return null;
  return (
    KNOWN_DISALLOWED_HOSTS.find((e) => h === e.host || h.endsWith(`.${e.host}`)) || null
  );
}
