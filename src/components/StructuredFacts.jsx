// StructuredFacts.jsx — render schema-shaped extraction output as something a
// person can read, cite and paste.
//
// ── WHY THIS REPLACED A <pre>{JSON.stringify(…)}</pre> ───────────────────────
// Enrichment and template results were rendered as a raw JSON dump. That is
// defensible when the shape is unknown; it stopped being defensible the moment
// extractionSchemas.js gave every capability a declared shape with declared
// groups. A pricing extraction is a table of plans, a leadership extraction is
// a list of people — rendering both as pretty-printed JSON is the difference
// between a data product and a debug view, and it is most of what "the output
// is very basic" meant.
//
// Three rules:
//   1. GROUPS FIRST. When the capability declares groups, render those sections
//      in that order with their labels. Unknown keys still render — a schema is
//      guidance for the model, not a guarantee.
//   2. ARRAYS OF LIKE OBJECTS BECOME TABLES. Ten plans or ten people are a
//      table; one object is a definition list. Choosing per-shape is what makes
//      this readable without a bespoke renderer per capability.
//   3. EVIDENCE IS FIRST-CLASS, NOT A FOOTNOTE. Every fact the model returned
//      carries a verbatim quote and its source URL. These values get pasted
//      into CRMs and decks; a name with nothing behind it is a claim nobody
//      can check.
import { useState, useMemo } from "react";
import Icon from "./Icon.jsx";

const HIDDEN_KEYS = new Set(["evidence", "not_found"]);

function humanise(key) {
  return String(key)
    .replace(/_/g, " ")
    .replace(/\burl\b/gi, "URL")
    .replace(/\bid\b/gi, "ID")
    .replace(/^./, (c) => c.toUpperCase());
}

function isEmptyValue(v) {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).every((k) => isEmptyValue(v[k]));
  return String(v).trim() === "";
}

function isUrl(v) {
  return typeof v === "string" && /^https?:\/\//i.test(v.trim());
}

/** A scalar cell: links become links, booleans become words, null becomes an em dash. */
function Scalar({ value }) {
  if (value == null || value === "") return <span className="sf-null">—</span>;
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (isUrl(value)) {
    return (
      <a className="sf-link" href={value} target="_blank" rel="noreferrer noopener">
        {value.replace(/^https?:\/\//, "").slice(0, 60)}
      </a>
    );
  }
  if (typeof value === "string" && /^[\w.+-]+@[\w-]+\.[\w.]+$/.test(value.trim())) {
    return <a className="sf-link" href={`mailto:${value.trim()}`}>{value}</a>;
  }
  return <span>{String(value)}</span>;
}

/** An array of objects sharing a shape → a table. Column order follows first-seen. */
function ObjectTable({ rows }) {
  const columns = useMemo(() => {
    const seen = [];
    for (const r of rows) {
      for (const k of Object.keys(r || {})) {
        if (HIDDEN_KEYS.has(k)) continue;
        // A column that is empty in every row is noise, not information.
        if (!seen.includes(k) && rows.some((row) => !isEmptyValue(row?.[k]))) seen.push(k);
      }
    }
    return seen;
  }, [rows]);

  if (!columns.length) return null;

  return (
    <div className="sf-table-wrap">
      <table className="sf-table">
        <thead>
          <tr>{columns.map((c) => <th key={c}>{humanise(c)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => {
                const v = row?.[c];
                return (
                  <td key={c}>
                    {Array.isArray(v)
                      ? (v.length
                          ? <ul className="sf-cell-list">{v.map((x, j) => (
                              <li key={j}>{typeof x === "object" ? <ValueNode value={x} /> : <Scalar value={x} />}</li>
                            ))}</ul>
                          : <span className="sf-null">—</span>)
                      : (v && typeof v === "object" ? <ValueNode value={v} /> : <Scalar value={v} />)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Any value → the most legible representation of it. */
function ValueNode({ value }) {
  if (Array.isArray(value)) {
    if (!value.length) return <span className="sf-null">None found</span>;
    const objects = value.filter((v) => v && typeof v === "object" && !Array.isArray(v));
    // A table only makes sense when the rows are actually alike; a mixed array
    // renders as a list rather than a table with a forest of blank cells.
    if (objects.length === value.length && value.length > 1) return <ObjectTable rows={value} />;
    if (objects.length === value.length && value.length === 1) return <ValueNode value={value[0]} />;
    return (
      <ul className="sf-list">
        {value.map((v, i) => (
          <li key={i}>{v && typeof v === "object" ? <ValueNode value={v} /> : <Scalar value={v} />}</li>
        ))}
      </ul>
    );
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([k, v]) => !HIDDEN_KEYS.has(k) && !isEmptyValue(v));
    if (!entries.length) return <span className="sf-null">None found</span>;
    return (
      <dl className="sf-dl">
        {entries.map(([k, v]) => (
          <div className="sf-dl-row" key={k}>
            <dt>{humanise(k)}</dt>
            <dd>{v && typeof v === "object" ? <ValueNode value={v} /> : <Scalar value={v} />}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return <Scalar value={value} />;
}

/** Verbatim quotes behind the facts, collapsed by default. */
function Evidence({ items }) {
  const [open, setOpen] = useState(false);
  if (!Array.isArray(items) || !items.length) return null;
  return (
    <section className="sf-evidence">
      <button type="button" className="sf-evidence-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={14} />
        Evidence — {items.length} supporting quote{items.length === 1 ? "" : "s"}
      </button>
      {open ? (
        <ul className="sf-evidence-list">
          {items.map((e, i) => (
            <li key={i}>
              <span className="sf-evidence-field">{humanise(e.field || "fact")}</span>
              <blockquote>“{e.quote}”</blockquote>
              {e.source_url ? (
                <a className="sf-link" href={e.source_url} target="_blank" rel="noreferrer noopener">
                  {String(e.source_url).replace(/^https?:\/\//, "").slice(0, 70)}
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * @param {object}  data     the schema-shaped extraction result
 * @param {Array}   groups   optional [{key,label}] from the capability schema
 * @param {object}  meta     optional {provider, model, structured, facts, pagesRead}
 */
export default function StructuredFacts({ data, groups, meta, title }) {
  const [rawOpen, setRawOpen] = useState(false);
  if (!data || typeof data !== "object") return null;

  const evidence = Array.isArray(data.evidence) ? data.evidence : null;
  const notFound = Array.isArray(data.not_found) ? data.not_found : null;

  // Declared groups first, then anything the model returned that the schema
  // did not name — a schema guides the model, it does not bind it, and
  // silently dropping an extra key would lose real data.
  const declared = (groups || []).map((g) => g.key);
  const extraKeys = Object.keys(data).filter(
    (k) => !HIDDEN_KEYS.has(k) && !declared.includes(k) && !isEmptyValue(data[k])
  );
  const sections = [
    ...(groups || [])
      .filter((g) => !isEmptyValue(data[g.key]))
      .map((g) => ({ key: g.key, label: g.label, value: data[g.key] })),
    ...extraKeys.map((k) => ({ key: k, label: humanise(k), value: data[k] })),
  ];

  return (
    <div className="sf">
      {meta ? (
        <div className="sf-meta">
          {typeof meta.facts === "number" ? <span className="sf-chip">{meta.facts} facts</span> : null}
          {meta.structured ? (
            <span className="sf-chip sf-chip-ok" title="The provider enforced the output schema — this shape is guaranteed, not parsed out of prose.">
              Schema-validated
            </span>
          ) : null}
          {meta.provider ? <span className="sf-chip sf-chip-dim">{meta.provider}{meta.model ? ` · ${meta.model}` : ""}</span> : null}
          {Array.isArray(meta.pagesRead) && meta.pagesRead.length > 1 ? (
            <span className="sf-chip sf-chip-dim" title={meta.pagesRead.join("\n")}>
              {meta.pagesRead.length} pages read
            </span>
          ) : null}
        </div>
      ) : null}

      {sections.length === 0 ? (
        <p className="sf-null">Nothing was found for this capability.</p>
      ) : (
        sections.map((s) => (
          <section className="sf-section" key={s.key}>
            <h4 className="sf-section-title">{s.label}</h4>
            <ValueNode value={s.value} />
          </section>
        ))
      )}

      {/* What the model looked for and could NOT find is real information —
          it separates "we did not check" from "this page does not say". */}
      {notFound && notFound.length ? (
        <p className="sf-notfound">
          <Icon name="alert-circle" size={13} /> Not stated on the pages read: {notFound.map(humanise).join(", ")}
        </p>
      ) : null}

      <Evidence items={evidence} />

      <details className="sf-raw" open={rawOpen} onToggle={(e) => setRawOpen(e.currentTarget.open)}>
        <summary>Raw JSON{title ? ` — ${title}` : ""}</summary>
        <pre>{JSON.stringify(data, null, 2)}</pre>
      </details>
    </div>
  );
}

export const _internal = { humanise, isEmptyValue, ValueNode };
