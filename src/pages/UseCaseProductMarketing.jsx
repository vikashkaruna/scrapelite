// UseCaseProductMarketing.jsx — /use-cases/product-marketing (plan §22, D22b).
import UseCaseLanding from "../components/UseCaseLanding.jsx";
import { useSeo } from "../hooks/useSeo.js";
import { seoFor } from "../lib/pageSeo.js";

export default function UseCaseProductMarketing() {
  useSeo(seoFor("/use-cases/product-marketing"));
  return (
    <UseCaseLanding
      eyebrow="Use Case · Product Marketing"
      title="Battlecards and claims built from what competitors actually publish"
      answer="Read competitor pricing, proof and positioning under one shared schema, keep a standing watch on the pages that matter, and hear about a real change the day it happens. Every claim on a battlecard carries the page and quote it came from, so nothing goes to the sales team that you cannot back up."
      stats={[
        { num: "5", label: "companies compared under one schema" },
        { num: "1", label: "silent baseline before any alert" },
        { num: "$0", label: "to start — no card" },
      ]}
      whatYouGet={[
        { icon: "swords", title: "Like-for-like battlecards", desc: "The Competitor Pricing Tracker and the AI Visibility & Competitive Brief read you and up to four competitors the same way, so the rows are comparable." },
        { icon: "trophy", title: "Proof you can cite", desc: "The Customer Proof Extractor lists every named customer, case study and quantified outcome a competitor publishes — with its source." },
        { icon: "bell", title: "Changes that matter", desc: "Competitor watchlists classify each change by materiality: a price change alerts immediately, a copyright year never does." },
      ]}
      howItWorks={[
        { title: "Pick your competitors", desc: "Start a Competitor Change Monitor or a pricing tracker from the template hub." },
        { title: "Build the card", desc: "Run the brief and keep the parts you can back up — anything unread is named as unread, never filled in." },
        { title: "Watch the pages", desc: "The first check is a silent baseline, so setting up a watch never fires a false alert." },
        { title: "Route the change", desc: "Send critical changes to Slack or email with a rule limited to that watchlist." },
      ]}
      personas={[
        { icon: "megaphone", label: "Product marketing" },
        { icon: "eye", label: "Competitive intelligence" },
        { icon: "target", label: "Sales enablement" },
      ]}
      honesty={{
        title: "A field that disappeared is not a deletion",
        body: "When a page stops showing a field, DatIQ reports it as no longer observed — usually a failed render — rather than telling you a competitor dropped their pricing. That is the false positive that costs the most.",
      }}
      cta={{ title: "Build your first battlecard", body: "Free to start — 100 credits, no credit card required.", label: "Open the template hub", to: "/templates?filter=pmm" }}
      related={[
        { label: "Competitive Monitoring", path: "/use-cases/competitive-monitoring" },
        { label: "Competitor Research", path: "/use-cases/competitor-research" },
        { label: "AI Visibility", path: "/use-cases/ai-visibility" },
      ]}
    />
  );
}
