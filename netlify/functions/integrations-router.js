// netlify/functions/integrations-router.js
//
// Dispatch router for the /api/integrations/* endpoints. Each provider
// (hubspot, notion, airtable, slack, zapier) has its own dedicated
// function; this router just looks at the first path segment and
// re-dispatches the event with the provider context set.
//
// Mounted at /api/integrations/* via netlify.toml.
//
// The ROUTES table is intentionally defensive: any provider that doesn't
// have its function file yet returns a 501 "not implemented" stub. That
// way we can ship incrementally without the router crashing on import.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

function notImplemented(provider) {
  return async () => ({
    statusCode: 501,
    headers: { "Content-Type": "application/json", ...CORS },
    body: JSON.stringify({
      error: `Integration "${provider}" is not yet implemented.`,
    }),
  });
}

async function loadHandler(provider) {
  try {
    switch (provider) {
      case "hubspot":   return (await import("./integrations-hubspot.js")).handler;
      case "zapier":    return (await import("./integrations-zapier.js")).handler;
      case "notion":    return (await import("./integrations-notion.js")).handler;
      case "airtable":  return (await import("./integrations-airtable.js")).handler;
      case "slack":     return (await import("./integrations-slack.js")).handler;
      default:          return null;
    }
  } catch (err) {
    console.warn(`[integrations-router] Failed to load ${provider}:`, err.message);
    return null;
  }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  // Resolve the sub-path from EITHER the query-string splat OR a path-segment
  // tail. The 2026-08-10 production fix switched netlify.toml from
  // `?splat=:splat` to `/:splat` (path-based) because the query-string form
  // wasn't being substituted correctly on per-provider explicit redirects.
  const splatFromQuery = event.queryStringParameters?.splat || "";
  const fnName = "/.netlify/functions/integrations-router";
  const tail = (event.path || "").startsWith(fnName)
    ? (event.path || "").slice(fnName.length).replace(/^\/+/, "")
    : "";
  const splat = splatFromQuery || tail;
  const segments = splat.split("/").filter(Boolean);
  const provider = segments[0];
  if (!provider) {
    // Defensive debug context — if this fires it means the redirect rule
    // `/api/integrations/*` was hit but didn't pass the splat. The 5
    // explicit per-provider rules in netlify.toml route around the router
    // for the current providers, so the wildcard should only catch unknown
    // providers (which would be a 501 not 400). Include the diagnostic
    // context so future failures are debuggable from the error string alone.
    console.warn(
      "[integrations-router] Missing provider — splat:",
      JSON.stringify(splat),
      "rawQuery:",
      JSON.stringify(event.queryStringParameters),
      "path:",
      event.path
    );
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json", ...CORS },
      body: JSON.stringify({
        error: `Missing provider. Use /api/integrations/{hubspot|zapier|notion|airtable|slack}/{...}. (splat=${JSON.stringify(splat)})`,
      }),
    };
  }
  const target = await loadHandler(provider);
  if (!target) {
    return notImplemented(provider)(event);
  }
  // Re-dispatch with the sub-path (everything after the provider segment).
  // The provider-specific handler also has a path-based fallback (commit
  // 87f5597), so we set BOTH the query (original form) AND rewrite event.path
  // to the provider function's path. Either form works; the dual-set means
  // the handler picks the right sub-path regardless of how Netlify routed
  // the original request.
  const subPath = segments.slice(1).join("/");
  const newEvent = {
    ...event,
    queryStringParameters: {
      ...(event.queryStringParameters || {}),
      splat: subPath,
    },
    path: `/.netlify/functions/integrations-${provider}${subPath ? "/" + subPath : ""}`,
  };
  return target(newEvent);
};

