-- Push notifications V1: APNs device-token registry + per-type push preference.
--
-- Mirrors the notifications_v1 conventions (20260512130000_notifications_v1.sql):
-- service-role-only access, RLS enabled with no client policies. The iOS app
-- registers its APNs token through POST /api/device-tokens (server route backed
-- by the service role); the notification delivery path sends pushes directly to
-- Apple. `push_enabled` is the third delivery channel alongside the existing
-- in-app (native_enabled) and Slack (slack_enabled) toggles.

begin;

create table if not exists public.device_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       text not null references public.users(id) on delete cascade,
  platform      text not null default 'ios' check (platform in ('ios', 'android')),
  -- The APNs device token (hex). One row per physical device/install.
  token         text not null,
  -- Which APNs host the token is registered against. TestFlight / App Store
  -- builds are 'production' (api.push.apple.com); Xcode debug builds are
  -- 'sandbox' (api.sandbox.push.apple.com). The sender falls back to the
  -- other host on BadDeviceToken and updates this column.
  environment   text not null default 'production'
                  check (environment in ('production', 'sandbox')),
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (token)
);

create index if not exists device_tokens_user_idx
  on public.device_tokens (user_id);

alter table public.device_tokens enable row level security;

-- No client policies: the app reads/writes device tokens through the
-- service-role server route only, matching the notifications table.

alter table public.notification_preferences
  add column if not exists push_enabled boolean not null default true;

commit;
