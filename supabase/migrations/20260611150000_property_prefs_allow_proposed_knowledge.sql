-- The notification_property_preferences.type CHECK predates the third proposal
-- type, so opting a property into 'proposed_knowledge' was rejected at the DB.
-- Extend it to match PROPERTY_NOTIFICATION_TYPES.

begin;

alter table public.notification_property_preferences
  drop constraint if exists notification_property_preferences_type_check;

alter table public.notification_property_preferences
  add constraint notification_property_preferences_type_check
  check (type in ('proposed_task', 'proposed_reply', 'proposed_knowledge'));

commit;
