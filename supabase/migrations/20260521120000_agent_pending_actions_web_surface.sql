-- Allow web-surface pending actions so the in-app chat can render durable
-- Confirm/Cancel buttons, mirroring the Slack flow. Web rows carry no Slack
-- channel/user, so those columns become nullable; access control for web
-- rows falls back to requester_app_user_id.
alter table public.agent_pending_actions
  drop constraint if exists agent_pending_actions_surface_check;
alter table public.agent_pending_actions
  add constraint agent_pending_actions_surface_check
  check (surface in ('slack', 'web'));

alter table public.agent_pending_actions
  alter column slack_channel_id drop not null;
alter table public.agent_pending_actions
  alter column slack_user_id drop not null;

create index if not exists agent_pending_actions_web_lookup_idx
  on public.agent_pending_actions (requester_app_user_id, status, expires_at);
