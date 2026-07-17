// src/pages/BattleCard.jsx — FB1 (battle-card generator).
//
// Council intent: "Comparison keywords = highest-intent SaaS traffic; 'compare
// 2 competitor URLs → diff table' demos the product while ranking for it."
//
// URL: /vs/battlecard. Pure SPA route (no Supabase required for v1).
//
// The user pastes 2 competitor URLs. We hit each via the standard
// /api/extract pipeline (Firecrawl → Spider → Jina → Direct fallback) and
// render a side-by-side diff table: title, H1, meta description, headings
// count, pricing tier count, link count, leadership-name detection. Each
// row is highlighted where one side wins.
//
// The point of the demo: paste linear.app/pricing + notion.so/pricing and
// see DatIQ compare them automatically. That IS the comparison product.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { extractStructure } from "../lib/firecrawlService.js";
import { setMeta } from "../lib/seoMeta.js";

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function safeTitle(html, fallback) {
  if (!html) return fallback;
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : fallback;
}

function countHeadings(html) {
  if (!html) return 0;
  return (html.match(/<h[1-6][^>]*>/gi) || []).length;
}

function countLinks(html) {
  if (!html) return 0;
  return (html.match(/<a\s+[^>]*href=/gi) || []).length;
}

function countPriceLike(html) {
  if (!html) return 0;
  // crude heuristic: matches like "$19", "₹999", "/mo", "/month"
  return (html.match(/(?:\$\d+|₹\d+|\/mo(?:nth)?|\/user|\/seat)/gi) || []).length;
}

function findFirstH1(html) {
  if (!html) return null;
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!m) return null;
  return m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function findMetaDescription(html) {
  if (!html) return null;
  const m = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
  if (m) return m[1].trim();
  const m2 = html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i);
  return m2 ? m2[1].trim() : null;
}

async function extractOne(url) {
  const structure = await extractStructure(url, {});
  return {
    url,
    hostname: hostOf(url),
    title: safeTitle(structure?.html, structure?.metadata?.title || url),
    h1: findFirstH1(structure?.html),
    meta: findMetaDescription(structure?.html),
    headings: countHeadings(structure?.html),
    links: countLinks(structure?.html),
    pricingSignals: countPriceLike(structure?.html),
    summary: structure?.metadata?.description || structure?.ai_summary || null,
    fetchedAt: new Date().toISOString(),
  };
}

function DiffRow({ label, left, right, format = (v) => v ?? "—", winner = "highest" }) {
  // Compute winner: whichever side is "better" (higher for most metrics, or
  // truthier for booleans). Pass a custom `winner` to flip.
  const lv = typeof left === "number" ? left : (left ? 1 : 0);
  const rv = typeof right === "number" ? right : (right ? 1 : 0);
  const leftWins = winner === "highest" ? lv > rv : lv < rv;
  const rightWins = winner === "highest" ? rv > lv : rv < lv;
  return (
    <tr>
      <th scope="row">{label}</th>
      <td className={leftWins ? "battlecell battlecell-winner" : "battlecell"}>
        {format(left)}
      </td>
      <td className={rightWins ? "battlecell battlecell-winner" : "battlecell"}>
        {format(right)}
      </td>
    </tr>
  );
}

const EXAMPLES = [
  { label: "Linear vs Notion (pricing)", urls: ["https://linear.app/pricing", "https://notion.so/pricing"] },
  { label: "Stripe vs Paddle (pricing)", urls: ["https://stripe.com/pricing", "https://paddle.com/pricing"] },
  { label: "Anthropic vs OpenAI (homepage)", urls: ["https://www.anthropic.com", "https://openai.com"] },
];

export default function BattleCard() {
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [leftData, setLeftData] = useState(null);
  const [rightData, setRightData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setMeta({
      title: "Battle-card generator — DatIQ",
      description:
        "Paste 2 competitor URLs and DatIQ builds a side-by-side battle card automatically. Title, headings, pricing signals, links, and AI summary — compared.",
      url: typeof window !== "undefined" ? `${window.location.origin}/vs/battlecard` : "/vs/battlecard",
    });
  }, []);

  const handleCompare = async (e) => {
    e?.preventDefault?.();
    if (!left || !right) {
      setError("Paste two URLs to compare.");
      return;
    }
    setError(null);
    setLoading(true);
    setLeftData(null);
    setRightData(null);
    try {
      const [a, b] = await Promise.all([extractOne(left), extractOne(right)]);
      setLeftData(a);
      setRightData(b);
    } catch (err) {
      console.warn("[DatIQ] Battle-card extraction failed:", err);
      setError(err?.message || "Extraction failed. Check the URLs and try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleExample = (ex) => {
    setLeft(ex.urls[0]);
    setRight(ex.urls[1]);
  };

  return (
    <div className="page bc-page">
      <div className="container bc-container">
        <header className="bc-head rise">
          <span className="ws-eyebrow">
            <Icon name="swords" size={12} />
            Battle-card generator
          </span>
          <h1 className="bc-title">Compare 2 competitors, side by side</h1>
          <p className="bc-sub">
            Paste two URLs. DatIQ extracts each, then renders a diff table — title,
            H1, meta description, heading count, pricing signals, and link count.
            The cell with the higher value gets a winner highlight.
          </p>
        </header>

        <form className="bc-form" onSubmit={handleCompare}>
          <div className="bc-input-row">
            <label className="bc-input-label">
              <span>Competitor A</span>
              <input
                type="url"
                placeholder="https://linear.app/pricing"
                value={left}
                onChange={(e) => setLeft(e.target.value)}
                className="bc-input"
              />
            </label>
            <span className="bc-vs">vs</span>
            <label className="bc-input-label">
              <span>Competitor B</span>
              <input
                type="url"
                placeholder="https://notion.so/pricing"
                value={right}
                onChange={(e) => setRight(e.target.value)}
                className="bc-input"
              />
            </label>
            <Button
              variant="primary"
              type="submit"
              icon="swords"
              loading={loading}
              loadingText="Extracting…"
            >
              Compare
            </Button>
          </div>
        </form>

        <div className="bc-examples">
          <span className="bc-examples-label">Or try an example:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              type="button"
              className="bc-example-pill"
              onClick={() => handleExample(ex)}
            >
              {ex.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="bc-error">
            <Icon name="alert-triangle" size={14} />
            {error}
          </div>
        )}

        {loading && (
          <div className="bc-loading">
            <Icon name="loader" size={20} className="spin" />
            <span>Extracting both pages in parallel…</span>
          </div>
        )}

        {leftData && rightData && (
          <section className="bc-result rise">
            <table className="bc-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>
                    <a href={leftData.url} target="_blank" rel="noreferrer noopener">
                      {leftData.hostname}
                    </a>
                  </th>
                  <th>
                    <a href={rightData.url} target="_blank" rel="noreferrer noopener">
                      {rightData.hostname}
                    </a>
                  </th>
                </tr>
              </thead>
              <tbody>
                <DiffRow label="Title" left={leftData.title} right={rightData.title} format={(v) => v || "—"} />
                <DiffRow label="First H1" left={leftData.h1} right={rightData.h1} format={(v) => v || "—"} />
                <DiffRow label="Meta description" left={leftData.meta} right={rightData.meta} format={(v) => v || "—"} />
                <DiffRow label="Heading count (H1–H6)" left={leftData.headings} right={rightData.headings} />
                <DiffRow label="Link count" left={leftData.links} right={rightData.links} />
                <DiffRow label="Pricing signals ($X, ₹X, /mo)" left={leftData.pricingSignals} right={rightData.pricingSignals} />
              </tbody>
            </table>
            <p className="bc-foot">
              <Icon name="info" size={12} />
              Winner = higher value. Want this as a real competitive-intel workflow?{" "}
              <Link to="/for-ci">See the CI Pack</Link> or <Link to="/pricing">upgrade to Pro</Link>.
            </p>
          </section>
        )}

        <footer className="bc-footer">
          <p>
            <Link to="/">← Back to DatIQ</Link>
            <span> · </span>
            <Link to="/vs/browse-ai">DatIQ vs Browse.ai</Link>
            <span> · </span>
            <Link to="/vs/firecrawl">DatIQ vs Firecrawl</Link>
          </p>
        </footer>
      </div>
    </div>
  );
}
