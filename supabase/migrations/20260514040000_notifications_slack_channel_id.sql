-- Slack's chat.update requires the DM channel id (Dxxx), not the user id
-- (Uxxx) we pass to chat.postMessage. Capture and persist the channel id
-- returned in the postMessage response so we can edit the same DM later
-- (coalesce updates, "Mark as read" button click ack).

alter table public.notifications
  add column if not exists slack_channel_id text;
