import { getSupabaseServer } from '@/lib/supabaseServer';

// getTaskById / getTasksByIds — canonical single-task (and small-batch)
// lookup used by every "show me this task" surface:
//
//   - GET /api/all-tasks/[id]      (in-app deep-link → overlay payload)
//   - Slack link unfurl handler    (build a card per pasted task URL)
//
// The shape mirrors a row from /api/all-tasks closely enough that the same
// downstream consumers (e.g. ContextTaskDetailOverlay's OverlayTaskInput)
// keep working. JSON-heavy fields (form_metadata) are passed through as
// `unknown`; callers that don't care can ignore them.
//
// Why a dedicated module: this query is slightly non-trivial (joins to
// templates, departments, project_bins, reservations, task_assignments, and
// project_comments aggregate) and needs to stay in sync between the route
// and the unfurl path. Centralising avoids drift.

const TASK_SELECT = `
  id,
  reservation_id,
  property_id,
  property_name,
  template_id,
  title,
  description,
  priority,
  department_id,
  status,
  scheduled_date,
  scheduled_time,
  bin_id,
  is_binned,
  form_metadata,
  completed_at,
  created_at,
  updated_at,
  templates(id, name, department_id),
  departments(id, name),
  project_bins(id, name, is_system),
  reservations(id, property_name, guest_name, check_in, check_out),
  task_assignments(user_id, users(id, name, avatar, role)),
  project_comments(count)
`;

export interface TaskByIdAssignedUser {
  user_id: string;
  name: string;
  avatar: string | null;
  role: string;
}

export interface TaskByIdRow {
  task_id: string;
  reservation_id: string | null;
  property_id: string | null;
  template_id: string | null;
  template_name: string;
  title: string | null;
  /**
   * Stored as ProseMirror/TipTap JSON in turnover_tasks.description, not a
   * plain string — every consumer here keeps it untyped and either renders
   * it through the rich-text editor (in-app overlay) or flattens it to
   * plain text first (Slack unfurl). Typing it `unknown` forces callers to
   * be explicit instead of accidentally calling string methods on a doc
   * object (which previously broke the unfurl path with a TypeError that
   * silently aborted the handler).
   */
  description: unknown;
  priority: string;
  department_id: string | null;
  department_name: string | null;
  status: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  form_metadata: unknown;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  bin_id: string | null;
  bin_name: string | null;
  bin_is_system: boolean;
  is_binned: boolean;
  is_automated: boolean;
  property_name: string;
  guest_name: string | null;
  check_in: string | null;
  check_out: string | null;
  is_recurring: boolean;
  assigned_users: TaskByIdAssignedUser[];
  comment_count: number;
}

export type GetTaskByIdResult =
  | { ok: true; task: TaskByIdRow }
  | { ok: false; reason: 'invalid_id' }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'error'; message: string };

// Shared shaping logic. Both the single-row and batch fetchers run rows
// through this so the output is identical regardless of entry point.
//
// Uses `any` because Supabase's nested-relation typing yields `unknown`
// here without a generated client; the field accesses below are
// individually defensive (each falls back to a sensible default).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shapeTaskRow(row: any): TaskByIdRow {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const template = row.templates as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reservation = row.reservations as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const department = row.departments as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bin = row.project_bins as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assignments = (row.task_assignments || []) as any[];
  const commentAgg = row.project_comments;
  const commentCount = Array.isArray(commentAgg)
    ? Number(commentAgg[0]?.count ?? 0)
    : 0;

  return {
    task_id: row.id,
    reservation_id: row.reservation_id ?? null,
    property_id: row.property_id || null,
    template_id: row.template_id ?? null,
    template_name: template?.name || 'Unnamed Task',
    title: row.title || null,
    description: row.description || null,
    priority: row.priority || 'medium',
    department_id: row.department_id || template?.department_id || null,
    department_name: department?.name || null,
    status: row.status || 'not_started',
    scheduled_date: row.scheduled_date ?? null,
    scheduled_time: row.scheduled_time ?? null,
    form_metadata: row.form_metadata,
    completed_at: row.completed_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    bin_id: row.bin_id || null,
    bin_name: bin?.name || null,
    bin_is_system: !!bin?.is_system,
    is_binned: row.is_binned ?? false,
    is_automated: row.template_id != null,
    property_name:
      row.property_name || reservation?.property_name || 'Unknown Property',
    guest_name: reservation?.guest_name || null,
    check_in: reservation?.check_in || null,
    check_out: reservation?.check_out || null,
    is_recurring: row.reservation_id === null,
    assigned_users: assignments.map((a) => ({
      user_id: a.user_id,
      name: a.users?.name || '',
      avatar: a.users?.avatar || null,
      role: a.users?.role || '',
    })),
    comment_count: commentCount,
  };
}

/**
 * Look up a single task by its primary key.
 *
 * Returns a discriminated result so callers can distinguish "the id was
 * malformed", "the row doesn't exist", and "the database errored" — all of
 * which the API route maps to different HTTP status codes, and the unfurl
 * handler treats uniformly as "skip this URL."
 */
export async function getTaskById(id: string): Promise<GetTaskByIdResult> {
  if (!id) return { ok: false, reason: 'invalid_id' };

  const { data, error } = await getSupabaseServer()
    .from('turnover_tasks')
    .select(TASK_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error) return { ok: false, reason: 'error', message: error.message };
  if (!data) return { ok: false, reason: 'not_found' };
  return { ok: true, task: shapeTaskRow(data) };
}

/**
 * Batch variant for the unfurl handler. Returns whatever rows exist (no
 * error envelope per id); the caller is expected to skip URLs whose task
 * isn't in the result, which mirrors what the unfurl UX should do anyway.
 *
 * Empty input shortcuts to an empty array without a round-trip.
 */
export async function getTasksByIds(ids: string[]): Promise<TaskByIdRow[]> {
  if (ids.length === 0) return [];
  const unique = Array.from(new Set(ids));
  const { data, error } = await getSupabaseServer()
    .from('turnover_tasks')
    .select(TASK_SELECT)
    .in('id', unique);

  if (error || !data) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map(shapeTaskRow);
}
