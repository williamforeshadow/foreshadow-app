-- Task-proposal sensitivity narrows from a 1-5 ladder to 1-3.
--
-- Levels 4 ("Proactive") and 5 ("Track everything") proposed work the guest
-- never asked anyone to do. That contradicts the triage prompt's own definition
-- one paragraph up -- "an operational task ... is NOT an answer to a question;
-- things the team can simply reply to are not tasks on their own" -- and level 5
-- ("essentially any guest feedback, request, or preference the team might want
-- to track") describes a CRM log rather than a task list. The useful range is
-- 1-3: emergencies only, clear operational work, or work plus administrative.
--
-- Done now, pre-launch, deliberately: with no external tenants this is one
-- constraint change. Once clients have saved settings and read the docs,
-- shortening a scale costs a data migration plus a comms problem.
--
-- Clamp before re-constraining so any org sitting on 4/5 lands on the new
-- ceiling instead of failing the constraint. (Every org is on 3 at time of
-- writing, so the update is defensive and should affect zero rows.)

update public.operations_settings
   set task_proposal_sensitivity = 3
 where task_proposal_sensitivity > 3;

alter table public.operations_settings
  drop constraint if exists operations_settings_task_proposal_sensitivity_check;

alter table public.operations_settings
  add constraint operations_settings_task_proposal_sensitivity_check
    check (task_proposal_sensitivity between 1 and 3);
