// ConfirmDialog.jsx — the DatIQ confirm, in place of window.confirm.
//
// A native confirm cannot say WHY something is blocked or offer more than
// OK/Cancel, and it looks like a browser error. This one takes a title, a body
// and any number of actions, e.g. a delete refused because rules still use the
// item: [Unlink and delete] [Open the rules] [Cancel].
import { useEffect, useRef } from "react";
import Button from "./Button.jsx";

export default function ConfirmDialog({ open, title, children, actions = [], onClose, busy = false }) {
  const firstRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    firstRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);
  if (!open) return null;
  return (
    <div className="dq-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}>
      <div className="dq-dialog" role="alertdialog" aria-modal="true" aria-labelledby="dq-dialog-title">
        <h2 id="dq-dialog-title" className="dq-dialog-title">{title}</h2>
        <div className="dq-dialog-body">{children}</div>
        <div className="dq-dialog-actions">
          {actions.map((a, i) => (
            <Button
              key={a.label}
              ref={i === 0 ? firstRef : undefined}
              type="button"
              variant={a.variant || "secondary"}
              disabled={busy || a.disabled}
              loading={busy && a.primary}
              onClick={a.onClick}
            >{a.label}</Button>
          ))}
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
