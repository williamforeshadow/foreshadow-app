import { createClient } from '@supabase/supabase-js';

// Lazy initialization to avoid build-time errors when env vars aren't available
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabaseServer: any = null;

export function getSupabaseServer() {
  if (!supabaseServer) {
    supabaseServer = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return supabaseServer;
}
