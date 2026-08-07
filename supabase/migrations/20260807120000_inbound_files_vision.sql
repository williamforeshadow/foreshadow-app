-- Let the agent actually see what people upload.
--
-- Staging already downloads a file, puts the bytes in a private bucket and
-- hands the model an inbound_file_id. What the model never got was the
-- CONTENTS — formatInboundFilesForAgent renders a name, a type and a size, and
-- the system prompt told it to say plainly that it can't look inside. So a
-- photo of a leaking water heater arrived as the string "IMG_2671.jpeg" and the
-- best the agent could do was offer to file it somewhere.
--
-- The fix is one canonical RENDERABLE ARTIFACT per staged file, resolved once
-- and reused on every turn after:
--
--   images, PDFs   -> an Anthropic Files API id  (anthropic_file_id)
--   text-ish files -> extracted plain text       (vision_text)
--   everything else-> nothing, plus an honest reason (vision_note)
--
-- Resolving once is what makes this affordable. A file id is a UUID on the
-- wire, so a photo can stay visible for the whole conversation without
-- re-uploading three megabytes of base64 on every single turn.
--
-- The ORIGINAL bytes at storage_path are untouched and stay canonical. That is
-- what attachInboundFile.ts copies onto tasks and Property Knowledge, so a
-- HEIC photo still lands on the task as the HEIC the user actually took; the
-- derived JPEG exists only so the model can look at it, and is never stored.

alter table public.slack_inbound_files
  add column if not exists vision_status text not null default 'pending',
  add column if not exists anthropic_file_id text,
  add column if not exists vision_media_type text,
  add column if not exists vision_text text,
  add column if not exists vision_note text,
  add column if not exists vision_prepared_at timestamptz;

-- pending      nothing attempted yet. Every row that predates this migration
--              starts here and resolves lazily the first time it's needed, so
--              there is no backfill job to run.
-- ready        anthropic_file_id is live; send it as an image or a document.
-- text         vision_text holds the readable contents.
-- unsupported  we know we can never show this one. Terminal, never retried.
-- failed       transient (upload 5xx, decode blew up). Retried on next use.
alter table public.slack_inbound_files
  drop constraint if exists slack_inbound_files_vision_status_check;

alter table public.slack_inbound_files
  add constraint slack_inbound_files_vision_status_check
  check (vision_status in ('pending', 'ready', 'text', 'unsupported', 'failed'));

-- Lets a sweep find rows that never got prepared, without scanning the ones
-- that resolved cleanly. Partial so it stays small: in steady state almost
-- every row is 'ready', 'text' or 'unsupported'.
create index if not exists slack_inbound_files_vision_pending_idx
  on public.slack_inbound_files (created_at)
  where vision_status in ('pending', 'failed');

comment on column public.slack_inbound_files.anthropic_file_id is
  'Anthropic Files API id for the renderable artifact. Persistent - Anthropic files have no TTL, so this is also what has to be cleaned up when the row is deleted.';

comment on column public.slack_inbound_files.vision_media_type is
  'What we actually uploaded, which is not always mime_type: a HEIC row reads image/jpeg here because that is the form the model was given.';

comment on column public.slack_inbound_files.vision_note is
  'Why a file cannot be shown, phrased for the model to repeat verbatim to the user (e.g. "312 pages - too long to read"). Never a stack trace.';
