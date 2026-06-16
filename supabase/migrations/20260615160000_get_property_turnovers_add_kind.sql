-- Expose reservation `kind` ('guest_booking' | 'owner_stay') from
-- get_property_turnovers so the Turnovers page and Timeline (both powered by
-- this RPC) can distinguish owner stays — rendered amber, labeled "Owner Stay"
-- — from guest bookings. Return-type shape change, so the function must be
-- dropped first. Additive: existing callers that select by name ignore it.
DROP FUNCTION IF EXISTS public.get_property_turnovers();

CREATE FUNCTION public.get_property_turnovers()
 RETURNS TABLE(id uuid, property_id uuid, property_name text, kind text, guest_name text, check_in timestamp with time zone, check_out timestamp with time zone, next_check_in timestamp with time zone, occupancy_status text, tasks jsonb, total_tasks integer, completed_tasks integer, tasks_in_progress integer, turnover_status text)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_default_check_in time;
BEGIN
  SELECT COALESCE(default_check_in_time, '15:00'::time)
    INTO v_default_check_in
    FROM operations_settings
    LIMIT 1;
  v_default_check_in := COALESCE(v_default_check_in, '15:00'::time);

  RETURN QUERY
  SELECT
    r.id,
    r.property_id,
    r.property_name,
    r.kind,
    r.guest_name,
    r.check_in,
    r.check_out,
    r.next_check_in,

    CASE
      WHEN NOW() BETWEEN r.check_in AND r.check_out THEN 'occupied'
      ELSE 'vacant'
    END AS occupancy_status,

    COALESCE(wt.task_list, '[]'::jsonb) AS tasks,
    COALESCE(wt.active_total, 0)        AS total_tasks,
    COALESCE(wt.active_completed, 0)    AS completed_tasks,
    COALESCE(wt.active_in_progress, 0)  AS tasks_in_progress,

    CASE
      WHEN COALESCE(wt.active_total, 0) = 0
        THEN 'no_tasks'
      WHEN COALESCE(wt.active_completed, 0) = COALESCE(wt.active_total, 0)
        THEN 'complete'
      WHEN COALESCE(wt.active_completed, 0) > 0
        OR COALESCE(wt.active_in_progress, 0) > 0
        THEN 'in_progress'
      ELSE 'not_started'
    END AS turnover_status

  FROM reservations r
  LEFT JOIN LATERAL (
    WITH bounds AS (
      SELECT
        to_char(r.check_in,      'YYYY-MM-DD') || 'T' ||
          to_char(v_default_check_in, 'HH24:MI') AS start_key,
        CASE WHEN r.next_check_in IS NOT NULL THEN
          to_char(r.next_check_in, 'YYYY-MM-DD') || 'T' ||
            to_char(v_default_check_in, 'HH24:MI')
        END AS end_key
    ),
    scoped AS (
      SELECT
        t.id, t.property_id, t.reservation_id, t.template_id, t.title, t.description, t.priority, t.bin_id,
        t.department_id, t.status, t.scheduled_date, t.scheduled_time,
        t.form_metadata, t.completed_at, t.created_at,
        tm.name AS template_name,
        d.name  AS department_name,
        to_char(t.scheduled_date, 'YYYY-MM-DD') || 'T' ||
          COALESCE(to_char(t.scheduled_time, 'HH24:MI'), '00:00') AS task_key
      FROM turnover_tasks t
      LEFT JOIN templates   tm ON tm.id = t.template_id
      LEFT JOIN departments d  ON d.id  = t.department_id
      WHERE
        (
          (r.property_id IS NOT NULL AND t.property_id = r.property_id)
          OR (t.property_id IS NULL AND t.property_name = r.property_name)
        )
        AND t.scheduled_date IS NOT NULL
    ),
    in_window AS (
      SELECT s.*
      FROM scoped s, bounds b
      WHERE s.task_key >= b.start_key
        AND (b.end_key IS NULL OR s.task_key < b.end_key)
    )
    SELECT
      jsonb_agg(
        jsonb_build_object(
          'task_id',         iw.id,
          'property_id',     iw.property_id,
          'reservation_id',  iw.reservation_id,
          'template_id',     iw.template_id,
          'template_name',   iw.template_name,
          'title',           iw.title,
          'description',     iw.description,
          'priority',        iw.priority,
          'bin_id',          iw.bin_id,
          'department_id',   iw.department_id,
          'department_name', iw.department_name,
          'status',          iw.status,
          'assigned_users',  COALESCE(
            (
              SELECT jsonb_agg(jsonb_build_object(
                'user_id', u.id,
                'name',    u.name,
                'email',   u.email,
                'role',    u.role,
                'avatar',  u.avatar
              ))
              FROM task_assignments ta
              JOIN users u ON u.id = ta.user_id
              WHERE ta.task_id = iw.id
            ),
            '[]'::jsonb
          ),
          'scheduled_date', iw.scheduled_date,
          'scheduled_time', iw.scheduled_time,
          'form_metadata',  iw.form_metadata,
          'completed_at',   iw.completed_at
        )
        ORDER BY iw.scheduled_date,
                 COALESCE(iw.scheduled_time, '00:00:00'::time),
                 iw.created_at
      ) AS task_list,
      COUNT(*) FILTER (WHERE iw.status <> 'contingent')::integer
        AS active_total,
      COUNT(*) FILTER (WHERE iw.status = 'complete')::integer
        AS active_completed,
      COUNT(*) FILTER (WHERE iw.status IN ('in_progress', 'paused'))::integer
        AS active_in_progress
    FROM in_window iw
  ) wt ON true

  WHERE r.check_out IS NOT NULL
  ORDER BY r.check_out DESC;
END;
$function$;
