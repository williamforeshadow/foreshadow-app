-- Let the inbound-file staging table hold web uploads, not just Slack ones.
--
-- slack_inbound_files was built when Slack was the only way to get a binary
-- into the agent: every row carried a Slack file id, channel, message ts and
-- user id, all NOT NULL. The in-app agent chat now stages files the same way
-- (POST /api/agent/attachments), and it has none of those — so the four
-- Slack-shaped columns become optional and a `source` column records which
-- surface put the row there.
--
-- The table keeps its name. Every consumer (the attach service, the
-- preview/commit tools, the compound attachment_inbound_file_ids paths) reads
-- it by that name, and a rename would buy nothing but churn.

alter table public.slack_inbound_files
  alter column slack_file_id drop not null,
  alter column slack_channel_id drop not null,
  alter column slack_message_ts drop not null,
  alter column slack_user_id drop not null;

-- slack_file_id stays UNIQUE — Postgres treats NULLs as distinct, so any
-- number of web rows coexist while Slack keeps its dedupe guarantee.

alter table public.slack_inbound_files
  add column if not exists source text not null default 'slack';

alter table public.slack_inbound_files
  drop constraint if exists slack_inbound_files_source_check;

alter table public.slack_inbound_files
  add constraint slack_inbound_files_source_check
  check (source in ('slack', 'web'));

-- Slack rows must still carry their Slack identity; only web rows may omit it.
alter table public.slack_inbound_files
  drop constraint if exists slack_inbound_files_slack_identity_check;

alter table public.slack_inbound_files
  add constraint slack_inbound_files_slack_identity_check
  check (
    source <> 'slack'
    or (
      slack_file_id is not null
      and slack_channel_id is not null
      and slack_message_ts is not null
      and slack_user_id is not null
    )
  );

-- Carry-forward lookup for the web surface: "this user's unconsumed uploads
-- from the last hour". The existing (app_user_id, created_at desc) index
-- covers the leading columns; this partial index keeps the unconsumed set
-- small and skips the consumed rows entirely.
create index if not exists slack_inbound_files_web_unconsumed_idx
  on public.slack_inbound_files (app_user_id, created_at desc)
  where consumed_at is null;
