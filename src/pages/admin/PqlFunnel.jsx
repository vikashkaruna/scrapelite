// PqlFunnel.jsx — the founder's activation view on /admin/revenue.
//
// PRD §Now: "PQL event tracking — know who is likely to pay and why."
//
// Every number here can be absent for a reason that is NOT "zero", and keeping
// those apart is the component's whole job:
//
//   available=false   the pql_scores table could not be read — usually
//                     migration 0040 not applied. Not a product finding.
//   rate === null     no denominator. Renders "no data", never "0%".
//   unscorable > 0    accounts the product cannot currently judge at all.
//   coverage < 1      scores computed from a subset of the signals, so the PQL
//                     count is a FLOOR and will rise when Phase 4 lands — for
//                     reasons no customer caused.
//
// A founder dashboard that renders a fabricated 0% gets used to decide whether
// to spend on acquisition. That is what this guards against.
import Icon from "../../components/Icon.jsx";

const pct = (r) => (r === null || r === undefined ? null : `${Math.round(r * 100)}%`);

function Stat({ label, value, hint, tone = "" }) {
  return (
    <div className={"pqlf-stat" + (tone ? ` pqlf-stat-${tone}` : "")}>
      <span className="pqlf-stat-value">
        {value ?? <span className="pqlf-nodata">no data</span>}
      </span>
      <span className="pqlf-stat-label">{label}</span>
      {hint && <span className="pqlf-stat-hint">{hint}</span>}
    </div>
  );
}

export default function PqlFunnel({ funnel, available = true }) {
  if (!available) {
    return (
      <section className="card card-pad pqlf" aria-labelledby="pqlf-heading">
        <h3 id="pqlf-heading" className="pqlf-heading">Activation &amp; PQL</h3>
        <div className="pqlf-notice">
          <Icon name="alert-circle" size={15} />
          <span>
            The <code>pql_scores</code> table could not be read — most likely migration{" "}
            <code>0040_pql.sql</code> has not been applied to this environment.{" "}
            <strong>This is not the same as “no one has activated”</strong>, so no numbers are shown.
          </span>
        </div>
      </section>
    );
  }
  if (!funnel) return null;

  const thin = funnel.meanCoverage !== null && funnel.meanCoverage < 1;

  return (
    <section className="card card-pad pqlf" aria-labelledby="pqlf-heading">
      <div className="pqlf-head">
        <h3 id="pqlf-heading" className="pqlf-heading">Activation &amp; PQL</h3>
        <span className="pqlf-threshold">PQL at {funnel.threshold} of {funnel.maxPoints} points</span>
      </div>

      <div className="pqlf-stats">
        <Stat label="Accounts" value={funnel.total} />
        <Stat
          label="Activated"
          value={funnel.activated}
          hint={pct(funnel.activationRate) ? `${pct(funnel.activationRate)} of all accounts` : "no accounts yet"}
        />
        <Stat
          label="PQLs"
          value={funnel.pqls}
          hint={pct(funnel.pqlRate) ? `${pct(funnel.pqlRate)} of scored` : "nothing scored yet"}
          tone="accent"
        />
        <Stat label="Mean score" value={funnel.meanScore} hint={funnel.scored ? `across ${funnel.scored} scored` : null} />
      </div>

      {/* Both caveats are facts about the INSTRUMENTATION, not about users.
          Hiding them would let a floor be read as a measurement. */}
      {funnel.unscorable > 0 && (
        <p className="pqlf-caveat">
          <Icon name="info" size={13} />
          <span>
            <strong>{funnel.unscorable}</strong> account{funnel.unscorable === 1 ? "" : "s"} could not be
            scored at all — no measurable signal yet. Excluded from the mean and from the PQL rate.
          </span>
        </p>
      )}
      {thin && (
        <p className="pqlf-caveat">
          <Icon name="alert-triangle" size={13} />
          <span>
            Scores use <strong>{pct(funnel.meanCoverage)}</strong> of the signal weight on average — two
            signals have no source until bulk enrichment and firmographics land. Treat the PQL count as a{" "}
            <strong>floor</strong>: it will rise when they ship, for reasons no customer caused.
          </span>
        </p>
      )}

      <div className="pqlf-bands" role="group" aria-label="Score distribution">
        {[
          ["belowHalf", "Cold", "Below half the threshold"],
          ["approaching", "Warming", "Half the threshold or more"],
          ["atThreshold", "PQL", "At or above the threshold"],
          ["strong", "Strong", "Half again above the threshold"],
        ].map(([key, label, title]) => (
          <div key={key} className={`pqlf-band pqlf-band-${key}`} title={title}>
            <span className="pqlf-band-n">{funnel.bands[key]}</span>
            <span className="pqlf-band-label">{label}</span>
          </div>
        ))}
      </div>

      <table className="pqlf-table">
        <caption className="pqlf-caption">
          Grouped by the job to be done, not by app persona — two personas doing the same job answer the
          same question.
        </caption>
        <thead>
          <tr>
            <th scope="col">Activation group</th><th scope="col">Accounts</th>
            <th scope="col">Activated</th><th scope="col">Rate</th><th scope="col">PQLs</th>
          </tr>
        </thead>
        <tbody>
          {funnel.groups.map((g) => (
            <tr key={g.key} className={g.users ? "" : "pqlf-row-empty"}>
              <th scope="row" title={g.label}>{g.key}</th>
              <td>{g.users}</td>
              <td>{g.activated}</td>
              <td>{pct(g.activationRate) ?? <span className="pqlf-nodata">—</span>}</td>
              <td>{g.pqls}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
