import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type TurnoverStatus =
  | "no_tasks"
  | "not_started"
  | "in_progress"
  | "complete"
  | string;

export type TurnoverTask = {
  task_id: string;
  template_id: string | null;
  template_name: string | null;
  type: string;
  status: string;
  assigned_staff: string | null;
  scheduled_start: string | null;
  card_actions: string | null;
  form_metadata: any;
  completed_at: string | null;
};

export type TurnoverRow = {
  id: string;
  property_name: string;
  guest_name: string | null;
  check_in: string;
  check_out: string;
  next_check_in: string | null;
  occupancy_status: string | null;
  tasks: TurnoverTask[] | any;
  total_tasks: number;
  completed_tasks: number;
  tasks_in_progress: number;
  turnover_status: TurnoverStatus;
};

export type GetTurnoversInput = {
  startDate?: string;      // "YYYY-MM-DD"
  endDate?: string;        // "YYYY-MM-DD"
  status?: TurnoverStatus;
  propertyName?: string;
};

/**
 * High-level helper around get_property_turnovers().
 * Filters by date/status/property in code for now.
 */
export async function getTurnovers(
  input: GetTurnoversInput = {}
): Promise<TurnoverRow[]> {
  const { data, error } = await supabase.rpc("get_property_turnovers");
  if (error) {
    throw new Error(`get_property_turnovers error: ${error.message}`);
  }

  const rows = (data || []) as TurnoverRow[];

  const { startDate, endDate, status, propertyName } = input;

  let filtered = rows;

  if (startDate || endDate) {
    filtered = filtered.filter((t) => {
      const co = new Date(t.check_out);
      const day = co.toISOString().slice(0, 10);

      if (startDate && day < startDate) return false;
      if (endDate && day > endDate) return false;
      return true;
    });
  }

  if (status) {
    filtered = filtered.filter((t) => t.turnover_status === status);
  }

  if (propertyName) {
    filtered = filtered.filter((t) => t.property_name === propertyName);
  }

  filtered.sort(
    (a, b) =>
      new Date(a.check_out).getTime() - new Date(b.check_out).getTime()
  );

  return filtered;
}