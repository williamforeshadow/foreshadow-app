import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { taskUrl } from '@/src/lib/links';
import {
  requireOrgId,
  type ToolContext,
  type ToolDefinition,
  type ToolError,
  type ToolMeta,
  type ToolResult,
} from './types';
import { embedQueryCached, toVectorLiteral } from '@/src/server/search/embeddingClient';

// find_tasks — discover/list operational tasks.
//
// Tasks are the operational unit Foreshadow revolves around: cleanings,
// inspections, manual to-dos, recurring jobs. This tool lets the agent slice
// the global task ledger by property, template, status/priority, schedule, or
// assignee. Mirrors the columns surfaced by /api/all-tasks but exposes
// structured filters instead of relying on client-side filtering.
//
// JSON-heavy fields (description, form_metadata, template fields) are
// intentionally omitted, and comments/attachments appear only as counts —
// this is the breadth half of the task read surface. get_task is the depth
// half: pass it one task_id and it returns the description, the resolved
// checklist, and the actual comment bodies. Keep it that way; widening this
// projection would make every list query pay for detail it doesn't show.
//
// Searching and returning are separate concerns, though, and the `search`
// filter deliberately reaches further than the projection does: it matches
// against comment BODIES even though it never returns them. A note is often
// the only place a fact was ever written down ("Patricia confirmed Thursday
// 9-10am"), so excluding comments from the search made those tasks
// unreachable by the words their owner would actually type. Matching a
// comment surfaces the task; reading the comment is still get_task's job.
//
// Free-text `search` is delegated to the search_tasks() database function
// (see supabase/migrations/*_task_trigram_search.sql). It trigram-matches the
// query against title, the flattened description, property_name, template and
// department names, and comment bodies, then orders by match quality times a
// recency decay. Two consequences worth knowing here:
//
//   - Searched results come back in RELEVANCE order, not schedule order. The
//     rows are re-sorted in this file after the query returns, because
//     PostgREST cannot sort by the RPC's score.
//   - Matching is fuzzy. "dishwaser" finds "dishwasher" and "yard" finds
//     "backyard" — deliberately, since the product's whole premise is that
//     users talk casually instead of phrasing queries precisely.
//
// The honest boundary: this is still lexical. No character-level technique
// connects "landscaping" to a task titled "Get a gardener". That needs
// embeddings fused into search_tasks()' ORDER BY — pgvector is already
// installed. The RPC exists partly to make that a change with no blast
// radius above it: the tool contract stays find_tasks(search) -> ranked ids.

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
        "Bin filter. Pass a sub-bin UUID for a specific sub-bin, '__none__' for unbinned tasks only, '__task_bin__' for orphan binned tasks (the default \"Task Bin\": is_binned=true AND bin_id IS NULL), or '__any__' for every binned task (Task Bin + every sub-bin).",
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
        'Case-insensitive substring match on users.name. Returns tasks assigned to any user that matches; meta.resolved_assignees lists the matched users so you can disambiguate. Use this for single-person questions only — for "tasks A and B are both on", use assigned_user_ids instead.',
      ),
    assigned_user_ids: z
      .array(z.string().uuid())
      .min(1)
      .optional()
      .describe(
        "AND-filter on assignees. When the user names multiple specific people and means 'tasks all of them share' (e.g. 'tasks Billy and Gabe are both on'), resolve each name with find_users first, then pass the resulting user_ids here. Returns only tasks whose task_assignments include EVERY supplied user_id. Mutually exclusive with assignee_name.",
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
      .describe(
        'Restrict to tasks tied to a single reservation. Use find_reservations first to resolve a guest, stay window, or Hostaway id into a reservation_id.',
      ),
    ids: z
      .array(z.string().uuid())
      .optional()
      .describe('Batch lookup by task UUID. Other filters are ignored when set.'),
    search: z
      .string()
      .min(2)
      .optional()
      .describe(
        "Fuzzy, RANKED free-text search across task title, description, property_name, template_name, department_name, and COMMENT BODIES. Results come back best-match-first, weighted toward recently-active tasks. Matching is forgiving: typos ('dishwaser' finds 'dishwasher') and partial words ('yard' finds 'backyard') both work, so pass the user's own wording rather than cleaning it up. Because comments and descriptions are covered, this finds tasks by text written only in a note or a note body — a person who isn't an assignee, a vendor, an order, a confirmed time. Reach for it whenever the user's phrasing doesn't name a task, property, or category ('did Patricia get back to us', 'what did I order'). Prefer department_name or template_name when they name a category precisely. Each row carries matched_in — when it says 'comment' or 'description', the matching text is NOT in the row, so call get_task to read it.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Max rows to return. Default 25, hard cap 100.'),
    sort: z
      .enum(['soonest', 'latest'])
      .optional()
      .describe(
        "Result ordering by scheduled date. 'soonest' (default) = earliest scheduled_date first; 'latest' = most recent scheduled_date first. Resolved order echoed in meta.sort.",
      ),
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
  )
  .refine(
    (v) => !(v.assignee_name && v.assigned_user_ids),
    {
      message:
        'assignee_name and assigned_user_ids are mutually exclusive; pick one',
      path: ['assigned_user_ids'],
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
  attachment_count: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  /**
   * Deep link to this task in the Foreshadow app. Absolute when APP_BASE_URL
   * is configured (required for Slack); falls back to a relative path when
   * not set (still works in the in-app chat). The model is expected to
   * surface this as a markdown link so users can jump from chat to the task
   * overlay.
   */
  task_url: string;
  /**
   * Only present on results from a free-text `search`. Which field produced
   * the match: 'title' | 'description' | 'property' | 'template_or_department'
   * | 'comment'.
   *
   * Worth surfacing to the model because 'comment' and 'description' mean the
   * matching text is NOT anywhere in this row — the projection doesn't carry
   * either. Seeing it, the model knows to open the task with get_task rather
   * than guess at what matched from the title.
   */
  matched_in?: string;
  /**
   * Only present on results from a free-text `search`. Relevance x recency,
   * roughly 0-1, same number the rows are sorted by.
   *
   * Exposed because without it the model treats every returned row as equally
   * "found" and narrates a weak tail with the same confidence as a direct hit.
   * That is how a search for "trash" once presented tasks matching only on
   * "track" as though they were results. The scores are meant to be compared
   * to EACH OTHER, not to a fixed bar — see the tool description.
   */
  match_score?: number;
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
  project_comments(count),
  project_attachments(count)
`;

const DEFAULT_LIMIT = 25;
// How many ranked candidates search_tasks() returns before the tool's own
// structured filters (status, date, property, bin...) narrow them further.
// Deliberately larger than the row limit: a search for "cleaning" scoped to
// "this week" has to have enough ranked candidates left after filtering to
// still fill a page. Bounded because the ids travel back as a PostgREST
// `in.()` filter, ~37 characters each.
const SEARCH_CANDIDATE_CAP = 200;
const BIN_NONE = '__none__';
const BIN_TASK_BIN = '__task_bin__';
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

interface TaskQueryRow {
  id: string;
  reservation_id: string | null;
  property_id: string | null;
  property_name: string | null;
  template_id: string | null;
  title: string | null;
  priority: string | null;
  department_id: string | null;
  status: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  bin_id: string | null;
  is_binned: boolean | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  templates: { id: string; name: string } | null;
  departments: { id: string; name: string } | null;
  project_bins: { id: string; name: string; is_system: boolean } | null;
  reservations: {
    id: string;
    guest_name: string | null;
    check_in: string | null;
    check_out: string | null;
  } | null;
  task_assignments: Array<{
    user_id: string;
    users: { id: string; name: string; role: string } | null;
  }> | null;
  project_comments: Array<{ count: number }> | null;
  project_attachments: Array<{ count: number }> | null;
}

type Supabase = ReturnType<typeof getSupabaseServer>;

async function resolveAssigneesByName(
  supabase: Supabase,
  rawTerm: string,
  org: string,
): Promise<{ ok: true; users: ResolvedAssignee[] } | { ok: false; message: string }> {
  const term = sanitizeSearchTerm(rawTerm);
  if (term.length < 2) return { ok: true, users: [] };
  const { data, error } = await supabase
    .from('users')
    .select('id, name')
    .eq('org_id', org)
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
  org: string,
): Promise<
  { ok: true; rows: Array<{ id: string; name: string }> } | { ok: false; message: string }
> {
  const term = sanitizeSearchTerm(rawTerm);
  if (term.length < 2) return { ok: true, rows: [] };
  const { data, error } = await supabase
    .from(table)
    .select('id, name')
    .eq('org_id', org)
    .ilike('name', `%${term}%`)
    .limit(50);
  if (error) return { ok: false, message: error.message };
  return { ok: true, rows: (data ?? []) as Array<{ id: string; name: string }> };
}

/** One ranked candidate from the search_tasks() database function. */
interface RankedMatch {
  task_id: string;
  /** match quality x recency decay. Higher is better. */
  score: number;
  /** Which field won: 'title' | 'description' | 'property' | 'comment'. */
  matched_in: string;
}

// Free-text search, delegated to the search_tasks() database function.
//
// The function trigram-matches the query against task title, the flattened
// description, property_name, and comment bodies, then orders by match quality
// times a recency decay. See the migration for why trigram beat full-text
// search here (short version: FTS matches whole tokens, so it would have
// broken "yard" -> "backyard door", and it can't survive a typo).
//
// Ranking has to happen in the database because PostgREST can express "rows
// where X matches" but has no syntax for "ordered by how well they matched".
// This RPC is also the seam that keeps the agent stable as retrieval improves:
// when embeddings land, the vector score is fused into the function's ORDER BY
// and nothing above it changes — not this tool, not the prompt, not the agent.
//
// Note the term is passed as an RPC parameter rather than interpolated into a
// PostgREST filter string, so it no longer needs sanitizing for `%`/`,`/`(`.
async function rankedSearch(
  supabase: Supabase,
  rawTerm: string,
  org: string,
  applyRecency: boolean,
): Promise<{ ok: true; matches: RankedMatch[] } | { ok: false; message: string }> {
  const term = rawTerm.trim();
  if (term.length < 2) return { ok: true, matches: [] };
  // Semantic channel. embedQueryCached never throws and returns null when
  // embeddings are unconfigured or the provider is unreachable — the RPC then
  // skips its vector CTE and behaves exactly as it did before embeddings
  // existed. So this is additive: it can improve a result, never break one.
  const embedding = await embedQueryCached(term);
  const { data, error } = await supabase.rpc('search_tasks', {
    p_org: org,
    p_query: term,
    p_limit: SEARCH_CANDIDATE_CAP,
    p_apply_recency: applyRecency,
    p_query_embedding: embedding ? toVectorLiteral(embedding) : null,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, matches: (data ?? []) as RankedMatch[] };
}

async function resolveTaskIdsForUsers(
  supabase: Supabase,
  userIds: string[],
  org: string,
): Promise<{ ok: true; taskIds: string[] } | { ok: false; message: string }> {
  if (userIds.length === 0) return { ok: true, taskIds: [] };
  const { data, error } = await supabase
    .from('task_assignments')
    .select('task_id')
    .eq('org_id', org)
    .in('user_id', userIds);
  if (error) return { ok: false, message: error.message };
  const rows = (data ?? []) as Array<{ task_id: string }>;
  const taskIds = Array.from(new Set(rows.map((r) => r.task_id)));
  return { ok: true, taskIds };
}

// AND-of-assignees: return task_ids that have EVERY supplied user_id in
// task_assignments. PostgREST has no HAVING clause, so we fetch the
// matching rows and count distinct user_ids per task in-process. Input
// is deduped via Set so a caller passing the same id twice doesn't
// inflate the required count.
async function resolveTaskIdsForAllUsers(
  supabase: Supabase,
  userIds: string[],
  org: string,
): Promise<{ ok: true; taskIds: string[] } | { ok: false; message: string }> {
  const uniqueUserIds = Array.from(new Set(userIds));
  if (uniqueUserIds.length === 0) return { ok: true, taskIds: [] };
  const { data, error } = await supabase
    .from('task_assignments')
    .select('task_id, user_id')
    .eq('org_id', org)
    .in('user_id', uniqueUserIds);
  if (error) return { ok: false, message: error.message };
  const rows = (data ?? []) as Array<{ task_id: string; user_id: string }>;
  const perTask = new Map<string, Set<string>>();
  for (const r of rows) {
    let s = perTask.get(r.task_id);
    if (!s) {
      s = new Set();
      perTask.set(r.task_id, s);
    }
    s.add(r.user_id);
  }
  const required = uniqueUserIds.length;
  const taskIds: string[] = [];
  for (const [taskId, users] of perTask) {
    if (users.size === required) taskIds.push(taskId);
  }
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
  org: string,
): Promise<{ ok: false; error: ToolError } | null> {
  if (checks.length === 0) return null;

  const results = await Promise.all(
    checks.map(async (c) => {
      const { data, error } = await supabase
        .from(c.table)
        .select('id')
        .eq('id', c.value)
        .eq('org_id', org)
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

async function handler(
  input: Input,
  ctx: ToolContext,
): Promise<ToolResult<TaskRow[]>> {
  const org = requireOrgId(ctx);
  if (typeof org !== 'string') return org;

  const limit = input.limit ?? DEFAULT_LIMIT;
  const supabase = ctx.db;

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
        hint: 'Call find_reservations to resolve a stay (by property, guest_name, hostaway_reservation_id, or date range) into a valid reservation_id.',
      });
    }
    // bin_id may be a sentinel ('__none__' / '__task_bin__' / '__any__') or
    // a real sub-bin UUID. Only validate the UUID case; sentinels are
    // interpreted in-handler.
    if (
      input.bin_id &&
      input.bin_id !== BIN_NONE &&
      input.bin_id !== BIN_TASK_BIN &&
      input.bin_id !== BIN_ANY
    ) {
      checks.push({
        field: 'bin_id',
        table: 'project_bins',
        value: input.bin_id,
        hint: "Resolve sub-bin names with find_bins. Or use bin_id='__task_bin__' for orphan binned tasks (the Task Bin), '__any__' for every binned task, '__none__' for unbinned.",
      });
    }

    const fkError = await validateForeignKeys(supabase, checks, org);
    if (fkError) return fkError;

    // Batch FK check for assigned_user_ids. validateForeignKeys is
    // one-id-per-call; for an array of user_ids we issue a single
    // `select id from users where id in (...)` and compare against the
    // requested set so a fabricated UUID surfaces as a loud not_found
    // instead of silently producing zero matching tasks.
    if (input.assigned_user_ids && input.assigned_user_ids.length > 0) {
      const unique = Array.from(new Set(input.assigned_user_ids));
      const { data: foundRows, error: userErr } = await supabase
        .from('users')
        .select('id')
        .eq('org_id', org)
        .in('id', unique);
      if (userErr) {
        return {
          ok: false,
          error: { code: 'db_error', message: userErr.message },
        };
      }
      const found = new Set(
        ((foundRows ?? []) as Array<{ id: string }>).map((r) => r.id),
      );
      const missing = unique.filter((id) => !found.has(id));
      if (missing.length > 0) {
        return {
          ok: false,
          error: {
            code: 'not_found',
            message: `assigned_user_ids contains UUIDs not in users: ${missing.join(', ')}`,
            hint: 'Call find_users to resolve names to valid user_ids before passing them here.',
          },
        };
      }
    }
  }

  // Two-step assignee resolution. We do this up front so we can short-circuit
  // when no users (or no assigned tasks) match, and surface the resolved set
  // in `meta` so the model can disambiguate when multiple users share a name.
  let resolvedAssignees: ResolvedAssignee[] | undefined;
  let assigneeTaskIds: string[] | undefined;
  if (input.assignee_name && !input.ids) {
    const resolved = await resolveAssigneesByName(supabase, input.assignee_name, org);
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
      org,
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

  // AND-of-assignees resolution. Mutually exclusive with assignee_name
  // (enforced by Zod refine); the FK pre-validation above guarantees every
  // user_id exists, so a zero-task result here means no task has ALL of
  // them assigned — we short-circuit the main query.
  if (input.assigned_user_ids && !input.ids) {
    const taskRes = await resolveTaskIdsForAllUsers(
      supabase,
      input.assigned_user_ids,
      org,
    );
    if (!taskRes.ok) {
      return {
        ok: false,
        error: { code: 'db_error', message: taskRes.message },
      };
    }
    assigneeTaskIds = taskRes.taskIds;
    if (assigneeTaskIds.length === 0) {
      return {
        ok: true,
        data: [],
        meta: { returned: 0, limit, truncated: false },
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
    const r = await resolveIdsByName(supabase, 'departments', input.department_name, org);
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
    const r = await resolveIdsByName(supabase, 'templates', input.template_name, org);
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

  // Ranked free-text search. Runs before the main query so its ordered
  // candidate list can both filter the query and re-sort what comes back.
  let searchRank: Map<string, RankedMatch> | undefined;
  if (input.search && !input.ids) {
    // Recency decay is DEFEATED when the user named an explicit time window.
    // Without this, "what did we do about the pool heater last spring?" would
    // rank its own answers last for the crime of being old — the system would
    // be structurally unable to answer historical questions. The model already
    // converts relative language ("last year", "in March") into concrete dates
    // before calling tools, so the presence of a date filter IS the signal.
    const hasExplicitDateFilter = !!(
      input.scheduled_between?.from ||
      input.scheduled_between?.to ||
      input.unscheduled === true ||
      input.overdue === true
    );
    const ranked = await rankedSearch(
      supabase,
      input.search,
      org,
      !hasExplicitDateFilter,
    );
    if (!ranked.ok) {
      return { ok: false, error: { code: 'db_error', message: ranked.message } };
    }
    if (ranked.matches.length === 0) {
      // Nothing scored above the similarity threshold. Short-circuit with a
      // loud empty rather than letting the main query return every task in
      // the org because no id filter got applied.
      return {
        ok: true,
        data: [],
        meta: {
          returned: 0,
          limit,
          truncated: false,
          search_matches: 0,
          search_ranked: true,
        },
      };
    }
    searchRank = new Map(ranked.matches.map((m) => [m.task_id, m]));
  }

  // Ordering by intent. A single hard-coded direction can't serve both "the
  // next/soonest task" and "the last/most recent task" — so we default to
  // soonest (the forward-looking work queue) and let the caller override with
  // `sort`. nulls-last in both directions keeps unscheduled tasks out of the
  // way of a `limit:1` "latest" lookup. The resolved order is echoed in
  // meta.sort. Pull `limit + 1` to detect truncation cheaply.
  const sort: 'soonest' | 'latest' = input.sort ?? 'soonest';
  let q = supabase.from('turnover_tasks').select(SELECT).eq('org_id', org);
  if (sort === 'latest') {
    q = q
      .order('scheduled_date', { ascending: false, nullsFirst: false })
      .order('scheduled_time', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
  } else {
    q = q
      .order('scheduled_date', { ascending: true, nullsFirst: false })
      .order('scheduled_time', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });
  }
  // When searching we pull the whole ranked candidate set rather than limit+1,
  // because the rows have to be re-sorted by relevance before they're trimmed.
  // Taking limit+1 here would hand back the earliest-SCHEDULED matches and
  // then "rank" those — which is the exact bug ranking exists to fix.
  q = q.limit(searchRank ? SEARCH_CANDIDATE_CAP : limit + 1);

  if (input.ids && input.ids.length > 0) {
    q = q.in('id', input.ids);
  } else {
    if (input.property_id) q = q.eq('property_id', input.property_id);
    if (input.template_id) q = q.eq('template_id', input.template_id);
    if (input.has_template === true) q = q.not('template_id', 'is', null);
    if (input.has_template === false) q = q.is('template_id', null);

    if (input.bin_id === BIN_NONE) {
      q = q.eq('is_binned', false);
    } else if (input.bin_id === BIN_TASK_BIN) {
      // Task Bin = orphan binned (binned but no specific sub-bin).
      q = q.eq('is_binned', true).is('bin_id', null);
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

    // Ranked candidates from search_tasks(), already ordered by relevance x
    // recency. Restricting the query to them lets every structured filter
    // below compose with the search normally; the rank order is re-applied
    // after the rows come back, since PostgREST can't sort by it.
    if (searchRank) q = q.in('id', Array.from(searchRank.keys()));

    if (assigneeTaskIds) q = q.in('id', assigneeTaskIds);
  }

  const { data, error } = await q;
  if (error) {
    return { ok: false, error: { code: 'db_error', message: error.message } };
  }

  // Cast via unknown: the generic SupabaseClient types to-one embeds as arrays,
  // but PostgREST returns objects for them at runtime (shape unchanged).
  const rows = (data ?? []) as unknown as TaskQueryRow[];
  // Re-apply relevance order. The database returned these in schedule order
  // (PostgREST has no way to sort by the RPC's score), so without this the
  // trim below would keep the earliest-scheduled matches instead of the
  // best-matching ones.
  if (searchRank) {
    rows.sort(
      (a, b) =>
        (searchRank.get(b.id)?.score ?? 0) - (searchRank.get(a.id)?.score ?? 0),
    );
  }
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
    const attachmentAgg = task.project_attachments as
      | Array<{ count: number }>
      | null;
    const attachmentCount = Array.isArray(attachmentAgg)
      ? Number(attachmentAgg[0]?.count ?? 0)
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
      attachment_count: attachmentCount,
      created_at: task.created_at,
      updated_at: task.updated_at,
      completed_at: task.completed_at ?? null,
      task_url: taskUrl(task.id),
      ...(searchRank
        ? {
            matched_in: searchRank.get(task.id)?.matched_in,
            // Two decimals: enough to compare rows against each other, not so
            // much precision that it invites the model to read meaning into
            // a difference of 0.003.
            match_score:
              Math.round((searchRank.get(task.id)?.score ?? 0) * 100) / 100,
          }
        : {}),
    };
  });

  const meta: ToolMeta = {
    returned: transformed.length,
    limit,
    truncated,
    sort:
      sort === 'latest'
        ? 'latest (most recent scheduled_date first)'
        : 'soonest (earliest scheduled_date first)',
    ...(resolvedAssignees ? { resolved_assignees: resolvedAssignees } : {}),
    ...(resolvedDepartments ? { resolved_departments: resolvedDepartments } : {}),
    ...(resolvedTemplates ? { resolved_templates: resolvedTemplates } : {}),
    // Present only on searched calls. search_ranked tells the model these rows
    // are in relevance order (not schedule order), so the first one really is
    // the best guess. search_candidates is how many tasks cleared the
    // similarity threshold before structured filters narrowed them — useful
    // for telling "nothing matched" apart from "lots matched, your filters
    // excluded them".
    ...(searchRank
      ? { search_ranked: true, search_candidates: searchRank.size }
      : {}),
  };

  return { ok: true, data: transformed, meta };
}

export const findTasks: ToolDefinition<Input, TaskRow[]> = {
  name: 'find_tasks',
  description:
    "Find operational tasks (cleanings, inspections, recurring jobs, manual to-dos) with structured filters. Filter by property, template (id or name), department (id or name), status, priority, schedule, assignee, or free-text. The `search` filter is fuzzy and RANKED: it covers descriptions and COMMENT BODIES as well as titles and names, tolerates typos and partial words, and returns results best-match-first weighted toward recently-active tasks. So it can find a task by something written only in a note (a vendor, an order, a person who isn't assigned, a confirmed time) — when the user's phrasing doesn't name a task, property, or category, try `search` with their own wording before concluding nothing exists. When search is used, meta.search_ranked is true and the FIRST result is the best candidate, not merely the earliest-scheduled. Each searched row also carries match_score (relevance x recency, roughly 0-1). COMPARE SCORES TO EACH OTHER, not to a fixed bar: if the top score is far above the rest, that one task is the answer and the others are at most 'also mentions it' — say so rather than presenting the whole list as equally relevant. If the scores are close together, several tasks genuinely match. Never narrate a low-scoring tail with the same confidence as the leader. For category questions like 'show me all cleaning tasks' or 'maintenance work today', prefer department_name over search — it's more precise. For template-shaped questions ('turnover cleanings this week'), prefer template_name. Assignee filters: use assignee_name for a single-person substring match; use assigned_user_ids when the user names multiple specific people and means 'tasks all of them share' (resolve names to user_ids with find_users first). Resolve other references first when the user names something rather than ids: call find_properties for a property name, and call find_reservations for a specific stay or guest (then pass the resulting reservation_id). ORDERING: `sort` controls direction — 'soonest' (default) = earliest scheduled_date first; 'latest' = most recent scheduled_date first. The resolved order is echoed in meta.sort. Note scheduled_date can be in the future: turnovers are auto-spawned and 'contingent' tasks are dated months/years ahead, so the latest-dated task is frequently not the last one actually performed. JSON-heavy fields (description, form_metadata) are not returned, and comments/attachments come back only as counts — a comment can MATCH a search here, but reading its text requires get_task.",
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
          "Sub-bin UUID, or '__none__' (unbinned only), '__task_bin__' (orphan binned — the default Task Bin: is_binned=true AND bin_id IS NULL), or '__any__' (every binned task).",
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
          'Case-insensitive substring match on users.name. Returns tasks assigned to any user matching the term; meta.resolved_assignees lists the matches so you can disambiguate when multiple users share a name. Single-person questions only — for "tasks A and B are both on", use assigned_user_ids.',
      },
      assigned_user_ids: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        description:
          "AND-filter on assignees. When the user names multiple specific people and means 'tasks all of them share' (e.g. 'tasks Billy and Gabe are both on'), resolve each name with find_users first, then pass the resulting user_ids here. Returns only tasks whose task_assignments include EVERY supplied user_id. Mutually exclusive with assignee_name.",
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
        description:
          'Reservation UUID; restricts to tasks tied to this specific stay. Resolve guest names, date windows, or Hostaway ids into a reservation_id with find_reservations before calling.',
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
          "Fuzzy, RANKED free-text search across task title, description, property_name, template_name, department_name, and COMMENT BODIES. Results are ordered best-match-first and weighted toward recently-active tasks. Matching tolerates typos ('dishwaser' finds 'dishwasher') and partial words ('yard' finds 'backyard'), so pass the user's own wording rather than tidying it up. Finds tasks by text written only in a note or description — a vendor, an order, a person who isn't assigned, a confirmed time ('did Patricia get back to us', 'what did I order on Amazon'). Prefer department_name or template_name when they name a category precisely. Each row's matched_in says where it hit; 'comment' or 'description' means the text is NOT in the row and get_task is required to read it.",
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 100,
        description: 'Max rows to return. Default 25.',
      },
      sort: {
        type: 'string',
        enum: ['soonest', 'latest'],
        description:
          "Ordering by scheduled date. 'soonest' (default) = earliest scheduled_date first; 'latest' = most recent scheduled_date first. Resolved order is returned in meta.sort. Note scheduled_date can be future-dated (turnovers are auto-spawned and 'contingent' tasks run months/years ahead), so the latest-dated task is often not the last one actually performed.",
      },
    },
    additionalProperties: false,
  },
  handler,
};
