// UseCaseRevOps.jsx — /use-cases/revops (plan §22, D22b).
import UseCaseLanding from "../components/UseCaseLanding.jsx";
import { useSeo } from "../hooks/useSeo.js";
import { seoFor } from "../lib/pageSeo.js";

export default function UseCaseRevOps() {
  useSeo(seoFor("/use-cases/revops"));
  return (
    <UseCaseLanding
      eyebrow="Use Case · RevOps & Growth Operations"
      title="Clean, score and route an account list without a spreadsheet in the middle"
      answer="Paste a list of company domains, enrich each one from its own website, score it against ICP rules you write, and route the accounts that qualify to HubSpot, Slack, email or a webhook. Every field carries its source, and a criterion DatIQ could not measure is left out of the score rather than counted as zero."
      stats={[
        { num: "500", label: "accounts per list on Agency" },
        { num: "0", label: "fields invented — observed, inferred or absent" },
        { num: "$0", label: "to start — no card" },
      ]}
      whatYouGet={[
        { icon: "list-checks", title: "A clean list", desc: "Paste company domains or names. Every entry is normalised and de-duplicated, and a name is matched to a domain only after you confirm it." },
        { icon: "target", title: "Scores you can defend", desc: "ICP rules with field, operator, value and weight, plus required criteria and a threshold. Coverage travels with every score, so a 70 from five signals is not confused with a 70 from two." },
        { icon: "git-merge", title: "Routing that is visibly wired", desc: "Signal rules send qualified accounts where your team works, and the Workflow hub shows any list that no rule is listening to." },
      ]}
      howItWorks={[
        { title: "Import the list", desc: "Start from the ICP List → CRM template, or create an account list directly." },
        { title: "Write your ICP rules", desc: "Test them against a sample domain before you spend anything on a run." },
        { title: "Run the enrichment", desc: "A long run survives a closed tab; low-confidence rows go to a review queue instead of into your table." },
        { title: "Route the result", desc: "Create a rule that listens to this list only, and read it back as one sentence before you save it." },
      ]}
      personas={[
        { icon: "sliders", label: "RevOps" },
        { icon: "trending-up", label: "Growth operations" },
        { icon: "target", label: "Sales leadership" },
      ]}
      honesty={{
        title: "An honest gap beats a confident guess",
        body: "A company that does not publish its size gets no size — not an estimate. Unmeasured criteria are excluded and their weight redistributed, so your routing decides on what was actually read.",
      }}
      cta={{ title: "Score your first list", body: "Free to start — 500 credits, no credit card required.", label: "Open the template hub", to: "/templates?filter=revops" }}
      related={[
        { label: "Account Intelligence", path: "/use-cases/account-intelligence" },
        { label: "Lead Generation", path: "/use-cases/lead-generation" },
        { label: "Competitive Monitoring", path: "/use-cases/competitive-monitoring" },
      ]}
    />
  );
}
