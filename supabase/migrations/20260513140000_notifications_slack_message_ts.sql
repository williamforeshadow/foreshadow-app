-- Store the Slack DM message id so we can chat.update the same DM when a
-- notification is coalesced within the recent-window or when the recipient
-- clicks the in-Slack "Mark as read" button.

alter table public.notifications
  add column if not exists slack_message_ts text;
