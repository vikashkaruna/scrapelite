// D22 — one source of truth for the two release runners' non-overlapping jobs.
//
// The deployment runner may perform one disposable P1 audit, but it does not
// own P1/P2 product conformance. The Discoverability runner owns those stable
// check ids and may leave intentional append-only test evidence, so it must
// never be invoked implicitly by a general release command.

const scope = ({ id, command, summary, owns, doesNotOwn, writeBoundary }) => Object.freeze({
  id,
  command,
  summary,
  owns: Object.freeze(owns),
  doesNotOwn: Object.freeze(doesNotOwn),
  writeBoundary,
});

export const RELEASE_GATE_SCOPES = Object.freeze({
  release: scope({
    id: "deployment-release",
    command: "test:release",
    summary: "Deployment, public-route, browser, RLS, and disposable P1 audit-lifecycle checks.",
    owns: [
      "deployment-smoke",
      "public-route-contracts",
      "deployed-browser-contracts",
      "anonymous-rls-posture",
      "disposable-p1-audit-lifecycle",
    ],
    doesNotOwn: [
      "p1-p2-behavioural-conformance",
      "database-schema-inventory",
      "cross-tenant-isolation",
      "free-plan-entitlement-boundaries",
      "discoverability-test-sheet-ids",
    ],
    writeBoundary: "--allow-live-write plus DATIQ_TEST_BEARER_TOKEN permits one disposable P1 audit.",
  }),
  discoverability: scope({
    id: "discoverability-conformance",
    command: "verify:discoverability",
    summary: "Stable-id P1/P2 API, schema, tenancy, entitlement, and evidence conformance checks.",
    owns: [
      "p1-p2-behavioural-conformance",
      "database-schema-inventory",
      "cross-tenant-isolation",
      "free-plan-entitlement-boundaries",
      "discoverability-test-sheet-ids",
    ],
    doesNotOwn: [
      "deployment-smoke",
      "public-route-contracts",
      "deployed-browser-contracts",
      "anonymous-rls-posture",
      "disposable-p1-audit-lifecycle",
    ],
    writeBoundary: "--allow-writes and --allow-audits are separate; production requires each explicitly.",
  }),
});
