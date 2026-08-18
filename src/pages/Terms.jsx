// Terms.jsx — Terms of Service page (route "/terms").
//
// ⚠️ As in Privacy.jsx, SECTIONS drives the #section-N anchor ids by ARRAY
// INDEX. Edit in place; appending is safe; inserting or reordering silently
// repoints every existing deep link.
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { useSeo } from "../hooks/useSeo.js";

const SECTIONS = [
  {
    title: "Acceptance of Terms",
    content:
      "By accessing or using DatIQ (the \"Service\"), you agree to be bound by these Terms of Service (\"Terms\"). If you do not agree to all of these Terms, you may not use the Service. These Terms apply to all visitors, users, and others who access or use the Service.",
  },
  {
    title: "Description of Service",
    content:
      "DatIQ is a web-based platform that enables users to extract structured data (headings, links, contact information, and other content) from publicly accessible web pages, and to enrich that data using AI-powered analysis. The Service is provided on an \"as is\" and \"as available\" basis.",
  },
  {
    title: "Acceptable Use",
    items: [
      "You may only use DatIQ to extract data from websites you own, have explicit permission to scrape, or that are publicly accessible and not protected by technical or legal access controls.",
      "You must comply with the robots.txt directives and Terms of Service of any website you scrape using DatIQ.",
      "You may not use DatIQ to harvest personal data for spam, phishing, identity theft, or any other malicious purpose.",
      "You may not use DatIQ to circumvent authentication, access controls, or rate limits of any website or service.",
      "You may not resell, sublicense, or redistribute access to DatIQ's extraction infrastructure without prior written consent.",
      "You may not use DatIQ in any way that violates applicable laws, including data protection laws (GDPR, CCPA) and computer fraud statutes (CFAA).",
      "Automated batch extraction at scale requires prior agreement with DatIQ. Contact us for enterprise usage.",
    ],
  },
  {
    title: "Intellectual Property",
    content:
      "The Service itself — including its design, code, branding, and underlying technology — is owned by DatIQ and protected by intellectual property laws. Content extracted from third-party websites remains the intellectual property of those websites' owners. DatIQ does not claim ownership of any extracted content. You are responsible for ensuring your use of extracted content complies with applicable copyright and data laws.",
  },
  {
    title: "User Data and Privacy",
    content:
      "Your use of the Service is subject to our Privacy Policy, which is incorporated by reference into these Terms. By using the Service, you consent to the collection and use of information as described in the Privacy Policy.",
  },
  {
    title: "Third-Party Services",
    content:
      "DatIQ integrates with third-party services including Firecrawl (web crawling), Anthropic Claude (AI), and Supabase (data storage). Your use of these integrations is subject to the respective terms and policies of those services. DatIQ is not responsible for the availability, accuracy, or actions of these third-party services.",
  },
  {
    title: "Limitation of Liability",
    content:
      "To the maximum extent permitted by applicable law, DatIQ shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to loss of data, loss of profits, or business interruption, arising from your use of or inability to use the Service. Our total liability to you for any claims under these Terms shall not exceed the amount you paid us in the twelve months preceding the claim.",
  },
  {
    title: "Disclaimer of Warranties",
    content:
      "DatIQ is provided \"as is\" without warranty of any kind, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, or non-infringement. We do not warrant that the Service will be uninterrupted, error-free, or free of harmful components, or that extraction results will be complete or accurate.",
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
    title: "Governing Law and Dispute Resolution",
    content:
      "These Terms are governed by and construed in accordance with the laws of India, without regard to its conflict of law provisions. Any dispute, controversy, or claim arising out of or in connection with these Terms, including any question regarding their existence, validity, or termination, shall be referred to and finally resolved by arbitration in accordance with the Arbitration and Conciliation Act, 1996 (India), as amended. The seat and venue of arbitration shall be Bengaluru, Karnataka, India. The arbitration shall be conducted in English by a sole arbitrator mutually agreed upon by both parties, or appointed by a competent court in the absence of agreement. Pending arbitration, either party may seek urgent interim relief from a court of competent jurisdiction in India.",
  },
  {
    title: "Contact",
    content:
      "If you have questions about these Terms of Service, please contact us at admin@datiq.app.",
  },
];

export default function Terms() {
  const navigate = useNavigate();

  // Without this, /terms served index.html's hard-coded canonical pointing at
  // the homepage, and Google dropped it as a duplicate. See Privacy.jsx.
  useSeo({
    title: "Terms of Service | DatIQ.app",
    description:
      "The terms governing your use of DatIQ: acceptable use, account and billing terms, intellectual property, liability, and the Indian arbitration clause that governs disputes.",
    canonical: "https://datiq.app/terms",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: "Terms of Service",
        url: "https://datiq.app/terms",
        description: "DatIQ's terms of service.",
        isPartOf: { "@type": "WebSite", name: "DatIQ", url: "https://datiq.app" },
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://datiq.app/" },
          { "@type": "ListItem", position: 2, name: "Terms of Service", item: "https://datiq.app/terms" },
        ],
      },
    ],
  });

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
            Please read these Terms of Service carefully before using DatIQ. These Terms constitute a legally
            binding agreement between you and DatIQ governing your use of the Service.
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
            <a href="mailto:admin@datiq.app" className="legal-link">
              admin@datiq.app
            </a>
          </div>
          <p className="legal-text" style={{ marginTop: 14, marginBottom: 0 }}>
            To report copyright infringement or request removal of content, follow our{" "}
            <a href="/dmca" className="legal-link">
              DMCA and content takedown process
            </a>
            . Indian complainants may also submit under the Information Technology Act, 2000.
          </p>
        </div>
      </div>
    </div>
  );
}
