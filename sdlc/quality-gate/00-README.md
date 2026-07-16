# DatIQ — Quality Gate & Test Suite Initiative

> **Initiative:** close DatIQ's testing coverage gap (Unit + Integration + Contract + Functional + System + Smoke + E2E + Security + A11y + Visual) and ship a release-grade quality gate that scales as R-numbers land.
>
> **Generated:** 2026-07-15
> **Branch / status:** **Plan LOCKED. 11/11 decisions resolved. Ready to start M0 on `claude/quality-gate`.**
> **Owner:** Vikash Karuna
> **M0 ETA:** Next working session (~5 h) — NotFound page + test harness + new npm scripts + cross-browser projects + deeplink specs.
>
> This directory contains the full SDLC package for the initiative. Read `01-analysis.md` first (executive summary + audit findings), then `02-requirements.md` and `03-design.md` for the spec, then `04-testing-spec.md` for the test inventory, then `05-implementation-plan.md` for the work plan, then `06-review-request.md` for the decisions, then `sdlc-prompt.md` for the reusable SDLC prompt.

## How to read this package

| File | Purpose | Read when |
|---|---|---|
| `01-analysis.md` | Existing-state audit, gap analysis, BRD-vs-implementation conflicts, improvement list | You want the "what is / what isn't / what should be" picture |
| `02-requirements.md` | Phase-1 SDLC output — functional + non-functional requirements, acceptance criteria | You want to ratify scope |
| `03-design.md` | Phase-2 SDLC output — test architecture, infra trade-offs, file layout, CI integration | You want to know "how" |
| `04-testing-spec.md` | The complete test inventory across all 5+ layers (Unit, Integration, Contract, Functional, System, Smoke, E2E, Security, Accessibility, Visual) | You want the full list of tests that will be added |
| `05-implementation-plan.md` | Prioritized work plan, dependency graph, milestone releases, effort estimate | You want the schedule |
| `06-review-request.md` | Concrete decisions I need from you before I start coding | **You need to act on this** |
| `sdlc-prompt.md` | The reusable SDLC prompt that drives the whole initiative (8-phase, MiniMax-grounded) | You want to re-run the prompt or hand it to a sub-agent |

## What I am NOT doing yet (intentionally)

- I am **not** writing the test code itself yet. The plan + specs are concrete enough that we can adjust scope before any code is written.
- I am **not** modifying any production source files.
- I am **not** changing CI. The current `.github/workflows/quality-gate.yml` already runs `npm run test:all`; the plan strengthens what runs inside that gate.

## Why this package exists

Today the project has:

- **8 Vitest files** (7 unit, 1 integration), 77 % line / 73 % function / 84 % branch coverage on a hand-picked 740-line subset of `src/lib/`. Everything else (`src/components/`, `src/pages/`, `netlify/functions/`, `src/data/`) is at 0 % coverage.
- **2 Playwright specs** (1 smoke + 1 happy-path extraction flow), 3 functions, 89 % of the previous `e2e-test.mjs` suite lost when it was retired for the Playwright port.
- **1 server-side test** (`publicUrl.test.js` for SSRF policy).
- **1 security check** (`scripts/security-check.mjs`) — secret-pattern scan + dep audit, but no functional security tests.
- **No a11y tests**, **no visual-regression tests**, **no contract tests** for `/api/*`, **no load/perf tests**.

That is not a release gate. It is a smoke alarm. The rest of this package fixes that.

## What I am asking for

Open `06-review-request.md`. It has six concrete decisions. Your answers unlock the implementation plan in `05-implementation-plan.md`.

— Mavis
