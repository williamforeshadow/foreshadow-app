alter table public.property_cards
  drop constraint if exists property_cards_created_by_user_id_fkey;

alter table public.property_cards
  add constraint property_cards_created_by_user_id_fkey
  foreign key (created_by_user_id)
  references public.users(id)
  on delete set null;

alter table public.property_cards
  drop constraint if exists property_cards_updated_by_user_id_fkey;

alter table public.property_cards
  add constraint property_cards_updated_by_user_id_fkey
  foreign key (updated_by_user_id)
  references public.users(id)
  on delete set null;
