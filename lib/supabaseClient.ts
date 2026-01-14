import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Lazy initialization for client-side Supabase
let supabaseInstance: SupabaseClient | null = null;

// Fallback values for when env vars aren't properly embedded at build time
// TODO: Remove these fallbacks once Vercel env var issue is resolved
const FALLBACK_SUPABASE_URL = 'https://oybwoawidkryladoyyyf.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95YndvYXdpZGtyeWxhZG95eXlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI3MzIzMjAsImV4cCI6MjA2ODMwODMyMH0.xK7G8oEmf5L-8iJRw0LD1eqDbNCD3enYojQmRErffqM';

export function getSupabase(): SupabaseClient {
  if (!supabaseInstance) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY;
    
    // Log for debugging (remove after confirming it works)
    if (typeof window !== 'undefined') {
      console.log('Supabase init:', { 
        hasEnvUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        hasEnvKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        usingFallbackUrl: !process.env.NEXT_PUBLIC_SUPABASE_URL,
        usingFallbackKey: !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      });
    }
    
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey);
  }
  return supabaseInstance;
}

// For backward compatibility - lazy getter
export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    return (getSupabase() as any)[prop];
  }
});
