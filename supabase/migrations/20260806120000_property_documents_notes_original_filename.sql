-- Add the two property_documents columns the code has always assumed existed.
--
-- `property_documents` predates this migrations folder and was created without
-- `notes` or `original_filename`, but every code path that touches it reads or
-- writes both:
--
--   app/api/properties/[id]/documents/route.ts        UI upload (INSERT)
--   app/api/properties/[id]/documents/[docId]/route.ts UI edit + delete
--   app/properties/[id]/knowledge/documents/page.tsx   renders a notes editor,
--                                                      displays the filename
--   src/server/properties/propertyKnowledge.ts         the read behind
--                                                      get_property_knowledge
--   src/server/properties/propertyKnowledgeWrite.ts    agent doc metadata
--   src/server/slack/attachInboundFile.ts              agent file attachment
--
-- So this was never a working feature: the table has zero rows, and every
-- insert has been failing with PostgREST's "Could not find the 'notes' column
-- of 'property_documents' in the schema cache". The agent path is simply where
-- it finally surfaced — the READ soft-fails (propertyKnowledge.ts returns
-- `documents: []` plus a warning rather than throwing), so the Documents
-- section has just looked permanently empty instead of broken.
--
-- Adding the columns rather than stripping them from the code is deliberate:
-- the UI is built around both. The documents page has an inline notes textarea
-- wired to PATCH, and shows original_filename beneath each title.
--
-- Both nullable, no backfill — there are no rows to backfill.

begin;

alter table public.property_documents
  add column if not exists notes text;

-- The file's name as uploaded. `title` is an optional human label, so without
-- this there is nothing to show for a document nobody bothered to title.
alter table public.property_documents
  add column if not exists original_filename text;

commit;
