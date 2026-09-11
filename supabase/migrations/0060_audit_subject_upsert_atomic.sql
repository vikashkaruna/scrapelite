-- 0060_audit_subject_upsert_atomic.sql — close the get-or-create race in D7.
--
-- 0057 shipped `upsert_audit_subject` as SELECT-then-INSERT and its own comment
-- claimed the partial unique indexes made it "idempotent ... so two concurrent
-- audits of the same brand cannot mint two subjects". That claim is half true,
-- and the missing half is the defect: the indexes make a SECOND ROW impossible,
-- they do NOT make the losing caller return the winner's id. A concurrent
-- transaction's snapshot cannot see the other's uncommitted row, so its SELECT
-- misses, its INSERT raises unique_violation, and the exception propagates out
-- of the function.
--
-- `ensureSubject` swallows that into `null`, which is a legal state — so the
-- audit still runs. The cost is silent: that audit carries no subject_id, and
-- `sameSubject()` falls back to `target_id`. For a PAGE subject the fallback
-- covers it, which is why nothing has surfaced. An entity-backed subject
-- (brand / product / service / location) has NO fallback, so the moment W13
-- persists one, a lost race scatters exactly the history D7 exists to keep
-- together.
--
-- `upsert_audit_target` — the function 0057 says it mirrors — has always been
-- atomic. This makes the newer one match rather than be quietly weaker.
--
-- Three INSERTs rather than one, because the arbiter differs per reference:
-- each partial index is inferred by restating its own predicate. A single
-- composite arbiter is impossible here for the same reason 0057 used three
-- indexes — a composite over three nullable columns constrains nothing.
--
-- Forward-only: 0057 is already applied to dev/stage, so editing its history
-- would repair neither.

create or replace function public.upsert_audit_subject(
  p_user_id uuid,
  p_kind text,
  p_target_id uuid default null,
  p_entity_id uuid default null,
  p_truth_record_id uuid default null,
  p_label text default null,
  p_canonical_domain text default null,
  p_workspace_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  -- The CHECKs would refuse this anyway; naming it here makes the refusal
  -- legible to the caller instead of surfacing as a constraint violation.
  -- It also guarantees exactly one of the three branches below is taken.
  if (p_target_id is not null)::int
   + (p_entity_id is not null)::int
   + (p_truth_record_id is not null)::int <> 1 then
    raise exception 'upsert_audit_subject: exactly one reference is required';
  end if;

  -- `coalesce(nullif(btrim(...),''), <existing>)` in the DO UPDATE keeps the
  -- 0057 merge semantics exactly: a caller that supplies nothing must never
  -- blank a label or a domain another caller already established.
  if p_target_id is not null then
    insert into public.audit_subjects
      (user_id, workspace_id, subject_kind, target_id, label, canonical_domain)
    values
      (p_user_id, p_workspace_id, p_kind, p_target_id,
       coalesce(nullif(btrim(p_label), ''), p_kind), p_canonical_domain)
    on conflict (user_id, subject_kind, target_id) where target_id is not null
      do update set
        label            = coalesce(nullif(btrim(p_label), ''), public.audit_subjects.label),
        canonical_domain = coalesce(p_canonical_domain, public.audit_subjects.canonical_domain),
        workspace_id     = coalesce(p_workspace_id, public.audit_subjects.workspace_id),
        updated_at       = now()
    returning id into v_id;

  elsif p_entity_id is not null then
    insert into public.audit_subjects
      (user_id, workspace_id, subject_kind, entity_id, label, canonical_domain)
    values
      (p_user_id, p_workspace_id, p_kind, p_entity_id,
       coalesce(nullif(btrim(p_label), ''), p_kind), p_canonical_domain)
    on conflict (user_id, subject_kind, entity_id) where entity_id is not null
      do update set
        label            = coalesce(nullif(btrim(p_label), ''), public.audit_subjects.label),
        canonical_domain = coalesce(p_canonical_domain, public.audit_subjects.canonical_domain),
        workspace_id     = coalesce(p_workspace_id, public.audit_subjects.workspace_id),
        updated_at       = now()
    returning id into v_id;

  else
    insert into public.audit_subjects
      (user_id, workspace_id, subject_kind, truth_record_id, label, canonical_domain)
    values
      (p_user_id, p_workspace_id, p_kind, p_truth_record_id,
       coalesce(nullif(btrim(p_label), ''), p_kind), p_canonical_domain)
    on conflict (user_id, subject_kind, truth_record_id) where truth_record_id is not null
      do update set
        label            = coalesce(nullif(btrim(p_label), ''), public.audit_subjects.label),
        canonical_domain = coalesce(p_canonical_domain, public.audit_subjects.canonical_domain),
        workspace_id     = coalesce(p_workspace_id, public.audit_subjects.workspace_id),
        updated_at       = now()
    returning id into v_id;
  end if;

  return v_id;
end $$;

comment on function public.upsert_audit_subject(uuid, text, uuid, uuid, uuid, text, text, uuid) is
  'D7 get-or-create. ATOMIC since 0060 — one INSERT .. ON CONFLICT per reference, so a concurrent caller receives the existing subject instead of a unique_violation. Refuses anything but exactly one reference.';

-- Re-stated because `create or replace function` does not carry privileges
-- forward on its own in every path, and a SECURITY DEFINER function that
-- anon can execute would be a privilege-escalation primitive.
revoke all on function public.upsert_audit_subject(uuid, text, uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.upsert_audit_subject(uuid, text, uuid, uuid, uuid, text, text, uuid) to service_role;
