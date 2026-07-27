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
  const splat = event.queryStringParameters?.splat || "";
  const segments = splat.split("/").filter(Boolean);
  const provider = segments[0];
  if (!provider) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json", ...CORS },
      body: JSON.stringify({
        error: "Missing provider. Use /api/integrations/{hubspot|zapier|notion|airtable|slack}/{...}.",
      }),
    };
  }
  const target = await loadHandler(provider);
  if (!target) {
    return notImplemented(provider)(event);
  }
  // Re-dispatch with the splat trimmed of the provider segment. The
  // provider-specific handler reads subPath from event.queryStringParameters
  // .splat the same way it did when mounted directly.
  const newEvent = {
    ...event,
    queryStringParameters: {
      ...(event.queryStringParameters || {}),
      splat: segments.slice(1).join("/"),
    },
  };
  return target(newEvent);
};

