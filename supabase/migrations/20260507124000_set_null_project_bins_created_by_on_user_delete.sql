alter table public.project_bins
  drop constraint if exists project_bins_created_by_fkey;

alter table public.project_bins
  add constraint project_bins_created_by_fkey
  foreign key (created_by)
  references public.users(id)
  on delete set null;
