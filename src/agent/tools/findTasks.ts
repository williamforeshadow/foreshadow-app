import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import type { ToolDefinition, ToolError, ToolMeta, ToolResult } from './types';

// find_tasks — discover/list operational tasks.
//
// Tasks are the operational unit Foreshadow revolves around: cleanings,
// inspections, manual to-dos, recurring jobs. This tool lets the agent slice
// the global task ledger by property, template, status/priority, schedule, or
// assignee. Mirrors the columns surfaced by /api/all-tasks but exposes
// structured filters instead of relying on client-side filtering.
//
// JSON-heavy fields (description, form_metadata, template fields) are
// intentionally omitted; a future get_task tool will return the full record
// for a single id when needed.

const STATUS_ENUM = z.enum([
  'not_started',
  'in_progress',
  'paused',
  'complete',
  'contingent',
]);
const PRIORITY_ENUM = z.enum(['urgent', 'high', 'medium', 'low']);

const inputSchema = z
  .object({
    property_id: z
      .string()
      .uuid()
      .optional()
      .describe(
        'Restrict to a single property. Use find_properties to resolve a name to an id first.',
      ),
    template_id: z
      .string()
      .uuid()
      .optional()
      .describe('Restrict to tasks spawned from a specific template.'),
    has_template: z
      .boolean()
      .optional()
      .describe(
        'true → templated tasks only. false → ad-hoc/manual tasks only. Omit for both.',
      ),
    bin_id: z
      .string()
      .optional()
      .describe(
        "Bin filter. Pass a UUID for a specific bin, '__none__' for unbinned tasks only, or '__any__' for any binned task.",
      ),
    statuses: z
      .array(STATUS_ENUM)
      .optional()
      .describe('Match any of these statuses.'),
    priorities: z
      .array(PRIORITY_ENUM)
      .optional()
      .describe('Match any of these priorities.'),
    department_id: z
      .string()
      .uuid()
      .optional()
      .describe('Restrict to a single department.'),
    department_name: z
      .string()
      .min(2)
      .optional()
      .describe(
        "Case-insensitive substring match on departments.name. Use this for category questions like 'cleaning tasks' or 'maintenance work' — it's more precise than free-text search. Ignored when department_id is also set. meta.resolved_departments lists the matched departments.",
      ),
    template_name: z
      .string()
      .min(2)
      .optional()
      .describe(
        "Case-insensitive substring match on templates.name. Use when the user names a template (e.g. 'turnover cleaning', 'deep clean') without giving an id. Ignored when template_id is also set. meta.resolved_templates lists the matched templates.",
      ),
    assignee_name: z
      .string()
      .min(2)
      .optional()
      .describe(
        'Case-insensitive substring match on users.name. Returns tasks assigned to any user that matches; meta.resolved_assignees lists the matched users so you can disambiguate.',
      ),
    scheduled_between: z
      .object({
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
          .optional(),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
          .optional(),
      })
      .optional()
      .describe('Inclusive scheduled_date range. Either bound is optional.'),
    unscheduled: z
      .boolean()
      .optional()
      .describe('When true, only tasks with no scheduled_date.'),
    overdue: z
      .boolean()
      .optional()
      .describe(
        'When true, only tasks scheduled before reference_date (or today UTC if reference_date is omitted) and not yet complete.',
      ),
    reference_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
      .optional()
      .describe(
        "Today's date in the user's timezone (YYYY-MM-DD). Pass this whenever overdue=true so the cutoff aligns with the user's local sense of 'today' instead of server UTC.",
      ),
    reservation_id: z
      .string()
      .uuid()
      .optional()
      .describe('Restrict to tasks tied to a single reservation.'),
    ids: z
      .array(z.string().uuid())
      .optional()
      .describe('Batch lookup by task UUID. Other filters are ignored when set.'),
    search: z
      .string()
      .min(2)
      .optional()
      .describe(
        'Case-insensitive substring match against task title, property_name, template_name, and department_name. Prefer department_name or template_name when the user is asking about a category they can name precisely.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Max rows to return. Default 25, hard cap 100.'),
  })
  .refine(
    (v) =>
      !(
        v.unscheduled === true &&
        (v.scheduled_between?.from || v.scheduled_between?.to)
      ),
    {
      message: 'unscheduled cannot be combined with scheduled_between',
      path: ['unscheduled'],
    },
  );

type Input = z.infer<typeof inputSchema>;

interface AssignedUser {
  user_id: string;
  name: string;
  role: string;
}

export interface TaskRow {
  task_id: string;
  reservation_id: string | null;
  property_id: string | null;
  property_name: string | null;
  template_id: string | null;
  template_name: string | null;
  title: string | null;
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
  guest_name: string | null;
  check_in: string | null;
  check_out: string | null;
  assigned_users: AssignedUser[];
  comment_count: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

const SELECT = `
  id,
  reservation_id,
  property_id,
  property_name,
  template_id,
  title,
  priority,
  department_id,
  status,
  scheduled_date,
  scheduled_time,
  bin_id,
  is_binned,
  completed_at,
  created_at,
  updated_at,
  templates(id, name),
  departments(id, name),
  project_bins(id, name, is_system),
  reservations(id, guest_name, check_in, check_out),
  task_assignments(user_id, users(id, name, role)),
  project_comments(count)
`;

const DEFAULT_LIMIT = 25;
const BIN_NONE = '__none__';
const BIN_ANY = '__any__';

// PostgREST `or()` filters use commas as separators and treat `%`/`_` as
// ILIKE wildcards. Same sanitizer used by find_properties.
function sanitizeSearchTerm(raw: string): string {
  return raw.replace(/[%_,()\\]/g, ' ').trim();
}

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

interface ResolvedAssignee {
  user_id: string;
  name: string;
}

interface ResolvedDepartment {
  department_id: string;
  name: string;
}

interface ResolvedTemplate {
  template_id: string;
  name: string;
}

type Supabase = ReturnType<typeof getSupabaseServer>;

async function resolveAssigneesByName(
  supabase: Supabase,
  rawTerm: string,
): Promise<{ ok: true; users: ResolvedAssignee[] } | { ok: false; message: string }> {
  const term = sanitizeSearchTerm(rawTerm);
  if (term.length < 2) return { ok: true, users: [] };
  const { data, error } = await supabase
    .from('users')
    .select('id, name')
    .ilike('name', `%${term}%`)
    .limit(50);
  if (error) return { ok: false, message: error.message };
  const rows = (data ?? []) as Array<{ id: string; name: string }>;
  return {
    ok: true,
    users: rows.map((u) => ({ user_id: u.id, name: u.name })),
  };
}

// Generic case-insensitive name resolver for the small lookup tables that
// back task category/template filters. Returns the raw {id, name} rows so the
// caller can both filter the main query and surface the matches in meta.
async function resolveIdsByName(
  supabase: Supabase,
  table: 'departments' | 'templates',
  rawTerm: string,
): Promise<
  { ok: true; rows: Array<{ id: string; name: string }> } | { ok: false; message: string }
> {
  const term = sanitizeSearchTerm(rawTerm);
  if (term.length < 2) return { ok: true, rows: [] };
  const { data, error } = await supabase
    .from(table)
    .select('id, name')
    .ilike('name', `%${term}%`)
    .limit(50);
  if (error) return { ok: false, message: error.message };
  return { ok: true, rows: (data ?? []) as Array<{ id: string; name: string }> };
}

async function resolveTaskIdsForUsers(
  supabase: Supabase,
  userIds: string[],
): Promise<{ ok: true; taskIds: string[] } | { ok: false; message: string }> {
  if (userIds.length === 0) return { ok: true, taskIds: [] };
  const { data, error } = await supabase
    .from('task_assignments')
    .select('task_id')
    .in('user_id', userIds);
  if (error) return { ok: false, message: error.message };
  const rows = (data ?? []) as Array<{ task_id: string }>;
  const taskIds = Array.from(new Set(rows.map((r) => r.task_id)));
  return { ok: true, taskIds };
}

// Foreign-key existence check. The model has a known habit of fabricating
// well-formed UUIDs that pass Zod but match no real row, which then return
// `ok:true, data:[]` and read to the model as "definitively no results."
// Validating up-front converts that silent failure into a loud `not_found`
// the model can self-correct on (or surface to the user).
interface FkCheck {
  field: string;
  table: string;
  value: string;
  hint: string;
}

async function validateForeignKeys(
  supabase: Supabase,
  checks: FkCheck[],
): Promise<{ ok: false; error: ToolError } | null> {
  if (checks.length === 0) return null;

  const results = await Promise.all(
    checks.map(async (c) => {
      const { data, error } = await supabase
        .from(c.table)
        .select('id')
        .eq('id', c.value)
        .maybeSingle();
      return { check: c, data, error };
    }),
  );

  for (const { check, data, error } of results) {
    if (error) {
      return { ok: false, error: { code: 'db_error', message: error.message } };
    }
    if (!data) {
      return {
        ok: false,
        error: {
          code: 'not_found',
          message: `No row in ${check.table} with id ${check.value} (passed as ${check.field}).`,
          hint: check.hint,
        },
      };
    }
  }
  return null;
}

async function handler(input: Input): Promise<ToolResult<TaskRow[]>> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const supabase = getSupabaseServer();

  // Validate every foreign-key id the model handed us before doing any other
  // work. Skipped when `ids` is set since that path overrides other filters
  // anyway — invalid task ids in `ids` simply return fewer rows, which is
  // an acceptable failure mode (the agent passed a list it presumably got
  // from a prior tool result).
  if (!input.ids) {
    const checks: FkCheck[] = [];
    if (input.property_id) {
      checks.push({
        field: 'property_id',
        table: 'properties',
        value: input.property_id,
        hint: 'Call find_properties to resolve a property name into a valid id.',
      });
    }
    if (input.template_id) {
      checks.push({
        field: 'template_id',
        table: 'templates',
        value: input.template_id,
        hint: 'Pass template_name (e.g. "turnover cleaning") instead, or omit this filter.',
      });
    }
    if (input.department_id) {
      checks.push({
        field: 'department_id',
        table: 'departments',
        value: input.department_id,
        hint: 'Pass department_name (e.g. "cleaning", "maintenance") instead, or omit this filter.',
      });
    }
    if (input.reservation_id) {
      checks.push({
        field: 'reservation_id',
        table: 'reservations',
        value: input.reservation_id,
        hint: 'There is no reservation resolver tool yet. Confirm the reservation_id with the user or omit this filter.',
      });
    }
    // bin_id may be a sentinel ('__none__' / '__any__') or a real UUID.
    // Only validate the UUID case; sentinels are interpreted in-handler.
    if (input.bin_id && input.bin_id !== BIN_NONE && input.bin_id !== BIN_ANY) {
      checks.push({
        field: 'bin_id',
        table: 'project_bins',
        value: input.bin_id,
        hint: "There is no bin resolver tool yet. Use bin_id='__any__' for any binned task or '__none__' for unbinned, or confirm the bin_id with the user.",
      });
    }

    const fkError = await validateForeignKeys(supabase, checks);
    if (fkError) return fkError;
  }

  // Two-step assignee resolution. We do this up front so we can short-circuit
  // when no users (or no assigned tasks) match, and surface the resolved set
  // in `meta` so the model can disambiguate when multiple users share a name.
  let resolvedAssignees: ResolvedAssignee[] | undefined;
  let assigneeTaskIds: string[] | undefined;
  if (input.assignee_name && !input.ids) {
    const resolved = await resolveAssigneesByName(supabase, input.assignee_name);
    if (!resolved.ok) {
      return { ok: false, error: { code: 'db_error', message: resolved.message } };
    }
    resolvedAssignees = resolved.users;

    if (resolved.users.length === 0) {
      return {
        ok: true,
        data: [],
        meta: {
          returned: 0,
          limit,
          truncated: false,
          resolved_assignees: [],
        },
      };
    }

    const taskRes = await resolveTaskIdsForUsers(
      supabase,
      resolved.users.map((u) => u.user_id),
    );
    if (!taskRes.ok) {
      return { ok: false, error: { code: 'db_error', message: taskRes.message } };
    }
    assigneeTaskIds = taskRes.taskIds;

    if (assigneeTaskIds.length === 0) {
      return {
        ok: true,
        data: [],
        meta: {
          returned: 0,
          limit,
          truncated: false,
          resolved_assignees: resolvedAssignees,
        },
      };
    }
  }

  // Department-by-name resolution. Skipped when department_id is explicitly
  // set (id wins) or when this is an `ids` batch lookup (filters ignored).
  // Mirrors the assignee shape: short-circuit empty when no departments
  // matched so the model gets a loud "we looked, found nothing" instead of
  // a generic empty list it might attribute to other filters.
  let resolvedDepartments: ResolvedDepartment[] | undefined;
  let departmentIdsFilter: string[] | undefined;
  if (input.department_name && !input.department_id && !input.ids) {
    const r = await resolveIdsByName(supabase, 'departments', input.department_name);
    if (!r.ok) {
      return { ok: false, error: { code: 'db_error', message: r.message } };
    }
    resolvedDepartments = r.rows.map((row) => ({
      department_id: row.id,
      name: row.name,
    }));
    if (r.rows.length === 0) {
      return {
        ok: true,
        data: [],
        meta: {
          returned: 0,
          limit,
          truncated: false,
          resolved_departments: [],
        },
      };
    }
    departmentIdsFilter = r.rows.map((row) => row.id);
  }

  // Template-by-name resolution. Same precedence + short-circuit rules.
  let resolvedTemplates: ResolvedTemplate[] | undefined;
  let templateIdsFilter: string[] | undefined;
  if (input.template_name && !input.template_id && !input.ids) {
    const r = await resolveIdsByName(supabase, 'templates', input.template_name);
    if (!r.ok) {
      return { ok: false, error: { code: 'db_error', message: r.message } };
    }
    resolvedTemplates = r.rows.map((row) => ({
      template_id: row.id,
      name: row.name,
    }));
    if (r.rows.length === 0) {
      return {
        ok: true,
        data: [],
        meta: {
          returned: 0,
          limit,
          truncated: false,
          resolved_templates: [],
        },
      };
    }
    templateIdsFilter = r.rows.map((row) => row.id);
  }

  // Pull `limit + 1` to detect truncation cheaply.
  let q = supabase
    .from('turnover_tasks')
    .select(SELECT)
    .order('scheduled_date', { ascending: true, nullsFirst: false })
    .order('scheduled_time', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit + 1);

  if (input.ids && input.ids.length > 0) {
    q = q.in('id', input.ids);
  } else {
    if (input.property_id) q = q.eq('property_id', input.property_id);
    if (input.template_id) q = q.eq('template_id', input.template_id);
    if (input.has_template === true) q = q.not('template_id', 'is', null);
    if (input.has_template === false) q = q.is('template_id', null);

    if (input.bin_id === BIN_NONE) {
      q = q.eq('is_binned', false);
    } else if (input.bin_id === BIN_ANY) {
      q = q.eq('is_binned', true);
    } else if (input.bin_id) {
      q = q.eq('bin_id', input.bin_id);
    }

    if (input.statuses && input.statuses.length > 0) q = q.in('status', input.statuses);
    if (input.priorities && input.priorities.length > 0) {
      q = q.in('priority', input.priorities);
    }
    if (input.department_id) q = q.eq('department_id', input.department_id);
    if (input.reservation_id) q = q.eq('reservation_id', input.reservation_id);

    if (input.unscheduled === true) {
      q = q.is('scheduled_date', null);
    } else if (input.scheduled_between) {
      if (input.scheduled_between.from) {
        q = q.gte('scheduled_date', input.scheduled_between.from);
      }
      if (input.scheduled_between.to) {
        q = q.lte('scheduled_date', input.scheduled_between.to);
      }
    }

    if (input.overdue === true) {
      const cutoff = input.reference_date ?? todayUtcDate();
      q = q.lt('scheduled_date', cutoff).neq('status', 'complete');
    }

    if (departmentIdsFilter) q = q.in('department_id', departmentIdsFilter);
    if (templateIdsFilter) q = q.in('template_id', templateIdsFilter);

    if (input.search) {
      const term = sanitizeSearchTerm(input.search);
      if (term.length > 0) {
        // Free-text search fans out across the task's own columns plus the
        // joined template/department names. Auto-spawned tasks frequently
        // had a null title with the searchable text only living on the
        // template name, which made the prior title-only search miss most
        // matches. We resolve template/department ids separately and OR
        // them into the row-level filter so PostgREST can do the whole
        // match in one query.
        const orParts = [
          `title.ilike.%${term}%`,
          `property_name.ilike.%${term}%`,
        ];
        const [tmpl, dept] = await Promise.all([
          resolveIdsByName(supabase, 'templates', term),
          resolveIdsByName(supabase, 'departments', term),
        ]);
        if (!tmpl.ok) {
          return { ok: false, error: { code: 'db_error', message: tmpl.message } };
        }
        if (!dept.ok) {
          return { ok: false, error: { code: 'db_error', message: dept.message } };
        }
        if (tmpl.rows.length > 0) {
          orParts.push(`template_id.in.(${tmpl.rows.map((r) => r.id).join(',')})`);
        }
        if (dept.rows.length > 0) {
          orParts.push(`department_id.in.(${dept.rows.map((r) => r.id).join(',')})`);
        }
        q = q.or(orParts.join(','));
      }
    }

    if (assigneeTaskIds) q = q.in('id', assigneeTaskIds);
  }

  const { data, error } = await q;
  if (error) {
    return { ok: false, error: { code: 'db_error', message: error.message } };
  }

  const rows = (data ?? []) as Array<Record<string, any>>;
  const truncated = rows.length > limit;
  const trimmed = truncated ? rows.slice(0, limit) : rows;

  const transformed: TaskRow[] = trimmed.map((task) => {
    const template = task.templates as { id: string; name: string } | null;
    const department = task.departments as { id: string; name: string } | null;
    const bin = task.project_bins as
      | { id: string; name: string; is_system: boolean }
      | null;
    const reservation = task.reservations as
      | {
          id: string;
          guest_name: string | null;
          check_in: string | null;
          check_out: string | null;
        }
      | null;
    const assignments = (task.task_assignments ?? []) as Array<{
      user_id: string;
      users: { id: string; name: string; role: string } | null;
    }>;
    const commentAgg = task.project_comments as Array<{ count: number }> | null;
    const commentCount = Array.isArray(commentAgg)
      ? Number(commentAgg[0]?.count ?? 0)
      : 0;

    return {
      task_id: task.id,
      reservation_id: task.reservation_id ?? null,
      property_id: task.property_id ?? null,
      property_name: task.property_name ?? null,
      template_id: task.template_id ?? null,
      template_name: template?.name ?? null,
      title: task.title ?? null,
      priority: task.priority ?? 'medium',
      department_id: task.department_id ?? null,
      department_name: department?.name ?? null,
      status: task.status ?? 'not_started',
      scheduled_date: task.scheduled_date ?? null,
      scheduled_time: task.scheduled_time ?? null,
      bin_id: task.bin_id ?? null,
      bin_name: bin?.name ?? null,
      bin_is_system: !!bin?.is_system,
      is_binned: task.is_binned ?? false,
      has_template: task.template_id != null,
      guest_name: reservation?.guest_name ?? null,
      check_in: reservation?.check_in ?? null,
      check_out: reservation?.check_out ?? null,
      assigned_users: assignments.map((a) => ({
        user_id: a.user_id,
        name: a.users?.name ?? '',
        role: a.users?.role ?? '',
      })),
      comment_count: commentCount,
      created_at: task.created_at,
      updated_at: task.updated_at,
      completed_at: task.completed_at ?? null,
    };
  });

  const meta: ToolMeta = {
    returned: transformed.length,
    limit,
    truncated,
    ...(resolvedAssignees ? { resolved_assignees: resolvedAssignees } : {}),
    ...(resolvedDepartments ? { resolved_departments: resolvedDepartments } : {}),
    ...(resolvedTemplates ? { resolved_templates: resolvedTemplates } : {}),
  };

  return { ok: true, data: transformed, meta };
}

export const findTasks: ToolDefinition<Input, TaskRow[]> = {
  name: 'find_tasks',
  description:
    "Find operational tasks (cleanings, inspections, recurring jobs, manual to-dos) with structured filters. Filter by property, template (id or name), department (id or name), status, priority, schedule, assignee name, or free-text. For category questions like 'show me all cleaning tasks' or 'maintenance work today', prefer department_name over search — it's more precise. For template-shaped questions ('turnover cleanings this week'), prefer template_name. Use find_properties first if the user mentions a property by name. Returns rows sorted by scheduled_date asc (nulls last), scheduled_time asc, then created_at desc. JSON-heavy fields (description, form_metadata) are not returned.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      property_id: {
        type: 'string',
        description:
          'Property UUID. Resolve property names with find_properties before calling.',
      },
      template_id: {
        type: 'string',
        description: 'Template UUID; restricts to tasks spawned from this template.',
      },
      has_template: {
        type: 'boolean',
        description:
          'true → templated tasks only. false → ad-hoc/manual tasks only. Omit for both.',
      },
      bin_id: {
        type: 'string',
        description:
          "Bin UUID, or '__none__' for unbinned tasks only, or '__any__' for any binned task.",
      },
      statuses: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['not_started', 'in_progress', 'paused', 'complete', 'contingent'],
        },
        description: 'Match any of these statuses.',
      },
      priorities: {
        type: 'array',
        items: { type: 'string', enum: ['urgent', 'high', 'medium', 'low'] },
        description: 'Match any of these priorities.',
      },
      department_id: {
        type: 'string',
        description: 'Department UUID.',
      },
      department_name: {
        type: 'string',
        minLength: 2,
        description:
          "Case-insensitive substring match on departments.name. Best filter for category questions ('cleaning tasks', 'maintenance work'). Ignored when department_id is also set; meta.resolved_departments lists the matches.",
      },
      template_name: {
        type: 'string',
        minLength: 2,
        description:
          "Case-insensitive substring match on templates.name. Use when the user names a template ('turnover cleaning', 'deep clean') without giving an id. Ignored when template_id is also set; meta.resolved_templates lists the matches.",
      },
      assignee_name: {
        type: 'string',
        minLength: 2,
        description:
          'Case-insensitive substring match on users.name. Returns tasks assigned to any user matching the term; meta.resolved_assignees lists the matches so you can disambiguate when multiple users share a name.',
      },
      scheduled_between: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'YYYY-MM-DD inclusive lower bound.' },
          to: { type: 'string', description: 'YYYY-MM-DD inclusive upper bound.' },
        },
        additionalProperties: false,
        description: 'Inclusive scheduled_date range. Either bound is optional.',
      },
      unscheduled: {
        type: 'boolean',
        description:
          'When true, only tasks with no scheduled_date. Cannot combine with scheduled_between.',
      },
      overdue: {
        type: 'boolean',
        description:
          'When true, only tasks scheduled before reference_date (or today UTC when reference_date is omitted) and not yet complete.',
      },
      reference_date: {
        type: 'string',
        description:
          "Today's date in the user's timezone, formatted YYYY-MM-DD. Pass this whenever overdue=true so the cutoff matches the user's local 'today' rather than the server's UTC clock.",
      },
      reservation_id: {
        type: 'string',
        description: 'Restrict to tasks tied to a single reservation.',
      },
      ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Batch lookup by task UUID. Other filters are ignored when set.',
      },
      search: {
        type: 'string',
        minLength: 2,
        description:
          "Case-insensitive substring search across task title, property_name, template_name, and department_name. Prefer department_name or template_name when the user is asking about a category they can name precisely.",
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 100,
        description: 'Max rows to return. Default 25.',
      },
    },
    additionalProperties: false,
  },
  handler,
};
