// server/src/db/supabase.ts — optional Supabase persistence (spec §9.1)
// Plug in when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set.
export const supabaseEnabled = !!process.env.SUPABASE_URL;

export async function saveMatch(_match: any) {
  if (!supabaseEnabled) return;
  // TODO: insert into matches, match_events tables
}

export async function getLeaderboard() {
  if (!supabaseEnabled) return [];
  return [];
}
