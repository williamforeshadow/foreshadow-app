-- Make the task-automation trigger chain org-safe by keying on property_id
-- everywhere, never on property NAME.
--
-- Why: properties.name is unique PER ORG (org_id, lower(name)) — two tenants
-- can legitimately own a property with the same name. Two functions in the
-- auto-task chain resolved properties by bare name across ALL orgs:
--   - sync_automation_to_future_tasks(p_property_name, ...) — its
--     `SELECT id FROM properties WHERE name = p_property_name LIMIT 1`
--     fallback could pick ANOTHER org's property, then delete/insert
--     turnover_tasks under it (the derive_org_id trigger would stamp them
--     with that other org's org_id → tasks appear in the other tenant).
--   - generate_tasks_for_reservation — same name fallback, currently dead
--     code (reservations.property_id is NOT NULL) but the same landmine.
--
-- Changes:
--   1. generate_tasks_for_reservation: drop the name fallback; no property_id
--      → no tasks. Also pin search_path.
--   2. sync_automation_to_future_tasks re-created as (p_property_id uuid,
--      p_template_id uuid); resolves the display name from properties by id.
--   3. Both caller triggers (sync_tasks_on_template_change,
--      trigger_sync_automation_on_update) now pass NEW.property_id.
--   4. The old name-keyed overload is DROPPED so no code path can use it.

-- 1. generate_tasks_for_reservation — id-keyed only.
CREATE OR REPLACE FUNCTION public.generate_tasks_for_reservation(res_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  prop_id UUID;
  prop_name TEXT;
  res_check_in TIMESTAMPTZ;
  res_check_out TIMESTAMPTZ;
  res_next_check_in TIMESTAMPTZ;
  stay_length INT;
  template_record RECORD;
  automation_cfg JSONB;
  schedule_cfg JSONB;
  occ_condition JSONB;
  occ_schedule JSONB;
  calculated_date DATE;
  calculated_time TIME;
  base_date TIMESTAMPTZ;
  new_task_id UUID;
  user_id_val UUID;
  is_same_day BOOLEAN;
  condition_met BOOLEAN;
  trigger_type TEXT;
  day_of_occ INT;
  repeat_enabled BOOLEAN;
  repeat_interval INT;
  repeat_count INT;
  i INT;
  vac_condition JSONB;
  vac_schedule JSONB;
  vac_day_of_vacancy INT;
  vac_time TEXT;
  vac_repeat_enabled BOOLEAN;
  vac_repeat_interval INT;
  vac_max_days_ahead INT;
  vacancy_length INT;
  vac_condition_met BOOLEAN;
  vac_end_date DATE;
  vac_repeat_count INT;
  contingent_enabled BOOLEAN;
  task_status TEXT;
BEGIN
  SELECT property_id, property_name, check_in, check_out, next_check_in
  INTO prop_id, prop_name, res_check_in, res_check_out, res_next_check_in
  FROM reservations
  WHERE id = res_id;

  -- Org safety: NEVER resolve a property by name — names are only unique per
  -- org, so a bare-name match can land on another tenant's property. No
  -- property_id → no auto-generated tasks.
  IF prop_id IS NULL THEN RETURN; END IF;

  IF res_check_in IS NOT NULL AND res_check_out IS NOT NULL THEN
    stay_length := EXTRACT(DAY FROM (res_check_out - res_check_in))::INT;
  ELSE
    stay_length := 0;
  END IF;
  is_same_day := (res_check_out::DATE = res_next_check_in::DATE) AND res_next_check_in IS NOT NULL;

  FOR template_record IN
    SELECT pt.template_id, pt.automation_config, t.department_id, t.name
    FROM property_templates pt
    JOIN templates t ON t.id = pt.template_id
    WHERE pt.property_id = prop_id
      AND pt.enabled = true
  LOOP
    automation_cfg := template_record.automation_config;
    calculated_date := NULL;
    calculated_time := NULL;

    IF automation_cfg IS NULL OR (automation_cfg->>'enabled')::boolean != true THEN CONTINUE; END IF;
    trigger_type := COALESCE(automation_cfg->>'trigger_type', 'turnover');
    IF trigger_type = 'recurring' THEN CONTINUE; END IF;

    contingent_enabled := COALESCE((automation_cfg->'contingent'->>'enabled')::BOOLEAN, false);
    task_status := CASE WHEN contingent_enabled THEN 'contingent' ELSE 'not_started' END;

    -- ============= TURNOVER =============
    IF trigger_type = 'turnover' THEN
      IF is_same_day AND COALESCE((automation_cfg->'same_day_override'->>'enabled')::boolean, false) THEN
        schedule_cfg := automation_cfg->'same_day_override'->'schedule';
      ELSE
        schedule_cfg := automation_cfg->'schedule';
      END IF;

      IF COALESCE(schedule_cfg->>'relative_to', 'check_out') = 'next_check_in' THEN
        base_date := res_next_check_in;
      ELSE
        base_date := res_check_out;
      END IF;

      IF base_date IS NOT NULL THEN
        IF (schedule_cfg->>'type') = 'before' THEN
          base_date := base_date - ((COALESCE(schedule_cfg->>'days_offset', '0')::int) || ' days')::interval;
        ELSIF (schedule_cfg->>'type') = 'after' THEN
          base_date := base_date + ((COALESCE(schedule_cfg->>'days_offset', '0')::int) || ' days')::interval;
        END IF;
        calculated_date := DATE(base_date);
        calculated_time := COALESCE(schedule_cfg->>'time', '10:00')::TIME;
      END IF;

      INSERT INTO turnover_tasks (
        reservation_id, property_id, property_name, template_id,
        title, department_id, status, scheduled_date, scheduled_time
      )
      VALUES (
        res_id, prop_id, prop_name, template_record.template_id,
        template_record.name, template_record.department_id,
        task_status, calculated_date, calculated_time
      )
      ON CONFLICT DO NOTHING
      RETURNING id INTO new_task_id;

      IF new_task_id IS NOT NULL AND COALESCE((automation_cfg->'auto_assign'->>'enabled')::boolean, false) THEN
        FOR user_id_val IN
          SELECT (jsonb_array_elements_text(automation_cfg->'auto_assign'->'user_ids'))::uuid
        LOOP
          INSERT INTO task_assignments (task_id, user_id) VALUES (new_task_id, user_id_val) ON CONFLICT DO NOTHING;
        END LOOP;
      END IF;

    -- ============= OCCUPANCY =============
    ELSIF trigger_type = 'occupancy' THEN
      occ_condition := automation_cfg->'occupancy_condition';
      occ_schedule  := automation_cfg->'occupancy_schedule';

      condition_met := FALSE;
      IF occ_condition IS NOT NULL AND stay_length > 0 THEN
        CASE occ_condition->>'operator'
          WHEN 'gte' THEN condition_met := stay_length >= (occ_condition->>'days')::int;
          WHEN 'gt'  THEN condition_met := stay_length >  (occ_condition->>'days')::int;
          WHEN 'eq'  THEN condition_met := stay_length =  (occ_condition->>'days')::int;
          WHEN 'lt'  THEN condition_met := stay_length <  (occ_condition->>'days')::int;
          WHEN 'lte' THEN condition_met := stay_length <= (occ_condition->>'days')::int;
          WHEN 'between' THEN
            condition_met := stay_length >= (occ_condition->>'days')::int
                         AND stay_length <= COALESCE((occ_condition->>'days_end')::int, (occ_condition->>'days')::int);
          ELSE condition_met := FALSE;
        END CASE;
      END IF;
      IF NOT condition_met THEN CONTINUE; END IF;

      IF occ_schedule IS NOT NULL THEN
        day_of_occ      := COALESCE((occ_schedule->>'day_of_occupancy')::int, 1);
        repeat_enabled  := COALESCE((occ_schedule->'repeat'->>'enabled')::boolean, false);
        repeat_interval := COALESCE((occ_schedule->'repeat'->>'interval_days')::int, 7);
        repeat_count    := CASE WHEN repeat_enabled AND repeat_interval > 0
                                THEN 1 + GREATEST(0, (stay_length - day_of_occ) / repeat_interval)
                                ELSE 1 END;

        FOR i IN 0..(repeat_count - 1) LOOP
          base_date := res_check_in + ((day_of_occ - 1 + i * repeat_interval) || ' days')::interval;
          IF base_date < res_check_out THEN
            calculated_date := DATE(base_date);
            calculated_time := COALESCE(occ_schedule->>'time', '10:00')::TIME;

            INSERT INTO turnover_tasks (
              reservation_id, property_id, property_name, template_id,
              title, department_id, status, scheduled_date, scheduled_time
            )
            VALUES (
              res_id, prop_id, prop_name, template_record.template_id,
              template_record.name, template_record.department_id,
              task_status, calculated_date, calculated_time
            )
            RETURNING id INTO new_task_id;

            IF new_task_id IS NOT NULL AND COALESCE((automation_cfg->'auto_assign'->>'enabled')::boolean, false) THEN
              FOR user_id_val IN
                SELECT (jsonb_array_elements_text(automation_cfg->'auto_assign'->'user_ids'))::uuid
              LOOP
                INSERT INTO task_assignments (task_id, user_id) VALUES (new_task_id, user_id_val) ON CONFLICT DO NOTHING;
              END LOOP;
            END IF;
          END IF;
        END LOOP;
      END IF;

    -- ============= VACANCY =============
    ELSIF trigger_type = 'vacancy' THEN
      vac_condition         := automation_cfg->'vacancy_condition';
      vac_schedule          := automation_cfg->'vacancy_schedule';
      vac_day_of_vacancy    := COALESCE((vac_schedule->>'day_of_vacancy')::INT, 1);
      vac_time              := COALESCE(vac_schedule->>'time', '10:00');
      vac_repeat_enabled    := COALESCE((vac_schedule->'repeat'->>'enabled')::BOOLEAN, false);
      vac_repeat_interval   := COALESCE((vac_schedule->'repeat'->>'interval_days')::INT, 7);
      vac_max_days_ahead    := COALESCE((vac_schedule->>'max_days_ahead')::INT, 90);

      IF res_next_check_in IS NOT NULL THEN
        vacancy_length := EXTRACT(DAY FROM (res_next_check_in - res_check_out))::INT;
      ELSE
        vacancy_length := vac_max_days_ahead;
      END IF;

      vac_condition_met := FALSE;
      IF vac_condition IS NOT NULL AND vacancy_length > 0 THEN
        CASE vac_condition->>'operator'
          WHEN 'gte' THEN vac_condition_met := vacancy_length >= (vac_condition->>'days')::INT;
          WHEN 'gt'  THEN vac_condition_met := vacancy_length >  (vac_condition->>'days')::INT;
          WHEN 'eq'  THEN vac_condition_met := vacancy_length =  (vac_condition->>'days')::INT;
          WHEN 'lt'  THEN vac_condition_met := vacancy_length <  (vac_condition->>'days')::INT;
          WHEN 'lte' THEN vac_condition_met := vacancy_length <= (vac_condition->>'days')::INT;
          WHEN 'between' THEN
            vac_condition_met := vacancy_length >= (vac_condition->>'days')::INT
                AND vacancy_length <= COALESCE((vac_condition->>'days_end')::INT, (vac_condition->>'days')::INT);
          ELSE vac_condition_met := FALSE;
        END CASE;
      END IF;
      IF NOT vac_condition_met THEN CONTINUE; END IF;

      vac_end_date := CASE WHEN res_next_check_in IS NOT NULL
                           THEN res_next_check_in::DATE
                           ELSE res_check_out::DATE + vac_max_days_ahead END;

      IF vac_schedule IS NOT NULL THEN
        vac_repeat_count := CASE WHEN vac_repeat_enabled AND vac_repeat_interval > 0
                                 THEN 1 + GREATEST(0, (vacancy_length - vac_day_of_vacancy) / vac_repeat_interval)
                                 ELSE 1 END;

        FOR i IN 0..(vac_repeat_count - 1) LOOP
          base_date := res_check_out + ((vac_day_of_vacancy - 1 + i * vac_repeat_interval) || ' days')::interval;
          IF base_date::DATE >= vac_end_date THEN EXIT; END IF;

          calculated_date := DATE(base_date);
          calculated_time := vac_time::TIME;

          INSERT INTO turnover_tasks (
            reservation_id, property_id, property_name, template_id,
            title, department_id, status, scheduled_date, scheduled_time
          )
          VALUES (
            res_id, prop_id, prop_name, template_record.template_id,
            template_record.name, template_record.department_id,
            task_status, calculated_date, calculated_time
          )
          RETURNING id INTO new_task_id;

          IF new_task_id IS NOT NULL AND COALESCE((automation_cfg->'auto_assign'->>'enabled')::boolean, false) THEN
            FOR user_id_val IN
              SELECT (jsonb_array_elements_text(automation_cfg->'auto_assign'->'user_ids'))::uuid
            LOOP
              INSERT INTO task_assignments (task_id, user_id) VALUES (new_task_id, user_id_val) ON CONFLICT DO NOTHING;
            END LOOP;
          END IF;
        END LOOP;
      END IF;
    END IF;
  END LOOP;
END;
$function$;

-- 2. sync_automation_to_future_tasks — id-keyed replacement.
CREATE OR REPLACE FUNCTION public.sync_automation_to_future_tasks(p_property_id uuid, p_template_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  prop_id UUID;
  v_property_name TEXT;
  auto_config JSONB;
  trigger_type TEXT;
  schedule_type TEXT;
  schedule_relative_to TEXT;
  schedule_days_offset INT;
  schedule_time TEXT;
  same_day_enabled BOOLEAN;
  same_day_type TEXT;
  same_day_relative_to TEXT;
  same_day_days_offset INT;
  same_day_time TEXT;
  occ_condition JSONB;
  occ_schedule JSONB;
  occ_day_of_occupancy INT;
  occ_time TEXT;
  stay_length INT;
  condition_met BOOLEAN;
  auto_assign_enabled BOOLEAN;
  auto_assign_user_ids TEXT[];
  task_record RECORD;
  res_record RECORD;
  calculated_date DATE;
  calculated_time TIME;
  is_same_day BOOLEAN;
  repeat_enabled BOOLEAN;
  repeat_interval INT;
  repeat_count INT;
  i INT;
  new_task_id UUID;
  template_name TEXT;
  template_dept_id UUID;
  vac_condition JSONB;
  vac_schedule JSONB;
  vac_day_of_vacancy INT;
  vac_time TEXT;
  vac_repeat_enabled BOOLEAN;
  vac_repeat_interval INT;
  vac_max_days_ahead INT;
  vacancy_length INT;
  vac_condition_met BOOLEAN;
  vac_end_date DATE;
  vac_repeat_count INT;
  rec_schedule JSONB;
  rec_start_date DATE;
  rec_time TEXT;
  rec_interval_value INT;
  rec_interval_unit TEXT;
  rec_occurrence DATE;
  rec_horizon DATE;
  contingent_enabled BOOLEAN;
  task_status TEXT;
BEGIN
  -- Org safety: keyed strictly on (property_id, template_id). The previous
  -- name-keyed version fell back to `properties WHERE name = ... LIMIT 1`,
  -- which could resolve to ANOTHER org's same-named property and create/delete
  -- tasks in that tenant.
  prop_id := p_property_id;
  IF prop_id IS NULL THEN RETURN; END IF;

  SELECT automation_config INTO auto_config
  FROM property_templates
  WHERE property_id = p_property_id AND template_id = p_template_id;

  IF auto_config IS NULL OR NOT (auto_config->>'enabled')::BOOLEAN THEN RETURN; END IF;

  SELECT name INTO v_property_name FROM properties WHERE id = prop_id;
  IF v_property_name IS NULL THEN RETURN; END IF;

  trigger_type := COALESCE(auto_config->>'trigger_type', 'turnover');
  contingent_enabled := COALESCE((auto_config->'contingent'->>'enabled')::BOOLEAN, false);
  task_status := CASE WHEN contingent_enabled THEN 'contingent' ELSE 'not_started' END;

  auto_assign_enabled := COALESCE((auto_config->'auto_assign'->>'enabled')::BOOLEAN, false);
  IF auto_assign_enabled AND auto_config->'auto_assign'->'user_ids' IS NOT NULL THEN
    SELECT ARRAY_AGG(elem::TEXT) INTO auto_assign_user_ids
    FROM jsonb_array_elements_text(auto_config->'auto_assign'->'user_ids') AS elem;
  ELSE
    auto_assign_user_ids := ARRAY[]::TEXT[];
  END IF;

  -- ============= TURNOVER (UPDATE only — no inserts here) =============
  IF trigger_type = 'turnover' THEN
    schedule_type        := COALESCE(auto_config->'schedule'->>'type', 'on');
    schedule_relative_to := COALESCE(auto_config->'schedule'->>'relative_to', 'check_out');
    schedule_days_offset := COALESCE((auto_config->'schedule'->>'days_offset')::INT, 0);
    schedule_time        := COALESCE(auto_config->'schedule'->>'time', '10:00');
    same_day_enabled     := COALESCE((auto_config->'same_day_override'->>'enabled')::BOOLEAN, false);
    same_day_type        := COALESCE(auto_config->'same_day_override'->'schedule'->>'type', 'on');
    same_day_relative_to := COALESCE(auto_config->'same_day_override'->'schedule'->>'relative_to', 'check_out');
    same_day_days_offset := COALESCE((auto_config->'same_day_override'->'schedule'->>'days_offset')::INT, 0);
    same_day_time        := COALESCE(auto_config->'same_day_override'->'schedule'->>'time', '10:00');

    FOR task_record IN
      SELECT tt.id AS task_id, r.check_out, r.next_check_in
      FROM turnover_tasks tt
      JOIN reservations r ON r.id = tt.reservation_id
      WHERE r.property_id = prop_id
        AND tt.template_id = p_template_id
        AND r.check_out >= CURRENT_DATE
        AND tt.status IN ('not_started', 'contingent')
    LOOP
      is_same_day := (task_record.check_out IS NOT NULL AND task_record.next_check_in IS NOT NULL
                      AND task_record.check_out::DATE = task_record.next_check_in::DATE);
      IF is_same_day AND same_day_enabled THEN
        calculated_date := CASE WHEN same_day_relative_to = 'next_check_in' AND task_record.next_check_in IS NOT NULL
                                THEN task_record.next_check_in::DATE
                                ELSE task_record.check_out::DATE END;
        IF same_day_type = 'before' THEN calculated_date := calculated_date - same_day_days_offset;
        ELSIF same_day_type = 'after' THEN calculated_date := calculated_date + same_day_days_offset; END IF;
        calculated_time := same_day_time::TIME;
      ELSE
        calculated_date := CASE WHEN schedule_relative_to = 'next_check_in' AND task_record.next_check_in IS NOT NULL
                                THEN task_record.next_check_in::DATE
                                ELSE task_record.check_out::DATE END;
        IF schedule_type = 'before' THEN calculated_date := calculated_date - schedule_days_offset;
        ELSIF schedule_type = 'after' THEN calculated_date := calculated_date + schedule_days_offset; END IF;
        calculated_time := schedule_time::TIME;
      END IF;

      UPDATE turnover_tasks
      SET scheduled_date = calculated_date, scheduled_time = calculated_time, status = task_status
      WHERE id = task_record.task_id;

      DELETE FROM task_assignments WHERE task_id = task_record.task_id;
      IF auto_assign_enabled AND array_length(auto_assign_user_ids, 1) > 0 THEN
        INSERT INTO task_assignments (task_id, user_id)
        SELECT task_record.task_id, unnest(auto_assign_user_ids)::UUID;
      END IF;
    END LOOP;

  -- ============= OCCUPANCY =============
  ELSIF trigger_type = 'occupancy' THEN
    SELECT name, department_id INTO template_name, template_dept_id FROM templates WHERE id = p_template_id;

    occ_condition        := auto_config->'occupancy_condition';
    occ_schedule         := auto_config->'occupancy_schedule';
    occ_day_of_occupancy := COALESCE((occ_schedule->>'day_of_occupancy')::INT, 1);
    occ_time             := COALESCE(occ_schedule->>'time', '10:00');
    repeat_enabled       := COALESCE((occ_schedule->'repeat'->>'enabled')::BOOLEAN, false);
    repeat_interval      := COALESCE((occ_schedule->'repeat'->>'interval_days')::INT, 7);

    DELETE FROM task_assignments WHERE task_id IN (
      SELECT tt.id FROM turnover_tasks tt JOIN reservations r ON r.id = tt.reservation_id
      WHERE r.property_id = prop_id AND tt.template_id = p_template_id
        AND r.check_out >= CURRENT_DATE AND tt.status IN ('not_started', 'contingent')
    );
    DELETE FROM turnover_tasks WHERE id IN (
      SELECT tt.id FROM turnover_tasks tt JOIN reservations r ON r.id = tt.reservation_id
      WHERE r.property_id = prop_id AND tt.template_id = p_template_id
        AND r.check_out >= CURRENT_DATE AND tt.status IN ('not_started', 'contingent')
    );

    FOR res_record IN
      SELECT r.id AS reservation_id, r.check_in, r.check_out, r.property_name
      FROM reservations r WHERE r.property_id = prop_id AND r.check_out >= CURRENT_DATE
    LOOP
      IF res_record.check_in IS NOT NULL AND res_record.check_out IS NOT NULL THEN
        stay_length := EXTRACT(DAY FROM (res_record.check_out - res_record.check_in))::INT;
      ELSE stay_length := 0; END IF;

      condition_met := FALSE;
      IF occ_condition IS NOT NULL AND stay_length > 0 THEN
        CASE occ_condition->>'operator'
          WHEN 'gte' THEN condition_met := stay_length >= (occ_condition->>'days')::int;
          WHEN 'gt'  THEN condition_met := stay_length >  (occ_condition->>'days')::int;
          WHEN 'eq'  THEN condition_met := stay_length =  (occ_condition->>'days')::int;
          WHEN 'lt'  THEN condition_met := stay_length <  (occ_condition->>'days')::int;
          WHEN 'lte' THEN condition_met := stay_length <= (occ_condition->>'days')::int;
          WHEN 'between' THEN
            condition_met := stay_length >= (occ_condition->>'days')::int
                         AND stay_length <= COALESCE((occ_condition->>'days_end')::int, (occ_condition->>'days')::int);
          ELSE condition_met := FALSE;
        END CASE;
      END IF;
      IF NOT condition_met THEN CONTINUE; END IF;

      repeat_count := CASE WHEN repeat_enabled AND repeat_interval > 0
                           THEN 1 + GREATEST(0, (stay_length - occ_day_of_occupancy) / repeat_interval)
                           ELSE 1 END;

      FOR i IN 0..(repeat_count - 1) LOOP
        calculated_date := res_record.check_in::DATE + (occ_day_of_occupancy - 1 + i * repeat_interval);
        IF calculated_date < res_record.check_out::DATE THEN
          calculated_time := occ_time::TIME;

          INSERT INTO turnover_tasks (
            reservation_id, property_id, property_name, template_id,
            title, department_id, status, scheduled_date, scheduled_time
          )
          VALUES (
            res_record.reservation_id, prop_id, v_property_name, p_template_id,
            template_name, template_dept_id, task_status, calculated_date, calculated_time
          )
          RETURNING id INTO new_task_id;

          IF new_task_id IS NOT NULL AND auto_assign_enabled AND array_length(auto_assign_user_ids, 1) > 0 THEN
            INSERT INTO task_assignments (task_id, user_id)
            SELECT new_task_id, unnest(auto_assign_user_ids)::UUID;
          END IF;
        END IF;
      END LOOP;
    END LOOP;

  -- ============= VACANCY =============
  ELSIF trigger_type = 'vacancy' THEN
    SELECT name, department_id INTO template_name, template_dept_id FROM templates WHERE id = p_template_id;

    vac_condition         := auto_config->'vacancy_condition';
    vac_schedule          := auto_config->'vacancy_schedule';
    vac_day_of_vacancy    := COALESCE((vac_schedule->>'day_of_vacancy')::INT, 1);
    vac_time              := COALESCE(vac_schedule->>'time', '10:00');
    vac_repeat_enabled    := COALESCE((vac_schedule->'repeat'->>'enabled')::BOOLEAN, false);
    vac_repeat_interval   := COALESCE((vac_schedule->'repeat'->>'interval_days')::INT, 7);
    vac_max_days_ahead    := COALESCE((vac_schedule->>'max_days_ahead')::INT, 90);

    DELETE FROM task_assignments WHERE task_id IN (
      SELECT tt.id FROM turnover_tasks tt JOIN reservations r ON r.id = tt.reservation_id
      WHERE r.property_id = prop_id AND tt.template_id = p_template_id
        AND COALESCE(r.next_check_in, r.check_out + INTERVAL '90 days') >= CURRENT_DATE
        AND tt.status IN ('not_started', 'contingent')
    );
    DELETE FROM turnover_tasks WHERE id IN (
      SELECT tt.id FROM turnover_tasks tt JOIN reservations r ON r.id = tt.reservation_id
      WHERE r.property_id = prop_id AND tt.template_id = p_template_id
        AND COALESCE(r.next_check_in, r.check_out + INTERVAL '90 days') >= CURRENT_DATE
        AND tt.status IN ('not_started', 'contingent')
    );

    FOR res_record IN
      SELECT r.id AS reservation_id, r.check_out, r.next_check_in
      FROM reservations r WHERE r.property_id = prop_id
        AND COALESCE(r.next_check_in, r.check_out + INTERVAL '90 days') >= CURRENT_DATE
    LOOP
      vacancy_length := CASE WHEN res_record.next_check_in IS NOT NULL
                             THEN EXTRACT(DAY FROM (res_record.next_check_in - res_record.check_out))::INT
                             ELSE vac_max_days_ahead END;

      vac_condition_met := FALSE;
      IF vac_condition IS NOT NULL AND vacancy_length > 0 THEN
        CASE vac_condition->>'operator'
          WHEN 'gte' THEN vac_condition_met := vacancy_length >= (vac_condition->>'days')::INT;
          WHEN 'gt'  THEN vac_condition_met := vacancy_length >  (vac_condition->>'days')::INT;
          WHEN 'eq'  THEN vac_condition_met := vacancy_length =  (vac_condition->>'days')::INT;
          WHEN 'lt'  THEN vac_condition_met := vacancy_length <  (vac_condition->>'days')::INT;
          WHEN 'lte' THEN vac_condition_met := vacancy_length <= (vac_condition->>'days')::INT;
          WHEN 'between' THEN
            vac_condition_met := vacancy_length >= (vac_condition->>'days')::INT
                AND vacancy_length <= COALESCE((vac_condition->>'days_end')::INT, (vac_condition->>'days')::INT);
          ELSE vac_condition_met := FALSE;
        END CASE;
      END IF;
      IF NOT vac_condition_met THEN CONTINUE; END IF;

      vac_end_date := CASE WHEN res_record.next_check_in IS NOT NULL
                           THEN res_record.next_check_in::DATE
                           ELSE res_record.check_out::DATE + vac_max_days_ahead END;

      vac_repeat_count := CASE WHEN vac_repeat_enabled AND vac_repeat_interval > 0
                               THEN 1 + GREATEST(0, (vacancy_length - vac_day_of_vacancy) / vac_repeat_interval)
                               ELSE 1 END;

      FOR i IN 0..(vac_repeat_count - 1) LOOP
        calculated_date := res_record.check_out::DATE + (vac_day_of_vacancy - 1 + i * vac_repeat_interval);
        IF calculated_date >= vac_end_date THEN EXIT; END IF;
        calculated_time := vac_time::TIME;

        INSERT INTO turnover_tasks (
          reservation_id, property_id, property_name, template_id,
          title, department_id, status, scheduled_date, scheduled_time
        )
        VALUES (
          res_record.reservation_id, prop_id, v_property_name, p_template_id,
          template_name, template_dept_id, task_status, calculated_date, calculated_time
        )
        RETURNING id INTO new_task_id;

        IF new_task_id IS NOT NULL AND auto_assign_enabled AND array_length(auto_assign_user_ids, 1) > 0 THEN
          INSERT INTO task_assignments (task_id, user_id)
          SELECT new_task_id, unnest(auto_assign_user_ids)::UUID;
        END IF;
      END LOOP;
    END LOOP;

  -- ============= RECURRING =============
  ELSIF trigger_type = 'recurring' THEN
    SELECT name, department_id INTO template_name, template_dept_id FROM templates WHERE id = p_template_id;

    rec_schedule       := auto_config->'recurring_schedule';
    rec_start_date     := (rec_schedule->>'start_date')::DATE;
    rec_time           := COALESCE(rec_schedule->>'time', '10:00');
    rec_interval_value := COALESCE((rec_schedule->>'interval_value')::INT, 1);
    rec_interval_unit  := COALESCE(rec_schedule->>'interval_unit', 'months');
    rec_horizon        := CURRENT_DATE + 90;

    DELETE FROM task_assignments WHERE task_id IN (
      SELECT tt.id FROM turnover_tasks tt
      WHERE tt.property_id = prop_id AND tt.template_id = p_template_id
        AND tt.reservation_id IS NULL AND tt.status IN ('not_started', 'contingent')
    );
    DELETE FROM turnover_tasks
    WHERE property_id = prop_id AND template_id = p_template_id
      AND reservation_id IS NULL AND status IN ('not_started', 'contingent');

    rec_occurrence := rec_start_date;
    IF rec_occurrence < CURRENT_DATE THEN
      IF rec_interval_unit = 'days' THEN
        rec_occurrence := rec_occurrence + (CEIL((CURRENT_DATE - rec_occurrence)::NUMERIC / rec_interval_value) * rec_interval_value)::INT;
      ELSIF rec_interval_unit = 'weeks' THEN
        rec_occurrence := rec_occurrence + (CEIL((CURRENT_DATE - rec_occurrence)::NUMERIC / (rec_interval_value * 7)) * (rec_interval_value * 7))::INT;
      ELSIF rec_interval_unit = 'months' THEN
        WHILE rec_occurrence < CURRENT_DATE LOOP rec_occurrence := rec_occurrence + (rec_interval_value || ' months')::INTERVAL; END LOOP;
      ELSIF rec_interval_unit = 'years' THEN
        WHILE rec_occurrence < CURRENT_DATE LOOP rec_occurrence := rec_occurrence + (rec_interval_value || ' years')::INTERVAL; END LOOP;
      END IF;
    END IF;

    WHILE rec_occurrence <= rec_horizon LOOP
      INSERT INTO turnover_tasks (
        reservation_id, property_id, property_name, template_id,
        title, department_id, status, scheduled_date, scheduled_time
      )
      VALUES (
        NULL, prop_id, v_property_name, p_template_id,
        template_name, template_dept_id, task_status, rec_occurrence, rec_time::TIME
      )
      RETURNING id INTO new_task_id;

      IF new_task_id IS NOT NULL AND auto_assign_enabled AND array_length(auto_assign_user_ids, 1) > 0 THEN
        INSERT INTO task_assignments (task_id, user_id)
        SELECT new_task_id, unnest(auto_assign_user_ids)::UUID;
      END IF;

      IF rec_interval_unit = 'days' THEN     rec_occurrence := rec_occurrence + rec_interval_value;
      ELSIF rec_interval_unit = 'weeks' THEN rec_occurrence := rec_occurrence + (rec_interval_value * 7);
      ELSIF rec_interval_unit = 'months' THEN rec_occurrence := rec_occurrence + (rec_interval_value || ' months')::INTERVAL;
      ELSIF rec_interval_unit = 'years' THEN  rec_occurrence := rec_occurrence + (rec_interval_value || ' years')::INTERVAL;
      END IF;
    END LOOP;
  END IF;
END;
$function$;

-- 3. Callers now pass property_id.
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
      AND tt.template_id = OLD.template_id;

    DELETE FROM turnover_tasks
    WHERE property_id = OLD.property_id
      AND template_id = OLD.template_id
      AND reservation_id IS NULL;

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

CREATE OR REPLACE FUNCTION public.trigger_sync_automation_on_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- Only sync if automation_config has changed
  IF NEW.automation_config IS DISTINCT FROM OLD.automation_config THEN
    PERFORM sync_automation_to_future_tasks(NEW.property_id, NEW.template_id);
  END IF;

  RETURN NEW;
END;
$function$;

-- 4. Remove the name-keyed overload entirely — no code path may resolve a
-- property by bare name again.
DROP FUNCTION IF EXISTS public.sync_automation_to_future_tasks(text, uuid);
