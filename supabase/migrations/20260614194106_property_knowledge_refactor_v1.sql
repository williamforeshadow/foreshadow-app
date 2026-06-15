-- Property Knowledge refactor v1
-- Rooms lose `type`; cards become `attributes` (multi-tag jsonb, no tag_data);
-- contacts get tags[]/schedule/preferences (drop fixed category); notes dropped.
-- Data loss is accepted. card_scope (interior/exterior) is shared by rooms +
-- attributes and is kept; the other single-use enums are dropped after their
-- columns/table are removed. Visibility + pending proposals are cleared because
-- their stored encodings/targets no longer parse under the new model.

-- 1. Rooms: drop the type dropdown
alter table public.property_rooms drop column if exists type;
drop type if exists public.room_type;

-- 2. Rename cards -> attributes (FKs/indexes/RLS follow the rename)
alter table public.property_cards rename to property_attributes;
alter table public.property_card_photos rename to property_attribute_photos;
alter table public.property_attribute_photos rename column card_id to attribute_id;

-- 3. Attributes: multi-tag, drop structured sub-fields + single tag enum column
alter table public.property_attributes drop column if exists tag_data;
alter table public.property_attributes drop column if exists tag;
drop type if exists public.card_tag;
alter table public.property_attributes add column if not exists tags jsonb not null default '[]'::jsonb;

-- 4. Contacts: drop fixed category; add multi-tag + schedule + owner preferences
alter table public.property_contacts drop column if exists category;
drop type if exists public.contact_category;
alter table public.property_contacts add column if not exists tags jsonb not null default '[]'::jsonb;
alter table public.property_contacts add column if not exists schedule text;
alter table public.property_contacts add column if not exists preferences text;

-- 5. Drop the Notes section entirely
drop table if exists public.property_notes cascade;
drop type if exists public.note_scope;

-- 6. Clear runtime data whose encoding no longer matches the new model
delete from public.property_knowledge_visibility;
delete from public.proposed_knowledge;
