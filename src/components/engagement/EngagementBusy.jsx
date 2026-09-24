// src/components/engagement/EngagementBusy.jsx — "DatIQ is working" while an
// engagement action runs.
//
// Non-blocking on purpose: a floating card in the corner, not an overlay. A
// send or an import can take several seconds, and a person should be able to
// read the queue meanwhile — but they must SEE that something is happening, or
// they press the button again. The action buttons are disabled by the page
// while `label` is set, so the second press cannot happen either.
//
// Only shown after a short delay: a 150ms save that flashes a spinner is noise.

import { useEffect, useState } from "react";
import Icon from "../Icon.jsx";

export const BUSY_SHOW_AFTER_MS = 250;

export default function EngagementBusy({ label }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!label) { setVisible(false); return undefined; }
    const t = setTimeout(() => setVisible(true), BUSY_SHOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [label]);

  return (
    <div className="engx-busy-anchor" aria-live="polite">
      {label && visible && (
        <div className="engx-busy" role="status">
          <span className="engx-busy-orb" aria-hidden="true"><Icon name="bar-chart" size={16} strokeWidth={2.4} /></span>
          <span className="engx-busy-text">
            <strong>DatIQ is working</strong>
            <span>{label}</span>
          </span>
          <span className="engx-busy-bar" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
