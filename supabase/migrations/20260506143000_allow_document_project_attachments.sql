alter table public.project_attachments
  drop constraint if exists project_attachments_file_type_check;

alter table public.project_attachments
  add constraint project_attachments_file_type_check
  check (file_type in ('image', 'video', 'document'));

comment on constraint project_attachments_file_type_check
  on public.project_attachments
  is 'Allows task/project attachments to be images, videos, or documents. Document rendering is keyed by mime_type.';
