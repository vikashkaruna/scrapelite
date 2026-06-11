// Netlify Function — GET /api/stats
// Returns aggregate usage stats (teams, extractions) from Supabase usage_records.
// Falls back to { teams: null, extractions: null } when Supabase is not configured.
// Response is cached by CDN for 5 minutes.

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=300",
};

function respond(data) {
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify(data) };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: HEADERS, body: "" };
  }

  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const supabaseKey =
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    "";

  if (!supabaseUrl || !supabaseKey) {
    return respond({ teams: null, extractions: null });
  }

  try {
    // Direct REST call — avoids bundling the Supabase SDK in this function.
    const res = await fetch(
      `${supabaseUrl}/rest/v1/usage_records?select=session_id,extractions`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!res.ok) return respond({ teams: null, extractions: null });

    const records = await res.json();
    if (!Array.isArray(records)) return respond({ teams: null, extractions: null });

    const teams = new Set(records.map((r) => r.session_id)).size;
    const extractions = records.reduce((sum, r) => sum + (r.extractions || 0), 0);

    return respond({ teams, extractions });
  } catch {
    return respond({ teams: null, extractions: null });
  }
};
