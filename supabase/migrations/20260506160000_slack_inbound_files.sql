insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('slack-inbound-files', 'slack-inbound-files', false, 52428800, null)
on conflict (id) do update
set public = false,
    file_size_limit = 52428800,
    allowed_mime_types = null;

create table if not exists public.slack_inbound_files (
  id uuid primary key default gen_random_uuid(),
  slack_file_id text not null unique,
  slack_team_id text,
  slack_channel_id text not null,
  slack_message_ts text not null,
  slack_thread_ts text,
  slack_user_id text not null,
  app_user_id text references public.users(id) on delete set null,
  storage_bucket text not null default 'slack-inbound-files',
  storage_path text not null,
  name text not null,
  title text,
  mime_type text,
  file_type text not null check (file_type in ('image', 'video', 'document', 'other')),
  size_bytes bigint,
  consumed_at timestamptz,
  consumed_destination text,
  created_at timestamptz not null default now()
);

create index if not exists slack_inbound_files_app_user_created_idx
  on public.slack_inbound_files (app_user_id, created_at desc);

create index if not exists slack_inbound_files_message_idx
  on public.slack_inbound_files (slack_channel_id, slack_message_ts);
