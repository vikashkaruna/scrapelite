// src/pages/Report.jsx — the public face of a shared report (PRD 2).
//
// Route: /r/:slug — deliberately NOT under a private prefix, because this page
// is meant to be opened by someone who does not have a DatIQ account. That is
// the whole acquisition loop: recipient opens report → sees source-backed
// value → duplicates the template → signs up.
//
// Indexing is decided by the SERVER, per report: only `public` reports are
// indexable, and this component writes the matching robots meta from the
// response rather than assuming.

import { useEffect, useState } from "react";
import { useParams, Link } from "react-router";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { readReport } from "../lib/reports/reportsClient.js";
import { DENIAL_COPY } from "../lib/reports/visibilityModel.js";
import { setNoIndex, setPublicDefaultMeta } from "../lib/seoMeta.js";

export default function Report() {
  const { slug } = useParams();
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let alive = true;
    readReport(slug)
      .then((r) => { if (alive) setState({ loading: false, report: r.report, indexable: r.indexable }); })
      .catch((e) => { if (alive) setState({ loading: false, error: e, reason: e.reason }); });
    return () => { alive = false; };
  }, [slug]);

  // Only a `public` report may be indexed. Everything else gets an explicit
  // noindex — a shared link reaching a search index is a leak, not reach.
  //
  // ⚠️ This MUST override the existing tag, not append a second one. index.html
  // ships a site-wide `index, follow` robots meta, and appending left BOTH tags
  // in the head with the permissive one FIRST. Crawlers are not required to
  // resolve that in the restrictive direction, and the crawlers this product
  // exists to be read by (GPTBot, ClaudeBot, PerplexityBot) are exactly the
  // ones least likely to. setNoIndex()/setPublicDefaultMeta() upsert the single
  // canonical tag, so there is only ever one directive on the page.
  useEffect(() => {
    if (state.loading) return undefined;
    if (state.indexable) setPublicDefaultMeta();
    else setNoIndex();
    // Restore the site default on unmount so navigating from a private report
    // to a public marketing page does not leave the whole SPA noindexed.
    return () => { setPublicDefaultMeta(); };
  }, [state.indexable, state.loading]);

  if (state.loading) {
    return <div className="page container rp-page"><div className="card rp-empty">Opening report…</div></div>;
  }

  if (state.error) {
    return (
      <div className="page container rp-page">
        <div className="card rp-denied">
          <Icon name="lock" size={22} />
          <h1>This report isn't available</h1>
          <p>{DENIAL_COPY[state.reason] || "The link may have been revoked, expired, or never existed."}</p>
          <Link to="/"><Button>Go to DatIQ</Button></Link>
        </div>
      </div>
    );
  }

  const r = state.report;
  const data = r.data || {};
  const output = data.output || {};
  const branded = r.branding && Object.keys(r.branding).length > 0;

  return (
    <div className="page container rp-page">
      <article className="rp-article">
        <header className="rp-head">
          <h1>{r.title}</h1>
          <p className="rp-meta">
            {output.target && (
              <>Source: <a href={output.target} target="_blank" rel="noreferrer noopener">{output.target}</a> · </>
            )}
            Generated {r.created_at ? new Date(r.created_at).toLocaleString() : "recently"}
          </p>
        </header>

        {data.summary && (
          <section className="rp-block">
            <h2>Summary</h2>
            <p className="rp-ai">{data.summary}</p>
            {/* Fact vs interpretation, made visible rather than implied. */}
            <p className="rp-ai-note">
              Written by AI from the extracted facts below — not quoted from the page.
            </p>
          </section>
        )}

        {output.fields && (
          <section className="rp-block">
            <h2>Extracted facts</h2>
            <pre className="rp-json">{JSON.stringify(output.fields, null, 2)}</pre>
          </section>
        )}

        {Array.isArray(data.sources) && data.sources.length > 0 && (
          <section className="rp-block">
            <h2>Sources</h2>
            <ul className="rp-sources">
              {data.sources.map((s, i) => (
                <li key={i}>
                  <a href={s.url} target="_blank" rel="noreferrer noopener">{s.url}</a>
                  {s.fetched_at && <span className="rp-src-meta"> · read {new Date(s.fetched_at).toLocaleString()}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="rp-foot">
          {/* The duplicate CTA IS the acquisition loop (PRD 2). */}
          {r.template_key && (
            <Link to={`/templates?key=${encodeURIComponent(r.template_key)}`}>
              <Button>Run this on another company</Button>
            </Link>
          )}
          {!branded && (
            <p className="rp-attrib">
              Made with <Link to="/">DatIQ</Link> — turn any URL into business intelligence.
            </p>
          )}
        </footer>
      </article>
    </div>
  );
}
