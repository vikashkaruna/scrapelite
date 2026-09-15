# D7 — the P2 subject model

> **Status: ✅ SIGNED OFF AND BUILT — migration `0057_audit_subjects.sql`.**
> Written 2026-09-11 after W9 and W10 shipped without pre-empting it; approved
> by the owner the same day and implemented as recommended, unchanged.
>
> **What shipped, against §5's own sequencing:**
>
> | Step | State |
> |---|---|
> | Build `audit_subjects` + backfill | ✅ `0057`, backfill proven re-runnable by double-application |
> | Point comparability at `subject_id` | ✅ `subjectModel.sameSubject()`, with the `target_id` fallback |
> | Write `BT-xx` / `EG-xx` into `audit_issues` | ⏸ W13/W14, as scheduled — no earlier workstream depends on it |
> | Drop `audits.target_id` | ❌ never, and a comment in `0057` says so |
>
> 🔴 **ONE THING THIS FIXED THAT §3 DID NOT PREDICT.** The doc says comparability
> "today is same `target_id`". In the code it was **nothing at all**:
> `compareRoute` compared any two audits the caller owned, so an audit of
> `/pricing` against one of `/about` produced a confident delta that meant
> nothing. The UI never exercised it (it passes the audit's own recorded
> baseline) but `/api/v1` key holders reach the same handler. `sameSubject()`
> now gates it, and a subject mismatch **withholds the issue lists too** —
> unlike a version mismatch, where the codes stay true. See §3.
>
> ⚠️ **W12 is the first consumer**: `audit_local_checks.subject_id` points here,
> because a NAP check is about a business, which is exactly the case the
> page-shaped `audits.target_id` could never carry.

---

## 1. The question

P1 audits a **page**. `audits.target_id` points at `audit_targets`, and every
finding hangs off the audit:

```
audit_targets ─< audits ─< audit_issues
                       └─< audit_recommendations   (the queue)
                       └─< audit_signals
                       └─< audit_results
```

P2 audits things that are **not pages**: a brand, a product, a service, a
location. W11's BDS/PDS/SFS are scores for those subjects. So: how does a
business-level audit relate to a page-level one?

The plan's recorded default was a **polymorphic `subject_type` + `subject_id`
on the shared issue and recommendation tables**, so one queue serves every
audit kind. W9 and W10 deliberately did not implement it, and this document is
the reason why plus what to do instead.

---

## 2. Why the polymorphic retrofit is the wrong shape

It is the obvious answer and it fails on four counts.

**It destroys referential integrity, permanently.** A `subject_id` that points
at `audit_targets` on one row and `audit_entities` on the next **cannot carry a
foreign key**. Nothing stops an issue referencing a brand that was deleted last
month. 🔴 **This repository has already been burned by exactly this class of
hazard three times** — `audit_signals.raw_value`, `.evidence_json` and
`audit_recommendations.issue_id` were all declared and never written, and the
read path returned `null` identically to "not applicable". An unenforceable
pointer is the same failure with a different spelling: it is wrong silently.

**The blast radius is the whole of P1.** `audit_issues.audit_id` is
`not null references audits(id)`. Making the subject polymorphic means every
reader of the queue, `auditDiff`, all four export formats, the webhook payload
builder and `billing-purge`'s table list must now filter by `subject_type` or
risk mixing a brand finding into a page report. That is a large, uninteresting
change with no test that can prove it complete.

**It makes every consumer ask the same question forever.** `subject_type` is a
discriminator each reader must branch on. Miss one branch and the failure is a
wrong answer, not an error.

**And it buys nothing the alternative does not.** The goal — *one queue, one
differ, one workflow* — does not actually require polymorphic ISSUES.

---

## 3. The recommendation: make the AUDIT polymorphic, one level up

Introduce a **subject registry**, and leave the issue and recommendation tables
completely untouched.

```
audit_subjects ─< audits ─< audit_issues            ← UNCHANGED
                        └─< audit_recommendations   ← UNCHANGED
                        └─< audit_signals           ← UNCHANGED
```

```sql
create table public.audit_subjects (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  workspace_id   uuid,

  subject_kind   text not null check (subject_kind in
                   ('page','domain','brand','product','service','location')),

  -- 🔴 EXACTLY ONE of these is non-null, and every one is a REAL foreign key.
  -- This is the whole point: the polymorphism lives in a CHECK constraint the
  -- database enforces, not in a bare uuid the database cannot.
  target_id        uuid references public.audit_targets(id)                   on delete cascade,
  entity_id        uuid references public.audit_entities(id)                  on delete cascade,
  truth_record_id  uuid references public.audit_business_truth_records(id)    on delete cascade,

  label            text not null,
  canonical_domain text,          -- the same bridge key W9 and W10 already use

  created_at     timestamptz not null default now(),

  constraint audit_subjects_exactly_one_ref check (
    (target_id       is not null)::int
  + (entity_id       is not null)::int
  + (truth_record_id is not null)::int = 1
  ),

  -- A page subject must point at a target; a brand subject at an entity.
  -- Without this, `subject_kind` and the actual reference could disagree —
  -- which is the polymorphic bug back again, one column over.
  constraint audit_subjects_kind_matches_ref check (
    (subject_kind in ('page','domain') and target_id is not null)
    or (subject_kind in ('brand','product','service','location') and entity_id is not null)
    or (subject_kind = 'domain' and truth_record_id is not null)
  )
);

alter table public.audits
  add column subject_id uuid references public.audit_subjects(id) on delete set null;
```

> ⚠️ **ONE DEVIATION BETWEEN THIS SKETCH AND SHIPPED `0057`, DELIBERATE.** The
> sketch's first CHECK arm reads `subject_kind in ('page','domain')`, which lets
> a **`page`** subject be satisfied by a truth record via the third arm — the
> polymorphic bug back again, one column over, which is the exact thing the
> constraint exists to stop. Shipped, `page` requires a target and `domain`
> accepts either, written as one arm each. Same intent, one loophole fewer.

### Why this is the right shape

| Property | Polymorphic issues | Subject registry |
|---|---|---|
| Foreign keys enforced | ❌ impossible | ✅ every one real |
| P1 tables changed | issues, recommendations, + every reader | **none** |
| New subject kind costs | a new discriminator value every reader must learn | one nullable FK + one CHECK arm |
| Orphan findings possible | yes, silently | no — the FK cascades |
| One queue / one differ | yes | yes |

**One queue is preserved, and that was the actual goal.** Findings still hang
off `audit_id`; the queue already groups by audit. Nothing in
`listRecommendationQueue` changes.

**`auditDiff` gets simpler, not harder.** Comparability today is "same
`target_id`". It becomes "same `subject_id`" — one field, one rule, and two
brand audits compare exactly as two page audits do. The existing
`scoring_model_version` guard is unaffected.

**The migration is additive and backfillable**, unlike the polymorphic one:

1. Create `audit_subjects`.
2. Insert one `page` subject per existing `audit_targets` row.
3. `update audits set subject_id = <the subject for its target_id>`.
4. Keep `audits.target_id` — **do not drop it.** It is not redundant: it is the
   fast path for the page case, it is what every existing query uses, and
   dropping it would recreate the blast radius this design exists to avoid.
   `subject_id` is additive; `target_id` stays authoritative for page audits.

### The honest cost

One extra join to resolve a subject to its underlying row, and one denormalised
column (`target_id`) kept deliberately. That is the trade, and it is cheap: an
indexed FK lookup against the alternative of permanently unenforceable pointers.

---

## 4. What happens to the W9 / W10 conflict tables

`audit_business_truth_conflicts` and `audit_entity_conflicts` **stay where they
are.** They are not queue entries — they carry their own lifecycle
(`resolved_at`, `resolution`) that the recommendation queue does not model, and
they are about a *record*, not about an *audit*.

The bridge, once `audit_subjects` exists, is **additive**: an audit that detects
a conflict also writes an `audit_issues` row carrying the `BT-xx` / `EG-xx`
code, so the finding reaches the one queue while the conflict row remains the
detail behind it. That mirrors the split `audit_issues` and
`audit_recommendations` already have — *finding* versus *task*.

⚠️ **Do not MOVE the conflict rows into `audit_issues`.** The resolution
vocabularies differ (`record_updated` / `page_updated` / `not_a_conflict` versus
the eight workflow states), and collapsing them would lose the distinction
between "this conflict is settled" and "somebody did the task".

---

## 5. Sequencing

| Step | When | Why then |
|---|---|---|
| Build `audit_subjects` + backfill | **before W11** | W11 is the first workstream whose audits have a non-page subject. |
| Point `auditDiff` comparability at `subject_id` | with W11 | Two brand audits must be comparable the day brand audits exist. |
| Write `BT-xx` / `EG-xx` into `audit_issues` | W13 or W14 | Needs the issue catalogue widened; no earlier workstream depends on it. |
| Drop `audits.target_id` | **never** | See §3.4. |

---

## 6. What this does not decide

The PRD's **7-role RBAC** (viewer, analyst, editor, manager, admin, agency
admin, client viewer) is **D6's deferred half**, not D7. It attaches to
`workspace_id`, which every table in this module already carries. Keep the two
decisions apart — conflating them is how a subject model turns into a
permissions rewrite.
