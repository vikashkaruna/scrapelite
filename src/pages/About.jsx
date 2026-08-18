// About.jsx — DatIQ / DatIQ about page.
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { PERSONA_BY_ID } from "../lib/personaConfig.js";
import { useSeo } from "../hooks/useSeo.js";
import { seoFor } from "../lib/pageSeo.js";

const VALUES = [
  {
    icon: "lightbulb",
    title: "Intelligence First",
    desc: "Raw data is noise. We transform it into structured, actionable intelligence so you can decide with confidence.",
  },
  {
    icon: "zap",
    title: "Zero Friction",
    desc: "No code. No setup. Paste a URL and get structured data back in seconds — from a landing page to an entire domain.",
  },
  {
    icon: "shield",
    title: "Privacy Respecting",
    desc: "We only extract publicly available information. Your session data stays local by default, never sold or shared.",
  },
  {
    icon: "heart",
    title: "Built for Humans",
    desc: "From researchers to sales teams to developers — DatIQ adapts to your workflow, not the other way around.",
  },
];

const HOW_IT_WORKS = [
  { step: "01", title: "Paste any URL", desc: "A product page, a company site, a help doc, a pricing page — anything publicly accessible." },
  { step: "02", title: "Extract structure", desc: "We pull headings, links, metadata, contacts, pricing tiers, and any custom field you define." },
  { step: "03", title: "Enrich with AI", desc: "Layer on an AI summary, content generation, lead scoring, or your own enrichment prompts." },
  { step: "04", title: "Decide and act", desc: "Export to CSV, share via PDF, trigger a webhook, or build on top of the API — your data, your workflow." },
];

// DatIQ's product is organised as a stack of named pillars. Pillar 0 is the
// proven foundation that ships today; higher pillars build on top of it.
// Each pillar is intentionally short — the point is to communicate that
// Pillar 0 is real (not a roadmap promise) and that the rest is layered.
const PILLARS = [
  {
    id: "p0",
    label: "Pillar 0",
    title: "Web Intelligence (Core)",
    status: "live",
    desc: "The proven single, batch, and scheduled URL-extraction engine that the whole platform is built on. Headings, links, contacts, pricing, custom fields, AI summaries, CSV/PDF export, domain mapping — every DatIQ capability you use today runs on Pillar 0.",
  },
  {
    id: "p1",
    label: "Pillar 1",
    title: "Enrichment & Insight",
    status: "live",
    desc: "AI summaries, lead scoring, contact enrichment, social-link discovery, company-mission extraction, and content generation (SEO outlines, competitor briefs, social posts) — all running on the structured data Pillar 0 returns.",
  },
  {
    id: "p2",
    label: "Pillar 2",
    title: "Distribution & Workflow",
    status: "live",
    desc: "CSV / PDF / Google Sheets export, scheduled monitoring with alerts, email delivery, webhook push, and CRM sync (HubSpot). The intelligence leaves the app on your terms.",
  },
  {
    id: "p3",
    label: "Pillar 3",
    title: "Workspace & Collaboration",
    status: "roadmap",
    desc: "Shared workspaces, role-based access, audit trails, and team-level usage controls — for agencies, research teams, and revenue ops running DatIQ at scale.",
  },
  {
    id: "p4",
    label: "Pillar 4",
    title: "Intelligence Mesh (API & Integrations)",
    status: "roadmap",
    desc: "A first-class REST + webhook API, native integrations (Zapier, Make, n8n, HubSpot, Salesforce, Notion, Airtable), and an SDK so DatIQ's intelligence can be embedded anywhere.",
  },
];

export default function About() {
  // Title, description, canonical and JSON-LD for this route.
  // Ported from the hand-written public/about/index.html this page now owns.
  useSeo(seoFor("/about"));

  const navigate = useNavigate();
  const personas = Object.values(PERSONA_BY_ID);

  return (
    <div className="page">
      <div className="about-page container">

        {/* Hero */}
        <div className="about-hero rise">
          <div className="about-hero-badge">
            <Icon name="sparkles" size={13} />
            Data + IQ — Intelligence Quotient for the Web
          </div>
          <h1>
            Intelligence from the <span style={{ color: "var(--accent)" }}>Web.</span>
          </h1>
          <p className="about-hero-sub">
            DatIQ — the unified web intelligence platform.
          </p>
          <div className="about-hero-actions">
            <Button variant="primary" icon="rocket" onClick={() => navigate("/")}>
              Start extracting
            </Button>
            <Button variant="secondary" icon="book-open" onClick={() => { window.location.href = "/help/index.html"; }}>
              Read the docs
            </Button>
          </div>
        </div>

        {/* Pillars — communicates that Pillar 0 is the proven foundation and
            higher pillars are layered on top. Visually mirrors the
            home/capabilities grid for a consistent mental model. */}
        <div className="about-section">
          <div className="about-section-label">
            <Icon name="layers" size={14} />
            The product, organised
          </div>
          <h2>Built on a named foundation. Pillar 0 ships today.</h2>
          <p style={{ marginTop: -4, marginBottom: 18 }}>
            DatIQ is structured as a stack of pillars. <strong>Pillar 0 — Web Intelligence (Core)</strong> is the
            single, batch, and scheduled URL-extraction engine that every other capability in the product is
            built on. It's the proven foundation; the rest of the platform is what you can do once you have it.
          </p>
          <div className="about-pillars">
            {PILLARS.map((p) => (
              <div
                key={p.id}
                className={
                  "about-pillar" +
                  (p.status === "live" ? " about-pillar-live" : " about-pillar-roadmap") +
                  (p.id === "p0" ? " about-pillar-p0" : "")
                }
              >
                <div className="about-pillar-head">
                  <span className="about-pillar-label">{p.label}</span>
                  <span className={"about-pillar-status about-pillar-status-" + p.status}>
                    {p.status === "live" ? "Live" : "Roadmap"}
                  </span>
                </div>
                <div className="about-pillar-title">{p.title}</div>
                <p className="about-pillar-desc">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Mission */}
        <div className="about-section fade">
          <div className="about-section-label">
            <Icon name="target" size={14} />
            Our Mission
          </div>
          <h2>Intelligence from Web</h2>
          <p>
            The web holds an enormous amount of structured knowledge — company pages, pricing tables, contact directories,
            product documentation, research articles — yet extracting that knowledge has traditionally required writing scrapers,
            managing proxies, parsing HTML, and building data pipelines.
          </p>
          <p>
            DatIQ collapses that complexity into a single URL input. Paste any publicly accessible page and get back
            structured headings, links, contacts, pricing data, and an AI-powered summary — in seconds.
            No code. No setup. No infrastructure.
          </p>
          <p>
            Then go deeper: map an entire domain, enrich leads with AI, generate SEO briefs, extract any field in
            plain English, and export your results in any format your workflow needs.
          </p>
        </div>

        {/* Values */}
        <div className="about-section">
          <div className="about-section-label">
            <Icon name="heart" size={14} />
            What we stand for
          </div>
          <h2>Our values</h2>
          <div className="about-values">
            {VALUES.map((v) => (
              <div key={v.title} className="about-value">
                <div className="about-value-icon">
                  <Icon name={v.icon} size={20} strokeWidth={2} />
                </div>
                <div>
                  <div className="about-value-title">{v.title}</div>
                  <p className="about-value-desc">{v.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* How it works */}
        <div className="about-section">
          <div className="about-section-label">
            <Icon name="layers" size={14} />
            How it works
          </div>
          <h2>From URL to intelligence in four steps</h2>
          <div className="about-values" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            {HOW_IT_WORKS.map((s) => (
              <div key={s.step} className="about-value">
                <div style={{ fontSize: "1.6em", fontWeight: 800, letterSpacing: "-.04em", color: "var(--accent)", lineHeight: 1 }}>
                  {s.step}
                </div>
                <div>
                  <div className="about-value-title">{s.title}</div>
                  <p className="about-value-desc">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Built for every persona */}
        <div className="about-section">
          <div className="about-section-label">
            <Icon name="users" size={14} />
            Who uses DatIQ
          </div>
          <h2>Built for every data-driven role</h2>
          <p>
            DatIQ adapts to your role from the moment you start. Tell us who you are and we tailor the examples,
            quick actions, and hero copy to your exact use case.
          </p>
          <div className="about-personas">
            {personas.map((p) => (
              <div key={p.id} className="about-persona">
                <div className="about-persona-dot" style={{ background: p.color }} />
                <span className="about-persona-name">{p.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Founder block */}
        <div className="about-section fade">
          <div className="about-section-label">
            <Icon name="building" size={14} />
            The company
          </div>
          <h2>Built by someone who felt the need</h2>
          <div className="about-founder">
            <div className="about-founder-avatar about-founder-company" role="img" aria-label="Axiom Minds Private Limited logo">
              <img
                src="/axiom-minds-logo.png"
                alt="Axiom Minds Private Limited"
                width={64}
                height={64}
                loading="lazy"
              />
            </div>
            <div className="about-founder-info">
              {/* Company name with the Axiom Minds logo anchored to the LEFT of the
                  name (per Vikash's spec) — the seal sits inline so it's
                  unmistakably attached to the corporate identity, not a generic
                  "founder avatar". The icon next to the company name also
                  reinforces the brand. */}
              <div className="about-founder-company-row">
                <img
                  src="/axiom-minds-logo.png"
                  alt=""
                  aria-hidden="true"
                  width={28}
                  height={28}
                  loading="lazy"
                  className="about-founder-company-mark"
                />
                <div className="about-founder-name">Axiom Minds Private Limited</div>
              </div>
              <div className="about-founder-role">Founder, https://axiomminds.ai - DatIQ</div>
              <p className="about-founder-bio">
                DatIQ has been built after realizing the pain of manually copying data from websites into spreadsheets — a
                workflow teams kept encountering across sales, research, and marketing. DatIQ is the answer: a
                zero-code platform that turns any URL into structured, actionable intelligence in seconds.
              </p>
              <a
                href="https://www.linkedin.com/company/axiom-minds/about/"
                target="_blank"
                rel="noopener noreferrer"
                className="about-founder-linkedin"
              >
                <Icon name="linkedin" size={15} />
                linkedin.com/company/axiom-minds/
              </a>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="about-cta rise">
          <h2>Ready to extract intelligence?</h2>
          <p>
            Paste your first URL in under 10 seconds. No sign-up required to get started.
          </p>
          <Button variant="primary" size="sm" icon="rocket" onClick={() => navigate("/")}>
            Try DatIQ free
          </Button>
        </div>

      </div>
    </div>
  );
}
