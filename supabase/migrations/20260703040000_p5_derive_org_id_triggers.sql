-- Multi-tenant P5 (correctness): derive org_id from parent FKs + fix handle_new_user.
--
-- Prepares to drop the org-1 org_id DEFAULT (next migration). A generic
-- BEFORE INSERT trigger fills a NULL org_id from the row's parent FK, so shared
-- helpers / agent tools / DB functions that don't set org_id still land in the
-- correct org (and a truly parent-less row fails loudly instead of leaking to
-- org 1). Explicit org_id always wins (trigger early-returns when it's set), so
-- the bulk sync/ingest paths that already set org_id skip the lookup.

begin;

create or replace function public.derive_org_id()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  parent_table text := TG_ARGV[0];
  fk_col text := TG_ARGV[1];
  fk_val text;
  derived uuid;
begin
  if NEW.org_id is not null then return NEW; end if;
  fk_val := to_jsonb(NEW) ->> fk_col;
  if fk_val is null or fk_val = '' then return NEW; end if;
  execute format('select org_id from public.%I where id::text = $1', parent_table)
    into derived using fk_val;
  if derived is not null then NEW.org_id := derived; end if;
  return NEW;
end$$;

-- Attach the derivation to each child table. Multiple entries per table are
-- fallbacks (each only fills a still-null org_id); trigger order is alpha by
-- name, so the earlier-listed FK wins when several are present.
do $$
declare
  spec text; parts text[]; tbl text; fk text; parent text; trg text;
  specs text[] := array[
    'calendar_blocks:property_id:properties',
    'notification_property_preferences:property_id:properties',
    'property_access:property_id:properties',
    'property_attributes:property_id:properties',
    'property_connectivity:property_id:properties',
    'property_contacts:property_id:properties',
    'property_documents:property_id:properties',
    'property_knowledge_activity_log:property_id:properties',
    'property_knowledge_visibility:property_id:properties',
    'property_listings:property_id:properties',
    'property_projects:property_id:properties',
    'property_rooms:property_id:properties',
    'property_tech_accounts:property_id:properties',
    'property_templates:property_id:properties',
    'proposed_knowledge:property_id:properties',
    'proposed_tasks:property_id:properties',
    'turnover_tasks:property_id:properties',
    'concierge_training_properties:property_id:properties',
    'conversations:property_id:properties',
    'reservations:property_id:properties',
    'turnover_tasks:reservation_id:reservations',
    'conversations:reservation_id:reservations',
    'guest_messages:reservation_id:reservations',
    'guest_messages:conversation_id:conversations',
    'proposed_knowledge:conversation_id:conversations',
    'proposed_tasks:conversation_id:conversations',
    'task_assignments:task_id:turnover_tasks',
    'project_attachments:task_id:turnover_tasks',
    'project_comments:task_id:turnover_tasks',
    'project_time_entries:task_id:turnover_tasks',
    'project_activity_log:project_id:property_projects',
    'project_assignments:project_id:property_projects',
    'project_attachments:project_id:property_projects',
    'project_comments:project_id:property_projects',
    'project_time_entries:project_id:property_projects',
    'project_views:project_id:property_projects',
    'agent_pending_actions:requester_app_user_id:users',
    'device_tokens:user_id:users',
    'notification_preferences:user_id:users',
    'notifications:user_id:users',
    'project_bins:created_by:users',
    'project_views:user_id:users',
    'slack_inbound_files:app_user_id:users',
    'user_departments:user_id:users',
    'concierge_training_examples:training_id:concierge_training',
    'automation_deliveries:automation_id:automations',
    'property_attribute_photos:attribute_id:property_attributes',
    'property_room_photos:room_id:property_rooms',
    'property_tech_account_photos:account_id:property_tech_accounts'
  ];
begin
  foreach spec in array specs loop
    parts := string_to_array(spec, ':');
    tbl := parts[1]; fk := parts[2]; parent := parts[3];
    trg := format('trg_derive_org_%s_%s', tbl, fk);
    execute format('drop trigger if exists %I on public.%I', trg, tbl);
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public.derive_org_id(%L, %L)',
      trg, tbl, parent, fk);
  end loop;
end $$;

-- handle_new_user: no more hardcoded org-1/staff. Only auto-create a profile
-- when the signup carries an org_id (invite flow); new-org signups create their
-- profile via the onboarding flow. Removes the "every signup lands in org 1"
-- landmine ahead of self-serve.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.raw_user_meta_data ? 'org_id' then
    insert into public.users (id, email, name, role, org_id)
    values (
      NEW.id::text,
      NEW.email,
      coalesce(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
      coalesce(NEW.raw_user_meta_data->>'role', 'staff'),
      (NEW.raw_user_meta_data->>'org_id')::uuid
    );
  end if;
  return NEW;
end$$;

commit;
