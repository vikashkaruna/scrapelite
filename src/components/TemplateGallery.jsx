// src/components/TemplateGallery.jsx — Q5 (template / example library) UI
// + F06 (Recipe Packs) filter row.
//
// 10–15 prebuilt extraction recipes, browseable as a card grid. Clicking a
// template fires `onSelect(template)` with the recipe pre-filled. The top of
// the gallery now has a Pack filter row (Sales / CI / SEO / All) so users
// can quickly narrow to the templates that match their role.

import { useMemo, useState } from "react";
import Icon from "./Icon.jsx";
import {
  EXTRACTION_TEMPLATES,
  TEMPLATE_TAGS,
  RECIPE_PACKS,
  filterTemplatesByTag,
  getTemplatesByPack,
} from "../lib/extractionTemplates.js";

export default function TemplateGallery({ onSelect, tag = "all", pack = "all" }) {
  const [activePack, setActivePack] = useState(pack);
  const [activeTag, setActiveTag] = useState(tag);

  const list = useMemo(() => {
    let base = activePack === "all" ? EXTRACTION_TEMPLATES : getTemplatesByPack(activePack);
    if (activeTag && activeTag !== "all") {
      base = base.filter((t) => t.tags.includes(activeTag));
    }
    return base;
  }, [activePack, activeTag]);

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

      {/* F06 — Recipe Pack filter row */}
      <div className="template-packs" role="tablist" aria-label="Filter by Recipe Pack">
        <button
          type="button"
          className={"template-pack" + (activePack === "all" ? " on" : "")}
          onClick={() => setActivePack("all")}
          role="tab"
          aria-selected={activePack === "all"}
        >
          <Icon name="layers" size={12} />
          All recipes
        </button>
        {RECIPE_PACKS.map((p) => (
          <button
            key={p.key}
            type="button"
            className={"template-pack" + (activePack === p.key ? " on" : "")}
            onClick={() => setActivePack(p.key)}
            role="tab"
            aria-selected={activePack === p.key}
            title={p.description}
            style={activePack === p.key ? { "--pack-accent": p.color } : {}}
          >
            <Icon name={p.icon} size={12} />
            {p.label}
          </button>
        ))}
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
          <p className="template-empty">No templates for that combination yet.</p>
        )}
      </div>
    </div>
  );
}
