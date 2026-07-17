// src/components/TemplateGallery.jsx — Q5 (template / example library) UI.
//
// 10–15 prebuilt extraction recipes, browseable as a card grid. Clicking a
// template fires `onSelect(template)` with the recipe pre-filled.

import { useMemo, useState } from "react";
import Icon from "./Icon.jsx";
import { EXTRACTION_TEMPLATES, TEMPLATE_TAGS, filterTemplatesByTag } from "../lib/extractionTemplates.js";

export default function TemplateGallery({ onSelect, tag = "all" }) {
  const [activeTag, setActiveTag] = useState(tag);
  const list = useMemo(() => filterTemplatesByTag(activeTag), [activeTag]);

  return (
    <div className="template-gallery">
      <div className="template-gallery-head">
        <h2 className="template-gallery-title">
          <Icon name="library" size={16} />
          Template library
        </h2>
        <p className="template-gallery-sub">
          {EXTRACTION_TEMPLATES.length} prebuilt extraction recipes — click one to pre-fill
          the URL, intent, and prompt.
        </p>
      </div>

      <div className="template-tags" role="tablist" aria-label="Filter by tag">
        <button
          type="button"
          className={"template-tag" + (activeTag === "all" ? " on" : "")}
          onClick={() => setActiveTag("all")}
          role="tab"
          aria-selected={activeTag === "all"}
        >
          All
        </button>
        {TEMPLATE_TAGS.map((t) => (
          <button
            key={t}
            type="button"
            className={"template-tag" + (activeTag === t ? " on" : "")}
            onClick={() => setActiveTag(t)}
            role="tab"
            aria-selected={activeTag === t}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="template-grid" role="list">
        {list.map((tpl) => (
          <button
            key={tpl.key}
            type="button"
            className="template-card"
            onClick={() => onSelect?.(tpl)}
            role="listitem"
            title={`Use: ${tpl.exampleUrl}`}
          >
            <span className="template-card-icon" aria-hidden="true">
              <Icon name={tpl.icon} size={16} />
            </span>
            <span className="template-card-title">{tpl.title}</span>
            <span className="template-card-desc">{tpl.desc}</span>
            <span className="template-card-tags">
              {tpl.tags.map((tag) => (
                <span key={tag} className="template-card-tag">{tag}</span>
              ))}
            </span>
            <span className="template-card-host">
              <Icon name="external-link" size={11} />
              {(() => { try { return new URL(tpl.exampleUrl).hostname; } catch { return tpl.exampleUrl; } })()}
            </span>
          </button>
        ))}
        {list.length === 0 && (
          <p className="template-empty">No templates for that tag yet.</p>
        )}
      </div>
    </div>
  );
}
