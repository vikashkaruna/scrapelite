---
description: Run the DatIQ release-readiness gate (audit → fix → test → merge staging → prod if green)
argument-hint: "[auto | audit | staging-only]  (default: auto)"
---

Invoke the `production-readiness` skill and run its full workflow for this
release. Mode = `$ARGUMENTS` (default `auto` when empty).

Follow the skill exactly:

1. Run `node .claude/skills/production-readiness/scripts/audit.mjs` and turn every
   FAIL/WARN into a worklist.
2. Fix every FAIL: apply `--fix-emails`, remove any admin/confidential leakage
   from external surfaces, rebuild help (`node docs/build-help.mjs`) if the
   markdown changed, and repair broken screenshot references.
3. Bring the collateral in sync with the code per `references/checklist.md`
   (tests & coverage, internal + external docs, help center, personas, features
   & comparison, pricing, gallery, release blog, changelog, use-cases).
4. Re-run the audit until 0 FAIL, then `npm run test:all`.
5. Write the release doc to `docs/internal/`.
6. Merge per `references/merge-and-deploy.md`:
   - `audit` mode: stop after step 4 (report only, no commit/merge).
   - `staging-only` mode: commit + merge to `staging` + push + `smoke:staging`, then stop.
   - `auto` mode (default): the above, and if staging is green, merge to `main`
     and push. Stop and ask a human only for a failing smoke test, an
     unverifiable competitor/pricing claim, or a FAIL the audit can't auto-resolve.

Keep every customer-facing surface admin-free and every customer email at
`hello@datiq.app`. Report what changed on each surface when done.
