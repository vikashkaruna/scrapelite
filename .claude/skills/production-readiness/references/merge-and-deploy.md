# Merge & deploy — the staging → production gate

The release only ships after the gate is green. This file defines the gate, the
exact commands, auto-mode behavior, and rollback.

## Branch flow

```
<feature branch>  →  staging  →  main (production, auto-deploys to datiq.app)
```

- `staging` deploys to `staging.datiq.app`; `main` deploys to the live site
  `datiq.app` (Netlify auto-publish on push).
- CI: `.github/workflows/staging-gate.yml` guards pushes to `staging`;
  `.github/workflows/phase-gate.yml` guards promotion to `main` (test →
  smoke-staging → manual approval → deploy-prod → smoke-prod + auto-rollback).
- `npm run readiness` (the audit) is a required check in both — a leak, an email
  split, a broken screenshot ref, or an empty changelog **blocks the merge**
  regardless of who or which model ran the release.

## The green-gate definition

"Green" means **all** of:
1. `node .claude/skills/production-readiness/scripts/audit.mjs` → 0 FAIL (WARNs
   resolved or annotated in the release doc).
2. `npm run test:all` passes.
3. `npm run build` succeeds (bundled into `test:all`).
4. For production only: `npm run smoke:staging` is green against the deployed
   staging site (proves the staging deploy actually works, not just local tests).

## Commands

```bash
# 0. Pre-flight (on the feature branch)
node .claude/skills/production-readiness/scripts/audit.mjs
npm run test:all

# 1. Commit the release work
git add -A
git commit -m "release: <summary>"          # end with the Co-Authored-By trailer

# 2. Promote to staging
git checkout staging
git merge --no-ff <feature-branch> -m "Merge <feature-branch> into staging: <summary>"
git push origin staging                       # → staging-gate.yml runs, deploys staging

# 3. Verify staging is green (wait for the deploy)
npm run smoke:staging                         # or watch the staging-gate workflow

# 4. Promote to production — ONLY if staging is green
git checkout main
git merge --no-ff staging -m "Release <version>: <summary>"
git push origin main                          # → phase-gate.yml; deploys datiq.app
npm run smoke:prod                            # confirm production is healthy
```

## Auto mode — what runs unattended vs. what stops

Auto mode keeps the deterministic, reversible work moving and pauses on the
irreversible-and-uncertain:

**Runs unattended (defaults):** audit, `--fix-emails`, admin-leak removal, help
rebuild, all collateral edits, `test:all`, the commit, the merge to `staging`,
the push to `staging`, and `smoke:staging`.

**Stops and asks a human when:**
- `npm run test:all` fails and the fix isn't obvious/mechanical.
- `smoke:staging` (or `smoke:prod`) fails — never push over a red smoke.
- A pricing number has no backing in `src/lib/pricingConfig.js`, or a competitor
  claim can't be verified (correctness risk, not mechanical).
- The audit still shows a FAIL it can't auto-resolve.

Promotion to `main` is the one outward-facing, hard-to-reverse step (it deploys
to the live paid product). Auto mode performs it **only** when staging is green
by the definition above; otherwise it stops with staging done and hands off the
two production commands. This matches the repo's phase-gate design, which also
requires a manual approval before the production deploy.

## Rollback

- **CI auto-rollback:** `phase-gate.yml` runs `smoke:prod` after deploy and rolls
  back the Netlify production deploy automatically if it fails.
- **Manual:** `git revert <merge-commit> && git push origin main`, or in the
  Netlify dashboard publish the previous successful deploy. Then open a fix
  branch and re-run this gate.

## After shipping

- Record the release in `docs/internal/` (what changed on each surface, audit
  result, test result, any WARNs consciously accepted).
- If screenshots were deferred (WARN), file it as an explicit follow-up rather
  than letting it drift silently.
