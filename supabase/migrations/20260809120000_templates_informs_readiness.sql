-- Per-template property-readiness gate.
--
-- Property readiness (the Schedule's at-a-glance vacant-property indicator)
-- is driven by templates: when a template has this flag on, tasks generated
-- from it that fall in a property's vacancy window (check-out -> next
-- check-in) gate whether the property shows as "ready". The flag is
-- template-global — it applies to every property the template is assigned
-- to, including properties with per-property field overrides, because the
-- scheduled task is still that template.
--
-- Defaults false so readiness is opt-in per template: nothing changes on the
-- Schedule until an operator flips the toggle on the templates that matter
-- (typically the turnover clean / inspection ones).

alter table public.templates
  add column if not exists informs_readiness boolean not null default false;

comment on column public.templates.informs_readiness is
  'When true, tasks from this template scheduled in a property''s vacancy window (check-out to next check-in) gate the property-readiness indicator on the Schedule.';
