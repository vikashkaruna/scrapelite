// InlineFix — create the missing link WITHOUT leaving the diagnosis.
//
// ── WHY INLINE, AND WHY ONLY SOMETIMES ─────────────────────────────────────
// Phase 1 named the gaps and linked out to the screen that could close them.
// That is a correct diagnosis and a poor repair: the user reads "no rule is
// listening", lands on an empty rule builder, and has to re-derive from scratch
// what the issue card already knew — which trigger source, and why.
//
// So the fix is offered here, pre-filled from the issue, for the cases where
// the missing thing is genuinely small. It is deliberately NOT offered for
// importing an account list: that is a paste-a-CRM-export flow with dedupe and
// a credit estimate, and a three-field version of it inside a card would be a
// worse version of a screen that already exists.
//
// ⚠️ EVERY FORM CREATES SOMETHING INERT-BUT-HONEST RATHER THAN GUESSING.
// A rule created here has NO conditions, which the evaluator treats as "matches
// everything" — stated on the form, because a rule that silently matched
// nothing would reproduce the exact defect this screen exists to surface.
import { useState } from "react";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";
import { useAuth } from "../AuthProvider.jsx";
import { useToast } from "../Toast.jsx";
import * as watchlistApi from "../../lib/watchlist/watchlistClient.js";
import * as rulesApi from "../../lib/rules/rulesClient.js";

/** Which issue codes can be repaired from here, and with what. */
export const INLINE_FIXABLE = {
  no_consumer: "rule",
  rule_unreachable: "watchlist_or_list",
  rule_upstream_idle: "targets",
  watchlist_no_targets: "targets",
};

export default function InlineFix({ issue, graph, onDone }) {
  const [open, setOpen] = useState(false);
  const kind = INLINE_FIXABLE[issue.code];
  if (!kind) return null;

  // `rule_unreachable` is only inline-fixable when the missing upstream is a
  // watchlist. When it is an account list, the honest answer is the import
  // screen, so the card keeps its plain link instead.
  if (kind === "watchlist_or_list" && issue.fix?.href?.startsWith("/lists")) return null;

  return (
    <div className="wf-inline">
      {!open ? (
        <button type="button" className="wf-inline-open" onClick={() => setOpen(true)}>
          <Icon name="plus" size={12} /> Fix it here
        </button>
      ) : (
        <div className="wf-inline-form">
          {kind === "rule" && <RuleForm issue={issue} graph={graph} onDone={onDone} onCancel={() => setOpen(false)} />}
          {(kind === "targets" || kind === "watchlist_or_list") && (
            <TargetsForm issue={issue} kind={kind} onDone={onDone} onCancel={() => setOpen(false)} />
          )}
        </div>
      )}
    </div>
  );
}

/** Create a rule that listens for the source this issue says nobody listens to. */
function RuleForm({ issue, graph, onDone, onCancel }) {
  const { user } = useAuth();
  const showToast = useToast();
  const [name, setName] = useState(
    issue.stage === "watchlists" ? "Tell me about competitor changes" : "Tell me about new qualified accounts",
  );
  const [to, setTo] = useState(user?.email || "");
  const [busy, setBusy] = useState(false);

  // The source is DERIVED from the issue, never asked. The card already knows
  // which upstream has no listener, and asking the user to restate it is how
  // the wrong source gets picked and the rule stays unreachable.
  const source = issue.stage === "watchlists" ? "watchlist" : "bulk_enrichment";

  async function submit(e) {
    e.preventDefault();
    if (!to.trim()) { showToast("An email address is required."); return; }
    setBusy(true);
    try {
      await rulesApi.createRule({
        name: name.trim() || "New rule",
        trigger_source: source,
        conditions: [],
        action_type: "email",
        action_config: { to: to.trim() },
      });
      showToast("Rule created — it will fire on the next matching event.");
      onDone?.();
    } catch (err) {
      showToast(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label className="wf-inline-label">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="wf-inline-label">
        Email it to
        {/* Prefilled with the signed-in address: the one destination that needs
            no connection, no webhook URL and no further setup, so the rule
            works the moment it is saved. */}
        <input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@company.com" />
      </label>
      <p className="wf-inline-note">
        <Icon name="info" size={12} />
        This starts with <strong>no conditions</strong>, so it fires on every {issue.stage === "watchlists" ? "competitor change" : "enriched account"}.
        Narrow it on the rule screen once you see what arrives.
      </p>
      <div className="wf-inline-actions">
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? "Creating…" : "Create rule"}
        </Button>
        <button type="button" className="wf-inline-cancel" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** Add competitor domains — either to an existing watchlist, or a new one. */
function TargetsForm({ issue, kind, onDone, onCancel }) {
  const showToast = useToast();
  const [domains, setDomains] = useState("");
  const [name, setName] = useState("Close competitors");
  const [busy, setBusy] = useState(false);
  const needsNewWatchlist = kind === "watchlist_or_list" || !issue.subjectId;

  async function submit(e) {
    e.preventDefault();
    const list = domains.split(/[\s,;]+/).map((d) => d.trim()).filter(Boolean);
    if (list.length === 0) { showToast("Add at least one domain."); return; }
    setBusy(true);
    try {
      if (needsNewWatchlist) {
        await watchlistApi.createWatchlist({ name: name.trim() || "Competitors", cadence: "daily", domains: list });
        showToast(`Watchlist created with ${list.length} competitor${list.length === 1 ? "" : "s"}.`);
      } else {
        // An existing watchlist gains targets by being recreated with them is
        // NOT how this works — there is no add-target endpoint yet, so we send
        // the user to the screen that owns it rather than pretending.
        showToast("Open the watchlist to add competitors to it.");
        onDone?.();
        return;
      }
      onDone?.();
    } catch (err) {
      showToast(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!needsNewWatchlist) {
    return (
      <p className="wf-inline-note">
        <Icon name="info" size={12} />
        Adding competitors to an existing watchlist happens on the watchlist screen.
        <button type="button" className="wf-inline-cancel" onClick={onCancel}>Close</button>
      </p>
    );
  }

  return (
    <form onSubmit={submit}>
      <label className="wf-inline-label">
        Watchlist name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="wf-inline-label">
        Competitor domains
        <textarea
          rows={3}
          value={domains}
          onChange={(e) => setDomains(e.target.value)}
          placeholder={"rival.com\nother-rival.com"}
        />
      </label>
      <p className="wf-inline-note">
        <Icon name="info" size={12} />
        The first check records a <strong>baseline</strong> and never alerts. Changes appear from the second check on.
      </p>
      <div className="wf-inline-actions">
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? "Creating…" : "Create watchlist"}
        </Button>
        <button type="button" className="wf-inline-cancel" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
