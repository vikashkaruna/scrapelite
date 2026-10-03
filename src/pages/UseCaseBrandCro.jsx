// UseCaseBrandCro.jsx — /use-cases/brand-cro (plan §22, D22b).
import UseCaseLanding from "../components/UseCaseLanding.jsx";
import { useSeo } from "../hooks/useSeo.js";
import { seoFor } from "../lib/pageSeo.js";

export default function UseCaseBrandCro() {
  useSeo(seoFor("/use-cases/brand-cro"));
  return (
    <UseCaseLanding
      eyebrow="Use Case · Brand, Growth & CRO"
      title="Make sure search engines and AI answers say the right things about you"
      answer="Record the facts about your company once, approved by a person, and DatIQ checks every audited page against them. It scores how you show up in search, answer engines and generative engines, measures your share of voice against competitors, and scores trust by the quality of the evidence — never the volume."
      stats={[
        { num: "3", label: "engines scored: SEO, AEO and GEO" },
        { num: "1", label: "approved truth record to check against" },
        { num: "$0", label: "to start — no card" },
      ]}
      whatYouGet={[
        { icon: "shield-check", title: "A business truth record", desc: "Your legal name, domain and key facts, approved by a person. An audit that contradicts it is flagged — often the reason three engines describe you three ways." },
        { icon: "radar", title: "Share of voice", desc: "The AI Visibility & Competitive Brief and the Weekly AI Visibility Monitor show how you and your competitors are described, side by side." },
        { icon: "trophy", title: "Trust that cannot be gamed", desc: "One verifiable third-party record outweighs any number of testimonials on your own page, so the score rises only when the evidence does." },
      ]}
      howItWorks={[
        { title: "Set up your truth record", desc: "Start from the Business Truth Setup template; two fields are required, the rest are reported as you go." },
        { title: "Audit the pages that convert", desc: "Every finding separates what was measured from what it probably means." },
        { title: "Fix in priority order", desc: "Copy-ready constructs — answer blocks, FAQ and Organization markup built from your visible content." },
        { title: "Keep watching", desc: "A weekly monitor emails you only when something material moves." },
      ]}
      personas={[
        { icon: "trending-up", label: "Brand & growth" },
        { icon: "gauge", label: "CRO" },
        { icon: "search", label: "SEO & content" },
      ]}
      honesty={{
        title: "“Not measured” is never “zero”",
        body: "A signal DatIQ could not measure is left out and its weight redistributed, and every score carries its coverage — so a third-party outage never shows up as a drop in your score.",
      }}
      cta={{ title: "Set up your truth record", body: "Free to start — 500 credits, no credit card required.", label: "Open the template hub", to: "/templates?filter=brand-growth" }}
      related={[
        { label: "AI Visibility", path: "/use-cases/ai-visibility" },
        { label: "SEO Audit", path: "/use-cases/seo-audit" },
        { label: "Product Marketing", path: "/use-cases/product-marketing" },
      ]}
    />
  );
}
