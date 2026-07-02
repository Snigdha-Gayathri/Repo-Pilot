import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anon) {
  // eslint-disable-next-line no-console
  console.warn("Supabase env vars missing — analysis features will not work.");
}

export const supabase = createClient(url ?? "", anon ?? "", {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const EDGE_URL = `${url}/functions/v1/repilot`;
