// TagChips.jsx — Groke QW#2. Inline tag editor for the Preview screen.
// Renders the item's existing tags as chips with × buttons + an inline
// "add tag" input that auto-suggests from the URL host and from the user's
// existing tag catalogue. Pure UI — persistence flows through the parent's
// onChange handler so the Preview screen can re-render with the updated
// extraction.
import { useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { suggestTags, suggestFromUrl, addTagPure, removeTagPure, TAG_LIMITS } from "../lib/tagsService.js";

export default function TagChips({ tags = [], url = "", knownTags = [], onChange }) {
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);

  const suggestions = suggestTags(draft, knownTags);
  // When the input is empty, show the host-derived suggestion (if it's a new tag)
  const hostSuggestion = !draft ? suggestFromUrl(url) : "";
  // knownTags can be either a Set (live) or an Array (test fixture / legacy).
  const knownSet = knownTags instanceof Set
    ? knownTags
    : new Set(Array.isArray(knownTags) ? knownTags : []);
  const showHostHint = !!hostSuggestion && !tags.includes(hostSuggestion) && !knownSet.has(hostSuggestion);

  const commit = (raw) => {
    const next = addTagPure(tags, raw);
    if (next.length !== tags.length) {
      onChange?.(next);
    }
    setDraft("");
  };

  const remove = (tag) => {
    onChange?.(removeTagPure(tags, tag));
  };

  const onKey = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && !draft && tags.length) {
      // Backspace on empty input removes the last tag (standard chip-input UX).
      onChange?.(removeTagPure(tags, tags[tags.length - 1]));
    } else if (e.key === "Escape") {
      setDraft("");
      inputRef.current?.blur();
    }
  };

  const atLimit = tags.length >= TAG_LIMITS.MAX_TAGS_PER_ITEM;

  return (
    <div className="tag-chips" onClick={(e) => { if (e.target === e.currentTarget) inputRef.current?.focus(); }}>
      <span className="tc-eyebrow">
        <Icon name="tag" size={11} /> Tags
      </span>
      <div className="tc-row">
        {tags.map((t) => (
          <span key={t} className="tc-chip">
            {t}
            <button
              type="button"
              className="tc-chip-x"
              onClick={() => remove(t)}
              aria-label={`Remove tag ${t}`}
            >
              <Icon name="x" size={10} />
            </button>
          </span>
        ))}
        {!atLimit && (
          <input
            ref={inputRef}
            type="text"
            className="tc-input"
            placeholder={tags.length ? "Add tag…" : "Tag this page (e.g. competitor)"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            onFocus={() => setFocused(true)}
            onBlur={() => { setTimeout(() => setFocused(false), 120); }}
            aria-label="Add a tag"
            maxLength={TAG_LIMITS.MAX_TAG_LEN}
          />
        )}
        {atLimit && (
          <span className="tc-limit-hint">Max {TAG_LIMITS.MAX_TAGS_PER_ITEM} tags</span>
        )}
      </div>

      {(focused && (suggestions.length > 0 || showHostHint)) && (
        <div className="tc-suggest" role="listbox">
          {showHostHint && (
            <button
              type="button"
              className="tc-suggest-item tc-suggest-host"
              onMouseDown={(e) => { e.preventDefault(); commit(hostSuggestion); }}
            >
              <Icon name="globe" size={11} />
              <span><b>{hostSuggestion}</b><span className="tc-hint">from URL host</span></span>
            </button>
          )}
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="tc-suggest-item"
              onMouseDown={(e) => { e.preventDefault(); commit(s); }}
            >
              <Icon name="hash" size={11} />
              <span>{s}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
