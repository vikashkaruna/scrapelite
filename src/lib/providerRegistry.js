// providerRegistry.js — the ONE source of truth for every external provider
// DatIQ calls, which functional area each one serves, and what model it runs.
//
// PURE. Imported by BOTH the browser (/admin/ai) and the Netlify functions
// (aiProviders.js, scrapeProviders.js, admin-provider-test.js), exactly like
// entitlementModel.js and the discoverability scoring model — so the console
// an operator configures and the chain the server actually walks can never be
// two different lists.
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
// Before it, provider knowledge was scattered across four files that each knew
// a different subset: aiProviders.js knew the AI chain, scrapeProviders.js knew
// the scrape chain, webVitals.js knew PageSpeed, and healthProbes.js knew a
// hand-copied list of env var names. Nothing knew WHICH FEATURE a provider
// served, so an operator could not answer "if I turn this off, what breaks?"
// and the health dashboard could not say "AI is down" in terms of anything a
// user would notice. FUNCTION_AREAS below is that missing mapping.
//
// ── THE TIER SPLIT IS DELIBERATE ─────────────────────────────────────────────
// Every provider declares a `fast` and a `deep` model. Classification work
// (tagging 60 links) and synthesis work (writing a competitive brief from
// 20k characters of page text) have wildly different quality floors, and
// paying frontier prices for link-tagging is waste while paying flash prices
// for a brief is why the output reads like filler. Callers ask for a TIER,
// never a model id — see resolveModel() in aiProviders.js.

// ── Provider kinds ───────────────────────────────────────────────────────────
export const PROVIDER_KIND = {
  AI: "ai",         // language models
  SCRAPE: "scrape", // page fetch / render / map
  INTEL: "intel",   // auxiliary data APIs (measurements, not generation)
};

export const MODEL_TIER = {
  FAST: "fast", // classification, tagging, short structured pulls
  DEEP: "deep", // extraction from long text, synthesis, briefs, reports
};

// ── The catalogue ────────────────────────────────────────────────────────────
// `models.catalogue` is a SUGGESTION LIST for the admin picker, not a
// whitelist: model ids change faster than deploys, so the console always
// accepts a typed id too. `fast`/`deep` are the shipped defaults.
export const PROVIDERS = {
  // ── AI ─────────────────────────────────────────────────────────────────────
  gemini: {
    kind: PROVIDER_KIND.AI,
    label: "Google Gemini",
    keyEnv: "GEMINI_API_KEY",
    modelEnv: "GEMINI_MODEL",
    modelFastEnv: "GEMINI_MODEL_FAST",
    modelDeepEnv: "GEMINI_MODEL_DEEP",
    docsUrl: "https://aistudio.google.com/apikey",
    structured: true, // native responseSchema
    models: {
      // 🔴 EVERY ID THAT WAS HERE BEFORE IS DEAD, AND GOOGLE SAYS SO IN THE
      // ERROR. `gemini-2.0-flash`, `gemini-2.5-flash`, `gemini-2.5-pro` and
      // `gemini-2.5-flash-lite` all answer `:generateContent` with
      //   404 "This model is no longer available" / "no longer available to
      //        new users"
      // for the live key. The 2.x line is retired wholesale.
      //
      // ⚠️ AND THE MODEL LISTING LIES ABOUT IT. GET /v1beta/models returns 200
      // for gemini-2.5-flash and gemini-2.5-pro. Only a real generateContent
      // call reveals the retirement — so a health check that enumerates models
      // reports a fully retired provider as healthy. Do not "verify" these ids
      // against the listing; run scripts/verify-ai-models.mjs.
      //
      // The replacement naming drops the version pin in favour of a family
      // (`-latest`) or a post-2.x concrete id, which is what Google's own 404
      // tells you to use. Tier INTENT is what we are actually pricing on
      // (see MODEL_TIER: `fast` is a cost decision, `deep` a quality one), so
      // tracking the family is the honest encoding of that — pinning a
      // concrete id would just guarantee this file needs editing again the
      // next time Google rotates a line.
      fast: "gemini-3.8-flash",
      deep: "gemini-pro-latest",
      catalogue: ["gemini-3.8-flash", "gemini-flash-latest", "gemini-flash-lite-latest", "gemini-pro-latest"],
    },
  },
  anthropic: {
    kind: PROVIDER_KIND.AI,
    label: "Anthropic Claude",
    // 🔴 A `VITE_`-PREFIXED NAME CANNOT BE A SERVER KEY SOURCE. Vite inlines
    // every `VITE_*` var into the public browser bundle, so reading an
    // Anthropic key from one guarantees it ships to every visitor. The
    // registry used to list `VITE_AI_API_KEY` as the fallback for exactly
    // that reason ("local `netlify dev` only"), and the consequence was that a
    // live `sk-ant-api03-…` sat inside the shipped JS of a public stack.
    //
    // The two uses of one name are mutually exclusive by construction: a var
    // cannot be server-only and browser-visible at the same time.
    //
    // `ANTHROPIC_API_KEY` is now the preferred name, because it says which
    // vendor it is for. `AI_API_KEY` is kept second so every existing
    // deployment (staging, production) keeps resolving the same credential it
    // resolves today — changing the order alone must not be a key rotation.
    keyEnvList: ["ANTHROPIC_API_KEY", "AI_API_KEY"],
    modelEnv: "AI_MODEL",
    docsUrl: "https://console.anthropic.com/settings/keys",
    structured: true, // via forced tool use
    models: {
      fast: "claude-haiku-4-5-20251001",
      deep: "claude-sonnet-5",
      catalogue: ["claude-haiku-4-5-20251001", "claude-sonnet-5", "claude-opus-5", "claude-fable-5-1"],
    },
  },
  openai: {
    kind: PROVIDER_KIND.AI,
    label: "OpenAI",
    keyEnv: "OPENAI_API_KEY",
    modelEnv: "OPENAI_MODEL",
    docsUrl: "https://platform.openai.com/api-keys",
    structured: true, // native json_schema response_format
    models: {
      fast: "gpt-4o-mini",
      deep: "gpt-4o",
      catalogue: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
    },
  },
  perplexity: {
    kind: PROVIDER_KIND.AI,
    label: "Perplexity",
    keyEnv: "PERPLEXITY_API_KEY",
    modelEnv: "PERPLEXITY_MODEL",
    docsUrl: "https://www.perplexity.ai/settings/api",
    structured: false, // prose + citations; parsed loosely on purpose
    models: {
      fast: "sonar",
      deep: "sonar-pro",
      catalogue: ["sonar", "sonar-pro", "sonar-reasoning"],
    },
  },

  // ── Scrape ─────────────────────────────────────────────────────────────────
  firecrawl: {
    kind: PROVIDER_KIND.SCRAPE,
    label: "Firecrawl",
    keyEnv: "FIRECRAWL_API_KEY",
    keyEnvFallback: "VITE_FIRECRAWL_API_KEY",
    docsUrl: "https://firecrawl.dev/app/api-keys",
    // The ONLY provider that renders JS *and* returns main-content-isolated
    // HTML *and* does server-side prompt-driven JSON extraction. When it is
    // absent, every custom extraction falls to the AI chain — which is how a
    // dead AI account became a total enrichment outage rather than a
    // degradation. Keep it first in the chain.
    capabilities: ["render_js", "main_content", "structured_extract", "map"],
    requiresKey: true,
  },
  spider: {
    kind: PROVIDER_KIND.SCRAPE,
    label: "Spider.cloud",
    keyEnv: "SPIDER_API_KEY",
    docsUrl: "https://spider.cloud/account",
    capabilities: ["render_js", "map"],
    requiresKey: true,
  },
  jina: {
    kind: PROVIDER_KIND.SCRAPE,
    label: "Jina AI Reader",
    keyEnv: "JINA_API_KEY",
    docsUrl: "https://jina.ai/reader",
    // Markdown-first: excellent signal-to-noise for AI prompts, no map endpoint.
    capabilities: ["main_content"],
    requiresKey: false, // works unauthenticated at a lower rate limit
  },
  direct: {
    kind: PROVIDER_KIND.SCRAPE,
    label: "Direct fetch",
    keyEnv: null,
    docsUrl: null,
    // Raw HTML, no JS, no main-content isolation. The floor, not the default —
    // it belongs LAST so it catches what the paid providers could not, rather
    // than pre-empting them with the lowest-fidelity result available.
    capabilities: ["map"],
    requiresKey: false,
  },

  // ── Intel / measurement ────────────────────────────────────────────────────
  pagespeed: {
    kind: PROVIDER_KIND.INTEL,
    label: "Google PageSpeed Insights",
    keyEnv: "PAGESPEED_API_KEY",
    keyEnvFallback: "GOOGLE_PAGESPEED_KEY",
    docsUrl: "https://developers.google.com/speed/docs/insights/v5/get-started",
    // Keyless works at low volume; without a key the audit's LCP/INP/CLS
    // signals read "not measured" under any real load, which costs the
    // technical pillar its evidence coverage.
    requiresKey: false,
  },
};

export const PROVIDER_KEYS = Object.keys(PROVIDERS);

export const AI_PROVIDERS     = PROVIDER_KEYS.filter((k) => PROVIDERS[k].kind === PROVIDER_KIND.AI);
export const SCRAPE_PROVIDERS_LIST = PROVIDER_KEYS.filter((k) => PROVIDERS[k].kind === PROVIDER_KIND.SCRAPE);
export const INTEL_PROVIDERS  = PROVIDER_KEYS.filter((k) => PROVIDERS[k].kind === PROVIDER_KIND.INTEL);

// ── Functional areas ─────────────────────────────────────────────────────────
// "Which part of the product does this provider power?" Every area names its
// own default chain and default tier, and every one is independently
// overridable from /admin/ai. An area with no stored override runs the
// defaults declared here — which is what makes the console able to SHOW the
// effective setting even when nothing has ever been configured.
//
// ⚠️ Adding an area here is half the job: the calling site must pass the same
// id as `area` to runChain(), or the override silently does nothing. The
// `callsite` field records where that is, so the pair stays checkable.
export const FUNCTION_AREAS = {
  enrichment: {
    label: "Quick enrichment & custom extraction",
    kind: PROVIDER_KIND.AI,
    blurb: "Contacts, leadership, social links, mission, pricing, and any free-text custom extraction.",
    userVisibleAs: "Enrichment tabs on Preview, Home custom extraction, Batch enrichment",
    defaultOrder: ["gemini", "anthropic", "openai"],
    defaultTier: MODEL_TIER.DEEP,
    callsite: "netlify/functions/extract.js → extractStructuredWithAI()",
  },
  synthesis: {
    label: "Summaries, content & briefs",
    kind: PROVIDER_KIND.AI,
    blurb: "AI page summaries, generated content formats, template synthesis, and intelligence briefs.",
    userVisibleAs: "AI summary, Generate content, template reports, Visibility Brief",
    defaultOrder: ["anthropic", "gemini", "openai"],
    defaultTier: MODEL_TIER.DEEP,
    callsite: "netlify/functions/ai.js (area=synthesis) ← src/lib/aiService.js",
  },
  classification: {
    label: "Link tagging & classification",
    kind: PROVIDER_KIND.AI,
    blurb: "High-volume, low-judgement work. Runs on the fast tier on purpose — frontier pricing buys nothing here.",
    userVisibleAs: "Link category chips on Preview and Dashboard",
    defaultOrder: ["gemini", "openai", "anthropic"],
    defaultTier: MODEL_TIER.FAST,
    callsite: "netlify/functions/ai.js (area=classification) ← src/lib/aiService.js",
  },
  discoverability: {
    label: "Discoverability audit scoring",
    kind: PROVIDER_KIND.AI,
    blurb: "The SEO / AEO / GEO audit's AI evaluator. Runs under a hard deadline, so a slow provider costs coverage.",
    userVisibleAs: "/discoverability audit findings and executive summary",
    defaultOrder: ["gemini", "anthropic", "openai"],
    defaultTier: MODEL_TIER.FAST,
    callsite: "netlify/functions/lib/audit/aiEvaluator.js",
  },
  citations: {
    label: "AI answer-engine citation sampling",
    kind: PROVIDER_KIND.AI,
    blurb: "Asks a live retrieval engine what it says about a domain. Perplexity is preferred because it returns citation URLs.",
    userVisibleAs: "Citation evidence in the GEO pillar",
    defaultOrder: ["perplexity", "gemini"],
    defaultTier: MODEL_TIER.FAST,
    callsite: "netlify/functions/lib/audit/citationSampling.js",
  },
  scrape: {
    label: "Page fetch & render",
    kind: PROVIDER_KIND.SCRAPE,
    blurb: "The fallback chain that turns a URL into HTML. Order is quality-first: the cheapest provider is the LAST resort, not the first.",
    userVisibleAs: "Every extraction, batch run, schedule and audit",
    defaultOrder: ["firecrawl", "spider", "jina", "direct"],
    callsite: "netlify/functions/lib/scrapeProviders.js → runScrapeChain()",
  },
  map: {
    label: "Domain mapping",
    kind: PROVIDER_KIND.SCRAPE,
    blurb: "Discovers a site's URLs. Jina has no crawl endpoint and is skipped automatically.",
    userVisibleAs: "Map site intent on Home",
    defaultOrder: ["firecrawl", "spider", "direct"],
    callsite: "netlify/functions/lib/scrapeProviders.js → runMapChain()",
  },
  vitals: {
    label: "Core Web Vitals measurement",
    kind: PROVIDER_KIND.INTEL,
    blurb: "Field and lab performance data. Without a key this is rate-limited to the point of reading 'not measured'.",
    userVisibleAs: "LCP / INP / CLS signals in the technical pillar",
    defaultOrder: ["pagespeed"],
    callsite: "netlify/functions/lib/audit/webVitals.js",
  },
};

export const FUNCTION_AREA_KEYS = Object.keys(FUNCTION_AREAS);

/** Areas an AI chain override may be stored for (the `pillar`/`area` allowlist). */
export const AI_AREA_KEYS = FUNCTION_AREA_KEYS.filter(
  (k) => FUNCTION_AREAS[k].kind === PROVIDER_KIND.AI
);

/** Every area a given provider currently powers by default — the "if I disable this, what breaks?" answer. */
export function areasForProvider(providerKey) {
  return FUNCTION_AREA_KEYS.filter((a) => FUNCTION_AREAS[a].defaultOrder.includes(providerKey));
}

/** Env var names that may hold this provider's key, most-preferred first. */
export function keyEnvNames(providerKey) {
  const p = PROVIDERS[providerKey];
  if (!p) return [];
  // `keyEnvList` is the general form: a provider can legitimately accept more
  // than one name (ANTHROPIC_API_KEY preferred, AI_API_KEY kept for existing
  // deployments). `keyEnv`/`keyEnvFallback` remain the two-name shorthand.
  if (Array.isArray(p.keyEnvList) && p.keyEnvList.length) return p.keyEnvList.slice();
  if (!p.keyEnv) return [];
  return p.keyEnvFallback ? [p.keyEnv, p.keyEnvFallback] : [p.keyEnv];
}

/** Resolve a provider's key from an env-like object. Returns "" when unset. */
export function readKey(providerKey, env = {}) {
  for (const name of keyEnvNames(providerKey)) {
    const v = env[name];
    if (v) return String(v);
  }
  return "";
}

/** Default model id for a provider at a tier, honouring its model env override. */
export function defaultModel(providerKey, tier = MODEL_TIER.DEEP, env = {}) {
  const p = PROVIDERS[providerKey];
  if (!p || !p.models) return "";
  // Tier-specific env override takes precedence for that tier
  if (tier === MODEL_TIER.FAST && p.modelFastEnv && env[p.modelFastEnv]) {
    return String(env[p.modelFastEnv]);
  }
  if (tier === MODEL_TIER.DEEP && p.modelDeepEnv && env[p.modelDeepEnv]) {
    return String(env[p.modelDeepEnv]);
  }
  // A single *_MODEL env var pins BOTH tiers — it predates tiering and the
  // operator who set it meant "use exactly this", so it wins over the tier defaults.
  const pinned = p.modelEnv ? env[p.modelEnv] : "";
  if (pinned) return String(pinned);
  return p.models[tier] || p.models.deep || "";
}

/** Known-retired Gemini model IDs that Google returns 404 for (2.x preview/experimental and early retired). */
export const RETIRED_GEMINI_MODELS = new Set([
  "gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-2.0-flash-exp",
  "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro",
]);

/** Check whether a model id is a retired Gemini model. */
export function isRetiredGeminiModel(name) {
  if (!name || typeof name !== "string") return false;
  return RETIRED_GEMINI_MODELS.has(name) || /^gemini-2\.[05]-/.test(name);
}
