-- Concierge tool master switches: per-tool on/off control for the guest-facing
-- concierge's read-only toolset (property-knowledge lookup, availability check,
-- alternative-property search). Stored as a jsonb map { tool_name: boolean } on
-- the operations_settings singleton (id=1), alongside the capability flags and
-- sensitivity dials.
--
-- Semantics: a tool is ENABLED unless its key is explicitly false. An empty {}
-- (the default) therefore means "every tool on", preserving today's behavior.
-- jsonb (not three booleans) so new concierge tools don't each need a migration.

begin;

alter table public.operations_settings
  add column if not exists concierge_tool_settings jsonb not null default '{}'::jsonb;

commit;
