import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';

// Service: create a manually-authored task.
//
// This is the single source of truth for the manual task-creation path.
// Both the HTTP route (app/api/tasks-for-bin/route.ts POST) and the agent
// tool (src/agent/tools/createTask.ts) wrap this function. The shared
// service ensures that the UI and the agent always produce structurally
// identical rows, validate the same inputs, and surface the same errors —
// no drift, no self-fetch, no duplicated SQL.
//
// What this service deliberately does NOT do:
//   - bind the new task to a reservation (reservation_id is automation-only;
//     manual tasks become "associated" with a reservation purely by
//     scheduled_date falling within that reservation's turnover window)
//   - apply per-property automation config (templated/auto-scheduled tasks
//     go through app/api/tasks/route.ts POST, which is a different gesture)
//   - allow direct writes of `property_name` (the rename_property RPC keeps
//     the denormalized copy in sync; we only write `property_id` here)
//
// `is_binned` is derived: a task is binned iff a `bin_id` is set. The
// previous route accepted is_binned as a separate field, but every UI
// surface already follows this rule, so the service drops it as a
// redundant knob.

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

// Tiptap doc: a structured rich-text JSON object. We accept either:
//   - a plain string (synthesized into a single-paragraph Tiptap doc), or
//   - a Tiptap doc object (passed through unchanged for UI callers that
//     already produced one in their editor).
const tiptapOrString = z.union([z.string(), z.record(z.string(), z.unknown())]);

export const createTaskInputSchema = z.object({
  title: z.string().min(1, 'title is required'),
  description: tiptapOrString.nullable().optional(),
  status: z.enum(STATUS_VALUES).optional(),
  priority: z.enum(PRIORITY_VALUES).optional(),
  scheduled_date: dateString.nullable().optional(),
  scheduled_time: timeString.nullable().optional(),
  property_id: z.string().uuid().nullable().optional(),
  bin_id: z.string().uuid().nullable().optional(),
  department_id: z.string().uuid().nullable().optional(),
  template_id: z.string().uuid().nullable().optional(),
  assigned_user_ids: z.array(z.string().uuid()).optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;

export type CreateTaskErrorCode = 'invalid_input' | 'not_found' | 'db_error';

export interface CreateTaskError {
  code: CreateTaskErrorCode;
  message: string;
  /** Which input field caused the error, when applicable. */
  field?: string;
}

export interface CreatedTaskAssignedUser {
  user_id: string;
  name: string;
  role: string;
  /** Present when joined; the agent ignores it but UI consumers render it. */
  email?: string | null;
  /** Present when joined; UI consumers render an avatar from this. */
  avatar?: string | null;
  /** Timestamp of the assignment row itself (not the task). */
  assigned_at?: string | null;
}

/**
 * Canonical "task as the system sees it" shape. Mirrors the agent's
 * find_tasks TaskRow with `description` and `form_metadata` added so a
 * caller that just inserted the row can render its own confirmation
 * without a follow-up read. HTTP routes that need a different
 * legacy-compatible shape project to it themselves.
 */
export interface CreatedTask {
  task_id: string;
  reservation_id: string | null;
  property_id: string | null;
  property_name: string | null;
  template_id: string | null;
  template_name: string | null;
  title: string;
  description: Record<string, unknown> | null;
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
  has_template: boolean;
  form_metadata: Record<string, unknown> | null;
  assigned_users: CreatedTaskAssignedUser[];
  comment_count: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export type CreateTaskResult =
  | { ok: true; task: CreatedTask }
  | { ok: false; error: CreateTaskError };

// ---------- helpers ---------------------------------------------------------

function plainTextToTiptap(text: string): Record<string, unknown> {
  // Split on blank lines to produce one paragraph per chunk. Empty input
  // returns an empty doc so the column is `{type: 'doc', content: []}`
  // rather than null — matches what an empty Tiptap editor emits.
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
  table: 'properties' | 'project_bins' | 'departments' | 'templates' | 'users';
  value: string;
}

async function validateForeignKey(
  supabase: Supabase,
  check: FkCheck,
): Promise<CreateTaskError | null> {
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

// ---------- main entrypoint ------------------------------------------------

/**
 * Insert a new task with optional assignments. Returns the inserted row in
 * the canonical CreatedTask shape (joined for display). Validation,
 * FK pre-checks, and rich-text synthesis are all performed here so the
 * route and the agent tool can share identical behavior.
 */
export async function createTask(rawInput: unknown): Promise<CreateTaskResult> {
  const parsed = createTaskInputSchema.safeParse(rawInput);
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

  // FK pre-validation. Cheap maybeSingle() checks up front so the caller
  // gets a structured "not_found" with the offending field, instead of an
  // opaque Postgres FK violation surfacing on insert.
  //
  // Property is special: we also need its `name` for the denormalized
  // `turnover_tasks.property_name` column the UI reads from. There is no
  // DB-level trigger keeping that column in sync on insert (only the
  // rename_property RPC does, on update), so the create path has to write
  // both fields itself. Pulling `id, name` once here lets us validate AND
  // denormalize without a second round trip.
  let resolvedPropertyName: string | null = null;
  if (input.property_id) {
    const { data: prop, error: propErr } = await supabase
      .from('properties')
      .select('id, name')
      .eq('id', input.property_id)
      .maybeSingle();
    if (propErr) {
      return {
        ok: false,
        error: { code: 'db_error', message: propErr.message, field: 'property_id' },
      };
    }
    if (!prop) {
      return {
        ok: false,
        error: {
          code: 'not_found',
          message: `No row in properties with id ${input.property_id} (passed as property_id).`,
          field: 'property_id',
        },
      };
    }
    resolvedPropertyName = (prop as { id: string; name: string }).name;
  }

  // The remaining FKs (bin, department, template, users) only need
  // existence checks — none of them are denormalized onto the task row.
  const checks: FkCheck[] = [];
  if (input.bin_id) {
    checks.push({ field: 'bin_id', table: 'project_bins', value: input.bin_id });
  }
  if (input.department_id) {
    checks.push({ field: 'department_id', table: 'departments', value: input.department_id });
  }
  if (input.template_id) {
    checks.push({ field: 'template_id', table: 'templates', value: input.template_id });
  }
  for (const userId of input.assigned_user_ids ?? []) {
    checks.push({ field: 'assigned_user_ids', table: 'users', value: userId });
  }

  // Run all remaining FK checks in parallel; return on first failure
  // (sufficient signal for the caller to correct the input).
  const fkErrors = await Promise.all(
    checks.map((c) => validateForeignKey(supabase, c)),
  );
  const firstFkError = fkErrors.find((e) => e !== null);
  if (firstFkError) {
    return { ok: false, error: firstFkError };
  }

  // Description: plain string → single-paragraph Tiptap doc. Existing Tiptap
  // doc passes through. null/undefined/empty stays null.
  let descriptionJson: Record<string, unknown> | null = null;
  if (input.description != null) {
    if (typeof input.description === 'string') {
      const trimmed = input.description.trim();
      descriptionJson = trimmed.length > 0 ? plainTextToTiptap(trimmed) : null;
    } else if (isTiptapDoc(input.description)) {
      descriptionJson = input.description;
    }
    // Any other object shape is silently ignored (Tiptap docs always have
    // type:'doc'; anything else would corrupt the renderer).
  }

  const isBinned = input.bin_id != null;

  const insertPayload: Record<string, unknown> = {
    title: input.title,
    description: descriptionJson,
    status: input.status ?? 'not_started',
    priority: input.priority ?? 'medium',
    scheduled_date: input.scheduled_date ?? null,
    scheduled_time: input.scheduled_time ?? null,
    property_id: input.property_id ?? null,
    // Denormalized copy of properties.name. Populated here from the FK
    // pre-validation lookup above; the rename_property RPC keeps it in
    // sync on subsequent property renames. Null when no property_id.
    property_name: resolvedPropertyName,
    bin_id: input.bin_id ?? null,
    is_binned: isBinned,
    department_id: input.department_id ?? null,
    template_id: input.template_id ?? null,
  };

  const { data: inserted, error: insertError } = await supabase
    .from('turnover_tasks')
    .insert(insertPayload)
    .select('id')
    .single();
  if (insertError || !inserted) {
    return {
      ok: false,
      error: {
        code: 'db_error',
        message: insertError?.message ?? 'insert returned no row',
      },
    };
  }

  const taskId = (inserted as { id: string }).id;

  // Assignments fan-out. We've already FK-validated each user_id above, so
  // any failure here is genuinely a DB-level issue rather than bad input.
  // The task row itself is already inserted; if assignments fail we return
  // a db_error and rely on the caller to decide whether to retry. We don't
  // attempt to roll back the task (no DB transaction surface in the
  // Supabase JS client) — the row is technically valid without assignments.
  const userIds = input.assigned_user_ids ?? [];
  if (userIds.length > 0) {
    const assignments = userIds.map((uid) => ({
      task_id: taskId,
      user_id: uid,
    }));
    const { error: asgnError } = await supabase
      .from('task_assignments')
      .insert(assignments);
    if (asgnError) {
      return {
        ok: false,
        error: {
          code: 'db_error',
          message: `task created (id=${taskId}) but assignment fan-out failed: ${asgnError.message}`,
          field: 'assigned_user_ids',
        },
      };
    }
  }

  // Read back the inserted row with joins so we can return a fully-shaped
  // CreatedTask. Mirrors the SELECT used by find_tasks so the two stay in
  // sync — when one grows a join, the other should too.
  const { data: fullTask, error: fetchErr } = await supabase
    .from('turnover_tasks')
    .select(
      `
      id, reservation_id, property_id, property_name, template_id, title,
      description, priority, department_id, status, scheduled_date,
      scheduled_time, bin_id, is_binned, form_metadata, completed_at,
      created_at, updated_at,
      templates(id, name),
      departments(id, name),
      project_bins(id, name, is_system),
      task_assignments(user_id, assigned_at, users(id, name, role, email, avatar)),
      project_comments(count)
    `,
    )
    .eq('id', taskId)
    .single();

  if (fetchErr || !fullTask) {
    return {
      ok: false,
      error: {
        code: 'db_error',
        message: fetchErr?.message ?? 'failed to read back created task',
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = fullTask as any;
  const template = t.templates as { id: string; name: string } | null;
  const department = t.departments as { id: string; name: string } | null;
  const bin = t.project_bins as
    | { id: string; name: string; is_system: boolean }
    | null;
  const taskAssignments = (t.task_assignments ?? []) as Array<{
    user_id: string;
    assigned_at: string | null;
    users: {
      id: string;
      name: string;
      role: string;
      email: string | null;
      avatar: string | null;
    } | null;
  }>;
  const commentAgg = t.project_comments as Array<{ count: number }> | null;
  const commentCount = Array.isArray(commentAgg)
    ? Number(commentAgg[0]?.count ?? 0)
    : 0;

  const task: CreatedTask = {
    task_id: t.id,
    reservation_id: t.reservation_id ?? null,
    property_id: t.property_id ?? null,
    property_name: t.property_name ?? null,
    template_id: t.template_id ?? null,
    template_name: template?.name ?? null,
    title: t.title,
    description: (t.description as Record<string, unknown> | null) ?? null,
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
    has_template: t.template_id != null,
    form_metadata: (t.form_metadata as Record<string, unknown> | null) ?? null,
    assigned_users: taskAssignments.map((a) => ({
      user_id: a.user_id,
      name: a.users?.name ?? '',
      role: a.users?.role ?? '',
      email: a.users?.email ?? null,
      avatar: a.users?.avatar ?? null,
      assigned_at: a.assigned_at ?? null,
    })),
    comment_count: commentCount,
    created_at: t.created_at,
    updated_at: t.updated_at,
    completed_at: t.completed_at ?? null,
  };

  return { ok: true, task };
}

// ---------- preview (no-write) ----------------------------------------------

export interface CreateTaskPlanLabel {
  id: string;
  name: string;
}

export interface CreateTaskPlan {
  /** Final task title that will be written. */
  title: string;
  /**
   * Resolved display labels for each FK the agent passed (or null when the
   * field was omitted). The agent uses these to present a human-readable
   * summary to the user without re-querying.
   */
  property: CreateTaskPlanLabel | null;
  bin:
    | (CreateTaskPlanLabel & { is_system: boolean })
    | null;
  department: CreateTaskPlanLabel | null;
  template: CreateTaskPlanLabel | null;
  assigned_users: Array<{
    user_id: string;
    name: string;
    role: string | null;
  }>;
  /** Status that will be written (effective default applied). */
  status: string;
  /** Priority that will be written (effective default applied). */
  priority: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  /** Derived from bin (true iff bin is set). */
  is_binned: boolean;
  /**
   * Short text excerpt of the synthesized description, for plan display.
   * Null when no description was provided. Capped to 240 chars so the
   * agent can present it inline without bloat.
   */
  description_preview: string | null;
}

export type PreviewCreateTaskResult =
  | { ok: true; plan: CreateTaskPlan; canonicalInput: CreateTaskInput }
  | { ok: false; error: CreateTaskError };

/**
 * Validate inputs and resolve display labels WITHOUT writing. Returns a
 * fully-formed plan the agent can present to the user verbatim, plus the
 * canonical (Zod-parsed) input which the caller mints a confirmation
 * token against.
 *
 * This deliberately mirrors createTask's validation surface so that any
 * input which previews successfully will also write successfully (modulo
 * race conditions on the underlying rows being deleted between the two
 * calls — handled at write-time by the DB FK constraint).
 */
export async function previewCreateTask(
  rawInput: unknown,
): Promise<PreviewCreateTaskResult> {
  const parsed = createTaskInputSchema.safeParse(rawInput);
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

  // Run all FK lookups in parallel. Each lookup pulls the display label
  // (or fails with not_found, surfaced verbatim like createTask).
  type LookupOk<T> = { ok: true; value: T | null };
  type LookupErr = { ok: false; error: CreateTaskError };
  type Lookup<T> = LookupOk<T> | LookupErr;

  async function lookupSingle<T extends { id: string }>(
    table: 'properties' | 'project_bins' | 'departments' | 'templates',
    id: string | null | undefined,
    select: string,
    field: string,
  ): Promise<Lookup<T>> {
    if (!id) return { ok: true, value: null };
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .eq('id', id)
      .maybeSingle();
    if (error) {
      return {
        ok: false,
        error: { code: 'db_error', message: error.message, field },
      };
    }
    if (!data) {
      return {
        ok: false,
        error: {
          code: 'not_found',
          message: `No row in ${table} with id ${id} (passed as ${field}).`,
          field,
        },
      };
    }
    return { ok: true, value: data as T };
  }

  const [propertyLookup, binLookup, departmentLookup, templateLookup] =
    await Promise.all([
      lookupSingle<{ id: string; name: string }>(
        'properties',
        input.property_id,
        'id, name',
        'property_id',
      ),
      lookupSingle<{ id: string; name: string; is_system: boolean }>(
        'project_bins',
        input.bin_id,
        'id, name, is_system',
        'bin_id',
      ),
      lookupSingle<{ id: string; name: string }>(
        'departments',
        input.department_id,
        'id, name',
        'department_id',
      ),
      lookupSingle<{ id: string; name: string }>(
        'templates',
        input.template_id,
        'id, name',
        'template_id',
      ),
    ]);

  const lookupErr = [
    propertyLookup,
    binLookup,
    departmentLookup,
    templateLookup,
  ].find((r): r is LookupErr => r.ok === false);
  if (lookupErr) return { ok: false, error: lookupErr.error };

  // Users: batch lookup, then verify every requested id resolved.
  let assignedUsers: Array<{
    user_id: string;
    name: string;
    role: string | null;
  }> = [];
  if (input.assigned_user_ids && input.assigned_user_ids.length > 0) {
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
    assignedUsers = found.map((u) => ({
      user_id: u.id,
      name: u.name,
      role: u.role ?? null,
    }));
  }

  // Description preview: synthesize what we'd actually write, then truncate
  // for display. We don't return the full Tiptap doc — the agent only needs
  // a short string excerpt to confirm intent with the user.
  let descriptionPreview: string | null = null;
  if (input.description != null) {
    if (typeof input.description === 'string') {
      const trimmed = input.description.trim();
      if (trimmed.length > 0) {
        descriptionPreview =
          trimmed.length <= 240 ? trimmed : trimmed.slice(0, 237) + '...';
      }
    }
    // Tiptap JSON inputs (UI-shaped) skipped from preview — never used by
    // the agent path, which only sends plain text.
  }

  // Property lookup matches the type of lookupSingle's generic. Cast for
  // TS narrowing once we've confirmed no error.
  const propertyOk = propertyLookup as LookupOk<{ id: string; name: string }>;
  const binOk = binLookup as LookupOk<{
    id: string;
    name: string;
    is_system: boolean;
  }>;
  const departmentOk = departmentLookup as LookupOk<{
    id: string;
    name: string;
  }>;
  const templateOk = templateLookup as LookupOk<{
    id: string;
    name: string;
  }>;

  const plan: CreateTaskPlan = {
    title: input.title,
    property: propertyOk.value
      ? { id: propertyOk.value.id, name: propertyOk.value.name }
      : null,
    bin: binOk.value
      ? {
          id: binOk.value.id,
          name: binOk.value.name,
          is_system: binOk.value.is_system,
        }
      : null,
    department: departmentOk.value
      ? { id: departmentOk.value.id, name: departmentOk.value.name }
      : null,
    template: templateOk.value
      ? { id: templateOk.value.id, name: templateOk.value.name }
      : null,
    assigned_users: assignedUsers,
    status: input.status ?? 'not_started',
    priority: input.priority ?? 'medium',
    scheduled_date: input.scheduled_date ?? null,
    scheduled_time: input.scheduled_time ?? null,
    is_binned: input.bin_id != null,
    description_preview: descriptionPreview,
  };

  return { ok: true, plan, canonicalInput: input };
}
