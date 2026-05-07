alter table public.project_attachments
  drop constraint if exists project_attachments_uploaded_by_fkey;

alter table public.project_attachments
  add constraint project_attachments_uploaded_by_fkey
  foreign key (uploaded_by)
  references public.users(id)
  on delete set null;
