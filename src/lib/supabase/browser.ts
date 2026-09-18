"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;
export function createBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase public credentials are not configured.");
  client ??= createClient(url, key);
  return client;
}

// Requires an authenticated operator and matching RLS policies before use.
export function subscribeToIncident(incidentId: string, onChange: () => void) {
  const supabase = createBrowserSupabase();
  const channel = supabase
    .channel(`incident:${incidentId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "events", filter: `incident_id=eq.${incidentId}` },
      onChange,
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
