// Contact.jsx — /contact — support form and contact details.
import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { useToast } from "../components/Toast.jsx";
import { submitContactForm } from "../lib/contactService.js";
import {
  CONTACT_TYPES,
  INBOX,
  INBOX_EMAIL,
  emailForType,
  normalizeContactType,
} from "../lib/contactRouting.js";
import { getSettings, loadSettings } from "../lib/globalSettingsService.js";

export default function Contact() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const showToast = useToast();

  const initialType = normalizeContactType(new URLSearchParams(search).get("type"));

  const [type,    setType]    = useState(initialType);
  const [name,    setName]    = useState("");
  const [email,   setEmail]   = useState("");
  const [subject, setSubject] = useState(initialType === "bug" ? "Bug report: " : "");
  const [message, setMessage] = useState("");
  const [status,  setStatus]  = useState("idle"); // idle | submitting | sent | error
  const [errorMsg, setErrorMsg] = useState("");
  const [fallbackMailto, setFallbackMailto] = useState("");

  // The three response-time rows in the sidebar come from operator-editable
  // settings (cached client-side). We render the synchronous cache value
  // immediately so the first paint is never empty, then refresh in the
  // background. Operators changing these values see the update after
  // a 5-min cache TTL or a hard refresh — no special "save + reload" dance.
  const [sla, setSla] = useState(() => {
    const s = getSettings();
    return [
      { id: "general",    label: s.contact_sla_general_label,    time: s.contact_sla_general_time },
      { id: "billing",    label: s.contact_sla_billing_label,    time: s.contact_sla_billing_time },
      { id: "enterprise", label: s.contact_sla_enterprise_label, time: s.contact_sla_enterprise_time },
    ];
  });
  useEffect(() => {
    let alive = true;
    loadSettings().then((s) => {
      if (!alive) return;
      setSla([
        { id: "general",    label: s.contact_sla_general_label,    time: s.contact_sla_general_time },
        { id: "billing",    label: s.contact_sla_billing_label,    time: s.contact_sla_billing_time },
        { id: "enterprise", label: s.contact_sla_enterprise_label, time: s.contact_sla_enterprise_time },
      ]);
    });
    return () => { alive = false; };
  }, []);

  // Address this enquiry type is routed to — shown live so the user knows who
  // is receiving the message before they send it.
  const destination = emailForType(type);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !message) return;
    setStatus("submitting");
    setErrorMsg("");
    setFallbackMailto("");

    // The email goes out via /api/contact-email (Resend); the CRM webhook +
    // subscriber capture fire in parallel and can't fail the submission.
    const result = await submitContactForm({ type, name, email, subject, message });

    if (result.ok) {
      setStatus("sent");
      showToast("Message sent! We'll get back to you within 24 hours.");
    } else {
      setStatus("error");
      setErrorMsg(result.error || "");
      setFallbackMailto(result.mailto || "");
    }
  };

  return (
    <div className="page">
      <div className="container contact-page">

        {/* Header */}
        <div className="contact-hero rise">
          <div className="eyebrow">
            <Icon name="message-circle" size={14} />
            Get in touch
          </div>
          <h1>Contact DatIQ</h1>
          <p className="contact-sub">
            We typically respond within 24 hours on business days.
          </p>
        </div>

        <div className="contact-layout">

          {/* Form */}
          <div className="contact-form-wrap card card-pad">
            {status === "sent" ? (
              <div className="contact-success">
                <div className="contact-success-icon">
                  <Icon name="check-circle" size={32} />
                </div>
                <h2>Message received!</h2>
                <p>We'll get back to you at <strong>{email}</strong> within 24 hours.</p>
                <Button variant="secondary" size="sm" onClick={() => { setStatus("idle"); setMessage(""); setSubject(""); setErrorMsg(""); setFallbackMailto(""); }}>
                  Send another message
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="contact-form">
                <div className="contact-field">
                  <label className="contact-label">Enquiry type</label>
                  <div className="contact-type-grid">
                    {CONTACT_TYPES.map((t) => (
                      <button
                        key={t.value}
                        type="button"
                        className={"contact-type-btn" + (type === t.value ? " active" : "")}
                        onClick={() => setType(t.value)}
                      >
                        <Icon name={t.icon} size={14} />
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <p className="contact-route-hint">
                    <Icon name="arrow-right" size={12} />
                    Goes to <strong>{destination}</strong>
                  </p>
                </div>

                <div className="contact-row">
                  <div className="contact-field">
                    <label className="contact-label" htmlFor="contact-name">Your name (optional)</label>
                    <input
                      id="contact-name"
                      className="contact-input"
                      type="text"
                      placeholder="Alex Smith"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="contact-field">
                    <label className="contact-label" htmlFor="contact-email">Email address *</label>
                    <input
                      id="contact-email"
                      className="contact-input"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="contact-field">
                  <label className="contact-label" htmlFor="contact-subject">Subject (optional)</label>
                  <input
                    id="contact-subject"
                    className="contact-input"
                    type="text"
                    placeholder="Brief description of your question"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </div>

                <div className="contact-field">
                  <label className="contact-label" htmlFor="contact-message">Message *</label>
                  <textarea
                    id="contact-message"
                    className="contact-input contact-textarea"
                    rows={5}
                    placeholder="Describe your question or issue in detail…"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    required
                  />
                </div>

                {status === "error" && (
                  <p className="contact-error">
                    We couldn&apos;t send that{errorMsg ? ` — ${errorMsg.replace(/\.?$/, ".")}` : "."} Email us directly at{" "}
                    <a href={fallbackMailto || `mailto:${destination}`}>{destination}</a> and we&apos;ll pick it up there.
                  </p>
                )}

                <Button
                  variant="primary"
                  type="submit"
                  icon="send"
                  disabled={status === "submitting" || !email || !message}
                  fullWidth
                >
                  {status === "submitting" ? "Sending…" : "Send message"}
                </Button>
              </form>
            )}
          </div>

          {/* Sidebar info */}
          <div className="contact-info">
            <div className="contact-info-card card card-pad">
              <div className="contact-info-title">
                <Icon name="mail" size={16} />
                Email us directly
              </div>
              <div className="contact-info-links">
                <a href={`mailto:${INBOX_EMAIL[INBOX.HELLO]}`} className="contact-info-link">
                  <Icon name="mail" size={14} />
                  <div>
                    <div className="cil-label">Product support, bug reports, feature requests, billing &amp; anything general</div>
                    <div className="cil-email">{INBOX_EMAIL[INBOX.HELLO]}</div>
                  </div>
                </a>
                <a href={`mailto:${INBOX_EMAIL[INBOX.ADMIN]}`} className="contact-info-link">
                  <Icon name="shield" size={14} />
                  <div>
                    <div className="cil-label">Enterprise &amp; agency, legal &amp; terms, privacy &amp; DPDP</div>
                    <div className="cil-email">{INBOX_EMAIL[INBOX.ADMIN]}</div>
                  </div>
                </a>
              </div>
            </div>

            <div className="contact-info-card card card-pad" style={{ marginTop: 16 }}>
              <div className="contact-info-title">
                <Icon name="clock" size={16} />
                Response times
              </div>
              <ul className="contact-sla-list">
                {sla.map((row) => (
                  <li key={row.id}>
                    <span className="contact-sla-type">{row.label}</span>
                    <span className="contact-sla-time">{row.time}</span>
                  </li>
                ))}
              </ul>
              <p className="contact-sla-foot">
                Indicative response posture. Actual times depend on volume and complexity.
              </p>
            </div>

            <div className="contact-info-card card card-pad" style={{ marginTop: 16 }}>
              <div className="contact-info-title">
                <Icon name="book-open" size={16} />
                Self-service resources
              </div>
              <div className="contact-self-links">
                <a className="contact-self-link" href="/help/index.html">
                  <Icon name="help-circle" size={13} /> Help & documentation
                </a>
                <button className="contact-self-link" onClick={() => navigate("/pricing")}>
                  <Icon name="credit-card" size={13} /> Billing & plans
                </button>
                <button className="contact-self-link" onClick={() => navigate("/privacy")}>
                  <Icon name="shield" size={13} /> Privacy policy
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
