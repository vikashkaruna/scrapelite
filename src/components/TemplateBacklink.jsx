// TemplateBacklink.jsx — "← Back to <template>" on a module opened from the
// template hub. Reads router state once, on mount: modules clear their own
// hand-off state after consuming it, and the link must survive that.
import { useState } from "react";
import { Link, useLocation } from "react-router";
import Icon from "./Icon.jsx";

export default function TemplateBacklink() {
  const location = useLocation();
  const [from] = useState(() => location.state?.fromTemplate || null);
  if (!from?.key) return null;
  return (
    <Link className="tpl-backlink" to={`/templates?key=${encodeURIComponent(from.key)}`}>
      <Icon name="arrow-left" size={13} /> Back to {from.title || "the template"}
    </Link>
  );
}
