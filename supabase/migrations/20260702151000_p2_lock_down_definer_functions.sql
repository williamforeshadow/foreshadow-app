-- Multi-tenant P2 hardening: lock down anon-callable SECURITY DEFINER functions.
--
-- The security advisor flagged 3 SECURITY DEFINER functions in the exposed
-- `public` schema as executable by the `anon` role via /rest/v1/rpc/*. Supabase's
-- default privileges re-grant EXECUTE to anon/authenticated on new public
-- functions, which is why P0's `revoke ... from public` on app_current_user_orgs
-- did not remove anon's access.
--
-- * execute_dynamic_sql(text) — runs ARBITRARY SQL as the owner. Unused in the
--   codebase (its /api/sql-query route was removed). Anon-callable, this bypasses
--   ALL RLS. Revoke from everyone except service_role/owner.
-- * app_current_user_orgs() — the RLS helper. `authenticated` MUST keep EXECUTE
--   (policies call it); anon never hits those policies, so revoke anon.
-- * handle_new_user() — auth trigger fn; runs as the trigger, not via role grant,
--   so revoking direct RPC EXECUTE from anon is safe.

begin;

revoke execute on function public.execute_dynamic_sql(text) from public, anon, authenticated;
revoke execute on function public.app_current_user_orgs()   from anon;
revoke execute on function public.handle_new_user()         from public, anon;

commit;
