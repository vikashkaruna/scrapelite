// Blog.jsx — DatIQ blog listing page with featured articles.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { captureEmail } from "../lib/emailCaptureService.js";

const FEATURED_POST = {
  tag: "Product",
  title: "Introducing DatIQ: From URL to Intelligence in Seconds",
  excerpt:
    "We built DatIQ because extracting structured data from the web shouldn't require a PhD in scraping. Today we're sharing the story behind the product, the personas it was designed for, and where we're taking it next.",
  date: "June 9, 2026",
  readTime: "5 min read",
  coverIcon: "layers",
};

const POSTS = [
  {
    tag: "Guide",
    title: "How to Extract Competitor Pricing in 60 Seconds",
    excerpt: "Stop manually checking competitor sites. DatIQ's pricing extraction pulls structured tier data from any pricing page in one click.",
    date: "June 5, 2026",
    readTime: "3 min read",
    coverIcon: "hash",
  },
  {
    tag: "Use Case",
    title: "Lead Research at Scale: Surface Contacts from Any Domain",
    excerpt: "Sales teams use DatIQ to pull leadership contacts and emails from hundreds of target company sites — without a single API key.",
    date: "May 28, 2026",
    readTime: "4 min read",
    coverIcon: "users",
  },
  {
    tag: "Deep Dive",
    title: "Domain Mapping: Discover Every URL on a Site",
    excerpt: "The domain map feature crawls an entire site and returns a structured list of every indexed page. Here's how to use it for SEO and competitor research.",
    date: "May 20, 2026",
    readTime: "6 min read",
    coverIcon: "network",
  },
  {
    tag: "Tutorial",
    title: "Custom Extraction: Ask for Any Field in Plain English",
    excerpt: "With DatIQ's custom extraction mode you describe what you want — 'find the product SKUs' — and the AI locates and structures it. No XPath required.",
    date: "May 12, 2026",
    readTime: "4 min read",
    coverIcon: "sparkles",
  },
  {
    tag: "Product",
    title: "Persona-Adaptive Workflows: DatIQ Learns Your Role",
    excerpt: "When you tell DatIQ you're a researcher vs. a sales rep, the entire app adapts — different examples, quick actions, and AI prompts out of the box.",
    date: "May 3, 2026",
    readTime: "3 min read",
    coverIcon: "target",
  },
  {
    tag: "Engineering",
    title: "How We Built a Zero-Code Enrichment Pipeline",
    excerpt: "A look under the hood at how DatIQ chains Firecrawl extraction, Anthropic AI enrichment, and a Supabase persistence layer — all without the user writing a line of code.",
    date: "April 25, 2026",
    readTime: "8 min read",
    coverIcon: "code",
  },
];

function CoverIcon({ name, large }) {
  return (
    <div className={"blog-card-cover" + (large ? " blog-cover-lg" : "")}>
      <Icon name={name} size={large ? 52 : 36} strokeWidth={1.6} />
    </div>
  );
}

function PostCard({ post, large }) {
  return (
    <div className={"blog-card" + (large ? " blog-featured-main" : "")}>
      <CoverIcon name={post.coverIcon} large={large} />
      <div className="blog-card-body">
        <span className="blog-tag">{post.tag}</span>
        <h2 className={"blog-card-title" + (large ? " blog-card-title-lg" : "")}>{post.title}</h2>
        <p className="blog-card-excerpt">{post.excerpt}</p>
        <div className="blog-card-meta">
          <span>{post.date}</span>
          <span className="blog-card-meta-sep">·</span>
          <span>{post.readTime}</span>
          <button className="blog-card-link" style={{ marginLeft: "auto" }}>
            Read more <Icon name="arrow-right" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Blog() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [subStatus, setSubStatus] = useState("idle"); // idle | loading | success | already | error

  async function handleSubscribe(e) {
    e.preventDefault();
    if (!email.includes("@")) { setSubStatus("error"); return; }
    setSubStatus("loading");
    try {
      const result = await captureEmail(email, "blog-newsletter");
      setSubStatus(result.alreadySubscribed ? "already" : "success");
    } catch {
      setSubStatus("error");
    }
  }

  return (
    <div className="page">
      <div className="blog-page container">

        {/* Hero */}
        <div className="blog-hero rise">
          <div className="eyebrow">
            <Icon name="newspaper" size={14} />
            DatIQ Blog
          </div>
          <h1>
            Insights, tutorials &amp; product news
          </h1>
          <p>
            Tips on web extraction, data enrichment, AI workflows, and how data-driven teams
            are turning URLs into intelligence with DatIQ.
          </p>
        </div>

        {/* Featured post */}
        <div className="blog-featured">
          <PostCard post={FEATURED_POST} large />
          <PostCard post={POSTS[0]} />
          <PostCard post={POSTS[1]} />
        </div>

        {/* More posts */}
        <div className="blog-section-head">More articles</div>
        <div className="blog-grid">
          {POSTS.slice(2).map((post) => (
            <PostCard key={post.title} post={post} />
          ))}
        </div>

        {/* Newsletter CTA */}
        <div
          className="rise"
          style={{
            marginTop: 64,
            padding: "40px 32px",
            border: "1px solid var(--border)",
            borderRadius: "var(--r-lg)",
            background: "var(--accent-soft)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: 16,
          }}
        >
          <div className="eyebrow">
            <Icon name="mail" size={14} />
            Stay in the loop
          </div>
          <h2 style={{ margin: 0, fontSize: "clamp(20px, 3vw, 28px)", fontWeight: 800, letterSpacing: "-.025em" }}>
            Get product updates and tutorials
          </h2>
          <p style={{ margin: 0, color: "var(--text-2)", maxWidth: "44ch", lineHeight: 1.6 }}>
            No spam. Just new features, use-case guides, and the occasional deep-dive when we ship something interesting.
          </p>
          {subStatus === "success" && (
            <p style={{ margin: 0, color: "#16a34a", fontWeight: 600 }}>
              You're subscribed! We'll be in touch.
            </p>
          )}
          {subStatus === "already" && (
            <p style={{ margin: 0, color: "var(--text-2)", fontWeight: 600 }}>
              You're already subscribed — we've got you covered.
            </p>
          )}
          {(subStatus === "idle" || subStatus === "loading" || subStatus === "error") && (
            <form onSubmit={handleSubscribe} style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              <input
                type="email"
                required
                placeholder="you@company.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (subStatus === "error") setSubStatus("idle"); }}
                style={{
                  padding: "10px 16px",
                  borderRadius: "var(--r)",
                  border: `1px solid ${subStatus === "error" ? "#e0556b" : "var(--border)"}`,
                  background: "var(--surface)",
                  color: "var(--text-1)",
                  fontSize: ".95em",
                  width: 260,
                  outline: "none",
                  fontFamily: "inherit",
                }}
                aria-label="Email address"
              />
              <Button variant="primary" type="submit" icon="mail" disabled={subStatus === "loading"}>
                {subStatus === "loading" ? "Subscribing…" : "Subscribe"}
              </Button>
            </form>
          )}
          {subStatus === "error" && (
            <p style={{ margin: "-4px 0 0", color: "#e0556b", fontSize: ".85em" }}>
              Please enter a valid email address.
            </p>
          )}
        </div>

      </div>
    </div>
  );
}
