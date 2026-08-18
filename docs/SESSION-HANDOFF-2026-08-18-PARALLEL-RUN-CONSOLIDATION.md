# Session handoff — 2026-08-18 — parallel-run consolidation + branch cleanup

## Why this session existed

Several Claude Code sessions had run in parallel against this repo. Each ended
with observations, some with uncommitted work, and the branch list had grown to
12 local / 5 remote refs with no clear story about which held real work. This
session reconciled all of it into one branch, shipped what was genuinely
outstanding, and cut the branch list back to the four the user wants to keep.

## What the audit actually found

The reconciliation was less dramatic than the branch count suggested.
`origin/staging` (`6ae0842`) was already a superset of every branch except two:

| Ref | Relationship to `origin/staging` |
|---|---|
| `origin/main` (`17e6c82`) | 1 commit ahead — the PR #92 **merge commit only**, no content. Staging holds all of main's content. |
| `origin/Integration-with-outside-ecosystem` (`c6e21fe`) | 3 commits ahead — 2 merge commits + 1 docs handoff. Kept. |
| `origin/workflow-implementation-and-optimization` (`44bb640`) | **0 ahead** — fully contained in staging. Kept by request, but it is a stale pointer, not live work. |
| `origin/claude/docs-screenshots-refresh-d71ebf` (`e43f269`) | 0 ahead — fully merged. Deleted. |
| every other local branch | 0 ahead — fully merged. Deleted. |

**The only uncommitted work anywhere in any worktree** was a 2-file diff in
`.claude/worktrees/analytics-search-optimization-ca6b7d` (branch
`claude/xenodochial-yonath-72d2c5`): the Salesforce-claim fix that three
separate handoffs flagged and none shipped. That diff is now committed here,
extended, and the branch deleted.

## What shipped (`95877e8`)

DatIQ has four push providers — `integrationsClient.js` `PUSH_PROVIDERS` is
HubSpot, Notion, Airtable, Slack. Salesforce is roadmap-only. Three surfaces
sold it as shipped:

- `src/lib/pricingConfig.js` — Business plan feature list, `included: true`.
  A **paid plan** promising a CRM that does not exist. The worst of the three.
- `src/lib/pageSeo.js` — the Business JSON-LD `Offer`, plus the `/integrations`
  `<title>` and meta description. Page bodies get reviewed; `pageSeo.js` rarely
  does, so a stale title keeps advertising a dead feature to Google and to LLM
  crawlers long after the visible page is corrected.
- `src/pages/About.jsx` — Pillar 2 carries `status: "live"` and listed
  Salesforce beside HubSpot as shipped CRM sync. Missed by the peer session
  that wrote the original diff.

**Deliberately left alone, because they are accurate:** About Pillar 4
(`status: "roadmap"`), `Blog.jsx:40` ("we're building toward"), the
`/integrations` card (`status: "roadmap"`, "Notify me"), and
`public/vs/clay/index.html`, which credits *the competitor* with native
Salesforce sync and states DatIQ pushes via webhook/CSV. Correcting those
would have made the copy wrong in the other direction.

### Second defect, found while fixing the first

The AI-crawler files had drifted much further than the Salesforce claim, and
every drift **understated** the product against `pricingConfig.js`:

| File | Was | Now |
|---|---|---|
| `llms.txt` | Go: no quota · Select 100 · Pro 250 · Business 1,000 · Dev H2 2026 | Go 200 · Select 500 · Pro 1,000 · Business 10,000 · Dev H3 2026 |
| `llms-full.txt` | **Go tier missing entirely** · Select 100 · Pro $29/250 · Business 1,000 + Salesforce · Dev H2 2026 | Go row added · Select 500 · Pro $20.40/1,000 · Business 10,000 · Dev H3 2026 |
| `pageSeo.js` | Business Offer "5000 extractions/month" | 10,000 |

These are the files AI answer engines ingest verbatim. They were advertising
Business as a 1,000-extraction plan that actually ships 10,000.

`public/*/index.html` regenerated with `npm run prerender`. The churn on
untouched routes is only the new bundle/CSS hashes — verified.

## Verification

All gates run on the merge content, not just the branch:

- readiness **6 pass · 1 warn · 0 fail** — the warn is gallery/persona
  coverage, which is runtime-populated from Supabase and unprovable from source
- unit **1975 passed / 124 files**
- contract · integration · system — pass
- db **124 assertions / 25 migrations**
- `npm run build` clean
- security check clean
- e2e smoke **115 passed · 1 skipped · 0 failed** (the skip is the deliberately
  CSS-hidden Pillar-0 banner, expected)

## Branch state after this session

Kept: `main`, `staging`, `Integration-with-outside-ecosystem`,
`workflow-implementation-and-optimization`, and the working branch
`claude/consolidate-parallel-runs-4c34b7` (the user cleans this one).
Everything else deleted, local and remote, after proving each was fully
contained in `origin/staging`.

## Suggested actions — nothing below is blocked on code

1. **Merge `staging` → `main`.** Deliberately not done, per the standing rule.
   Note this will be a merge commit, not a fast-forward: `main`'s tip is the
   PR #92 merge object, which staging does not contain.
2. **Netlify env — Supabase identity.** On `/admin/health` in both contexts,
   confirm `urlRef === keyRef` and that `url` is the `*.supabase.co` project
   URL, **not** `api.datiq.app`. An `Invalid API key` here is almost never the
   token; it is the two refs disagreeing.
3. **Netlify env — AI provider key.** `GEMINI_API_KEY` / `AI_API_KEY` /
   `OPENAI_API_KEY` all appeared unset in an earlier session, which is the
   likely reason Quick enrichment returns nothing. Unverified since; three
   sessions have shipped in between, so check before acting.
4. **Curate the public gallery** — `/admin/gallery`, ≥1 sample per persona.
   That is the one standing readiness warn, and the admin tooling exists
   specifically to satisfy it.
5. **`Integration-with-outside-ecosystem` needs a sync decision.** Its remote
   is 3 commits ahead of staging; the local copy was 55 behind its own remote
   and has been reset to it. It has not been merged forward with this
   session's work.
6. **The guest gate is still `localStorage`-backed.** Closing it needs
   server-side guest identity — a real change, not a cleanup.
