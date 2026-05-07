alter table public.project_comments
  drop constraint if exists project_comments_user_id_fkey;

alter table public.project_comments
  add constraint project_comments_user_id_fkey
  foreign key (user_id)
  references public.users(id)
  on delete cascade;
