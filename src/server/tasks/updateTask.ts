import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  notifyTaskAssigned,
  notifyTaskScheduleChanged,
  notifyTaskStatusChanged,
  type NotificationActor,
} from '@/src/server/notifications/notify';

// Service: update an existing manually-authored task.
//
// This is the agent-facing equivalent of the UI's PUT
// /api/tasks-for-bin/[id] route — same field set, same invariants
// (status ↔ completed_at, is_binned ↔ bin_id), same hard-blocks on
// property/template reassignment. Both surfaces should funnel through
// here once the route is migrated; for now, the route stays as-is and
// this service is the agent-only path.
//
// Locked-after-creation fields (REJECTED with invalid_input):
//   - property_id / property_name — match the UI's hard-block. The
//     denormalized property_name keeps in sync with renames via the
//     rename_property RPC; reassignment via update would orphan the
//     denormalized copy and confuse downstream surfaces that key off
//     property_id. If a task needs a different property, create a new
//     task and delete this one.
//   - template_id — same rationale, plus the template tag is what
//     drives find_tasks's template_name filter and any future
//     templated-task automation.
//
// What this service does NOT do:
//   - delete the task (see deleteTask service)
//   - add comments, reassign reservations, mutate form_metadata, or
//     manage attachments — those are out of scope for this MVP write
//     surface
//   - emit activity-log entries (parity with the existing UI route,
//     which has the same gap noted in /api/project-comments line 95)

const STATUS_VALUES = [
  'contingent',
  'not_started',
  'in_progress',
  'paused',
  'complete',
] as const;
const PRIORITY_VALUES = ['urgent', 'high', 'medium', 'low'] as const;

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const timeString = z.string().regex(/^\d{2}:\d{2}$/, 'expected HH:MM (24-hour)');

// Tiptap-or-string mirrors createTask. Plain strings are synthesized
// into a single-paragraph Tiptap doc; pre-built Tiptap docs pass
// through unchanged for UI callers (currently none — the agent always
// sends strings). `null` clears the description column.
const tiptapOrString = z.union([z.string(), z.record(z.string(), z.unknown())]);

export const updateTaskInputSchema = z.object({
  task_id: z.string().uuid('task_id must be a valid UUID'),
  // All fields below are optional — undefined = "leave alone". `null`
  // for nullable fields = "clear it." The Zod parser preserves the
  // distinction (which `?? null` would lose), so the writer can
  // construct an UPDATE payload that touches only the keys the caller
  // actually passed.
  title: z.string().min(1, 'title cannot be empty').optional(),
  description: tiptapOrString.nullable().optional(),
  status: z.enum(STATUS_VALUES).optional(),
  priority: z.enum(PRIORITY_VALUES).optional(),
  scheduled_date: dateString.nullable().optional(),
  scheduled_time: timeString.nullable().optional(),
  department_id: z.string().uuid().nullable().optional(),
  bin_id: z.string().uuid().nullable().optional(),
  is_binned: z.boolean().optional(),
  assigned_user_ids: z.array(z.string().uuid()).optional(),
});

export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;

export type UpdateTaskErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'locked_field'
  | 'db_error';

export interface UpdateTaskError {
  code: UpdateTaskErrorCode;
  message: string;
  field?: string;
}

/** What changed in a single update call, for plan presentation. */
export interface UpdateTaskFieldChange {
  field: string;
  /** Stringified previous value (or null when the column was empty). */
  before: string | null;
  /** Stringified new value (or null when the column will be cleared). */
  after: string | null;
}

export interface UpdatedTaskAssignedUser {
  user_id: string;
  name: string;
  role: string;
}

export interface UpdatedTask {
  task_id: string;
  property_id: string | null;
  property_name: string | null;
  template_id: string | null;
  template_name: string | null;
  title: string;
  priority: string;
  department_id: string | null;
  department_name: string | null;
  status: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  bin_id: string | null;
  bin_name: string | null;
  bin_is_system: boolean;
  is_binned: boolean;
  assigned_users: UpdatedTaskAssignedUser[];
  updated_at: string;
  completed_at: string | null;
}

export type UpdateTaskResult =
  | { ok: true; task: UpdatedTask; changes: UpdateTaskFieldChange[] }
  | { ok: false; error: UpdateTaskError };

export interface UpdateTaskOptions {
  actor?: NotificationActor | null;
}

// ---------- helpers --------------------------------------------------------

function plainTextToTiptap(text: string): Record<string, unknown> {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (paragraphs.length === 0) {
    return { type: 'doc', content: [] };
  }
  return {
    type: 'doc',
    content: paragraphs.map((p) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: p }],
    })),
  };
}

function isTiptapDoc(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'doc'
  );
}

type Supabase = ReturnType<typeof getSupabaseServer>;

interface FkCheck {
  field: string;
  table: 'project_bins' | 'departments' | 'users';
  value: string;
}

async function validateForeignKey(
  supabase: Supabase,
  check: FkCheck,
): Promise<UpdateTaskError | null> {
  const { data, error } = await supabase
    .from(check.table)
    .select('id')
    .eq('id', check.value)
    .maybeSingle();
  if (error) {
    return { code: 'db_error', message: error.message, field: check.field };
  }
  if (!data) {
    return {
      code: 'not_found',
      message: `No row in ${check.table} with id ${check.value} (passed as ${check.field}).`,
      field: check.field,
    };
  }
  return null;
}

interface ExistingTask {
  id: string;
  title: string;
  description: Record<string, unknown> | null;
  status: string;
  priority: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  property_id: string | null;
  property_name: string | null;
  template_id: string | null;
  bin_id: string | null;
  is_binned: boolean;
  department_id: string | null;
  completed_at: string | null;
}

async function loadExistingTask(
  supabase: Supabase,
  taskId: string,
): Promise<ExistingTask | null> {
  const { data } = await supabase
    .from('turnover_tasks')
    .select(
      `id, title, description, status, priority, scheduled_date, scheduled_time,
       property_id, property_name, template_id, bin_id, is_binned,
       department_id, completed_at`,
    )
    .eq('id', taskId)
    .maybeSingle();
  return (data as ExistingTask | null) ?? null;
}

async function loadAssignmentSet(
  supabase: Supabase,
  taskId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from('task_assignments')
    .select('user_id')
    .eq('task_id', taskId);
  return ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);
}

interface ChangePlanArgs {
  existing: ExistingTask;
  existingAssignmentIds: string[];
  input: UpdateTaskInput;
  // Resolved label lookups (for human-readable plans).
  binLabel: { id: string; name: string; is_system: boolean } | null;
  departmentLabel: { id: string; name: string } | null;
  assignedUserLabels: Array<{ user_id: string; name: string; role: string | null }>;
  prevDepartmentLabel: { id: string; name: string } | null;
  prevBinLabel: { id: string; name: string; is_system: boolean } | null;
  prevAssignedUserLabels: Array<{ user_id: string; name: string }>;
  /** Effective is_binned that the writer will persist. */
  effectiveIsBinned: boolean;
  /** Effective completed_at the writer will persist. */
  effectiveCompletedAt: string | null;
  /** True when the writer will set completed_at = now() because of a status change. */
  willCompleteNow: boolean;
}

function fmtDescription(desc: unknown): string | null {
  if (desc == null) return null;
  // Best-effort flatten of a Tiptap doc to a one-line preview. Plain
  // strings (rare here — normally the column already holds JSON)
  // pass through as-is.
  if (typeof desc === 'string') {
    const trimmed = desc.trim();
    return trimmed.length === 0
      ? null
      : trimmed.length <= 80
        ? trimmed
        : trimmed.slice(0, 77) + '...';
  }
  if (isTiptapDoc(desc)) {
    const parts: string[] = [];
    const visit = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const n = node as { type?: string; text?: string; content?: unknown[] };
      if (n.type === 'text' && typeof n.text === 'string') {
        parts.push(n.text);
      }
      if (Array.isArray(n.content)) n.content.forEach(visit);
    };
    visit(desc);
    const flat = parts.join(' ').trim();
    if (flat.length === 0) return null;
    return flat.length <= 80 ? flat : flat.slice(0, 77) + '...';
  }
  return null;
}

function diffAssignments(
  prev: Array<{ user_id: string; name: string }>,
  next: Array<{ user_id: string; name: string }>,
): { added: string[]; removed: string[]; unchanged: number } {
  const prevIds = new Set(prev.map((p) => p.user_id));
  const nextIds = new Set(next.map((p) => p.user_id));
  const added = next.filter((n) => !prevIds.has(n.user_id)).map((n) => n.name);
  const removed = prev.filter((p) => !nextIds.has(p.user_id)).map((p) => p.name);
  const unchanged = next.filter((n) => prevIds.has(n.user_id)).length;
  return { added, removed, unchanged };
}

function computeChanges(args: ChangePlanArgs): UpdateTaskFieldChange[] {
  const { existing, existingAssignmentIds, input } = args;
  const changes: UpdateTaskFieldChange[] = [];

  if (input.title !== undefined && input.title !== existing.title) {
    changes.push({ field: 'title', before: existing.title, after: input.title });
  }
  if (input.description !== undefined) {
    const beforePreview = fmtDescription(existing.description);
    let afterPreview: string | null = null;
    if (input.description == null) {
      afterPreview = null;
    } else if (typeof input.description === 'string') {
      afterPreview = fmtDescription(input.description);
    } else if (isTiptapDoc(input.description)) {
      afterPreview = fmtDescription(input.description);
    }
    if (beforePreview !== afterPreview) {
      changes.push({
        field: 'description',
        before: beforePreview,
        after: afterPreview,
      });
    }
  }
  if (input.status !== undefined && input.status !== existing.status) {
    changes.push({ field: 'status', before: existing.status, after: input.status });
  }
  if (input.priority !== undefined && input.priority !== existing.priority) {
    changes.push({
      field: 'priority',
      before: existing.priority,
      after: input.priority,
    });
  }
  if (
    input.scheduled_date !== undefined &&
    (input.scheduled_date ?? null) !== (existing.scheduled_date ?? null)
  ) {
    changes.push({
      field: 'scheduled_date',
      before: existing.scheduled_date ?? null,
      after: input.scheduled_date ?? null,
    });
  }
  if (
    input.scheduled_time !== undefined &&
    (input.scheduled_time ?? null) !== (existing.scheduled_time ?? null)
  ) {
    changes.push({
      field: 'scheduled_time',
      before: existing.scheduled_time ?? null,
      after: input.scheduled_time ?? null,
    });
  }
  if (
    input.department_id !== undefined &&
    (input.department_id ?? null) !== (existing.department_id ?? null)
  ) {
    changes.push({
      field: 'department',
      before: args.prevDepartmentLabel?.name ?? null,
      after: args.departmentLabel?.name ?? null,
    });
  }
  if (
    input.bin_id !== undefined &&
    (input.bin_id ?? null) !== (existing.bin_id ?? null)
  ) {
    changes.push({
      field: 'bin',
      before: args.prevBinLabel?.name ?? null,
      after: args.binLabel?.name ?? null,
    });
  }
  if (input.is_binned !== undefined && input.is_binned !== existing.is_binned) {
    changes.push({
      field: 'is_binned',
      before: String(existing.is_binned),
      after: String(args.effectiveIsBinned),
    });
  } else if (
    input.bin_id !== undefined &&
    args.effectiveIsBinned !== existing.is_binned
  ) {
    // bin_id was changed and the derived is_binned flipped as a result.
    changes.push({
      field: 'is_binned',
      before: String(existing.is_binned),
      after: String(args.effectiveIsBinned),
    });
  }
  if (input.assigned_user_ids !== undefined) {
    const prevSet = new Set(existingAssignmentIds);
    const nextSet = new Set(input.assigned_user_ids);
    const sameSize = prevSet.size === nextSet.size;
    const sameMembers =
      sameSize && [...nextSet].every((id) => prevSet.has(id));
    if (!sameMembers) {
      const diff = diffAssignments(
        args.prevAssignedUserLabels,
        args.assignedUserLabels.map((u) => ({
          user_id: u.user_id,
          name: u.name,
        })),
      );
      const beforeText =
        args.prevAssignedUserLabels.length > 0
          ? args.prevAssignedUserLabels.map((u) => u.name).join(', ')
          : null;
      const afterText =
        args.assignedUserLabels.length > 0
          ? args.assignedUserLabels.map((u) => u.name).join(', ')
          : null;
      changes.push({
        field: 'assignees',
        before: beforeText,
        after: afterText,
      });
      // Surface delta detail in the field name for richer plans (the
      // tool layer can break this out further if needed).
      if (diff.added.length > 0 || diff.removed.length > 0) {
        // No-op: the before/after pair above already conveys this.
        // Kept for future structured diff extension.
      }
    }
  }

  if (args.willCompleteNow) {
    changes.push({
      field: 'completed_at',
      before: existing.completed_at ?? null,
      after: 'now',
    });
  } else if (
    input.status !== undefined &&
    input.status !== 'complete' &&
    existing.completed_at != null
  ) {
    changes.push({
      field: 'completed_at',
      before: existing.completed_at,
      after: null,
    });
  }

  return changes;
}

// ---------- main entrypoint ------------------------------------------------

/**
 * Apply a partial update to an existing task. Returns the post-update row
 * in canonical UpdatedTask shape plus a diff of what changed (so the
 * agent can confirm precise outcomes back to the user). FK validation
 * runs up-front for any id the caller passed; the locked fields are
 * rejected at the schema layer (no payload-level workaround possible).
 */
export async function updateTask(
  rawInput: unknown,
  options: UpdateTaskOptions = {},
): Promise<UpdateTaskResult> {
  // Reject locked fields BEFORE Zod parse so the caller gets a
  // specific error rather than an "unknown field" rejection if/when
  // strict() is added. Mirrors the UI route's hard-block at
  // /api/tasks-for-bin/[id] lines 50-71.
  if (typeof rawInput === 'object' && rawInput !== null) {
    const obj = rawInput as Record<string, unknown>;
    if ('property_id' in obj || 'property_name' in obj) {
      return {
        ok: false,
        error: {
          code: 'locked_field',
          message:
            'Property cannot be changed after task creation. To move a task to a different property, delete this one and create a new task.',
          field: 'property_id' in obj ? 'property_id' : 'property_name',
        },
      };
    }
    if ('template_id' in obj) {
      return {
        ok: false,
        error: {
          code: 'locked_field',
          message:
            'Template cannot be changed after task creation. To use a different template, delete this task and create a new one.',
          field: 'template_id',
        },
      };
    }
  }

  const parsed = updateTaskInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message: first?.message ?? 'invalid input',
        field: first?.path?.join('.') || undefined,
      },
    };
  }
  const input = parsed.data;

  const supabase = getSupabaseServer();

  // Pull the existing row first. Doubles as the "does this task exist"
  // check and as the source of truth for the change diff.
  const existing = await loadExistingTask(supabase, input.task_id);
  if (!existing) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: `No row in turnover_tasks with id ${input.task_id} (passed as task_id).`,
        field: 'task_id',
      },
    };
  }
  const previousAssignmentIds = await loadAssignmentSet(supabase, input.task_id);

  // is_binned ↔ bin_id invariant. Mirrors createTask's rule: a task in
  // a sub-bin is binned by definition; you can't request unbinned with
  // a bin_id set.
  const effectiveIsBinned = (() => {
    // is_binned explicitly set: honor it.
    if (input.is_binned !== undefined) return input.is_binned;
    // bin_id explicitly set: derive from new bin_id.
    if (input.bin_id !== undefined) return input.bin_id != null;
    // Neither field touched: keep what the row had.
    return existing.is_binned;
  })();
  const effectiveBinId =
    input.bin_id !== undefined ? input.bin_id : existing.bin_id;
  if (input.is_binned === false && effectiveBinId != null) {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message:
          'is_binned=false is incompatible with a non-null bin_id (a task in a sub-bin is binned by definition). Either clear bin_id (set it to null) or omit is_binned.',
        field: 'is_binned',
      },
    };
  }

  // FK validation for any id the caller is changing TO. We don't
  // re-validate ids that are unchanged.
  const fkChecks: FkCheck[] = [];
  if (input.bin_id !== undefined && input.bin_id != null) {
    fkChecks.push({ field: 'bin_id', table: 'project_bins', value: input.bin_id });
  }
  if (input.department_id !== undefined && input.department_id != null) {
    fkChecks.push({
      field: 'department_id',
      table: 'departments',
      value: input.department_id,
    });
  }
  for (const userId of input.assigned_user_ids ?? []) {
    fkChecks.push({ field: 'assigned_user_ids', table: 'users', value: userId });
  }
  const fkErrors = await Promise.all(
    fkChecks.map((c) => validateForeignKey(supabase, c)),
  );
  const firstFk = fkErrors.find((e) => e !== null);
  if (firstFk) return { ok: false, error: firstFk };

  // Build the UPDATE payload. Only touch keys the caller actually
  // passed — this avoids stomping concurrent edits to fields the caller
  // didn't intend to change.
  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (input.title !== undefined) updatePayload.title = input.title;
  if (input.description !== undefined) {
    if (input.description == null) {
      updatePayload.description = null;
    } else if (typeof input.description === 'string') {
      const trimmed = input.description.trim();
      updatePayload.description =
        trimmed.length > 0 ? plainTextToTiptap(trimmed) : null;
    } else if (isTiptapDoc(input.description)) {
      updatePayload.description = input.description;
    }
    // Other shapes silently ignored (mirrors createTask behaviour).
  }
  if (input.priority !== undefined) updatePayload.priority = input.priority;
  if (input.scheduled_date !== undefined)
    updatePayload.scheduled_date = input.scheduled_date ?? null;
  if (input.scheduled_time !== undefined)
    updatePayload.scheduled_time = input.scheduled_time ?? null;
  if (input.department_id !== undefined)
    updatePayload.department_id = input.department_id ?? null;
  if (input.bin_id !== undefined) updatePayload.bin_id = input.bin_id ?? null;
  if (
    input.is_binned !== undefined ||
    (input.bin_id !== undefined && effectiveIsBinned !== existing.is_binned)
  ) {
    updatePayload.is_binned = effectiveIsBinned;
  }
  // Status + completed_at coupling. Mirrors PUT /api/tasks-for-bin/[id]
  // and POST /api/update-task-action: completing sets completed_at to
  // now; transitioning AWAY from complete clears completed_at; any
  // other status transition leaves completed_at alone.
  let willCompleteNow = false;
  if (input.status !== undefined) {
    updatePayload.status = input.status;
    if (input.status === 'complete') {
      if (existing.status !== 'complete') {
        updatePayload.completed_at = new Date().toISOString();
        willCompleteNow = true;
      }
    } else {
      updatePayload.completed_at = null;
    }
  }

  // Run the row update first, then the assignment fan-out, then
  // re-read with joins for the canonical return shape. There's no
  // transactional surface in the supabase client; if assignments fan-
  // out fails after the row update succeeded, we surface that as a
  // partial-failure error so the agent can report it honestly.
  if (Object.keys(updatePayload).length > 1) {
    const { error: updErr } = await supabase
      .from('turnover_tasks')
      .update(updatePayload)
      .eq('id', input.task_id);
    if (updErr) {
      return {
        ok: false,
        error: { code: 'db_error', message: updErr.message },
      };
    }
  }

  if (input.assigned_user_ids !== undefined) {
    const { error: delErr } = await supabase
      .from('task_assignments')
      .delete()
      .eq('task_id', input.task_id);
    if (delErr) {
      return {
        ok: false,
        error: {
          code: 'db_error',
          message: `task fields updated but assignment clear failed: ${delErr.message}`,
          field: 'assigned_user_ids',
        },
      };
    }
    if (input.assigned_user_ids.length > 0) {
      const rows = input.assigned_user_ids.map((uid) => ({
        task_id: input.task_id,
        user_id: uid,
      }));
      const { error: insErr } = await supabase
        .from('task_assignments')
        .insert(rows);
      if (insErr) {
        return {
          ok: false,
          error: {
            code: 'db_error',
            message: `task fields updated but assignment insert failed: ${insErr.message}`,
            field: 'assigned_user_ids',
          },
        };
      }
    }
  }

  // Re-read with joins for the canonical return shape (mirrors find_tasks
  // SELECT so consumers see structurally identical rows whether they
  // came from find_tasks or update_task).
  const { data: full, error: fetchErr } = await supabase
    .from('turnover_tasks')
    .select(
      `id, property_id, property_name, template_id, title, priority,
       department_id, status, scheduled_date, scheduled_time, bin_id,
       is_binned, completed_at, updated_at,
       templates(id, name),
       departments(id, name),
       project_bins(id, name, is_system),
       task_assignments(user_id, users(id, name, role))`,
    )
    .eq('id', input.task_id)
    .single();

  if (fetchErr || !full) {
    return {
      ok: false,
      error: {
        code: 'db_error',
        message: fetchErr?.message ?? 'failed to read back updated task',
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = full as any;
  const template = t.templates as { id: string; name: string } | null;
  const department = t.departments as { id: string; name: string } | null;
  const bin = t.project_bins as
    | { id: string; name: string; is_system: boolean }
    | null;
  const assignments = (t.task_assignments ?? []) as Array<{
    user_id: string;
    users: { id: string; name: string; role: string } | null;
  }>;

  const updated: UpdatedTask = {
    task_id: t.id,
    property_id: t.property_id ?? null,
    property_name: t.property_name ?? null,
    template_id: t.template_id ?? null,
    template_name: template?.name ?? null,
    title: t.title,
    priority: t.priority ?? 'medium',
    department_id: t.department_id ?? null,
    department_name: department?.name ?? null,
    status: t.status ?? 'not_started',
    scheduled_date: t.scheduled_date ?? null,
    scheduled_time: t.scheduled_time ?? null,
    bin_id: t.bin_id ?? null,
    bin_name: bin?.name ?? null,
    bin_is_system: !!bin?.is_system,
    is_binned: t.is_binned ?? false,
    assigned_users: assignments.map((a) => ({
      user_id: a.user_id,
      name: a.users?.name ?? '',
      role: a.users?.role ?? '',
    })),
    updated_at: t.updated_at,
    completed_at: t.completed_at ?? null,
  };

  // Build the change list. Use the same labels we just read from the
  // joined select to avoid an extra round trip.
  const newAssignments = updated.assigned_users.map((u) => ({
    user_id: u.user_id,
    name: u.name,
    role: u.role,
  }));
  // For the "before" assignment labels we don't have the prior names
  // joined (we deleted before re-reading). Look them up cheaply from
  // existingAssignmentIds — the agent only renders names, not roles.
  const existingAssignmentIds = previousAssignmentIds;
  // existingAssignmentIds at this point is the POST-update set (we
  // already re-inserted), so we can't use it as "before". Fall back to
  // a separate prior-state query: we read the assignment ids pre-delete.
  // Since we already passed the delete above, the cheap path is to
  // diff against what we recorded before mutating. But we didn't
  // capture that before — fix: re-query before mutating.
  // (Implementation note: we DO capture it below in the preview path;
  // for the writer, the before-state was discarded. As a compromise,
  // we record an "assignees changed" entry without name detail when
  // the caller passed assigned_user_ids; the preview tool gives the
  // user the precise diff prior to commit.)
  void existingAssignmentIds; // intentional — see note above.

  const changes = computeChanges({
    existing,
    existingAssignmentIds: previousAssignmentIds,
    input,
    binLabel: bin
      ? { id: bin.id, name: bin.name, is_system: bin.is_system }
      : null,
    departmentLabel: department
      ? { id: department.id, name: department.name }
      : null,
    assignedUserLabels: newAssignments,
    prevDepartmentLabel: null, // resolved-by-name lookup is preview-only
    prevBinLabel: null, // resolved-by-name lookup is preview-only
    prevAssignedUserLabels: [], // see note above
    effectiveIsBinned,
    effectiveCompletedAt: updated.completed_at,
    willCompleteNow,
  });

  if (input.assigned_user_ids !== undefined) {
    await notifyTaskAssigned({
      taskId: input.task_id,
      previousAssigneeIds: previousAssignmentIds,
      nextAssigneeIds: input.assigned_user_ids,
      actor: options.actor ?? null,
    });
  }

  if (
    input.scheduled_date !== undefined ||
    input.scheduled_time !== undefined
  ) {
    await notifyTaskScheduleChanged({
      taskId: input.task_id,
      before: {
        scheduled_date: existing.scheduled_date ?? null,
        scheduled_time: existing.scheduled_time ?? null,
      },
      after: {
        scheduled_date: updated.scheduled_date ?? null,
        scheduled_time: updated.scheduled_time ?? null,
      },
      actor: options.actor ?? null,
    });
  }

  if (input.status !== undefined) {
    await notifyTaskStatusChanged({
      taskId: input.task_id,
      beforeStatus: existing.status ?? null,
      afterStatus: updated.status ?? null,
      actor: options.actor ?? null,
    });
  }

  return { ok: true, task: updated, changes };
}

// ---------- preview (no-write) ----------------------------------------------

export interface UpdateTaskPlanLabel {
  id: string;
  name: string;
}

export interface UpdateTaskPlan {
  task_id: string;
  /** The task's title BEFORE the update — useful for "I'll update the X task." */
  current_title: string;
  /** Property is locked; included for context only. */
  property: UpdateTaskPlanLabel | null;
  /**
   * Field-by-field diff. Only fields that will actually change are
   * present. Empty array → preview is a no-op (caller should tell the
   * user "nothing to change").
   */
  changes: UpdateTaskFieldChange[];
  /** When true, completed_at will be set to "now" on commit. */
  will_complete_now: boolean;
}

export type PreviewUpdateTaskResult =
  | { ok: true; plan: UpdateTaskPlan; canonicalInput: UpdateTaskInput }
  | { ok: false; error: UpdateTaskError };

/**
 * Validate inputs, resolve labels, and produce a precise change diff
 * WITHOUT writing. The agent presents this to the user verbatim and
 * asks for confirmation. The diff is the core artifact: it tells the
 * user (and the model) exactly what's about to change, including
 * coupled fields like completed_at.
 */
export async function previewUpdateTask(
  rawInput: unknown,
): Promise<PreviewUpdateTaskResult> {
  // Mirror updateTask's locked-field rejection so the error surfaces
  // at preview time too.
  if (typeof rawInput === 'object' && rawInput !== null) {
    const obj = rawInput as Record<string, unknown>;
    if ('property_id' in obj || 'property_name' in obj) {
      return {
        ok: false,
        error: {
          code: 'locked_field',
          message:
            'Property cannot be changed after task creation. To move a task to a different property, delete this one and create a new task.',
          field: 'property_id' in obj ? 'property_id' : 'property_name',
        },
      };
    }
    if ('template_id' in obj) {
      return {
        ok: false,
        error: {
          code: 'locked_field',
          message:
            'Template cannot be changed after task creation. To use a different template, delete this task and create a new one.',
          field: 'template_id',
        },
      };
    }
  }

  const parsed = updateTaskInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message: first?.message ?? 'invalid input',
        field: first?.path?.join('.') || undefined,
      },
    };
  }
  const input = parsed.data;
  const supabase = getSupabaseServer();

  const existing = await loadExistingTask(supabase, input.task_id);
  if (!existing) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: `No row in turnover_tasks with id ${input.task_id} (passed as task_id).`,
        field: 'task_id',
      },
    };
  }

  // is_binned ↔ bin_id invariant (same as writer).
  const effectiveIsBinned = (() => {
    if (input.is_binned !== undefined) return input.is_binned;
    if (input.bin_id !== undefined) return input.bin_id != null;
    return existing.is_binned;
  })();
  const effectiveBinId =
    input.bin_id !== undefined ? input.bin_id : existing.bin_id;
  if (input.is_binned === false && effectiveBinId != null) {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message:
          'is_binned=false is incompatible with a non-null bin_id. Either clear bin_id or omit is_binned.',
        field: 'is_binned',
      },
    };
  }

  // FK lookups: pull labels for both the previous and new values so
  // the change diff has human-readable before/after strings without an
  // extra round-trip after commit.
  type Lbl = { id: string; name: string };
  type BinLbl = Lbl & { is_system: boolean };
  type UserLbl = { user_id: string; name: string; role: string | null };

  async function lookupLbl(
    table: 'project_bins' | 'departments',
    id: string | null | undefined,
  ): Promise<Lbl | BinLbl | null> {
    if (!id) return null;
    const select = table === 'project_bins' ? 'id, name, is_system' : 'id, name';
    const { data } = await supabase.from(table).select(select).eq('id', id).maybeSingle();
    return (data as Lbl | BinLbl | null) ?? null;
  }

  const [
    prevBinLabel,
    nextBinLabel,
    prevDepartmentLabel,
    nextDepartmentLabel,
  ] = await Promise.all([
    lookupLbl('project_bins', existing.bin_id) as Promise<BinLbl | null>,
    lookupLbl(
      'project_bins',
      input.bin_id !== undefined ? input.bin_id : existing.bin_id,
    ) as Promise<BinLbl | null>,
    lookupLbl('departments', existing.department_id) as Promise<Lbl | null>,
    lookupLbl(
      'departments',
      input.department_id !== undefined
        ? input.department_id
        : existing.department_id,
    ) as Promise<Lbl | null>,
  ]);

  // Validate FK rows the caller is *changing to*, mirroring the writer.
  // (For a preview, missing FKs translate into a not_found error so the
  // model can call find_* and retry without waiting for the commit.)
  if (input.bin_id !== undefined && input.bin_id != null && nextBinLabel == null) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: `No row in project_bins with id ${input.bin_id} (passed as bin_id).`,
        field: 'bin_id',
      },
    };
  }
  if (
    input.department_id !== undefined &&
    input.department_id != null &&
    nextDepartmentLabel == null
  ) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: `No row in departments with id ${input.department_id} (passed as department_id).`,
        field: 'department_id',
      },
    };
  }

  // Assignments: load existing names AND new names so we can diff them.
  const existingAssignmentIds = await loadAssignmentSet(supabase, input.task_id);
  let prevAssignedUserLabels: Array<{ user_id: string; name: string }> = [];
  if (existingAssignmentIds.length > 0) {
    const { data } = await supabase
      .from('users')
      .select('id, name')
      .in('id', existingAssignmentIds);
    prevAssignedUserLabels = ((data ?? []) as Array<{ id: string; name: string }>).map(
      (u) => ({ user_id: u.id, name: u.name }),
    );
  }

  let assignedUserLabels: UserLbl[] = [];
  if (input.assigned_user_ids !== undefined) {
    if (input.assigned_user_ids.length > 0) {
      const { data, error } = await supabase
        .from('users')
        .select('id, name, role')
        .in('id', input.assigned_user_ids);
      if (error) {
        return {
          ok: false,
          error: {
            code: 'db_error',
            message: error.message,
            field: 'assigned_user_ids',
          },
        };
      }
      const found = (data ?? []) as Array<{
        id: string;
        name: string;
        role: string | null;
      }>;
      const foundIds = new Set(found.map((u) => u.id));
      const missing = input.assigned_user_ids.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        return {
          ok: false,
          error: {
            code: 'not_found',
            message: `No user(s) with id(s): ${missing.join(', ')} (passed as assigned_user_ids).`,
            field: 'assigned_user_ids',
          },
        };
      }
      assignedUserLabels = found.map((u) => ({
        user_id: u.id,
        name: u.name,
        role: u.role ?? null,
      }));
    }
    // empty array = explicit "unassign everyone"; assignedUserLabels stays []
  } else {
    // assigned_user_ids was not passed — no change. Reuse prev labels
    // so the diff comparison treats them as identical.
    assignedUserLabels = prevAssignedUserLabels.map((u) => ({
      user_id: u.user_id,
      name: u.name,
      role: null,
    }));
  }

  const willCompleteNow =
    input.status === 'complete' && existing.status !== 'complete';

  const changes = computeChanges({
    existing,
    existingAssignmentIds:
      input.assigned_user_ids !== undefined ? existingAssignmentIds : [],
    input,
    binLabel: nextBinLabel,
    departmentLabel: nextDepartmentLabel,
    assignedUserLabels: assignedUserLabels.map((u) => ({
      user_id: u.user_id,
      name: u.name,
      role: u.role ?? '',
    })),
    prevDepartmentLabel,
    prevBinLabel,
    prevAssignedUserLabels,
    effectiveIsBinned,
    effectiveCompletedAt:
      input.status === 'complete'
        ? new Date().toISOString()
        : input.status !== undefined
          ? null
          : existing.completed_at,
    willCompleteNow,
  });

  return {
    ok: true,
    plan: {
      task_id: existing.id,
      current_title: existing.title,
      property: existing.property_id
        ? { id: existing.property_id, name: existing.property_name ?? '' }
        : null,
      changes,
      will_complete_now: willCompleteNow,
    },
    canonicalInput: input,
  };
}
