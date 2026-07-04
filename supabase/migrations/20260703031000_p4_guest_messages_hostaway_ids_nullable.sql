-- Multi-tenant P4: Hostaway-specific guest_messages id columns become nullable.
-- Hospitable rows use the generic source + external_message_id (prior migration);
-- they legitimately have no hostaway_message_id / hostaway_conversation_id.

alter table public.guest_messages alter column hostaway_message_id drop not null;
alter table public.guest_messages alter column hostaway_conversation_id drop not null;
