# Engagement — user & operator walkthrough

> **Updated:** 2026-09-24 (Phase A + B of [ENGAGEMENT-AND-WORKFLOWS-UX-PLAN.md](ENGAGEMENT-AND-WORKFLOWS-UX-PLAN.md))
> **Audience:** internal — the DatIQ team, beta testers, operators. Engagement is in private beta, so this is
> deliberately **not** published in the public help (owner decision D12).
> **Status, decisions, findings and env vars:** [PROSPECT-ENGAGEMENT-ENGINE-REVIEW-AND-ROLLOUT.md](PROSPECT-ENGAGEMENT-ENGINE-REVIEW-AND-ROLLOUT.md).
> **Database steps:** [DB-MIGRATION-RUNBOOK.md §4h (0081, 0082) and §4i (0083)](DB-MIGRATION-RUNBOOK.md).

This file replaces the pre-review walkthrough, which described n8n workflows, multi-channel dispatch and a
localStorage demo mode. All three were removed, and that design is summarised under *History* at the end.

---

## 1. Getting in

- **Menu:** user menu → **Workflows → Engagement** (`/engagement`). The Workflows group reads: Workflow hub ·
  Engagement · ─── · Account lists · Watchlists · Signal rules.
- **Signed out:** the page asks you to sign in and makes no requests.
- **Not in the beta:** "Prospect Engagement is in private beta". Access is `ENGAGEMENT_ENABLED=1` plus
  `ENGAGEMENT_ALLOWLIST` (account UUIDs or a bare `*`, never emails).
- **Test mode:** on test environments sending is simulated. A banner on every tab says *"Test mode — messages are
  not delivered from this environment"*, and simulated sends are marked **Test send**. The technical line naming
  `ENGAGEMENT_MOCK_SEND` appears only outside production.
- **"DatIQ is working…"** appears bottom-right during any action that waits on the server. Action buttons are
  disabled meanwhile, so nothing is pressed twice. Errors appear as red toasts or next to the field in a dialog.

## 2. Campaigns

- **New campaign:** name (unique on your account, ignoring case and spacing) and description.
- **Campaign bar:** a selector (same-named older campaigns show their creation date), status, description,
  prospect count, created date and sender. **Edit** renames, describes, pauses, completes or archives the
  campaign, or **deletes** it after a second confirmation. Deleting keeps your opt-outs, because they belong
  to the account.

## 3. Import prospects

**Import** (top right) opens one dialog for every way of bringing contacts in:

| You can | How |
|---|---|
| Paste text | CSV, semicolon- or tab-separated — including cells copied straight from Excel or Google Sheets |
| Upload a file | **Upload file** — `.csv`, `.tsv`, `.txt`, `.xlsx` (5 MB, 1,000 rows) |
| Drop or paste a file | Drag it onto the box, or copy the file and paste it |
| Start from the template | **Download template** — the recognised columns with two example rows |

- **Header row optional.** Without one, each column's meaning is read from its content: email, phone, then the
  template order. A notice at the top shows how the columns were read.
- **Recognised headers** include `first_name`, `last_name`, `name` (split), `email` / `email address`,
  `phone` / `mobile`, `company`, `role` / `title` / `job title`, `industry`, `country`. Other columns are kept as
  custom fields.
- **Refused files** get a reason: `.xls` and `.numbers` ("save it as .xlsx or CSV"), empty, over 5 MB,
  unreadable workbook. A workbook with several sheets asks which sheet to use.

**Before importing**, every row gets a status:

| Status | Meaning |
|---|---|
| Ready | Will be imported |
| Ready · opted out of email | Imported, but will not be emailed (and why: unsubscribed, bounced…) |
| Already in campaign | Skipped — names the prospect it matches and when they were added |
| Repeated | Skipped — same email/phone as an earlier line |
| Needs fixing | Skipped — the reason (bad email, no email or phone, too many values) |

Counts sit above the table. **Show problems only** filters it, and **Download problem rows** gives a CSV to
fix and re-import. The button reads **"Import N ready rows (skip M)"**; it imports the healthy rows as long as
there is at least one.

**After importing**, the result stays open:
- a headline such as *"Imported 18 of 25 — 5 were already in this campaign, 2 had problems"*;
- every skipped row listed by line and reason;
- **Download skipped rows**.

## 4. Pipeline

- Stages **wrap to the page width**, so the whole funnel is visible without scrolling sideways. Empty stages
  collapse to their header (**Show empty stages** restores them).
- A busy stage shows 6 cards and **"+ N more"**, which opens the Prospects tab filtered to that stage.
- Stages advance on real sends and delivery events. The only moves you make are **They replied**,
  **Converted**, **Follow up** and **Draft email** (on new prospects).

## 5. Review & send

- New drafts wait in the queue. Edit the subject or body, then **Approve**; what you approved is what gets sent.
  A draft that fails a compliance check (spam phrases, length, missing unsubscribe) cannot be approved until
  it is edited to pass.
- **Send N now** sends approved messages; the cron sends anything left every 5 minutes. Each message is sent
  **once**, and opt-outs are re-checked at the moment of sending. "Not sent" rows give the reason, with **Retry**
  where it makes sense.

## 6. Prospects

- A table with search, a stage filter and **Export CSV**. Each row has **Edit**, and new or follow-up prospects
  have **Draft email**.
- **Edit** (row or drawer ✎) corrects name, email, phone, company, role, industry and country.
  - A duplicate email or phone in the campaign is refused by name ("already *Ana Lopez* in this campaign").
  - Open drafts for that prospect are rebuilt with the new details. Drafts you edited by hand are kept, and an
    approved-but-unsent message goes back to review.
  - The change is logged.
- **Drawer** (click a row or card):
  - **Stage:** only the moves a person may make.
  - **Facts and contact details.**
  - **Draft email.**
  - **Consent by channel:** ticked = may be contacted. Untick a channel and **Save consent** to opt out, or use
    **Opt out of all channels**. Both ask to confirm, and you can give a reason. Opt-outs apply to every
    campaign on the account. A recipient's own opt-out shows as "Recipient's choice" and cannot be removed.
  - **Add a note.**
  - **Activity:** every event in plain words (notes, stage changes, sends, test sends, skips, opt-outs, edits).

## 7. Results

KPIs (prospects, sent, delivered %, opened %, replied %, opted out), a funnel, and A/B variant results, with
**Export CSV**. Opens are approximate, because some mail apps open every message automatically.

## 8. Brand kit & sender

- **Sender:** from name; from email (must be on a verified sending domain); reply-to.
- **Brand kit:** company/product name, what you offer, link label and URL, and **sign-off (up to 4 lines)**.
  Fields left empty are left out of drafts, never invented.
- **Use my account brand kit** (Business and Agency plans) fills the form from Account → Brand kit:

  | Account Brand Kit | Fills |
  |---|---|
  | Company name | Company / product name |
  | Tagline | What you offer |
  | Website | Link URL |
  | Footer text | Sign-off |
  | Contact email | Reply-to |

  It fills the form **without saving**, so you review first. The account Brand Kit is now stored on the server
  (`0083`, text fields only), so it follows you to other devices.
- **Saving the brand kit rewrites unsent drafts:**
  - drafts awaiting review are updated;
  - approved-but-unsent messages are updated and go back to review;
  - hand-edited drafts are left alone.

  The toast says how many of each.

## 9. Operator checklist

1. Migrations `0081` + `0082` (+ `0083` for the server Brand Kit) are applied — runbook §4h/§4i. Staging has
   `0081`/`0082`.
2. Environment variables are set per context (the table is in the review doc):
   - `ENGAGEMENT_ENABLED=1`;
   - `ENGAGEMENT_ALLOWLIST` (UUIDs or `*`);
   - `ENGAGEMENT_SENDER_DOMAINS`, `ENGAGEMENT_RESEND_API_KEY`, `ENGAGEMENT_RESEND_WEBHOOK_SECRET`;
   - `ENGAGEMENT_UNSUBSCRIBE_SECRET`;
   - `ENGAGEMENT_PUBLIC_URL` (bare origin);
   - `ENGAGEMENT_MOCK_SEND=1` on test environments only.
3. Redeploy after changing any of them. Netlify injects function environment variables at deploy time.
4. `npm run verify:rls`.
5. `npm run verify:engagement-p0` after any change to sending, webhook or consent code: 19 re-planted defects,
   each must fail its test.

## 10. Manual test script

Run M-1…M-16 from the review doc (§5.2), then these for Phases A and B:

| # | Check | Expected |
|---|---|---|
| M-17 | Paste one contact row, no header | Accepted; columns shown at the top; 1 ready |
| M-18 | Upload a `.xlsx` with two sheets | Sheet picker; switching sheets re-checks |
| M-19 | Upload `.xls`, and a 6 MB CSV | Each refused with what to do instead |
| M-20 | Paste 3 rows: one already in the campaign, one opted out, one new | Preview marks each; button "Import 2 ready rows (skip 1)"; result names the duplicate |
| M-21 | Edit a prospect's email to another prospect's | Refused, naming them |
| M-22 | Edit a prospect with an open draft | Draft shows the new details; hand-edited draft unchanged |
| M-23 | Sign-off on 3 lines, then Draft email | Three lines in the text and HTML versions |
| M-24 | Business account: Account → Brand kit → save; Engagement → Use my account brand kit | Form filled, not saved; on a Free account the button explains the plans |
| M-25 | Pipeline at 375 / 768 / 1280px | No sideways scroll; empty stages collapsed |
| M-26 | Production context with `ENGAGEMENT_MOCK_SEND=1` set by mistake | No test-mode banner — production refuses simulated sending |

## History

The pre-review build (to 2026-09-22) had these parts, all removed in Phase 1 for reasons recorded as findings
F-1…F-16 in the review doc:
- five n8n workflows for ingest, personalisation, routing, webhooks and a state monitor;
- a multi-channel router sending email, WhatsApp, SMS and Telegram;
- a localStorage "demo mode";
- a shared `ENGAGEMENT_WEBHOOK_SECRET` header check.
