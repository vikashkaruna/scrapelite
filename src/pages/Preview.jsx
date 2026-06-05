// Preview.jsx — review & save interface (route "/preview").
import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import FaviconDot from "../components/FaviconDot.jsx";
import { useExtraction } from "../components/ExtractionProvider.jsx";
import { useToast } from "../components/Toast.jsx";
import { hostOf, pathOf, isExternal } from "../lib/utils.js";

function HeadingRow({ h }) {
  const level = Math.max(1, parseInt(String(h.tag).replace(/\D/g, ""), 10) || 1);
  return (
    <div className="hd-row" style={{ paddingLeft: (level - 1) * 22 }}>
      {level > 1 && <span className="hd-guide" />}
      <span className="tag-pill">{h.tag}</span>
      <span
        className="hd-text"
        style={{
          fontWeight: level <= 2 ? 650 : 500,
          fontSize: level === 1 ? "1.05em" : level >= 5 ? ".9em" : "1em",
          color: level >= 5 ? "var(--text-2)" : "var(--text)",
        }}
      >
        {h.text}
      </span>
    </div>
  );
}

function LinkRow({ link, base }) {
  const ext = isExternal(link.href, base);
  return (
    <a className="lnk-row" href={link.href} target="_blank" rel="noopener noreferrer">
      <FaviconDot url={link.href} />
      <span className="lnk-text">{link.text}</span>
      <span className="lnk-href">
        <span className="lnk-host">{hostOf(link.href)}</span>
        <span className="lnk-path">{pathOf(link.href)}</span>
      </span>
      <span className={"lnk-badge" + (ext ? " ext" : "")}>
        {ext ? (
          <>
            <Icon name="external" size={12} /> external
          </>
        ) : (
          "internal"
        )}
      </span>
    </a>
  );
}

export default function Preview() {
  const navigate = useNavigate();
  const showToast = useToast();
  const { current, save } = useExtraction();
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  // Direct navigation with nothing to preview → send home.
  if (!current) return <Navigate to="/" replace />;

  const data = current;
  const links = data.links.filter((l) => {
    if (filter === "all") return true;
    const ext = isExternal(l.href, data.url);
    return filter === "external" ? ext : !ext;
  });
  const extCount = data.links.filter((l) => isExternal(l.href, data.url)).length;

  const onSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await save(data);
      showToast("Saved to your dashboard");
      navigate("/dashboard");
    } catch (err) {
      console.error("[ScrapeLite] Save failed:", err);
      setSaving(false);
      showToast("Couldn't save — please try again", "x");
    }
  };

  const onDiscard = () => {
    showToast("Extraction discarded", "trash");
    navigate("/");
  };

  return (
    <div className="page fade">
      <div className="container" style={{ paddingTop: 28, paddingBottom: 64 }}>
        {/* action bar */}
        <div className="preview-bar">
          <Button variant="ghost" icon="arrow-left" onClick={() => navigate("/")} className="back-btn">
            Back
          </Button>
          <div className="preview-bar-actions">
            <Button variant="danger" icon="trash" onClick={onDiscard}>
              Discard
            </Button>
            <Button
              variant="primary"
              icon={saving ? null : "bookmark"}
              onClick={onSave}
              disabled={saving}
            >
              {saving ? (
                <>
                  <span
                    className="spinner"
                    style={{
                      "--sp-size": "16px",
                      borderColor: "rgba(255,255,255,.4)",
                      borderTopColor: "#fff",
                    }}
                  />{" "}
                  Saving…
                </>
              ) : (
                "Save to Dashboard"
              )}
            </Button>
          </div>
        </div>

        {/* page identity */}
        <div className="preview-head rise">
          <FaviconDot url={data.url} size={44} />
          <div style={{ minWidth: 0 }}>
            <h1 className="preview-title">{data.page_title}</h1>
            <a className="preview-url" href={data.url} target="_blank" rel="noopener noreferrer">
              <Icon name="globe" size={15} /> {data.url} <Icon name="external" size={13} />
            </a>
          </div>
          <div className="preview-stats">
            <div className="pstat">
              <b>{data.headings.length}</b>
              <span>headings</span>
            </div>
            <div className="pstat">
              <b>{data.links.length}</b>
              <span>links</span>
            </div>
          </div>
        </div>

        <div className="section-gap" style={{ marginTop: "var(--gap)" }}>
          {/* AI summary */}
          <div className="card rise summary-card" style={{ animationDelay: ".05s" }}>
            <div className="card-head">
              <span className="ch-icon">
                <Icon name="sparkles" size={18} />
              </span>
              <div>
                <h3>AI summary</h3>
                <p className="ch-sub">Generated overview of the page's intent &amp; structure</p>
              </div>
              <span className="ai-badge ch-meta">
                <Icon name="zap" size={12} /> AI
              </span>
            </div>
            <div className="card-pad">
              <p className="summary-text">{data.ai_summary}</p>
            </div>
          </div>

          {/* two-column: headings + links */}
          <div className="preview-grid">
            <div
              className="card rise"
              style={{ animationDelay: ".1s", display: "flex", flexDirection: "column" }}
            >
              <div className="card-head">
                <span className="ch-icon">
                  <Icon name="list-tree" size={18} />
                </span>
                <div>
                  <h3>Headings</h3>
                  <p className="ch-sub">H1–H6 outline</p>
                </div>
                <span className="count-pill ch-meta">{data.headings.length}</span>
              </div>
              <div className="scroll-y hd-list">
                {data.headings.map((h, i) => (
                  <HeadingRow key={i} h={h} />
                ))}
              </div>
            </div>

            <div
              className="card rise"
              style={{ animationDelay: ".15s", display: "flex", flexDirection: "column" }}
            >
              <div className="card-head">
                <span className="ch-icon">
                  <Icon name="link" size={18} />
                </span>
                <div>
                  <h3>Links</h3>
                  <p className="ch-sub">
                    {extCount} external · {data.links.length - extCount} internal
                  </p>
                </div>
                <div className="seg-filter ch-meta">
                  {["all", "internal", "external"].map((f) => (
                    <button
                      key={f}
                      className={"seg-opt" + (filter === f ? " on" : "")}
                      onClick={() => setFilter(f)}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              <div className="scroll-y lnk-list">
                {links.length === 0 ? (
                  <div className="empty-mini">No {filter} links found.</div>
                ) : (
                  links.map((l, i) => <LinkRow key={i} link={l} base={data.url} />)
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
