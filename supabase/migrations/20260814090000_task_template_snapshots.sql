-- Task checklists become point-in-time snapshots.
--
-- Problem: turnover_tasks stored only template_id, and the checklist rendered
-- from the LIVE template at open. Editing a template rewrote every existing
-- task's checklist (including completed ones — a finished 5/5 read 5/6), and
-- deleting one was destructive twice over: the property_templates cascade
-- fired sync_tasks_on_template_change, whose DELETE branch had NO status
-- filter (completed recurring tasks hard-deleted), and survivors' template_id
-- SET NULL made their stored form_metadata unviewable.
--
-- Fix:
--   1. turnover_tasks.template_snapshot jsonb — {name, fields}, the merged
--      (template + property field_overrides) checklist captured at creation.
--   2. build_template_snapshot(template, property) — SQL port of
--      lib/templateUtils.mergeTemplateFields (remove ids, patch
--      label/required, append additional).
--   3. BEFORE INSERT trigger fills the snapshot on every creation path
--      (SQL generators, API routes, everything).
--   4. sync_tasks_on_template_change DELETE branch now only removes PENDING
--      UNTOUCHED tasks (not_started/contingent with empty form_metadata) —
--      completed/in-progress/touched tasks survive and keep rendering via
--      their snapshot.
--   5. refresh_pending_task_snapshots(template) — called by the app after
--      template/override edits so pending untouched tasks pick up the new
--      checklist; touched and finished tasks stay frozen.
--   6. template_delete_impact(template) — counts for the delete confirm.
--   7. Backfill existing tasks from their current templates.

-- 1. Column ------------------------------------------------------------------
ALTER TABLE turnover_tasks ADD COLUMN IF NOT EXISTS template_snapshot jsonb;

-- 2. Snapshot builder --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.build_template_snapshot(p_template_id uuid, p_property_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  tpl RECORD;
  ov jsonb;
  removed jsonb;
  modified jsonb;
  additional jsonb;
  merged jsonb;
BEGIN
  SELECT name, COALESCE(fields, '[]'::jsonb) AS fields
  INTO tpl FROM templates WHERE id = p_template_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT field_overrides INTO ov
  FROM property_templates
  WHERE template_id = p_template_id AND property_id = p_property_id
  LIMIT 1;

  IF ov IS NULL OR ov = 'null'::jsonb THEN
    merged := tpl.fields;
  ELSE
    removed    := COALESCE(ov->'removed_field_ids', '[]'::jsonb);
    modified   := COALESCE(ov->'modified_fields', '{}'::jsonb);
    additional := COALESCE(ov->'additional_fields', '[]'::jsonb);

    SELECT COALESCE(jsonb_agg(
      CASE WHEN modified ? (t.f->>'id') THEN
        t.f
        || CASE WHEN (modified->(t.f->>'id')) ? 'label'
             THEN jsonb_build_object('label', modified->(t.f->>'id')->'label')
             ELSE '{}'::jsonb END
        || CASE WHEN (modified->(t.f->>'id')) ? 'required'
             THEN jsonb_build_object('required', modified->(t.f->>'id')->'required')
             ELSE '{}'::jsonb END
      ELSE t.f END
      ORDER BY t.ord
    ), '[]'::jsonb)
    INTO merged
    FROM jsonb_array_elements(tpl.fields) WITH ORDINALITY AS t(f, ord)
    WHERE NOT (removed ? (t.f->>'id'));

    merged := merged || additional;
  END IF;

  RETURN jsonb_build_object('name', tpl.name, 'fields', merged);
END;
$$;

-- 3. Fill on every insert ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_task_template_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.template_id IS NOT NULL AND NEW.template_snapshot IS NULL THEN
    NEW.template_snapshot := build_template_snapshot(NEW.template_id, NEW.property_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_template_snapshot ON turnover_tasks;
CREATE TRIGGER trg_task_template_snapshot
BEFORE INSERT ON turnover_tasks
FOR EACH ROW EXECUTE FUNCTION set_task_template_snapshot();

-- 4. Safe unassign/delete: only pending untouched tasks are removed ----------
-- (INSERT branch reproduced verbatim from the live definition.)
CREATE OR REPLACE FUNCTION public.sync_tasks_on_template_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  task_status TEXT;
  trigger_type TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM turnover_tasks tt
    USING reservations r
    WHERE tt.reservation_id = r.id
      AND r.property_id = OLD.property_id
      AND r.check_out > NOW()
      AND tt.template_id = OLD.template_id
      AND tt.status IN ('not_started', 'contingent')
      AND (tt.form_metadata IS NULL OR tt.form_metadata = '{}'::jsonb);

    DELETE FROM turnover_tasks
    WHERE property_id = OLD.property_id
      AND template_id = OLD.template_id
      AND reservation_id IS NULL
      AND status IN ('not_started', 'contingent')
      AND (form_metadata IS NULL OR form_metadata = '{}'::jsonb);

    RETURN OLD;

  ELSIF TG_OP = 'INSERT' THEN
    trigger_type := COALESCE(NEW.automation_config->>'trigger_type', 'turnover');

    IF NEW.automation_config IS NOT NULL
       AND (NEW.automation_config->>'enabled')::BOOLEAN = true
       AND COALESCE((NEW.automation_config->'contingent'->>'enabled')::BOOLEAN, false) THEN
      task_status := 'contingent';
    ELSE
      task_status := 'not_started';
    END IF;

    IF trigger_type = 'recurring' THEN
      PERFORM sync_automation_to_future_tasks(NEW.property_id, NEW.template_id);
    ELSE
      INSERT INTO turnover_tasks (reservation_id, property_id, property_name, template_id, title, department_id, status)
      SELECT
        r.id,
        NEW.property_id,
        NEW.property_name,
        NEW.template_id,
        t.name,
        t.department_id,
        task_status
      FROM reservations r
      CROSS JOIN templates t
      WHERE r.property_id = NEW.property_id
        AND r.check_out > NOW()
        AND t.id = NEW.template_id
      ON CONFLICT DO NOTHING;

      PERFORM sync_automation_to_future_tasks(NEW.property_id, NEW.template_id);
    END IF;

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$function$;

-- 5. Propagate template edits to pending untouched tasks only ----------------
CREATE OR REPLACE FUNCTION public.refresh_pending_task_snapshots(p_template_id uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE turnover_tasks
  SET template_snapshot = build_template_snapshot(template_id, property_id)
  WHERE template_id = p_template_id
    AND status IN ('not_started', 'contingent')
    AND (form_metadata IS NULL OR form_metadata = '{}'::jsonb);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- 6. Delete-impact counts for the confirm dialog -----------------------------
CREATE OR REPLACE FUNCTION public.template_delete_impact(p_template_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'pending_removed', COUNT(*) FILTER (
      WHERE status IN ('not_started', 'contingent')
        AND (form_metadata IS NULL OR form_metadata = '{}'::jsonb)),
    'kept', COUNT(*) FILTER (
      WHERE NOT (status IN ('not_started', 'contingent')
        AND (form_metadata IS NULL OR form_metadata = '{}'::jsonb)))
  )
  FROM turnover_tasks WHERE template_id = p_template_id;
$$;

-- 7. Backfill existing tasks from their current templates --------------------
UPDATE turnover_tasks
SET template_snapshot = build_template_snapshot(template_id, property_id)
WHERE template_id IS NOT NULL AND template_snapshot IS NULL;
