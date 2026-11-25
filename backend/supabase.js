import { createClient } from "@supabase/supabase-js";
import ws from "ws";

export function createSupabaseBackend() {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !secretKey) {
    throw new Error("Missing env vars: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  });
}
