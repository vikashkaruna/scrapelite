// Toggle.jsx — a labeled switch reused for the Home "scrape options" row
// (Render JavaScript, Map Entire Domain, Contacts & Emails, Custom Extraction).
// Shares the visual language of the original .js-toggle switch.
import Icon from "./Icon.jsx";

export default function Toggle({ icon, label, hint, checked, onChange, title }) {
  return (
    <label className="opt-toggle" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="opt-toggle-track">
        <span className="opt-toggle-thumb" />
      </span>
      <span className="opt-toggle-label">
        {icon && <Icon name={icon} size={14} />} {label}
        {hint && <span className="opt-toggle-hint">{hint}</span>}
      </span>
    </label>
  );
}
