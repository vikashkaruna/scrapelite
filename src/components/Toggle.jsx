// Toggle.jsx — labeled switch with optional tooltip.
import Icon from "./Icon.jsx";

export default function Toggle({ icon, label, hint, checked, onChange, tooltip, title }) {
  const tip = tooltip || title;
  return (
    <div className="opt-toggle-wrap">
      <label className="opt-toggle">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="opt-toggle-track">
          <span className="opt-toggle-thumb" />
        </span>
        <span className="opt-toggle-label">
          {icon && <Icon name={icon} size={14} />}
          {label}
          {hint && <span className="opt-toggle-hint">{hint}</span>}
        </span>
      </label>
      {tip && (
        <span className="opt-tooltip" role="tooltip">
          <Icon name="help-circle" size={13} />
          <span className="opt-tooltip-text">{tip}</span>
        </span>
      )}
    </div>
  );
}
