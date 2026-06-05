// StructuredData.jsx — renders arbitrary JSON returned by the Custom Extraction
// feature (3.1) in a clean, human-readable way. Falls back gracefully for any
// shape: arrays of objects become labeled cards, nested objects become
// key/value rows, primitives render inline.
import Icon from "./Icon.jsx";

function humanizeKey(key) {
  return String(key)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isEmailLike(v) {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}
function isUrlLike(v) {
  return typeof v === "string" && /^https?:\/\//i.test(v.trim());
}

function Value({ value }) {
  if (value == null || value === "") return <span className="sd-empty">—</span>;
  if (Array.isArray(value)) return <NodeList items={value} />;
  if (typeof value === "object") return <ObjectRows obj={value} />;
  if (isEmailLike(value)) {
    return (
      <a className="sd-link" href={`mailto:${value}`}>
        <Icon name="mail" size={12} /> {value}
      </a>
    );
  }
  if (isUrlLike(value)) {
    return (
      <a className="sd-link" href={value} target="_blank" rel="noopener noreferrer">
        {value} <Icon name="external" size={11} />
      </a>
    );
  }
  return <span className="sd-val">{String(value)}</span>;
}

function ObjectRows({ obj }) {
  const entries = Object.entries(obj);
  if (entries.length === 0) return <span className="sd-empty">No data</span>;
  return (
    <div className="sd-rows">
      {entries.map(([k, v]) => (
        <div className="sd-row" key={k}>
          <span className="sd-key">{humanizeKey(k)}</span>
          <span className="sd-row-val">
            <Value value={v} />
          </span>
        </div>
      ))}
    </div>
  );
}

function NodeList({ items }) {
  if (items.length === 0) return <span className="sd-empty">None found</span>;
  return (
    <div className="sd-list">
      {items.map((item, i) =>
        item && typeof item === "object" ? (
          <div className="sd-item card" key={i}>
            <ObjectRows obj={item} />
          </div>
        ) : (
          <div className="sd-item-flat" key={i}>
            <Value value={item} />
          </div>
        ),
      )}
    </div>
  );
}

export default function StructuredData({ data }) {
  if (data == null) return <span className="sd-empty">No structured data returned.</span>;
  if (typeof data !== "object") return <Value value={data} />;
  return <Value value={data} />;
}
