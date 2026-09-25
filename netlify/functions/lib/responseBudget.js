// Keeps a function response under AWS Lambda's synchronous payload cap.
//
// Lambda refuses any response over 6,291,556 bytes. When that happens the
// handler has already done all the work — scraped, metered, charged — and the
// platform replaces its answer with a 502 whose body is
// {"errorType":"Function.ResponseSizeTooLarge",...}. That body has no `error`
// field, so the browser could only say "API POST /extract failed (502)" and
// the user was told the extraction service was down. It was not: the page
// (e.g. html.spec.whatwg.org, ~12 MB of HTML) was simply bigger than the pipe.
//
// `data.html` is the only unbounded field in an extract response (`text` is
// already capped upstream), so it is the one trimmed. A truncated document is
// still parseable by DOMParser — the client reads headings and links from it —
// and the response says it was trimmed rather than pretending it was whole.

// Headroom under 6,291,556 for headers, the Set-Cookie and base64 overhead.
export const MAX_RESPONSE_BYTES = 5_500_000;

const byteLength = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");

/**
 * Returns `body` unchanged when it fits; otherwise a copy whose `data.html` is
 * cut to fit, with `data.htmlTruncated: true` and `data.htmlOriginalChars`.
 */
export function fitResponseBudget(body, maxBytes = MAX_RESPONSE_BYTES) {
  const total = byteLength(body);
  const html = body?.data?.html;
  if (total <= maxBytes || typeof html !== "string" || !html) return body;

  // Bytes available for html once everything else is accounted for. JSON
  // escaping and multi-byte characters make chars→bytes non-linear, so shrink
  // proportionally and re-measure until it fits.
  const others = total - byteLength(html);
  let keep = Math.max(0, Math.floor(html.length * ((maxBytes - others) / byteLength(html))));
  let trimmed = { ...body, data: { ...body.data, html: html.slice(0, keep), htmlTruncated: true, htmlOriginalChars: html.length } };
  while (keep > 0 && byteLength(trimmed) > maxBytes) {
    keep = Math.floor(keep * 0.9);
    trimmed = { ...trimmed, data: { ...trimmed.data, html: html.slice(0, keep) } };
  }
  return trimmed;
}
