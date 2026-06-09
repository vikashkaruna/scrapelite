// Terms.jsx — Terms of Service page (route "/terms").
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";

const SECTIONS = [
  {
    title: "Acceptance of Terms",
    content:
      "By accessing or using ScrapeLite (the \"Service\"), you agree to be bound by these Terms of Service (\"Terms\"). If you do not agree to all of these Terms, you may not use the Service. These Terms apply to all visitors, users, and others who access or use the Service.",
  },
  {
    title: "Description of Service",
    content:
      "ScrapeLite is a web-based platform that enables users to extract structured data (headings, links, contact information, and other content) from publicly accessible web pages, and to enrich that data using AI-powered analysis. The Service is provided on an \"as is\" and \"as available\" basis.",
  },
  {
    title: "Acceptable Use",
    items: [
      "You may only use ScrapeLite to extract data from websites you own, have explicit permission to scrape, or that are publicly accessible and not protected by technical or legal access controls.",
      "You must comply with the robots.txt directives and Terms of Service of any website you scrape using ScrapeLite.",
      "You may not use ScrapeLite to harvest personal data for spam, phishing, identity theft, or any other malicious purpose.",
      "You may not use ScrapeLite to circumvent authentication, access controls, or rate limits of any website or service.",
      "You may not resell, sublicense, or redistribute access to ScrapeLite's extraction infrastructure without prior written consent.",
      "You may not use ScrapeLite in any way that violates applicable laws, including data protection laws (GDPR, CCPA) and computer fraud statutes (CFAA).",
      "Automated batch extraction at scale requires prior agreement with ScrapeLite. Contact us for enterprise usage.",
    ],
  },
  {
    title: "Intellectual Property",
    content:
      "The Service itself — including its design, code, branding, and underlying technology — is owned by ScrapeLite and protected by intellectual property laws. Content extracted from third-party websites remains the intellectual property of those websites' owners. ScrapeLite does not claim ownership of any extracted content. You are responsible for ensuring your use of extracted content complies with applicable copyright and data laws.",
  },
  {
    title: "User Data and Privacy",
    content:
      "Your use of the Service is subject to our Privacy Policy, which is incorporated by reference into these Terms. By using the Service, you consent to the collection and use of information as described in the Privacy Policy.",
  },
  {
    title: "Third-Party Services",
    content:
      "ScrapeLite integrates with third-party services including Firecrawl (web crawling), Anthropic Claude (AI), and Supabase (data storage). Your use of these integrations is subject to the respective terms and policies of those services. ScrapeLite is not responsible for the availability, accuracy, or actions of these third-party services.",
  },
  {
    title: "Limitation of Liability",
    content:
      "To the maximum extent permitted by applicable law, ScrapeLite shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to loss of data, loss of profits, or business interruption, arising from your use of or inability to use the Service. Our total liability to you for any claims under these Terms shall not exceed the amount you paid us in the twelve months preceding the claim.",
  },
  {
    title: "Disclaimer of Warranties",
    content:
      "ScrapeLite is provided \"as is\" without warranty of any kind, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, or non-infringement. We do not warrant that the Service will be uninterrupted, error-free, or free of harmful components, or that extraction results will be complete or accurate.",
  },
  {
    title: "Termination",
    content:
      "We may terminate or suspend your access to the Service at any time, with or without cause, and with or without notice. Upon termination, your right to use the Service ceases immediately. Provisions of these Terms that by their nature should survive termination (including intellectual property, limitation of liability, and dispute resolution) shall survive.",
  },
  {
    title: "Changes to Terms",
    content:
      "We reserve the right to modify these Terms at any time. We will notify you of material changes by posting the updated Terms in the Service and updating the \"Last updated\" date. Your continued use of the Service after any changes constitutes your acceptance of the new Terms.",
  },
  {
    title: "Governing Law",
    content:
      "These Terms are governed by and construed in accordance with the laws of the State of Delaware, United States, without regard to its conflict of law provisions. Any disputes arising from these Terms or your use of the Service shall be resolved through binding arbitration in accordance with the American Arbitration Association's rules.",
  },
  {
    title: "Contact",
    content:
      "If you have questions about these Terms of Service, please contact us at legal@datiq.app.",
  },
];

export default function Terms() {
  const navigate = useNavigate();

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 860, padding: "clamp(32px,5vw,64px) clamp(20px,4vw,44px)" }}>
        <Button variant="ghost" size="sm" icon="arrow-left" onClick={() => navigate(-1)} className="back-btn">
          Back
        </Button>

        <div className="legal-hero">
          <div className="legal-icon-wrap">
            <Icon name="file" size={26} />
          </div>
          <div>
            <h1 className="legal-title">Terms of Service</h1>
            <p className="legal-meta">Last updated: June 8, 2026 · Effective: June 8, 2026</p>
          </div>
        </div>

        <div className="legal-intro card card-pad">
          <p style={{ margin: 0 }}>
            Please read these Terms of Service carefully before using ScrapeLite. These Terms constitute a legally
            binding agreement between you and ScrapeLite governing your use of the Service.
          </p>
        </div>

        <div className="legal-toc card card-pad">
          <div className="legal-toc-title">Table of Contents</div>
          <ol className="legal-toc-list">
            {SECTIONS.map((s, i) => (
              <li key={i}>
                <a href={`#ts-${i}`} className="legal-link">
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </div>

        {SECTIONS.map((s, i) => (
          <div key={i} id={`ts-${i}`} className="legal-section">
            <h2 className="legal-section-title">
              {i + 1}. {s.title}
            </h2>
            {s.items ? (
              <ul className="legal-list">
                {s.items.map((item, j) => (
                  <li key={j} className="legal-list-item">
                    {item}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="legal-text">{s.content}</p>
            )}
          </div>
        ))}

        <div className="legal-contact card card-pad">
          <div className="legal-contact-title">Questions?</div>
          <p className="legal-text">
            For questions about these Terms of Service, please contact our legal team:
          </p>
          <div className="legal-contact-row">
            <Icon name="mail" size={16} />
            <a href="mailto:legal@datiq.app" className="legal-link">
              legal@datiq.app
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
