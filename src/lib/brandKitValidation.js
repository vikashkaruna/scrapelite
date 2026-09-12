// src/lib/brandKitValidation.js — pure validation for white-label brand kit.
// Decoupled from whiteLabelTemplate.js so serverless functions (export-email,
// report-email) can validate brand kits without pulling in Supabase or PDF libraries.

export const BRAND_KIT_LOGO_MAX_BYTES = 200 * 1024; // 200KB — a small logo mark, not a hero image
export const BRAND_KIT_TEXT_MAX = 120; // company name / tagline / footer text length cap
export const BRAND_KIT_LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/svg+xml"]);
export const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

function ok(value) {
  return { ok: true, code: "OK", reason: null, value };
}

function err(code, reason) {
  return { ok: false, code, reason, value: null };
}

/**
 * Validate + sanitize a Brand Kit object before it is stored or used. Returns
 * `{ ok: true, value }` or `{ ok: false, code, reason }`.
 *
 * `logo`, if present, must already be `{ dataUrl, width, height }`.
 */
export function validateBrandKit(input) {
  if (!input || typeof input !== "object") return err("INVALID_TYPE", "No brand kit data was provided.");
  const out = {};

  for (const field of ["companyName", "tagline", "footerText"]) {
    const v = input[field];
    if (v == null || v === "") continue;
    const s = String(v).trim();
    if (s.length > BRAND_KIT_TEXT_MAX) {
      return err("FIELD_TOO_LONG", `${field} must be ${BRAND_KIT_TEXT_MAX} characters or fewer.`);
    }
    out[field] = s;
  }

  if (input.website) {
    const s = String(input.website).trim();
    if (!/^https?:\/\/.+/i.test(s)) return err("INVALID_URL", "Website must be a full https:// URL.");
    out.website = s;
  }
  if (input.contactEmail) {
    const s = String(input.contactEmail).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return err("INVALID_EMAIL", "Contact email doesn't look valid.");
    out.contactEmail = s;
  }
  if (input.accentColor) {
    const s = String(input.accentColor).trim();
    if (!HEX_COLOR_RE.test(s)) return err("INVALID_COLOR", "Accent color must be a hex value like #4f46e5.");
    out.accentColor = s;
  }
  if (input.logo) {
    const { dataUrl, width, height } = input.logo;
    if (!dataUrl || typeof dataUrl !== "string") return err("INVALID_LOGO", "No logo image was provided.");
    const mimeMatch = /^data:([^;]+);base64,/.exec(dataUrl);
    const mime = mimeMatch?.[1];
    if (!mime || !BRAND_KIT_LOGO_TYPES.has(mime)) {
      return err("INVALID_LOGO_TYPE", "Logo must be a PNG, JPEG, or SVG image.");
    }
    // Rough byte size from the base64 payload length (each 4 chars ≈ 3 bytes).
    const approxBytes = Math.floor((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
    if (approxBytes > BRAND_KIT_LOGO_MAX_BYTES) {
      return err(
        "LOGO_TOO_LARGE",
        `Logo must be ${(BRAND_KIT_LOGO_MAX_BYTES / 1024).toFixed(0)}KB or smaller (yours is ~${(approxBytes / 1024).toFixed(0)}KB).`,
      );
    }
    out.logo = { dataUrl, width: Number(width) || null, height: Number(height) || null };
  }

  return ok(out);
}
