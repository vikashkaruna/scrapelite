// Netlify Function — multi-provider AI proxy with ordered fallback.
//
// POST /api/ai
//   Body: { model?, max_tokens?, messages: Array<{role, content}> }
//   Response: Anthropic-shaped { content: [{ type:"text", text }] }
//
// The chain is resolved server-side from admin-managed config (Supabase
// app_config 'ai' row) over the shared registry defaults — see
// lib/aiProviders.js and src/lib/providerRegistry.js. Provider keys stay
// server-side. The client-sent `model` is IGNORED (per-provider models come
// from config); `max_tokens`, `messages`, and now `area` are honored.
//
// `area` names the FUNCTION AREA this call belongs to (synthesis,
// classification, …). It selects an independently configurable chain and
// model tier, so writing a competitive brief and tagging 60 links stop
// sharing one model. It is validated against the allowlist — an unknown area
// falls back to the global chain rather than being rejected, because a client
// that is one deploy behind must not lose AI entirely.
//
// A failure returns a machine-readable `code` (no_credit / bad_key /
// rate_limited / …) and NOTHING ELSE. The browser used to see only a 502 and
// silently substituted locally-generated placeholder text, so a dead provider
// account looked exactly like a working one — hence the code.
//
// ⚠️ The code is all a customer gets. No `hint`, no provider names, no vendor
// error text, no attempt list: this endpoint is reachable by every signed-in
// user and by /api/v1 key holders, and "Your credit balance is too low to
// access the Anthropic API" is our billing state, not theirs. The full
// diagnosis goes to the server log and to the admin-gated endpoints. See
// lib/aiFailure.js.

import { runChain, keyPresence } from "./lib/aiProviders.js";
import { publicFailure, logChainFailure } from "./lib/aiFailure.js";
import { AI_AREA_KEYS, MODEL_TIER } from "../../src/lib/providerRegistry.js";
import { DENY_STATUS, denyBody, resolveRequestEntitlement, checkCapability } from "./lib/requireEntitlement.js";
import { peekGuestCredit } from "./lib/guestUsage.js";
import { meterContext, flush as flushMeter } from "./lib/creditMeter.js";
import { buildWorkspaceCtx } from "./lib/workspaceContext.js";
import { createDeadline } from "./lib/audit/deadline.js";

const MAX_MESSAGES = 50;
// Raised from 20k/100k. The old ceiling predates sending page BODY text: a
// link-heavy page's summary prompt could exceed 20k characters on its own,
// which returned 400 → the browser caught it → the user silently got
// fabricated placeholder prose. The limits exist to bound abuse, not to
// bound legitimate page content.
const MAX_MESSAGE_CHARS = 120_000;
const MAX_TOTAL_CHARS = 200_000;
const MAX_TOKENS = 8192;

function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) return null;
  let total = 0;
  const out = [];
  for (const message of messages) {
    if (!message || !["system", "user", "assistant"].includes(message.role)) return null;
    let content = message.content;
    if (Array.isArray(content)) {
      if (content.some((block) => !block || block.type !== "text" || typeof block.text !== "string")) return null;
      content = content.map((block) => ({ type: "text", text: block.text }));
      if (content.some((block) => block.text.length > MAX_MESSAGE_CHARS)) return null;
      total += content.reduce((n, block) => n + block.text.length, 0);
    } else if (typeof content === "string") {
      if (content.length > MAX_MESSAGE_CHARS) return null;
      total += content.length;
    } else return null;
    out.push({ role: message.role, content });
  }
  return total <= MAX_TOTAL_CHARS ? out : null;
}


// ── WALL-CLOCK BUDGET ───────────────────────────────────────────────────────
//
// `runChain` is a SERIAL fallback over three providers and, until now, this
// endpoint passed it no signal — so its cost was unbounded on a Netlify
// function killed at 10s. The discoverability audit fixed exactly this shape
// for its own AI calls (deadline.js names "runChain had no timeout at any
// layer" as one of the three causes of that 504) and /api/extract was budgeted
// for its scrape chain, but this endpoint kept the original defect.
//
// It matters most for TEMPLATE RUNS, which the client orchestrates: a run is
// 2-4 scrapes plus 1-2 calls to THIS endpoint. When the platform wins the race
// it answers with an HTML error page rather than JSON, so apiClient falls
// through to the generic "(504) problem on our side" copy instead of anything
// naming the real limit. Observed on both a hard target (notion.so) and our own
// prerendered site (datiq.app) — which is what rules out a slow scrape.
//
// Sized for the STOCK 10s timeout, deliberately, in the same conservative
// direction AUDIT_BUDGET_MS documents: the function timeout is site
// configuration no code can read, and guessing high reinstates the 504. Raise
// the timeout to 26s on Netlify and set AI_BUDGET_MS=20000.
const DEFAULT_AI_BUDGET_MS = 8_000;

function aiBudgetMs(env = process.env) {
  const raw = Number(env.AI_BUDGET_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_AI_BUDGET_MS;
  // Floor of 3s: below that no provider answers and every call is a timeout,
  // which reads as a dead product rather than a tight budget.
  return Math.max(3_000, Math.min(120_000, Math.round(raw)));
}

function respond(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return respond(405, { error: "Method not allowed" });
  }

  let reqBody;
  try {
    reqBody = JSON.parse(event.body || "{}");
  } catch {
    return respond(400, { error: "Invalid JSON body" });
  }

  const { max_tokens, messages, workspaceId, area: rawArea, tier: rawTier, meterScope } =
    reqBody && typeof reqBody === "object" ? reqBody : {};
  // Unknown area → global chain, never a rejection. A stale client must
  // degrade to the default, not lose AI.
  const area = AI_AREA_KEYS.includes(rawArea) ? rawArea : undefined;
  const tier = (rawTier === MODEL_TIER.FAST || rawTier === MODEL_TIER.DEEP) ? rawTier : undefined;

  const safeMessages = normalizeMessages(messages);
  if (!safeMessages) {
    return respond(400, { error: "messages array is required" });
  }
  if (max_tokens != null && (!Number.isInteger(max_tokens) || max_tokens < 1 || max_tokens > MAX_TOKENS)) {
    return respond(400, { error: `max_tokens must be an integer between 1 and ${MAX_TOKENS}` });
  }

  // Subscription gate — AI enrichment is a paid capability and must stop for a
  // lapsed subscriber. Signed-in users only; guests are unaffected. Fails OPEN
  // on infrastructure error (see lib/requireEntitlement.js).
  let verifiedUserId = null;
  try {
    const resolved = await resolveRequestEntitlement(event);
    verifiedUserId = resolved?.userId || null;
    const { ctx, refusal } = await buildWorkspaceCtx(resolved, workspaceId);
    if (refusal) return respond(403, { error: refusal.message, code: refusal.code });
    const check = checkCapability(resolved, "ai", ctx);
    if (!check.allowed) return respond(DENY_STATUS, denyBody(check));
  } catch (err) {
    console.warn("[DatIQ] entitlement check errored (failing open):", err.message);
  }

  // No provider has a key → behave like the old "not configured" path (503) so
  // aiService.js falls back to its local mock content.
  const present = keyPresence();
  if (!Object.values(present).some(Boolean)) {
    // Generic prose + the code. An operator reads the real cause in
    // /admin/ai; a customer can act on neither wording, so they get the one
    // that discloses nothing.
    return respond(503, { error: "AI is temporarily unavailable.", code: "no_key" });
  }

  // ── L0b: A GUEST REACHED THIS ENDPOINT FOR FREE, WITHOUT LIMIT ──────────
  //
  // The gate above is explicitly "signed-in users only; guests are
  // unaffected", which was true and was the leak: /api/ai is a real provider
  // call, and an anonymous caller could make it as many times as they liked.
  //
  // 🔴 IT CHECKS THE BUCKET, IT DOES NOT SPEND FROM IT.
  // One extraction from the browser is /api/extract — which charges a guest
  // credit — PLUS a /api/ai call for the summary and often another for link
  // tagging. Consuming here as well would have taken a guest from ten
  // extractions to three or four, silently, while GuestTrialBanner went on
  // advertising ten. A read closes the leak exactly (once the ten credits are
  // gone, this endpoint stops too) without charging one extraction twice.
  //
  // ⚠️ FAILS OPEN on anything undeterminable — no cookie, no row, no database
  // — and closed only on a count at or over the limit. "No account" is a
  // known state with a known bucket; an unreachable Supabase is not.
  const guestUsage = await peekGuestCredit(event, "single", { verifiedUserId });
  if (!guestUsage.allowed) {
    return respond(429, {
      error: "You've used your free AI requests. Sign in to continue — it's free and takes a moment.",
      code: guestUsage.reason || "single_limit_reached",
      remaining: 0,
    });
  }

  // `suppressed` when the caller declares this request is part of a template
  // run: templates.js owns the ledger for template runs via their finish
  // events, so a choke-point charge here would bill the same synthesis twice.
  // See meterContext's `suppressed` note in lib/creditMeter.js.
  const meter = meterContext({
    caller: "api-ai", userId: verifiedUserId, suppressed: meterScope === "template_run",
  });
  // Single exit below this line so no return path can forget the charge.
  // No Set-Cookie here: the peek above never mints an identity, because
  // /api/extract owns that and a second minter would hand the same browser
  // two identities and two fresh buckets.
  const reply = async (statusCode, body) => {
    await flushMeter(meter);
    return respond(statusCode, body);
  };

  // Budgeted from the REQUEST, not from the chain: entitlement resolution and
  // the workspace lookup above have already spent real wall clock, and a budget
  // that ignores it is a budget that still overruns.
  const deadline = createDeadline(aiBudgetMs());
  const slice = deadline.signalFor(deadline.remaining());

  try {
    const result = await runChain(safeMessages, max_tokens, { area, tier, signal: slice?.signal, meter });
    if (!result.ok) {
      // Our own clock, named as ours. Distinguished from a provider fault so an
      // operator reads "raise the budget" instead of hunting a key or a bill,
      // and so the customer is never told their request was the problem.
      // The slice aborts BEFORE the deadline expires — sliceFor() holds back a
      // reserve so there is room to answer — so `expired()` alone misses it and
      // the honest 504 degrades to a generic 502. The abort flag is ours by
      // construction: we own the controller that set it.
      if (slice?.signal.aborted || deadline.expired()) {
        logChainFailure("/api/ai (timeout)", result);
        return reply(504, {
          error: "This took too long to answer. This is a limit on our side — try again shortly.",
          code: "ai_timeout",
        });
      }
      // The full diagnosis goes to the LOG (an operator surface) and the code
      // alone goes to the caller. `detail.attempts` used to travel here
      // carrying each vendor's own error prose.
      logChainFailure("/api/ai", result);
      return reply(502, { error: "AI is temporarily unavailable.", ...publicFailure(result) });
    }
    // Normalize to the Anthropic messages shape the browser already parses.
    return reply(200, {
      content: [{ type: "text", text: result.text }],
      _provider: result.provider,
      _model: result.model,
      _tier: result.tier,
      _area: area || null,
    });
  } catch (err) {
    if (err?.name === "AbortError" || slice?.signal.aborted || deadline.expired()) {
      return reply(504, {
        error: "This took too long to answer. This is a limit on our side — try again shortly.",
        code: "ai_timeout",
      });
    }
    return reply(502, { error: `Upstream fetch failed: ${err.message}` });
  } finally {
    slice?.clear();
  }
};
