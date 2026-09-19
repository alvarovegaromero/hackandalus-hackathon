// OWNER: P4 durable dispatch attempts, callbacks and coordinator wakeups.
import "server-only";
import { createServerSupabase } from "../supabase/server";
import type { DispatchRpc } from "./contracts";

export const dispatchRpc: DispatchRpc = async (kind, data) => {
  const result = await createServerSupabase().rpc("resource_dispatch", {
    p_kind: kind,
    p_data: data,
  });
  if (result.error || !result.data) throw new Error("Dispatch persistence unavailable.");
  return result.data;
};
