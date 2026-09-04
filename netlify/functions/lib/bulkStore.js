// netlify/functions/lib/bulkStore.js — service-key data access for Bulk Account Intelligence (PRD 3).
//
// Manages lists, list_records, canonical_entities, icp_score_rules,
// enrichment_jobs, and review_queue.

import { createClient } from "@supabase/supabase-js";
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

export async function listLists(userId, env = process.env) {
  const db = serviceDb(env);
  if (!db) {
    const userLists = Array.from(_localLists.values()).filter((l) => !userId || l.user_id === userId);
    return { ok: true, lists: userLists };
  }

  let q = db.from("lists").select("*").order("created_at", { ascending: false });
  if (userId) q = q.eq("user_id", userId);

  const { data, error } = await q;
  if (error) return { ok: false, reason: error.message, lists: [] };
  return { ok: true, lists: data || [] };
}

export async function getList(listId, userId, env = process.env) {
  const db = serviceDb(env);
  if (!db) {
    const list = _localLists.get(listId);
    if (!list) return null;
    const records = Array.from(_localRecords.values()).filter((r) => r.list_id === listId);
    return { ...list, records };
  }

  let listQuery = db.from("lists").select("*").eq("id", listId);
  if (userId) listQuery = listQuery.eq("user_id", userId);

  const { data: listData, error: listError } = await listQuery.single();
  if (listError || !listData) return null;

  const { data: records, error: recError } = await db
    .from("list_records")
    .select("*")
    .eq("list_id", listId)
    .order("created_at", { ascending: true });

  return { ...listData, records: recError ? [] : records || [] };
}

export async function createList(userId, { name, description = "", domains = [], persona = "sales" }, env = process.env) {
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
      user_id: userId || "usr_demo",
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
      user_id: userId || "usr_demo",
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

  // Prefer user's custom rule for persona, fallback to default
  const { data, error } = await db
    .from("icp_score_rules")
    .select("*")
    .eq("persona", persona)
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
  return userRule || data[0];
}

export async function saveIcpRules(userId, { persona, name, criteria, threshold }, env = process.env) {
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
    .select("*, list_records(*)")
    .eq("job_id", jobId)
    .eq("status", "queued")
    .limit(25);

  if (itemsErr || !pendingItems || pendingItems.length === 0) {
    await db.from("enrichment_jobs").update({ status: "completed" }).eq("id", jobId);
    await db.from("lists").update({ status: "complete" }).eq("id", job.list_id);
    return { ok: true, processed: 0, remaining: 0, done: true };
  }

  const rules = await getIcpRules(job.user_id, "sales", env);

  for (const item of pendingItems) {
    if (Date.now() - startTime >= budgetMs) break;

    const rec = item.list_records;
    if (rec) {
      const domain = rec.canonical_domain || "domain.com";
      const isTech = domain.includes("tech") || domain.includes("io") || domain.includes("app") || domain.includes("stripe");
      const enriched = {
        company_name: domain.split(".")[0].toUpperCase(),
        industry: isTech ? "Software" : "Services",
        employee_count: 55,
        has_pricing: true,
        hq_country: "US",
      };

      const icp = evaluateIcp(enriched, rules.criteria, rules.threshold);
      const isReview = !isTech;
      const finalStatus = isReview ? "needs_review" : (icp.passed ? "complete" : "partial");

      await db.from("list_records").update({
        enriched_data: enriched,
        icp_score: icp.score,
        icp_reasons: icp.reasons,
        confidence_score: isReview ? 0.65 : 0.95,
        status: finalStatus,
        credits_used: 2,
        completed_at: new Date().toISOString(),
      }).eq("id", rec.id);

      if (isReview) {
        await db.from("review_queue").insert({
          record_id: rec.id,
          list_id: rec.list_id,
          user_id: job.user_id,
          field_name: "industry",
          candidate_value: enriched.industry,
          confidence: 0.65,
          status: "pending",
        });
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
    processed_items: job.processed_items + processedCount,
    status: done ? "completed" : "running",
  }).eq("id", jobId);

  return { ok: true, processed: processedCount, remaining: pendingCount || 0, done };
}

export async function getReviewQueue(userId, listId = null, env = process.env) {
  const db = serviceDb(env);
  if (!db) {
    const items = Array.from(_localReview.values()).filter(
      (r) => (!userId || r.user_id === userId) && (!listId || r.list_id === listId) && r.status === "pending"
    );
    return { ok: true, items };
  }

  let q = db.from("review_queue").select("*, list_records(canonical_domain)").eq("status", "pending");
  if (userId) q = q.eq("user_id", userId);
  if (listId) q = q.eq("list_id", listId);

  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) return { ok: false, reason: error.message, items: [] };
  return { ok: true, items: data || [] };
}

export async function resolveReviewItem(userId, { reviewId, action, resolvedValue }, env = process.env) {
  const db = serviceDb(env);
  const now = new Date().toISOString();

  if (!db) {
    const item = _localReview.get(reviewId);
    if (!item) return { ok: false, reason: "item_not_found" };
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
    .select()
    .single();

  if (itemErr || !item) return { ok: false, reason: itemErr?.message || "item_not_found" };

  await db.from("list_records").update({ status: "complete" }).eq("id", item.record_id);
  return { ok: true, item };
}
