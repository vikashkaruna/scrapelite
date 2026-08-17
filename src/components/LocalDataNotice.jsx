// LocalDataNotice.jsx — tells a signed-out user that their saved pages live in
// this browser only, and moves them to their account once they sign in.
//
// Why: extractionsRepo.shouldFallback() treats a 401 as "keep it locally", which
// is correct — a guest's extractions stay usable, unlike a guest's schedule,
// which is simply inert. But nothing said so. Rows sat in localStorage looking
// exactly like saved-to-your-account rows until the user cleared site data or
// opened a different browser, at which point they were gone with no warning.
//
// Rendered inline by Dashboard (and after a batch run). Renders nothing when
// there's nothing browser-only to warn about.
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider.jsx";
import { useToast } from "./Toast.jsx";
import { countUnclaimedLocal, claimLocalExtractions } from "../lib/extractionsRepo.js";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";

export default function LocalDataNotice({ onClaimed }) {
  const { user, openAuth } = useAuth();
  const showToast = useToast();
  const [count, setCount] = useState(() => countUnclaimedLocal());
  const [claiming, setClaiming] = useState(false);
  const claimedRef = useRef(false);

  const refresh = useCallback(() => setCount(countUnclaimedLocal()), []);

  // Re-count on mount and whenever auth flips, so the notice disappears as
  // soon as the rows are claimed.
  useEffect(() => { refresh(); }, [user, refresh]);

  // On sign-in, move the browser-only rows onto the account automatically.
  // Idempotent: rows that fail stay unclaimed and get retried next time.
  useEffect(() => {
    if (!user || claimedRef.current) return;
    if (countUnclaimedLocal() === 0) return;
    claimedRef.current = true;
    setClaiming(true);
    claimLocalExtractions()
      .then(({ claimed, failed }) => {
        if (claimed > 0) {
          showToast(`Saved ${claimed} page${claimed !== 1 ? "s" : ""} to your account.`, "bookmark");
          onClaimed?.(claimed);
        }
        if (failed > 0) claimedRef.current = false; // allow another attempt
      })
      .catch(() => { claimedRef.current = false; })
      .finally(() => { setClaiming(false); refresh(); });
  }, [user, showToast, onClaimed, refresh]);

  if (user || count === 0) return null;

  return (
    <div className="local-data-notice" role="status">
      <Icon name="alert-triangle" size={14} />
      <span className="local-data-notice-text">
        <b>{count} saved page{count !== 1 ? "s" : ""}</b> {count !== 1 ? "are" : "is"} stored in this
        browser only — clearing site data or switching browsers loses {count !== 1 ? "them" : "it"}.
      </span>
      <Button variant="secondary" size="sm" icon="user-plus" loading={claiming} onClick={() => openAuth("signup")}>
        Sign in to keep {count !== 1 ? "them" : "it"}
      </Button>
    </div>
  );
}
