alter table public.property_knowledge_activity_log
  drop constraint if exists property_knowledge_activity_log_user_id_fkey;

alter table public.property_knowledge_activity_log
  add constraint property_knowledge_activity_log_user_id_fkey
  foreign key (user_id)
  references public.users(id)
  on delete set null;
