// netlify/functions/lib/bulkStore.js — service-key data access for Bulk Account Intelligence (PRD 3).
//
// Manages lists, list_records, canonical_entities, icp_score_rules,
// enrichment_jobs, and review_queue.

import { createClient } from "@supabase/supabase-js";
import { enrichDomain, fieldsNeedingReview } from "./bulkEnrich.js";
import { dispatchSignal } from "./signalDispatch.js";
import { dedupeEntries } from "../../../src/lib/bulk/identityModel.js";
import { evaluateIcp, DEFAULT_THRESHOLD } from "../../../src/lib/bulk/icpModel.js";

// In-memory mock store for local/dev/offline when Supabase is not configured
const _localLists = new Map();
const _localRecords = new Map();
const _localRules = new Map();
const _localReview = new Map();
const _localJobs = new Map();
const _localJobItems = new Map();
const _localEntities = new Map();

export function serviceDb(env = process.env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}


// Service-key queries bypass RLS, so an absent user id must refuse rather than
// return an unfiltered result set. `review_queue` in particular holds
// unverified CONTACT data — names, titles and email addresses scraped from
// third-party sites — which is the most sensitive table in this feature.
const NO_OWNER = { ok: false, reason: "unauthenticated", status: 401 };
const ownerless = (userId) => !userId || typeof userId !== "string";

/**
 * Confirms `userId` owns the list behind `jobId`. Enrichment jobs are driven by
 * a client POST (`process_chunk`), so without this any signed-in user could
 * advance — and spend the credits of — another tenant's job.
 */
export async function assertJobOwner(jobId, userId, env = process.env) {
  if (ownerless(userId) || !jobId) return false;
  const db = serviceDb(env);
  if (!db) {
    const job = _localJobs.get(jobId);
    if (!job) return false;
    const list = _localLists.get(job.list_id);
    return !!list && list.user_id === userId;
  }
  const { data, error } = await db
    .from("enrichment_jobs")
    .select("id")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();
  return !error && !!data;
}

export async function assertListOwner(listId, userId, env = process.env) {
  if (ownerless(userId) || !listId) return false;
  const db = serviceDb(env);
  if (!db) {
    const list = _localLists.get(listId);
    return !!list && list.user_id === userId;
  }
  const { data, error } = await db
    .from("lists")
    .select("id")
    .eq("id", listId)
    .eq("user_id", userId)
    .maybeSingle();
  return !error && !!data;
}

export async function listLists(userId, env = process.env) {
  if (ownerless(userId)) return { ...NO_OWNER, lists: [] };
  const db = serviceDb(env);
  if (!db) {
    const userLists = Array.from(_localLists.values()).filter((l) => l.user_id === userId);
    return { ok: true, lists: userLists };
  }

  let q = db.from("lists").select("*").order("created_at", { ascending: false });
  q = q.eq("user_id", userId);

  const { data, error } = await q;
  if (error) return { ok: false, reason: error.message, lists: [] };
  return { ok: true, lists: data || [] };
}

export async function getList(listId, userId, env = process.env) {
  if (ownerless(userId)) return null;
  const db = serviceDb(env);
  if (!db) {
    const list = _localLists.get(listId);
    if (!list) return null;
    const records = Array.from(_localRecords.values()).filter((r) => r.list_id === listId);
    return { ...list, records };
  }

  let listQuery = db.from("lists").select("*").eq("id", listId);
  listQuery = listQuery.eq("user_id", userId);

  const { data: listData, error: listError } = await listQuery.single();
  if (listError || !listData) return null;

  const { data: records, error: recError } = await db
    .from("list_records")
    .select("*")
    .eq("list_id", listId)
    .order("created_at", { ascending: true });

  // ── THE JOBS THIS LIST HAS ────────────────────────────────────────────────
  // The client used to FABRICATE a job id as `job_${listId}` and POST it to
  // process_chunk, which answered 404 "Job not found" for every list ever
  // created — jobs carry a database-generated id, and createList already
  // returns the real one. Returning the jobs here means the UI can run the
  // right one and, just as importantly, SHOW the user what jobs exist and what
  // state they are in, instead of a dead button and an error naming an id the
  // user never saw.
  const { data: jobs } = await db
    .from("enrichment_jobs")
    .select("id, status, total_items, processed_items, created_at, updated_at")
    .eq("list_id", listId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return {
    ...listData,
    records: recError ? [] : records || [],
    jobs: jobs || [],
    // The one a "Run enrichment" click should advance: the newest that still
    // has work left, else the newest overall (so the UI can report it as done
    // rather than silently doing nothing).
    active_job_id: (jobs || []).find((j) => j.status !== "completed")?.id || null,
  };
}

export async function createList(userId, { name, description = "", domains = [], persona = "sales" }, env = process.env) {
  if (ownerless(userId)) return NO_OWNER;
  const deduped = dedupeEntries(domains);
  if (deduped.length === 0) {
    throw new Error("No valid domains could be extracted from input.");
  }

  const db = serviceDb(env);
  const listId = "list_" + Math.random().toString(36).slice(2, 10);
  const jobId = "job_" + Math.random().toString(36).slice(2, 10);
  const now = new Date().toISOString();

  if (!db) {
    const newList = {
      id: listId,
      user_id: userId,
      name: name || `Import ${new Date().toLocaleDateString()}`,
      description,
      status: "pending",
      total_records: deduped.length,
      completed_records: 0,
      failed_records: 0,
      needs_review_records: 0,
      created_at: now,
      updated_at: now,
    };
    _localLists.set(listId, newList);

    const createdRecords = [];
    const jobItems = [];

    for (let i = 0; i < deduped.length; i++) {
      const entry = deduped[i];
      const recId = `rec_${listId}_${i}`;
      const rec = {
        id: recId,
        list_id: listId,
        raw_input: entry.raw,
        canonical_domain: entry.canonical,
        status: "queued",
        icp_score: null,
        icp_reasons: [],
        enriched_data: {},
        confidence_score: null,
        error: null,
        credits_used: 0,
        created_at: now,
      };
      _localRecords.set(recId, rec);
      createdRecords.push(rec);

      const itemId = `item_${jobId}_${i}`;
      const item = {
        id: itemId,
        job_id: jobId,
        record_id: recId,
        status: "queued",
        attempts: 0,
        created_at: now,
      };
      _localJobItems.set(itemId, item);
      jobItems.push(item);
    }

    _localJobs.set(jobId, {
      id: jobId,
      list_id: listId,
      user_id: userId,
      status: "queued",
      cursor: 0,
      total_items: deduped.length,
      processed_items: 0,
      created_at: now,
    });

    return { ok: true, list: newList, jobId, total: deduped.length };
  }

  // Real DB insert
  const { data: listData, error: listError } = await db
    .from("lists")
    .insert({
      user_id: userId,
      name: name || `Import ${new Date().toLocaleDateString()}`,
      description,
      status: "pending",
      total_records: deduped.length,
    })
    .select()
    .single();

  if (listError) throw new Error(listError.message);

  const recordsPayload = deduped.map((d) => ({
    list_id: listData.id,
    raw_input: d.raw,
    canonical_domain: d.canonical,
    status: "queued",
  }));

  const { data: recordsData, error: recError } = await db
    .from("list_records")
    .insert(recordsPayload)
    .select();

  if (recError) throw new Error(recError.message);

  const { data: jobData, error: jobError } = await db
    .from("enrichment_jobs")
    .insert({
      list_id: listData.id,
      user_id: userId,
      status: "queued",
      total_items: deduped.length,
    })
    .select()
    .single();

  if (!jobError && jobData && recordsData) {
    const itemsPayload = recordsData.map((r) => ({
      job_id: jobData.id,
      record_id: r.id,
      status: "queued",
    }));
    await db.from("enrichment_job_items").insert(itemsPayload);
  }

  return { ok: true, list: listData, jobId: jobData?.id, total: deduped.length };
}

export async function getIcpRules(userId, persona = "default", env = process.env) {
  if (ownerless(userId)) return { ...NO_OWNER, rules: null };

  const db = serviceDb(env);
  if (!db) {
    const key = `${userId || "default"}_${persona}`;
    if (_localRules.has(key)) return _localRules.get(key);
    return {
      persona,
      name: "Default ICP Criteria",
      threshold: DEFAULT_THRESHOLD,
      criteria: [
        { field: "industry", operator: "in", value: ["Software", "SaaS", "Fintech"], weight: 40 },
        { field: "employee_count", operator: "gte", value: 20, weight: 30 },
        { field: "has_pricing", operator: "equals", value: true, weight: 30 },
      ],
      is_default: true,
    };
  }

  // Prefer this user's custom rule for the persona, else the shared default.
  // The query used to select every row for the persona regardless of owner and
  // then fall back to `data[0]` — which handed the caller ANOTHER tenant's
  // custom ICP criteria whenever they had none of their own. Scoping it in SQL
  // (own rule OR a genuine shared default) removes the fallback entirely.
  const { data, error } = await db
    .from("icp_score_rules")
    .select("*")
    .eq("persona", persona)
    .or(`user_id.eq.${userId},is_default.is.true`)
    .order("is_default", { ascending: true }); // user rule (is_default: false) first

  if (error || !data || data.length === 0) {
    return {
      persona,
      name: "Default ICP Criteria",
      threshold: DEFAULT_THRESHOLD,
      criteria: [
        { field: "industry", operator: "in", value: ["Software", "SaaS", "Fintech"], weight: 40 },
        { field: "employee_count", operator: "gte", value: 20, weight: 30 },
        { field: "has_pricing", operator: "equals", value: true, weight: 30 },
      ],
      is_default: true,
    };
  }

  const userRule = data.find((r) => r.user_id === userId);
  return userRule || data.find((r) => r.is_default === true) || null;
}

export async function saveIcpRules(userId, { persona, name, criteria, threshold }, env = process.env) {
  if (ownerless(userId)) return NO_OWNER;
  const db = serviceDb(env);
  if (!db) {
    const key = `${userId || "default"}_${persona || "default"}`;
    const rule = {
      persona: persona || "default",
      name: name || "Custom ICP",
      criteria: criteria || [],
      threshold: threshold || DEFAULT_THRESHOLD,
      is_default: false,
    };
    _localRules.set(key, rule);
    return { ok: true, rule };
  }

  const { data, error } = await db
    .from("icp_score_rules")
    .upsert({
      user_id: userId,
      persona: persona || "default",
      name: name || "Custom ICP",
      criteria: criteria || [],
      threshold: threshold || DEFAULT_THRESHOLD,
      is_default: false,
    })
    .select()
    .single();

  if (error) return { ok: false, reason: error.message };
  return { ok: true, rule: data };
}

/**
 * §1.3 Durable Chunked Execution:
 * Runs a slice of pending items within `budgetMs` to avoid serverless timeouts.
 */
export async function processJobChunk(jobId, budgetMs = 8000, env = process.env) {
  const startTime = Date.now();
  const db = serviceDb(env);

  let processedCount = 0;
  let remainingCount = 0;

  if (!db) {
    // Process local chunk
    const job = _localJobs.get(jobId);
    if (!job) return { ok: false, reason: "job_not_found" };

    const items = Array.from(_localJobItems.values()).filter(
      (i) => i.job_id === jobId && i.status === "queued"
    );

    const rules = await getIcpRules(job.user_id, "sales", env);

    for (const item of items) {
      if (Date.now() - startTime >= budgetMs) {
        remainingCount = items.length - processedCount;
        break;
      }

      item.status = "running";
      const rec = _localRecords.get(item.record_id);
      if (rec) {
        // Deterministic mock enrichment
        const domain = rec.canonical_domain || "company.com";
        const isTech = domain.includes("tech") || domain.includes("io") || domain.includes("app") || domain.includes("stripe");
        const enriched = {
          company_name: domain.split(".")[0].toUpperCase(),
          industry: isTech ? "Software" : "Services",
          employee_count: 55,
          has_pricing: true,
          hq_country: "US",
        };

        const icp = evaluateIcp(enriched, rules.criteria, rules.threshold);

        rec.enriched_data = enriched;
        rec.icp_score = icp.score;
        rec.icp_reasons = icp.reasons;
        rec.confidence_score = 0.92;
        rec.status = icp.passed ? "complete" : "partial";
        rec.credits_used = 2;
        rec.completed_at = new Date().toISOString();

        // Low confidence review item trigger example
        if (!isTech) {
          rec.status = "needs_review";
          const revId = "rev_" + Math.random().toString(36).slice(2, 9);
          _localReview.set(revId, {
            id: revId,
            record_id: rec.id,
            list_id: rec.list_id,
            user_id: job.user_id,
            field_name: "industry",
            candidate_value: enriched.industry,
            confidence: 0.65,
            status: "pending",
            created_at: new Date().toISOString(),
          });
        }
      }

      item.status = "completed";
      item.completed_at = new Date().toISOString();
      processedCount += 1;
      job.processed_items += 1;
    }

    const uncompleted = Array.from(_localJobItems.values()).filter(
      (i) => i.job_id === jobId && (i.status === "queued" || i.status === "running")
    );

    const list = _localLists.get(job.list_id);
    if (list) {
      const records = Array.from(_localRecords.values()).filter((r) => r.list_id === list.id);
      list.completed_records = records.filter((r) => r.status === "complete" || r.status === "partial").length;
      list.failed_records = records.filter((r) => r.status === "failed").length;
      list.needs_review_records = records.filter((r) => r.status === "needs_review").length;
      list.status = uncompleted.length === 0 ? "complete" : "running";
      list.updated_at = new Date().toISOString();
    }

    if (uncompleted.length === 0) {
      job.status = "completed";
    }

    return {
      ok: true,
      processed: processedCount,
      remaining: uncompleted.length,
      done: uncompleted.length === 0,
    };
  }

  // Real DB Chunk processing
  const { data: job, error: jobErr } = await db.from("enrichment_jobs").select("*").eq("id", jobId).single();
  if (jobErr || !job) return { ok: false, reason: "job_not_found" };

  const { data: pendingItems, error: itemsErr } = await db
    .from("enrichment_job_items")
    .select("id, job_id, record_id, status, attempts")
    .eq("job_id", jobId)
    .eq("status", "queued")
    .limit(25);

  if (itemsErr) {
    console.error("[bulkStore] processJobChunk items error:", itemsErr);
    return { ok: false, reason: itemsErr.message };
  }

  if (!pendingItems || pendingItems.length === 0) {
    await db.from("enrichment_jobs").update({ status: "completed" }).eq("id", jobId);
    await updateListCounters(db, job.list_id);
    return { ok: true, processed: 0, remaining: 0, done: true };
  }

  const recordIds = pendingItems.map((i) => i.record_id).filter(Boolean);
  const { data: recordsData, error: recFetchErr } = await db
    .from("list_records")
    .select("*")
    .in("id", recordIds);

  if (recFetchErr) {
    console.error("[bulkStore] processJobChunk recordsData error:", recFetchErr);
    return { ok: false, reason: recFetchErr.message };
  }
  const recordsMap = new Map((recordsData || []).map((r) => [r.id, r]));

  const rules = await getIcpRules(job.user_id, "sales", env);

  for (const item of pendingItems) {
    if (Date.now() - startTime >= budgetMs) break;

    const rec = recordsMap.get(item.record_id);
    if (rec) {
      const domain = rec.canonical_domain;

      // REAL enrichment. This used to build firmographics by string-matching the
      // domain name — `industry: domain.includes("tech") ? "Software" : "Services"`,
      // a hardcoded `employee_count: 55`, `has_pricing: true` always — and stamp
      // the result `confidence_score: 0.95`. Every ICP score in the product was
      // computed from that invention. See bulkEnrich.js for the rule that
      // replaced it: observed, inferred, or ABSENT — never defaulted.
      const perDomainBudget = Math.max(2000, budgetMs - (Date.now() - startTime));
      const enrichment = await enrichDomain(domain, {
        deadlineAt: Date.now() + Math.min(perDomainBudget, 9000),
      });

      if (!enrichment.ok) {
        // A domain we could not read is FAILED, not scored. Marking it complete
        // with empty data would put a null-coverage row in front of a user as
        // though it had been researched.
        await db.from("list_records").update({
          status: "failed",
          error: enrichment.reason,
          credits_used: 0,
          completed_at: new Date().toISOString(),
        }).eq("id", rec.id);
      } else {
        const enriched = enrichment.fields;
        const icp = evaluateIcp(enriched, rules.criteria, rules.threshold);
        const review = fieldsNeedingReview(enrichment.provenance);
        const finalStatus = review.length > 0
          ? "needs_review"
          : (icp.coverage > 0 ? (icp.passed ? "complete" : "partial") : "partial");

        await db.from("list_records").update({
          enriched_data: enriched,
          // Provenance travels with the row: source URL, method and confidence
          // per field, which is the BRD's "data provenance is a product feature".
          provenance: enrichment.provenance,
          icp_score: icp.score,
          icp_reasons: icp.reasons,
          confidence_score: enrichment.confidence,
          status: finalStatus,
          credits_used: enrichment.pagesFetched + (enrichment.aiConfidence > 0 ? 1 : 0),
          completed_at: new Date().toISOString(),
        }).eq("id", rec.id);

        // The review queue is now driven by MEASURED confidence rather than the
        // old `if (!isTech)`, so it surfaces the rows a human can actually help
        // with instead of a fixed arbitrary subset.
        for (const r of review) {
          await db.from("review_queue").insert({
            record_id: rec.id,
            list_id: rec.list_id,
            user_id: job.user_id,
            field_name: r.field,
            candidate_value: String(enriched[r.field] ?? ""),
            confidence: r.confidence,
            status: "pending",
          });
        }

        // PRD 5 producer: a scored account is a routable signal.
        try {
          await dispatchSignal({
            kind: "account.score_changed",
            userId: job.user_id,
            payload: {
              domain,
              company_name: enriched.company_name || domain,
              icp_score: icp.score,
              coverage: icp.coverage,
              confidence: enrichment.confidence,
              list_id: rec.list_id,
              source_url: enrichment.sourceUrl,
            },
          }, env);
        } catch {
          // Routing must never lose the enrichment that triggered it — the
          // list_records row is already committed above.
        }
      }
    }

    await db.from("enrichment_job_items").update({
      status: "completed",
      completed_at: new Date().toISOString(),
    }).eq("id", item.id);

    processedCount += 1;
  }

  const { count: pendingCount } = await db
    .from("enrichment_job_items")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .eq("status", "queued");

  const done = (pendingCount || 0) === 0;
  await db.from("enrichment_jobs").update({
    processed_items: (job.processed_items || 0) + processedCount,
    status: done ? "completed" : "running",
  }).eq("id", jobId);

  await updateListCounters(db, job.list_id);

  return { ok: true, processed: processedCount, remaining: pendingCount || 0, done };
}

/**
 * Recomputes and persists aggregate list statistics to public.lists.
 */
async function updateListCounters(db, listId) {
  if (!db || !listId) return;
  try {
    const { data: records, error } = await db
      .from("list_records")
      .select("status")
      .eq("list_id", listId);
    if (error || !records) return;

    const total = records.length;
    const completed = records.filter((r) => r.status === "complete" || r.status === "partial").length;
    const failed = records.filter((r) => r.status === "failed").length;
    const needsReview = records.filter((r) => r.status === "needs_review").length;
    const isDone = completed + failed + needsReview >= total && total > 0;

    await db.from("lists").update({
      completed_records: completed,
      failed_records: failed,
      needs_review_records: needsReview,
      status: isDone ? "complete" : "running",
      updated_at: new Date().toISOString(),
    }).eq("id", listId);
  } catch (err) {
    console.error("[bulkStore] updateListCounters error:", err);
  }
}

/**
 * Initiates or retrieves an active enrichment job for an account list.
 * Safe fallback so user can always trigger enrichment without re-importing.
 */
export async function startJob(userId, listId, env = process.env) {
  if (ownerless(userId)) return NO_OWNER;
  if (!listId) return { ok: false, reason: "list_id_required", status: 400 };

  const db = serviceDb(env);
  if (!db) {
    const list = _localLists.get(listId);
    if (!list || list.user_id !== userId) return { ok: false, reason: "list_not_found", status: 404 };

    const activeJob = Array.from(_localJobs.values()).find(
      (j) => j.list_id === listId && j.user_id === userId && j.status !== "completed"
    );
    if (activeJob) return { ok: true, jobId: activeJob.id, total: activeJob.total_items };

    const records = Array.from(_localRecords.values()).filter((r) => r.list_id === listId);
    const uncompleted = records.filter((r) => r.status !== "complete" && r.status !== "partial");
    const toQueue = uncompleted.length > 0 ? uncompleted : records;

    const jobId = "job_" + Math.random().toString(36).slice(2, 10);
    const now = new Date().toISOString();

    toQueue.forEach((rec, idx) => {
      rec.status = "queued";
      const itemId = `item_${jobId}_${idx}`;
      _localJobItems.set(itemId, {
        id: itemId,
        job_id: jobId,
        record_id: rec.id,
        status: "queued",
        attempts: 0,
        created_at: now,
      });
    });

    _localJobs.set(jobId, {
      id: jobId,
      list_id: listId,
      user_id: userId,
      status: "queued",
      cursor: 0,
      total_items: toQueue.length,
      processed_items: 0,
      created_at: now,
    });

    list.status = "running";
    return { ok: true, jobId, total: toQueue.length };
  }

  const isOwner = await assertListOwner(listId, userId, env);
  if (!isOwner) return { ok: false, reason: "list_not_found", status: 404 };

  // Check if there is an existing non-completed job
  const { data: existingJobs } = await db
    .from("enrichment_jobs")
    .select("id, status, total_items")
    .eq("list_id", listId)
    .eq("user_id", userId)
    .neq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1);

  if (existingJobs && existingJobs.length > 0) {
    return { ok: true, jobId: existingJobs[0].id, total: existingJobs[0].total_items };
  }

  const { data: records, error: recErr } = await db
    .from("list_records")
    .select("id, status")
    .eq("list_id", listId);

  if (recErr || !records || records.length === 0) {
    return { ok: false, reason: "no_records_in_list", status: 400 };
  }

  const uncompleted = records.filter((r) => r.status !== "complete" && r.status !== "partial");
  const targetRecords = uncompleted.length > 0 ? uncompleted : records;

  const { data: newJob, error: jobErr } = await db
    .from("enrichment_jobs")
    .insert({
      list_id: listId,
      user_id: userId,
      status: "queued",
      total_items: targetRecords.length,
    })
    .select()
    .single();

  if (jobErr) return { ok: false, reason: jobErr.message, status: 500 };

  const targetIds = targetRecords.map((r) => r.id);
  await db.from("list_records").update({ status: "queued" }).in("id", targetIds);

  const itemsPayload = targetIds.map((recId) => ({
    job_id: newJob.id,
    record_id: recId,
    status: "queued",
  }));
  await db.from("enrichment_job_items").insert(itemsPayload);

  await db.from("lists").update({ status: "running" }).eq("id", listId);

  return { ok: true, jobId: newJob.id, total: targetRecords.length };
}

export async function getReviewQueue(userId, listId = null, env = process.env) {
  if (ownerless(userId)) return { ...NO_OWNER, items: [] };
  const db = serviceDb(env);
  if (!db) {
    const items = Array.from(_localReview.values()).filter(
      (r) => r.user_id === userId && (!listId || r.list_id === listId) && r.status === "pending"
    );
    return { ok: true, items };
  }

  let q = db.from("review_queue").select("*, list_records(canonical_domain)").eq("status", "pending");
  q = q.eq("user_id", userId);
  if (listId) q = q.eq("list_id", listId);

  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) return { ok: false, reason: error.message, items: [] };
  return { ok: true, items: data || [] };
}

export async function resolveReviewItem(userId, { reviewId, action, resolvedValue }, env = process.env) {
  if (ownerless(userId)) return NO_OWNER;
  const db = serviceDb(env);
  const now = new Date().toISOString();

  if (!db) {
    const item = _localReview.get(reviewId);
    if (!item || item.user_id !== userId) return { ok: false, reason: "item_not_found" };
    item.status = action === "reject" ? "rejected" : (action === "edit" ? "edited" : "accepted");
    item.resolved_value = resolvedValue || item.candidate_value;
    item.resolved_at = now;

    const rec = _localRecords.get(item.record_id);
    if (rec) {
      rec.status = "complete";
      if (resolvedValue) {
        rec.enriched_data[item.field_name] = resolvedValue;
      }
    }
    return { ok: true, item };
  }

  const { data: item, error: itemErr } = await db
    .from("review_queue")
    .update({
      status: action === "reject" ? "rejected" : (action === "edit" ? "edited" : "accepted"),
      resolved_value: resolvedValue,
      resolved_at: now,
    })
    .eq("id", reviewId)
    // Scoped by owner: the update used to match on id alone, so any signed-in
    // user could accept or reject another tenant's review items and write an
    // arbitrary `resolvedValue` into their enriched record.
    .eq("user_id", userId)
    .select()
    .single();

  if (itemErr || !item) return { ok: false, reason: itemErr?.message || "item_not_found" };

  await db.from("list_records").update({ status: "complete" }).eq("id", item.record_id);
  return { ok: true, item };
}
