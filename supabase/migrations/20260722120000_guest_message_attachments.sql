-- Photos and files exchanged in a conversation, re-hosted so they persist.
--
-- Hostaway returns attachments on a message in two fields: `imagesUrls` (which
-- 403 — permanently private) and `attachments[]`, whose `url` works but is a
-- presigned S3 link that expires within the hour. Neither can be stored and
-- rendered later. So capture downloads each presigned attachment at ingest and
-- re-hosts it in our own bucket; from then on it's our file and lives as long as
-- the message does. (See src/server/messages/attachments.ts.)
--
-- The stored form is a jsonb array on the message rather than a side table: a
-- message's attachments are only ever read alongside the message, there are very
-- few of them (~1% of messages, usually one image), and this keeps the read path
-- a plain `select *` with no join and no new RLS surface to arm. Each element:
--   {
--     "hostaway_attachment_id": "19890915",  -- dedupe key; skip re-download
--     "name": "IMG_2671.jpeg",
--     "mime_type": "image/png",
--     "file_type": "image|video|document|other",
--     "size_bytes": 171854,
--     "storage_path": "org/<uuid>/conv/<id>/msg/<id>/<attId>-<name>"
--   }
-- The row stores a storage PATH, never a URL — the bucket is private and the
-- read route mints a short-lived signed URL per view.
alter table public.guest_messages
  add column if not exists attachments jsonb;

-- Private bucket, mirroring slack-inbound-files: guest-sent photos can carry
-- personal data (IDs, receipts, damage), so nothing is world-readable. Uploads
-- and signed-URL minting both run on the service role, which bypasses storage
-- RLS, so no per-object policy is needed here. 25MB cap — messaging-channel
-- attachments are small, and the capture layer enforces the same limit.
insert into storage.buckets (id, name, public, file_size_limit)
values ('guest-message-attachments', 'guest-message-attachments', false, 26214400)
on conflict (id) do nothing;
