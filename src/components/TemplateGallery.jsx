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

/**
 * @param {object}  props
 * @param {boolean} [props.defaultOpen]  start expanded. Off on the homepage.
 */
export default function TemplateGallery({ onSelect, tag = "all", pack = "all", defaultOpen = false }) {
  const [activePack, setActivePack] = useState(pack);
  const [activeTag, setActiveTag] = useState(tag);
  // ── Collapsed by default ─────────────────────────────────────────────────
  // The grid is 12+ cards and sat permanently open beneath the hero, so the
  // homepage asked a first-time visitor to read a catalogue before they had
  // decided to do anything. The FILTERS stay visible — they are the cheap
  // signal about what the product covers, and picking one is itself a reason
  // to open the grid, so choosing a pack or a tag expands it.
  const [open, setOpen] = useState(defaultOpen);

  const list = useMemo(() => {
    let base = activePack === "all" ? EXTRACTION_TEMPLATES : getTemplatesByPack(activePack);
    if (activeTag && activeTag !== "all") {
      base = base.filter((t) => t.tags.includes(activeTag));
    }
    return base;
  }, [activePack, activeTag]);

  /** Filtering is an act of interest — open the grid rather than filtering it out of sight. */
  const choosePack = (key) => { setActivePack(key); setOpen(true); };
  const chooseTag = (key) => { setActiveTag(key); setOpen(true); };

  return (
    <div className={"template-gallery" + (open ? " is-open" : "")}>
      <div className="template-gallery-head">
        <h2 className="template-gallery-title">
          <Icon name="library" size={16} />
          Template library
        </h2>
        <p className="template-gallery-sub">
          {EXTRACTION_TEMPLATES.length} prebuilt recipes — click one to pre-fill
          the URL, intent, and prompt.
        </p>
        <button
          type="button"
          className="template-gallery-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="template-gallery-grid"
        >
          <Icon name={open ? "chevron-up" : "chevron-down"} size={14} />
          {open ? "Hide recipes" : `Browse ${list.length} recipes`}
        </button>
      </div>

      {/* F06 — Recipe Pack filter row */}
      <div className="template-packs" role="tablist" aria-label="Filter by Recipe Pack">
        <button
          type="button"
          className={"template-pack" + (activePack === "all" ? " on" : "")}
          onClick={() => choosePack("all")}
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
            onClick={() => choosePack(p.key)}
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
          onClick={() => chooseTag("all")}
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
            onClick={() => chooseTag(t)}
            role="tab"
            aria-selected={activeTag === t}
          >
            {t}
          </button>
        ))}
      </div>

      {open && (
      <div className="template-grid" id="template-gallery-grid" role="list">
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
      )}
    </div>
  );
}
