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
        text: "When you use DatIQ, you may provide us with information such as your email address (if you create an account), your name, and URLs you submit for extraction. This information is used solely to provide and improve the Service.",
      },
      {
        heading: "Extraction data",
        text: "URLs and their extracted content (headings, links, AI summaries, custom extraction results) are processed to deliver the Service to you. Extracted data associated with your account is stored to enable the Dashboard and history features.",
      },
      {
        heading: "Usage data",
        text: "We automatically collect certain information about your device and how you interact with DatIQ, including browser type, pages visited, features used, and timestamps. This data is used in aggregate to improve the product.",
      },
    ],
  },
  {
    title: "How We Use Your Information",
    content: [
      {
        heading: "Service delivery",
        text: "We use your information primarily to provide, maintain, and improve DatIQ — including processing URL extractions, returning results, and persisting your saved extractions.",
      },
      {
        heading: "Communications",
        text: "If you provide your email address, we may use it to send you important product updates, security notices, or responses to your inquiries. You can opt out of non-essential communications at any time.",
      },
      {
        heading: "Analytics and improvement",
        text: "Aggregated, anonymised usage data helps us understand how DatIQ is used so we can make it better. We do not sell or share individual user data for advertising purposes.",
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
        text: "You can delete individual extractions from the Dashboard. To request deletion of your account and all associated data, contact us at hello@datiq.app.",
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
        text: "DatIQ uses your browser's localStorage (not traditional cookies) to store preferences such as your selected theme, persona, and unsaved extraction results. This data stays on your device and is not transmitted to our servers.",
      },
      {
        heading: "No tracking cookies",
        text: "We do not use third-party tracking cookies, advertising pixels, or cross-site tracking technologies. We may use minimal first-party analytics to understand aggregate product usage.",
      },
    ],
  },
  {
    title: "Digital Personal Data Protection (DPDP Act, India)",
    content: [
      {
        heading: "Applicability",
        text: "DatIQ operates in India and processes data of Indian residents. Accordingly, we comply with the Digital Personal Data Protection Act, 2023 (DPDP Act) and the rules notified thereunder. This section supplements the general privacy rights described above and applies specifically to Data Principals (users) located in India.",
      },
      {
        heading: "Lawful basis for processing",
        text: "We process your personal data on the basis of your consent, given at the time of registration or use of the Service, or on the basis of legitimate purposes as specified under the DPDP Act. You may withdraw your consent at any time by contacting hello@datiq.app, though withdrawal may limit your ability to use certain features of the Service.",
      },
      {
        heading: "Rights of Data Principals",
        text: "If you are an Indian resident, you have the right to: (a) access a summary of personal data we hold about you; (b) correct inaccurate or incomplete personal data; (c) erasure of personal data when it is no longer necessary; (d) grievance redressal through our designated contact below; and (e) nominate a person to exercise rights on your behalf in the event of death or incapacity.",
      },
      {
        heading: "Grievance Officer (India)",
        text: "For grievances under the DPDP Act, please contact our designated officer at hello@datiq.app with the subject line 'DPDP Grievance'. We will acknowledge your complaint within 48 hours and endeavour to resolve it within 15 business days.",
      },
      {
        heading: "Cross-border data transfers",
        text: "DatIQ uses Supabase and Anthropic services, which may process your data in jurisdictions outside India. We ensure such transfers are subject to adequate safeguards as required under the DPDP Act and applicable rules.",
      },
      {
        heading: "Retention and erasure",
        text: "We retain personal data only as long as necessary to fulfill the purposes for which it was collected or as required by law. Upon receiving a valid erasure request, we will delete your account data within 30 days unless retention is required by applicable law.",
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
            DatIQ ("<b>we</b>", "<b>us</b>", or "<b>our</b>") is committed to protecting your privacy. This
            Privacy Policy explains what information we collect when you use DatIQ at{" "}
            <a href="https://datiq.app" className="legal-link" target="_blank" rel="noopener noreferrer">
              datiq.app
            </a>{" "}
            (the "<b>Service</b>"), how we use it, and your choices.
          </p>
          <p style={{ marginTop: 12, marginBottom: 0 }}>
            By using DatIQ, you agree to the collection and use of information as described in this policy. If you
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
            <a href="mailto:hello@datiq.app" className="legal-link">
              hello@datiq.app
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
