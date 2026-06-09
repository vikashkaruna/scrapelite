// Privacy.jsx — Privacy Policy page (route "/privacy").
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";

const SECTIONS = [
  {
    title: "Information We Collect",
    content: [
      {
        heading: "Information you provide",
        text: "When you use ScrapeLite, you may provide us with information such as your email address (if you create an account), your name, and URLs you submit for extraction. This information is used solely to provide and improve the Service.",
      },
      {
        heading: "Extraction data",
        text: "URLs and their extracted content (headings, links, AI summaries, custom extraction results) are processed to deliver the Service to you. Extracted data associated with your account is stored to enable the Dashboard and history features.",
      },
      {
        heading: "Usage data",
        text: "We automatically collect certain information about your device and how you interact with ScrapeLite, including browser type, pages visited, features used, and timestamps. This data is used in aggregate to improve the product.",
      },
    ],
  },
  {
    title: "How We Use Your Information",
    content: [
      {
        heading: "Service delivery",
        text: "We use your information primarily to provide, maintain, and improve ScrapeLite — including processing URL extractions, returning results, and persisting your saved extractions.",
      },
      {
        heading: "Communications",
        text: "If you provide your email address, we may use it to send you important product updates, security notices, or responses to your inquiries. You can opt out of non-essential communications at any time.",
      },
      {
        heading: "Analytics and improvement",
        text: "Aggregated, anonymised usage data helps us understand how ScrapeLite is used so we can make it better. We do not sell or share individual user data for advertising purposes.",
      },
    ],
  },
  {
    title: "Data Storage and Security",
    content: [
      {
        heading: "Where your data is stored",
        text: "Extracted data and account information are stored in Supabase (a secure, SOC 2-compliant cloud database). Browser-local data (such as your persona preference and theme) is stored in your browser's localStorage and never transmitted to our servers.",
      },
      {
        heading: "Security measures",
        text: "We use industry-standard security practices including HTTPS encryption for all data in transit, secure API key management, and row-level security policies for database access. While we take reasonable precautions, no method of transmission or storage is 100% secure.",
      },
      {
        heading: "Data retention",
        text: "We retain your extracted data for as long as you maintain an account. You can delete individual extractions from your Dashboard at any time. To request deletion of all your data, contact us at the email below.",
      },
    ],
  },
  {
    title: "Third-Party Services",
    content: [
      {
        heading: "Firecrawl",
        text: "We use Firecrawl to perform web scraping and URL mapping. URLs you submit are sent to Firecrawl's API for processing. Please review Firecrawl's privacy policy for details on how they handle this data.",
      },
      {
        heading: "Anthropic (Claude AI)",
        text: "AI summaries and custom extractions are powered by Anthropic's Claude API. Content from extracted pages may be sent to Anthropic for AI processing. Please review Anthropic's usage policies.",
      },
      {
        heading: "Supabase",
        text: "User data and extraction records are stored using Supabase. Supabase is SOC 2 Type 2 certified and compliant with GDPR.",
      },
    ],
  },
  {
    title: "Your Rights",
    content: [
      {
        heading: "Access and portability",
        text: "You can export all your saved extractions at any time using the CSV or PDF export features in the Dashboard. This gives you full portability of your data.",
      },
      {
        heading: "Deletion",
        text: "You can delete individual extractions from the Dashboard. To request deletion of your account and all associated data, contact us at privacy@datiq.app.",
      },
      {
        heading: "GDPR and CCPA",
        text: "If you are located in the European Economic Area or California, you have additional rights under GDPR and CCPA respectively, including the right to access, correct, and delete your personal data. Contact us to exercise these rights.",
      },
    ],
  },
  {
    title: "Cookies and Local Storage",
    content: [
      {
        heading: "What we store locally",
        text: "ScrapeLite uses your browser's localStorage (not traditional cookies) to store preferences such as your selected theme, persona, and unsaved extraction results. This data stays on your device and is not transmitted to our servers.",
      },
      {
        heading: "No tracking cookies",
        text: "We do not use third-party tracking cookies, advertising pixels, or cross-site tracking technologies. We may use minimal first-party analytics to understand aggregate product usage.",
      },
    ],
  },
  {
    title: "Changes to This Policy",
    content: [
      {
        heading: "Updates",
        text: "We may update this Privacy Policy from time to time. We will notify you of significant changes via email (if you have provided one) or by posting a notice in the product. The date at the top of this page reflects the most recent update.",
      },
    ],
  },
];

export default function Privacy() {
  const navigate = useNavigate();

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 860, padding: "clamp(32px,5vw,64px) clamp(20px,4vw,44px)" }}>
        <Button variant="ghost" size="sm" icon="arrow-left" onClick={() => navigate(-1)} className="back-btn">
          Back
        </Button>

        <div className="legal-hero">
          <div className="legal-icon-wrap">
            <Icon name="shield" size={26} />
          </div>
          <div>
            <h1 className="legal-title">Privacy Policy</h1>
            <p className="legal-meta">Last updated: June 8, 2026 · Effective: June 8, 2026</p>
          </div>
        </div>

        <div className="legal-intro card card-pad">
          <p>
            ScrapeLite ("<b>we</b>", "<b>us</b>", or "<b>our</b>") is committed to protecting your privacy. This
            Privacy Policy explains what information we collect when you use ScrapeLite at{" "}
            <a href="https://scrapelite.netlify.app" className="legal-link" target="_blank" rel="noopener noreferrer">
              scrapelite.netlify.app
            </a>{" "}
            (the "<b>Service</b>"), how we use it, and your choices.
          </p>
          <p style={{ marginTop: 12, marginBottom: 0 }}>
            By using ScrapeLite, you agree to the collection and use of information as described in this policy. If you
            do not agree, please do not use the Service.
          </p>
        </div>

        <div className="legal-toc card card-pad">
          <div className="legal-toc-title">Table of Contents</div>
          <ol className="legal-toc-list">
            {SECTIONS.map((s, i) => (
              <li key={i}>
                <a href={`#section-${i}`} className="legal-link">
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </div>

        {SECTIONS.map((s, i) => (
          <div key={i} id={`section-${i}`} className="legal-section">
            <h2 className="legal-section-title">
              {i + 1}. {s.title}
            </h2>
            {s.content.map((c, j) => (
              <div key={j} className="legal-subsection">
                <h3 className="legal-subsection-title">{c.heading}</h3>
                <p className="legal-text">{c.text}</p>
              </div>
            ))}
          </div>
        ))}

        <div className="legal-contact card card-pad">
          <div className="legal-contact-title">Contact Us</div>
          <p className="legal-text">
            If you have questions about this Privacy Policy or want to exercise your data rights, please contact us:
          </p>
          <div className="legal-contact-row">
            <Icon name="mail" size={16} />
            <a href="mailto:privacy@datiq.app" className="legal-link">
              privacy@datiq.app
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
