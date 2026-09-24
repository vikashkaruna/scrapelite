// htmlEntities.js — decode HTML entities in ONE pass.
//
// The helpers this replaces chained `.replace()` calls, decoding `&amp;` before
// (or after) the other entities. Either order double-decodes something:
// "&amp;lt;" is the text "&lt;", but amp-first turns it into "<"; and
// "&#38;lt;" becomes "&lt;" and then "<" when numeric runs first. On a scraped
// page that turns escaped markup into live markup (CodeQL js/double-escaping).
// A single regex visits each entity once, so the output of one decode can
// never be decoded again.

const DEFAULT_NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…",
};

/**
 * @param {string} s
 * @param {{ named?: Record<string,string>, unknown?: (entity: string) => string }} [opts]
 *   `named` maps a lower-case name (no `&` or `;`) to its text.
 *   `unknown` decides what an unrecognised named entity becomes (default: kept as-is).
 */
export function decodeHtmlEntities(s, opts = {}) {
  const named = opts.named || DEFAULT_NAMED;
  const unknown = opts.unknown || ((m) => m);
  return String(s ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    const v = named[body.toLowerCase()];
    return v !== undefined ? v : unknown(m);
  });
}
