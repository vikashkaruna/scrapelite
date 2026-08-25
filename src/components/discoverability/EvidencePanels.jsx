// EvidencePanels.jsx — the evidence workspace.
//
// Heading tree, schema inventory, extracted answer preview, entity/citation
// panel and the technical panel. Every score in this module has to be traceable
// to something a person can look at, and this is where they look.

import Icon from "../Icon.jsx";
import { CWV_THRESHOLDS } from "../../lib/discoverability/signalScorers.js";

const NOT_MEASURED = <span className="dsc-unmeasured">not measured</span>;

function val(v, suffix = "") {
  if (v === null || v === undefined || v === "") return NOT_MEASURED;
  return <>{v}{suffix}</>;
}

/** The outline, with skipped levels and empty headings called out in place. */
export function HeadingTreePanel({ outline = [], stats = {} }) {
  if (outline.length === 0) {
    return <p className="dsc-muted">This page has no headings, so it is one undifferentiated chunk to a retrieval system.</p>;
  }
  let prev = 0;
  return (
    <>
      <p className="dsc-panel-summary">
        {outline.length} headings · {stats.h1_count ?? 0} H1
        {stats.skipped_levels > 0 && <> · <span className="dsc-warn">{stats.skipped_levels} skipped level{stats.skipped_levels === 1 ? "" : "s"}</span></>}
        {stats.empty_headings > 0 && <> · <span className="dsc-warn">{stats.empty_headings} empty</span></>}
      </p>
      <ol className="dsc-heading-tree">
        {outline.map((h, i) => {
          const skipped = prev > 0 && h.level > prev + 1;
          prev = h.level;
          const empty = !String(h.text || "").trim();
          return (
            <li
              key={i}
              className={`dsc-heading-row${skipped ? " dsc-heading-skipped" : ""}${empty ? " dsc-heading-empty" : ""}`}
              style={{ paddingLeft: `${(h.level - 1) * 16}px` }}
            >
              <span className="dsc-heading-tag">H{h.level}</span>
              <span className="dsc-heading-text">{empty ? "(empty heading)" : h.text}</span>
              {skipped && <span className="dsc-heading-flag" title="Skipped a level — this merges two sections a retrieval system would otherwise keep apart">skipped level</span>}
            </li>
          );
        })}
      </ol>
    </>
  );
}

/** What the page declares about itself, and what parsed. */
export function SchemaPanel({ schemaTypes = [], structuredData = {} }) {
  const errors = structuredData.parse_errors ?? 0;
  return (
    <>
      {errors > 0 && (
        <p className="dsc-panel-alert">
          <Icon name="alert-triangle" size={14} />
          {errors} JSON-LD block{errors === 1 ? "" : "s"} failed to parse and {errors === 1 ? "is" : "are"} being discarded whole — every signal it carried is lost silently.
        </p>
      )}
      {schemaTypes.length === 0 ? (
        <p className="dsc-muted">No structured data. Nothing states explicitly what a machine would otherwise have to infer.</p>
      ) : (
        <ul className="dsc-schema-list">
          {schemaTypes.map((t) => (
            <li key={t} className="dsc-schema-chip"><Icon name="file-json" size={12} /> {t}</li>
          ))}
        </ul>
      )}
      <p className="dsc-panel-summary">
        {structuredData.block_count ?? 0} block{(structuredData.block_count ?? 0) === 1 ? "" : "s"} parsed
      </p>
    </>
  );
}

/** What an answer engine would actually lift off this page. */
export function AnswerPanel({ blocks = [], faqPairs = [] }) {
  if (blocks.length === 0 && faqPairs.length === 0) {
    return <p className="dsc-muted">No self-contained answer passage was found on this page.</p>;
  }
  return (
    <>
      {blocks.map((b, i) => (
        <figure key={i} className="dsc-answer-block">
          <figcaption className="dsc-answer-head">
            <Icon name="message-square" size={14} />
            {b.anchor_heading || "Page lede"}
            <span className="dsc-answer-meta">
              {b.word_count} words · {b.position_percent}% down the page
              {Number.isFinite(b.standalone_score) && <> · stands alone {Math.round(b.standalone_score)}/100</>}
            </span>
          </figcaption>
          <blockquote className="dsc-answer-quote">{b.excerpt}</blockquote>
        </figure>
      ))}
      {faqPairs.length > 0 && (
        <>
          <p className="dsc-panel-summary">{faqPairs.length} visible question-and-answer pair{faqPairs.length === 1 ? "" : "s"}</p>
          <ul className="dsc-faq-list">
            {faqPairs.slice(0, 8).map((f, i) => (
              <li key={i}><strong>{f.question}</strong> <span className="dsc-muted">{String(f.answer || "").slice(0, 140)}…</span></li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** Who publishes this, and whether answer engines have noticed. */
export function EntityPanel({ entity = {} }) {
  const sample = entity.ai_citation_sample;
  return (
    <>
      <dl className="dsc-facts">
        <dt>Brand</dt><dd>{val(entity.brand_name)}</dd>
        <dt>Author</dt>
        <dd>
          {entity.authors?.length
            ? <>{entity.authors[0].name}
                {entity.authors[0].bio_page_present ? " · bio linked" : " · no bio page"}
                {entity.authors[0].credentials_present ? " · credentials shown" : ""}</>
            : NOT_MEASURED}
        </dd>
        <dt>Last updated</dt>
        <dd>{entity.last_updated_visible ? (entity.date_modified || entity.date_published || "shown on page") : <span className="dsc-warn">not visible to a reader</span>}</dd>
        <dt>sameAs links</dt>
        <dd>{entity.sameAs_links?.length ? entity.sameAs_links.length : <span className="dsc-warn">none declared</span>}</dd>
        <dt>Outbound references</dt><dd>{val(entity.third_party_mentions)}</dd>
      </dl>

      {entity.sameAs_links?.length > 0 && (
        <ul className="dsc-sameas">
          {entity.sameAs_links.slice(0, 8).map((s) => (
            <li key={s}><a href={s} target="_blank" rel="noopener noreferrer nofollow">{s.replace(/^https?:\/\/(www\.)?/, "")}</a></li>
          ))}
        </ul>
      )}

      <div className="dsc-citation">
        <h4 className="dsc-panel-subhead">Citation footprint</h4>
        {!sample ? (
          <p className="dsc-muted">
            No answer-engine sampling ran, so this is unknown — not zero. The
            signal was excluded from the score rather than counted against you.
          </p>
        ) : (
          <>
            <p className="dsc-panel-summary">
              {sample.mentions} mention{sample.mentions === 1 ? "" : "s"} and {sample.citations} citation
              {sample.citations === 1 ? "" : "s"} across {sample.prompt_count} prompts
              {Number.isFinite(sample.share_of_voice) && <> · {Math.round(sample.share_of_voice * 100)}% share of voice</>}
            </p>
            {!sample.live && (
              // The single most important caveat in the module. Presenting
              // model recall as live citation would be the most misleading
              // number in the product.
              <p className="dsc-panel-alert dsc-panel-alert-soft">
                <Icon name="alert-circle" size={14} />
                Sampled with <strong>{sample.engine}</strong>, a language model without live web retrieval.
                This measures how well known the brand is, not whether it is being cited in live answers today.
                Set a Perplexity key to sample a real answer engine.
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}

/** Can a bot reach, render and trust this page. */
export function TechnicalPanel({ technical = {} }) {
  const cwv = technical.core_web_vitals;
  const render = technical.rendering || {};
  const access = technical.ai_crawler_access;

  const metric = (key, value, unit) => {
    const t = CWV_THRESHOLDS[key];
    if (value === null || value === undefined) return NOT_MEASURED;
    const good = value < t.good;
    const poor = value > t.poor;
    return (
      <span className={good ? "dsc-ok" : poor ? "dsc-bad" : "dsc-warn"}>
        {value}{unit} <span className="dsc-muted">(good &lt; {t.good}{unit})</span>
      </span>
    );
  };

  return (
    <>
      <dl className="dsc-facts">
        <dt>HTTP status</dt><dd>{val(technical.http_status)}</dd>
        <dt>Indexable</dt>
        <dd>{technical.indexable === undefined ? NOT_MEASURED : technical.indexable
          ? <span className="dsc-ok">yes</span> : <span className="dsc-bad">no</span>}</dd>
        <dt>Canonical</dt>
        <dd>{technical.canonical_url
          ? <>{technical.canonical_url}{technical.canonical_self_reference === false && <span className="dsc-warn"> · points elsewhere</span>}</>
          : <span className="dsc-warn">not declared</span>}</dd>
        <dt>Viewport</dt><dd>{val(technical.viewport)}</dd>
        <dt>LCP</dt><dd>{metric("lcp", cwv?.lcp_seconds, "s")}</dd>
        <dt>INP</dt><dd>{metric("inp", cwv?.inp_ms, "ms")}</dd>
        <dt>CLS</dt><dd>{metric("cls", cwv?.cls, "")}</dd>
        <dt>Raw vs rendered</dt>
        <dd>
          {render.rendered_dom_word_count === null || render.rendered_dom_word_count === undefined ? (
            <span className="dsc-unmeasured" title="No headless provider is configured, so the two fetches return the same HTML and comparing them would be a tautology.">
              not measured — no headless renderer configured
            </span>
          ) : (
            <>
              {render.raw_html_word_count} / {render.rendered_dom_word_count} words
              {Number.isFinite(render.content_loss_ratio) && render.content_loss_ratio > 0.1 && (
                <span className="dsc-warn"> · {Math.round(render.content_loss_ratio * 100)}% only after JavaScript</span>
              )}
            </>
          )}
        </dd>
      </dl>

      <h4 className="dsc-panel-subhead">Answer-engine crawler access</h4>
      {!access ? (
        <p className="dsc-muted">robots.txt could not be read, so crawl policy is unknown — neither allowed nor blocked.</p>
      ) : (
        <ul className="dsc-crawler-list">
          {Object.entries(access).map(([agent, allowed]) => (
            <li key={agent} className={`dsc-crawler dsc-crawler-${allowed === null ? "unknown" : allowed ? "allowed" : "blocked"}`}>
              <Icon name={allowed === null ? "help-circle" : allowed ? "check-circle" : "circle-slash"} size={12} />
              {agent}
            </li>
          ))}
        </ul>
      )}
      {cwv?.source && (
        <p className="dsc-panel-foot">
          Web Vitals from {cwv.source === "field" ? "real Chrome users (CrUX field data)" : "a single synthetic Lighthouse run (lab data)"}.
        </p>
      )}
    </>
  );
}

/** A titled panel wrapper, so every evidence card looks the same. */
export function Panel({ title, icon, children, wide = false }) {
  return (
    <section className={`dsc-panel${wide ? " dsc-panel-wide" : ""}`}>
      <h3 className="dsc-panel-title"><Icon name={icon} size={15} /> {title}</h3>
      <div className="dsc-panel-body">{children}</div>
    </section>
  );
}
