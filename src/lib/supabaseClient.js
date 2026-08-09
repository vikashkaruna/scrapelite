// supabaseClient.js — initializes the Supabase client when env vars are present.
//
// Expects VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. If either is missing,
// `supabase` is null and the app gracefully falls back to localStorage (see
// extractionsRepo.js) so the UI stays fully interactive for demos.

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, hasSupabase } from "./config.js";

// `flowType: 'pkce'` is the modern Supabase auth flow. The legacy default
// is `'implicit'`, which makes Supabase redirect back to the app with the
// session tokens in the URL HASH (e.g. `datiq.app/#access_token=eyJ...`).
// PKCE instead returns a short-lived `?code=...` in the query string and
// the client exchanges it for tokens locally — no tokens in the URL bar.
//
// We also pass `flowType: 'pkce'` and an explicit `detectSessionInUrl: true`
// so the auto-init that runs on first auth call (see GoTrueClient._initialize)
// picks up the callback regardless of which flow the upstream Supabase
// server prefers. The auth provider is now Supabase's hosted auth at
// `api.datiq.app`, which historically defaulted to implicit; PKCE works
// with either, and is the right default going forward.
//
// See: src/components/AuthProvider.jsx — cleans the hash defensively for
// the legacy implicit case where the URL still has tokens in the fragment.
export const supabase = hasSupabase
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        flowType: "pkce",
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;

export const isSupabaseEnabled = hasSupabase;

// Name of the table that stores extractions (see SQL in README.md).
export const EXTRACTIONS_TABLE = "extractions";
