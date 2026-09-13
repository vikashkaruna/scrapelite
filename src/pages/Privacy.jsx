// Privacy.jsx — Privacy Policy page (route "/privacy").
//
// ⚠️ SECTIONS drives the table of contents, the visible numbering AND the
// #section-N anchor ids, all from the array INDEX. Editing a section in place
// is safe; INSERTING or REORDERING one silently repoints every existing deep
// link (including the ones this page's own TOC hands out, and any that have
// been shared or indexed). If a new section is genuinely needed, append it.
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { useToast } from "../components/Toast.jsx";
import { useSeo } from "../hooks/useSeo.js";
import { getConsent, clearConsent, withdrawAndErase } from "../lib/consentService.js";

/** Bumped alongside consentService.POLICY_VERSION whenever section 6 changes materially. */
const LAST_UPDATED = "August 15, 2026";

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
        text: "We retain your extracted data for as long as you maintain an account. For Discoverability and SXO analytics integrations, behavioural data is ingested and retained strictly in aggregated, privacy-minimized form with a default 90-day rolling retention window; no raw session replays, IP addresses, or visitor personal data are ever stored. Users, workspace administrators, and platform operators have the provision to trigger early or immediate data deletion at any time via the SXO dashboard or API, or configure shorter custom retention windows. Connected provider credentials and OAuth tokens are encrypted at rest with AES-256-GCM and deleted immediately upon provider disconnection (with an optional immediate data wipe). You can delete individual extractions from your Dashboard at any time. To request deletion of all your data, contact us at the email below.",
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
      {
        heading: "Google Analytics",
        text: "If you allow analytics, Google LLC processes product-usage events (pages viewed, features used, approximate location at country level) on our behalf. No extracted content, page data, or the URLs you submit for extraction are ever sent to Google Analytics. See the Cookies and Local Storage section below for what is set, when, and how to withdraw.",
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
        text: "You can delete individual extractions from the Dashboard. To request deletion of your account and all associated data, contact us at admin@datiq.app.",
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
        text: "DatIQ uses your browser's localStorage to store preferences such as your selected theme, persona, unsaved extraction results, and your analytics choice below. This data stays on your device and is not transmitted to our servers.",
      },
      {
        heading: "Analytics cookies (Google Analytics 4)",
        text: "We use Google Analytics 4 (property G-B0DZLRWG63), provided by Google LLC, to understand which parts of DatIQ people actually use. When — and only when — you allow it, Google Analytics sets first-party cookies named _ga and _ga_* in your browser to recognise repeat visits. The tag is loaded with Google Consent Mode v2 defaulting to 'denied', which means that before you choose, no analytics cookie or identifier is stored on your device; Google receives only cookieless, non-identifying signals that let us estimate overall traffic. We enable IP anonymisation, and we do not enable Google Signals, advertising features, or ads personalisation. We do not use advertising pixels or cross-site tracking technologies. Our internal operator tools are excluded from analytics entirely.",
      },
      {
        heading: "Your choice, and the record we keep of it",
        text: "You choose Allow or Decline the first time you visit, and you can change your mind at any time using the 'Cookie preferences' control at the bottom of this page or in the site footer. Declining is honoured immediately and permanently: nothing is stored and no identifier is set. We keep a record of your choice — the decision, the time, the version of this policy it was given under, and a coarse country — so we can demonstrate that consent was properly obtained. We deliberately do not store your IP address for this purpose.",
      },
      {
        heading: "Erasing your analytics data",
        text: "The 'Erase my analytics data' control at the bottom of this page withdraws your consent and immediately and permanently deletes the product-usage events DatIQ holds for your session and account. Please note the limit of what we can do on your behalf: data already held inside Google Analytics can only be removed through Google's own deletion process, which we must submit separately. If you want that done as well, email admin@datiq.app with the subject line 'Analytics Erasure' and we will submit the request to Google on your behalf.",
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
        text: "We process your personal data on the basis of your consent, given at the time of registration or use of the Service, or on the basis of legitimate purposes as specified under the DPDP Act. Analytics processing specifically relies on the separate, explicit consent you give through the notice shown on your first visit — it is never bundled into your acceptance of the Terms, and declining it does not restrict your use of the Service in any way. You may withdraw any consent at any time using the controls at the end of this page or by contacting admin@datiq.app; withdrawing consent for features other than analytics may limit your ability to use certain parts of the Service.",
      },
      {
        heading: "Rights of Data Principals",
        text: "If you are an Indian resident, you have the right to: (a) access a summary of personal data we hold about you; (b) correct inaccurate or incomplete personal data; (c) erasure of personal data when it is no longer necessary; (d) grievance redressal through our designated contact below; and (e) nominate a person to exercise rights on your behalf in the event of death or incapacity.",
      },
      {
        heading: "Grievance Officer (India)",
        text: "For grievances under the DPDP Act, please contact our designated officer at admin@datiq.app with the subject line 'DPDP Grievance'. We will acknowledge your complaint within 48 hours and endeavour to resolve it within 15 business days.",
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

/**
 * The two controls that make the consent in section 6 actually revocable.
 * Both GDPR and the DPDP Act require withdrawal to be as easy as giving
 * consent, so they live on the page that describes the consent rather than
 * behind a support email.
 *
 * They are deliberately separate actions. "Change my choice" re-opens the
 * question; "erase my data" is a destructive act with a different consequence,
 * and collapsing the two would mean anyone reconsidering their choice silently
 * destroyed their history.
 */
function CookieControls() {
  const showToast = useToast();
  const [choice, setChoice] = useState(() => getConsent());
  const [erasing, setErasing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const reopen = () => {
    clearConsent();
    setChoice(null);
    showToast("Cookie preferences cleared — the consent notice will appear again.", "shield");
  };

  const erase = async () => {
    if (!confirming) { setConfirming(true); return; }
    setConfirming(false);
    setErasing(true);
    const res = await withdrawAndErase();
    setErasing(false);
    setChoice(getConsent());
    if (res.ok) {
      showToast(
        res.deleted > 0
          ? `Analytics consent withdrawn and ${res.deleted} event${res.deleted === 1 ? "" : "s"} erased.`
          : "Analytics consent withdrawn. There was no stored event data to erase.",
        "check",
      );
    } else {
      // Say what did and did not happen. The withdrawal is local and already
      // in force even when the erase call failed, and implying otherwise would
      // be the more alarming error.
      showToast(
        `Consent withdrawn, but the erase request failed: ${res.error}. Email admin@datiq.app and we will complete it.`,
        "alert-triangle",
      );
    }
  };

  const label =
    choice?.analytics === "granted" ? "Allowed"
      : choice?.analytics === "denied" ? "Declined"
        : "Not set";

  return (
    <div className="legal-contact card card-pad" id="cookie-preferences">
      <div className="legal-contact-title">Cookie preferences</div>
      <p className="legal-text">
        Current analytics setting: <b>{label}</b>
        {choice?.ts && (
          <> · chosen {new Date(choice.ts).toLocaleDateString()} under policy version {choice.policyVersion || "—"}</>
        )}
      </p>
      <div className="legal-contact-row" style={{ gap: 10, flexWrap: "wrap", marginTop: 12 }}>
        <Button variant="secondary" size="sm" icon="shield" onClick={reopen}>
          Change my choice
        </Button>
        <Button
          variant={confirming ? "danger" : "ghost"}
          size="sm"
          icon="trash-2"
          onClick={erase}
          disabled={erasing}
        >
          {erasing
            ? "Erasing…"
            : confirming
              ? "Confirm — erase permanently"
              : "Erase my analytics data"}
        </Button>
        {confirming && (
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        )}
      </div>
      {confirming && (
        <p className="legal-text" style={{ marginTop: 10, marginBottom: 0 }}>
          This permanently deletes the product-usage events we hold for this session and account.
          It cannot be undone. Data already inside Google Analytics needs a separate request — see
          section 6.
        </p>
      )}
    </div>
  );
}

export default function Privacy() {
  const navigate = useNavigate();
  const { hash } = useLocation();

  // A browser scrolls to #fragment on a full page load; React Router does not
  // on a client-side navigation, so the footer's "Cookie preferences" link
  // would land at the top of a long legal page with no sign of what it was
  // supposed to reveal. One frame's delay so the section has rendered.
  useEffect(() => {
    if (!hash) return;
    const id = hash.slice(1);
    const raf = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(raf);
  }, [hash]);

  // THE canonical fix for this route. Until now /privacy inherited index.html's
  // hard-coded <link rel="canonical" href="https://datiq.app/">, which told
  // Google this page IS the homepage — so Search Console dropped it as
  // "Alternate page with proper canonical tag" and it never got indexed.
  // Same story for /terms and /vs/battlecard.
  useSeo({
    title: "Privacy Policy — how DatIQ handles your data | DatIQ.app",
    description:
      "How DatIQ collects, uses and stores your data: what we keep, which processors we use, your GDPR, CCPA and DPDP Act rights, our analytics cookie consent, and how to withdraw it or erase your analytics data.",
    canonical: "https://datiq.app/privacy",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: "Privacy Policy",
        url: "https://datiq.app/privacy",
        description:
          "DatIQ's privacy policy, including cookie and analytics consent, DPDP Act compliance, and data-subject rights.",
        dateModified: "2026-08-15",
        isPartOf: { "@type": "WebSite", name: "DatIQ", url: "https://datiq.app" },
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://datiq.app/" },
          { "@type": "ListItem", position: 2, name: "Privacy Policy", item: "https://datiq.app/privacy" },
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
            <Icon name="shield" size={26} />
          </div>
          <div>
            <h1 className="legal-title">Privacy Policy</h1>
            <p className="legal-meta">Last updated: {LAST_UPDATED} · Effective: {LAST_UPDATED}</p>
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

        <CookieControls />

        <div className="legal-contact card card-pad">
          <div className="legal-contact-title">Contact Us</div>
          <p className="legal-text">
            If you have questions about this Privacy Policy or want to exercise your data rights, please contact us:
          </p>
          <div className="legal-contact-row">
            <Icon name="mail" size={16} />
            <a href="mailto:admin@datiq.app" className="legal-link">
              admin@datiq.app
            </a>
          </div>
          <p className="legal-text" style={{ marginTop: 14, marginBottom: 0 }}>
            For copyright or content-removal requests, see our{" "}
            <a href="/dmca" className="legal-link">
              DMCA and content takedown process
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
