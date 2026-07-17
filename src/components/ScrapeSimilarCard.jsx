// ScrapeSimilarCard.jsx — DeepSeq QW#1. Post-extraction CTA that suggests
// same-domain sibling pages (2-3 internal links) so the user can quickly
// "Scrape Similar" without going back to Home. Picks internal links from the
// current extraction, scores them by path-depth (prefer top-level pages), and
// surfaces them as clickable cards. Click → run extract() for that URL.
import { useMemo } from "react";
import Icon from "./Icon.jsx";
import { useExtraction } from "./ExtractionProvider.jsx";
import { hostOf, isExternal, pathOf } from "../lib/utils.js";

// Pure — exported for unit testing.
export function pickSiblings(links, baseUrl, limit = 3) {
  if (!Array.isArray(links) || !baseUrl) return [];
  const baseHost = hostOf(baseUrl);
  if (!baseHost) return [];

  const seen = new Set();
  const candidates = [];
  for (const l of links) {
    const href = l?.href;
    if (!href) continue;
    if (isExternal(href, baseUrl)) continue;          // skip off-domain
    if (href === baseUrl) continue;                    // skip self
    if (seen.has(href)) continue;
    seen.add(href);

    const p = pathOf(href) || "/";
    // Score: prefer shallow, descriptive paths. / is a fine fallback.
    let score = 0;
    const segments = p.split("/").filter(Boolean);
    score += Math.max(0, 6 - segments.length);          // 0-6 pts for shallowness
    if (/pricing|features|product|about|team|docs|blog|customers|contact/i.test(p)) {
      score += 4;                                       // 4 pts for high-intent paths
    }
    if (l.text && l.text.length >= 4 && l.text.length < 60) score += 1; // meaningful label
    if (p === "/") score -= 2;                          // home is rarely the next step
    candidates.push({ href, label: l.text || p, path: p, score });
  }
  candidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return candidates.slice(0, limit);
}

export default function ScrapeSimilarCard({ extraction }) {
  const { extract } = useExtraction();
  const baseUrl = extraction?.url;
  const siblings = useMemo(() => pickSiblings(extraction?.links, baseUrl, 3), [extraction, baseUrl]);

  if (!siblings.length) return null;

  const handleClick = (href) => {
    // Trigger a new extraction with no custom prompt — the existing context
    // (the user already knows what they want) carries forward.
    extract(href);
  };

  return (
    <div className="card rise scrape-similar" style={{ animationDelay: ".08s" }}>
      <div className="card-head">
        <span className="ch-icon">
          <Icon name="copy-plus" size={18} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>Scrape similar</h3>
          <p className="ch-sub">Other pages on <b>{hostOf(baseUrl)}</b> you might want next</p>
        </div>
        <span className="ai-badge ch-meta">
          <Icon name="zap" size={12} /> One click
        </span>
      </div>
      <div className="card-pad">
        <ul className="scrape-similar-row">
          {siblings.map((s) => (
            <li key={s.href}>
              <button
                type="button"
                className="scrape-similar-btn"
                onClick={() => handleClick(s.href)}
                title={s.href}
              >
                <span className="ssr-label">{s.label}</span>
                <span className="ssr-path">{s.path}</span>
                <Icon name="arrow-up-right" size={13} className="ssr-arrow" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
