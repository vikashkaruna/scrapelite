# 09 — GCP Production Cutover Runbook (Phase 1c / Phase 3)

**Date:** 2026-09-29 · **Branch:** `docker-desktop-build` · **Status:** NOT EXECUTED — artifacts + scripts ready, awaiting owner sign-off after local + staging testing.

This is the runbook `deployment/scripts/gcp/cutover-db.sh` references. It covers
doc 05 §3d steps 1–9 end-to-end: the freeze, the DB dump/restore, the repoint,
the smoke, the external-party updates, the DNS flip, and the rollback.

> ⚠ DANGER: this window touches production. Do not begin without the owner
> present, the preflight checklist below completed, and the rollback path
> (step 7) rehearsed in advance.

---

## 0. Preflight (complete ALL before the window)

- [ ] Staging fully tested (local + GCP staging green; owner sign-off).
- [ ] `.env.prod` filled (copy from `.env.prod.example`) — including
      `JWT_SECRET` = the **production Supabase JWT secret** (Supabase dashboard
      → Settings → API → JWT Secret). A generated secret logs every user out.
- [ ] `SOURCE_DB_URL` = prod Supabase connection string (session pooler URI from
      the dashboard) available to paste at run time.
- [ ] `bootstrap.sh prod` + `bootstrap-secrets.sh prod` already run; the prod
      shadow (Phase 1b / `promote-prod.sh`) validated against the prod hosted
      Supabase with cron ownership proven in both directions.
- [ ] External-party change list prepared (step 5): Stripe webhook URL,
      Razorpay webhook URL, Resend webhook URL, OAuth provider redirect
      allow-lists, n8n callback URL.
- [ ] Rollback rehearsal done (step 7) — DNS revert path documented to the
      minute.

## 1. Freeze (doc 05 §3d step 1)

```bash
# Pause write-heavy crons — GCP side first (the script does this), and COMMENT
# the Netlify TOML schedules beforehand (never both owners live):
./deployment/scripts/gcp/cutover-db.sh prod "postgresql://postgres.<ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres"
```

The script then runs dump/restore (step 2), repoints auth/rest (step 3),
repoints api/jobs + Hosting rewrites (step 4 — it persists `DATA_MODE=cloud-sql`
and `SUPABASE_URL=<app base>` into `.env.prod` and redeploys hosting so the
`/auth/v1/**` + `/rest/v1/**` rewrites exist), and smokes (step 5).

What it does NOT automate (manual, in this order):
1. payments test event (Stripe + Razorpay test-mode webhooks) — verify 200
2. one n8n round-trip (HMAC-verified callback)
3. external-party updates (step 5 below)

## 2. Post-flip smoke (script step 5 + manual)

```bash
./deployment/scripts/gcp/smoke.sh prod        # edge parity + API gate
# manual: sign in (OAuth round-trip), extract, payments, admin, monitoring
```

## 3. Verify the DB restore was complete (post-review hardening)

The FK-safe restore fails loudly on the production path. After the run:
- `deployment/generated/db/fk-restore.err` must contain **0** ERROR lines (the
  full path restores the auth schema, so every `user_id → auth.users` FK
  re-adds — any failure aborts the script with the violation list).
- `deployment/generated/db/data-restore.err` must be empty.
- Verify the row-count report printed at the end matches the source counts
  (extractions, watchlists, workflow_events, audits, audit_events).

## 4. External parties (doc 05 §3d step 6; impact doc §6)

| Party | Change |
|---|---|
| Stripe | webhook endpoint URL → `https://datiq.app/api/payment-webhook` (or the shadow URL first) |
| Razorpay | same webhook URL change in the Razorpay dashboard |
| Resend | webhook URL update |
| Google/Microsoft OAuth | add `https://api.datiq.app` (GoTrue) + `https://datiq.app` to the redirect allow-lists |
| n8n | callback base URL → production origin |

## 5. DNS flip (doc 05 §3d step 7) — MANUAL and LAST

1. Firebase Hosting console → Hosting → Add custom domain for
   `datiq.app`, `www.datiq.app`, and `api.datiq.app` (custom domain → Cloud Run
   rewrites for `/api/**`).
2. Verify TLS (SSL cert provisioning completes; test `https://datiq.app`).
3. Only then update the DNS records at the registrar.
4. Verify: `curl -I https://datiq.app` + full smoke against the custom domain.

## 6. Keep Netlify deployed (doc 05 §3d step 8)

Netlify + hosted Supabase stay intact through the rollback window — instant
DNS-revert is the rollback. Document the caveat: accounts/payments created
post-flip do not exist on the old stack if you revert.

## 7. Rollback (rehearse BEFORE the window)

```bash
# revert DNS to Netlify at the registrar (TTL-permitting), then:
#   - unpause/resume the Netlify TOML schedules
#   - set OPS_JOBS_DISABLED=1 on the prod GCP services (they stop owning crons)
./deployment/scripts/gcp/deploy-run.sh prod api jobs     # re-apply OPS_JOBS_DISABLED=1
```

## 8. Decommission (after the rollback window; doc 05 §3d step 9)

- [ ] Netlify deploys retired; GitHub Actions Netlify-coupled jobs disabled.
- [ ] Hosted Supabase project retired (keep exports archived).
- [ ] `DATA_MODE=cloud-sql` confirmed in `.env.prod` (persisted by the script).
