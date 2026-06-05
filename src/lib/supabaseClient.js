// supabaseClient.js — initializes the Supabase client when env vars are present.
//
// Expects VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. If either is missing,
// `supabase` is null and the app gracefully falls back to localStorage (see
// extractionsRepo.js) so the UI stays fully interactive for demos.

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, hasSupabase } from "./config.js";

export const supabase = hasSupabase
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

export const isSupabaseEnabled = hasSupabase;

// Name of the table that stores extractions (see SQL in README.md).
export const EXTRACTIONS_TABLE = "extractions";
