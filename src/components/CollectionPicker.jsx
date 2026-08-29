// CollectionPicker.jsx — Groke QW#3. Compact "move to collection" dropdown
// for the Dashboard row actions. Shows existing collections + an inline
// "new collection…" option. Calls onSelect with the new collection name
// (or "" to remove from a collection).
//
// The menu is rendered via a PORTAL to document.body, positioned with
// `position: fixed` from the trigger's own bounding rect. It cannot live as a
// normal absolutely-positioned child: this component is used inside
// Dashboard's table view, where `.card.rise.table-wrap` sets `overflow:
// hidden` to clip the table to its rounded corners — a plain in-flow dropdown
// opened there is invisible, clipped by that same boundary. See the bug report
// "clicking Collection gets hidden in Dashboard".
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon.jsx";

export default function CollectionPicker({ value, collections = [], onSelect, onCreate }) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [menuPos, setMenuPos] = useState(null); // { top, left } in viewport coords
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const reposition = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Right-align to the trigger, same as the old absolute .cp-menu did,
    // clamped so it never runs off the left edge of the viewport.
    const left = Math.max(8, r.right - 220);
    setMenuPos({ top: r.bottom + 4, left });
  };

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => reposition();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    const handler = (e) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target) &&
        menuRef.current && !menuRef.current.contains(e.target)
      ) {
        setOpen(false); setCreating(false); setDraft("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("mousedown", handler);
    };
  }, [open]);

  const label = value || "No collection";

  const menu = open && menuPos && createPortal(
        <div
          className="cp-menu cp-menu-portal"
          style={{ position: "fixed", top: menuPos.top, left: menuPos.left }}
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
        >
          {value && (
            <button
              type="button"
              className="cp-item cp-remove"
              onClick={() => { onSelect(""); setOpen(false); }}
            >
              <Icon name="x" size={11} /> Remove from collection
            </button>
          )}
          {value && <div className="cp-sep" />}
          {collections.length === 0 && !creating && (
            <div className="cp-empty">No collections yet. Create one below.</div>
          )}
          {collections
            .filter((c) => c.name !== value)
            .map((c) => (
              <button
                key={c.name}
                type="button"
                className="cp-item"
                onClick={() => { onSelect(c.name); setOpen(false); }}
              >
                <Icon name="folder" size={11} />
                <span><b>{c.name}</b><span className="cp-count">{c.count} item{c.count !== 1 ? "s" : ""}</span></span>
              </button>
            ))}
          {creating ? (
            <form
              className="cp-create"
              onSubmit={(e) => {
                e.preventDefault();
                const name = draft.trim();
                if (!name) return;
                onCreate?.(name);
                onSelect(name);
                setOpen(false); setCreating(false); setDraft("");
              }}
            >
              <Icon name="plus" size={11} />
              <input
                type="text"
                autoFocus
                placeholder="New collection name"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label="New collection name"
                maxLength={48}
              />
              <button type="submit" className="cp-create-go" disabled={!draft.trim()}>
                <Icon name="check" size={11} />
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="cp-item cp-new"
              onClick={() => setCreating(true)}
            >
              <Icon name="plus" size={11} /> New collection…
            </button>
          )}
        </div>,
        document.body,
      );

  return (
    <div className="collection-picker">
      <button
        type="button"
        ref={triggerRef}
        className={"cp-trigger" + (value ? " cp-set" : "")}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title={value ? `In collection: ${value}` : "Add to a collection"}
      >
        <Icon name="folder" size={12} />
        {value ? value : "Collection"}
        <Icon name="chevron-down" size={10} />
      </button>
      {menu}
    </div>
  );
}
