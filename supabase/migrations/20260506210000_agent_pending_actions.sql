create table if not exists public.agent_pending_actions (
  id uuid primary key default gen_random_uuid(),
  surface text not null default 'slack' check (surface in ('slack')),
  action_kind text not null check (
    action_kind in (
      'create_task',
      'property_knowledge_write',
      'slack_file_attachment'
    )
  ),
  status text not null default 'pending' check (
    status in (
      'pending',
      'processing',
      'committed',
      'cancelled',
      'failed',
      'expired'
    )
  ),
  requester_app_user_id text references public.users(id) on delete set null,
  slack_team_id text,
  slack_channel_id text not null,
  slack_thread_ts text,
  slack_message_ts text,
  slack_user_id text not null,
  canonical_input jsonb not null,
  preview jsonb not null,
  result jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  resolved_at timestamptz
);

create index if not exists agent_pending_actions_slack_lookup_idx
  on public.agent_pending_actions (
    slack_user_id,
    slack_channel_id,
    slack_thread_ts,
    status,
    expires_at
  );

create index if not exists agent_pending_actions_status_expires_idx
  on public.agent_pending_actions (status, expires_at);
