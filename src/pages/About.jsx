// About.jsx — DatIQ / DatIQ about page.
import { useNavigate } from "react-router";
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

const MODULES = [
  {
    icon: "search",
    title: "Research any site",
    desc: "Get a clear view of companies, products, pricing, and markets in seconds — useful for founders, investors, competitive-intelligence, and research teams.",
  },
  {
    icon: "user-plus",
    title: "Enrich the details",
    desc: "Find contacts, leadership, social profiles, company missions, and other signals for faster prospecting, recruiting, and account research.",
  },
  {
    icon: "sparkles",
    title: "Create better work",
    desc: "Turn source material into summaries, SEO briefs, competitor comparisons, and content ideas — without starting from a blank page.",
  },
  {
    icon: "share",
    title: "Share and act",
    desc: "Keep results organized, export polished reports, monitor changes, and connect insights to the tools used by agencies, marketers, and operations teams.",
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
            Turn the public web into <span style={{ color: "var(--accent)" }}>useful answers.</span>
          </h1>
          <p className="about-hero-sub">
            DatIQ helps sales, research, marketing, recruiting, and operations teams turn any public URL into structured, ready-to-use intelligence — without code.
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

        {/* User-facing modules */}
        <div className="about-section">
          <div className="about-section-label">
            <Icon name="layers" size={14} />
            What you can do with DatIQ
          </div>
          <h2>One simple workflow, useful for every role.</h2>
          <div className="about-values">
            {MODULES.map((module) => (
              <div key={module.title} className="about-value">
                <div className="about-value-icon">
                  <Icon name={module.icon} size={20} strokeWidth={2} />
                </div>
                <div>
                  <div className="about-value-title">{module.title}</div>
                  <p className="about-value-desc">{module.desc}</p>
                </div>
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
            Choose your starting point and DatIQ brings the right examples and quick actions to the work you need to do.
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
