import { z } from 'zod';
import type { FieldDefinition, Template } from '@/components/DynamicCleaningForm';
import { templateProgress, unwrapValue, isFieldSatisfied } from '@/lib/tasks/templateProgress';
import { tiptapToPlainText } from '@/lib/utils';
import { taskUrl } from '@/src/lib/links';
import {
  requireOrgId,
  type ToolContext,
  type ToolDefinition,
  type ToolMeta,
  type ToolResult,
} from './types';

// get_task — the depth half of the task read surface.
//
// find_tasks is breadth: 18 filters, up to 100 rows, deliberately thin
// projection. get_task is depth: one id, everything we hold. The split
// mirrors find_properties → get_property_knowledge and find_conversations
// → read_conversation_thread.
//
// This closes a gap that had been open since find_tasks was written — its
// header promised "a future get_task tool will return the full record for
// a single id" and nothing was built, which left the agent able to SEE
// that a task had 4 comments and to WRITE a 5th, but never to read one.
// Same for description, checklist answers, and attachments: all four were
// reachable only as counts, or not at all.
//
// Resolved, not raw (critical):
//   Two fields are useless in their stored form and are resolved here.
//   - description is ProseMirror/TipTap JSON, not a string. Passing it
//     through raw once caused a TypeError that silently killed the Slack
//     unfurl handler; we flatten it to plain text.
//   - form_metadata holds ONLY touched fields, in either of two formats
//     (legacy raw, or {label,type,value}). Handing the model that blob
//     would read as "3 fields answered" on a 20-field checklist. We join
//     it against the template's field definitions so the denominator is
//     real. See lib/tasks/templateProgress.ts — same logic the UI counts
//     with, so the agent and the screen never disagree.
//
// Activity history is deliberately absent: tasks do not have one. The
// project_activity_log table is keyed to property_projects (the legacy
// projects entity), not turnover_tasks — see the note in
// src/server/comments/addComment.ts. There is no data to return, so the
// tool says so in its description rather than exposing an always-null
// field the model would be tempted to narrate.

const DEFAULT_COMMENT_LIMIT = 20;
const MAX_COMMENT_LIMIT = 100;
// Attachments are metadata-only rows (no bodies), so a flat cap beats
// pagination. Tasks with more than this are vanishingly rare.
const ATTACHMENT_CAP = 25;
// Descriptions are free-text and occasionally enormous. The loop's output
// budget is 2048 tokens; a runaway description would crowd out the answer.
const DESCRIPTION_CAP = 4000;

// Up to five tasks per call. The cap exists because this is a DEEP read —
// five tasks with twenty comments each is a lot of context for a 2048-token
// answer budget — and because past five, the conversation hasn't actually
// narrowed and the model should be filtering with find_tasks instead.
const MAX_TASKS_PER_CALL = 5;
// Reading several at once is nearly always disambiguation ("which of these
// three is the one about the gate code?"), which needs the gist of each
// thread rather than all of it. Dropping the per-task comment window keeps a
// five-task read from crowding out the answer itself.
const MULTI_TASK_COMMENT_LIMIT = 8;

const inputSchema = z.object({
  task_ids: z
    .array(z.string().uuid())
    .min(1)
    .max(MAX_TASKS_PER_CALL)
    .describe(
      `UUIDs of the tasks to open, 1 to ${MAX_TASKS_PER_CALL}. Resolve them with find_tasks first and pass the task_id values it returned. Pass several at once when find_tasks left more than one plausible candidate — reading them together is one round trip instead of several.`,
    ),
  comment_limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_COMMENT_LIMIT)
    .optional()
    .describe(
      `Max comments per task. Default ${DEFAULT_COMMENT_LIMIT} for a single task, ${MULTI_TASK_COMMENT_LIMIT} when several are requested; hard cap ${MAX_COMMENT_LIMIT}. When a task has more, the MOST RECENT are kept and comments.truncated is true.`,
    ),
});

type Input = z.infer<typeof inputSchema>;

interface AssignedUser {
  user_id: string;
  name: string;
  role: string;
}

interface ChecklistItem {
  /** Field label as written on the template, e.g. "Kitchen counters wiped". */
  label: string;
  type: FieldDefinition['type'];
  required: boolean;
  /**
   * Whether this field counts as satisfied. Absent on separators, which are
   * section headings rather than answerable fields.
   */
  answered?: boolean;
  /**
   * The recorded answer. Photo fields report a count ("2 photos") instead of
   * URLs — the model almost never needs the URL and they are token-expensive.
   * Null when the field was never touched.
   */
  value?: string | number | boolean | null;
}

interface Checklist {
  completed: number;
  /** Countable fields only — separators are excluded, matching the UI. */
  total: number;
  /** 0..1. */
  fraction: number;
  items: ChecklistItem[];
}

interface TaskComment {
  comment_id: string;
  user_id: string | null;
  user_name: string | null;
  content: string;
  created_at: string;
}

interface TaskAttachment {
  attachment_id: string;
  file_name: string | null;
  file_type: string | null;
  mime_type: string | null;
  file_size: number | null;
  url: string | null;
  uploaded_by_name: string | null;
  created_at: string;
}

export interface TaskDetailView {
  task_id: string;
  task_url: string;
  title: string | null;
  /** Flattened from TipTap JSON to plain text. Null when empty. */
  description: string | null;
  description_truncated: boolean;
  status: string;
  priority: string;
  property_id: string | null;
  property_name: string | null;
  template_id: string | null;
  template_name: string | null;
  department_id: string | null;
  department_name: string | null;
  bin_id: string | null;
  bin_name: string | null;
  bin_is_system: boolean;
  is_binned: boolean;
  scheduled_date: string | null;
  scheduled_time: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  reservation: {
    reservation_id: string;
    guest_name: string | null;
    check_in: string | null;
    check_out: string | null;
  } | null;
  assigned_users: AssignedUser[];
  /** Null for ad-hoc tasks and for templated tasks whose template has no fields. */
  checklist: Checklist | null;
  comments: {
    total: number;
    returned: number;
    truncated: boolean;
    /** Oldest-first for readability, but the newest are kept when truncated. */
    items: TaskComment[];
  };
  attachments: {
    total: number;
    returned: number;
    truncated: boolean;
    items: TaskAttachment[];
  };
}

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
  templates(id, name),
  departments(id, name),
  project_bins(id, name, is_system),
  reservations(id, guest_name, check_in, check_out),
  task_assignments(user_id, users(id, name, role))
`;

/**
 * Render a stored answer for the model. Photo fields collapse to a count:
 * the URLs are long, rarely useful in conversation, and would dominate the
 * payload on a photo-heavy cleaning checklist.
 */
function presentValue(
  type: FieldDefinition['type'],
  raw: unknown,
): string | number | boolean | null {
  const value = unwrapValue(raw);
  if (value === undefined || value === null || value === '') return null;

  if (type === 'photo' || type === 'photos') {
    // Multi-photo now; legacy 'photo' snapshots may still hold a single string.
    if (Array.isArray(value)) {
      return value.length === 0
        ? null
        : `${value.length} photo${value.length === 1 ? '' : 's'}`;
    }
    return typeof value === 'string' && value !== '' ? '1 photo' : null;
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  // Unexpected shape (old data, hand-edited JSON). Don't guess — stringify
  // shallowly so the model sees something honest rather than "[object Object]".
  return JSON.stringify(value).slice(0, 200);
}

function buildChecklist(
  fields: FieldDefinition[] | null,
  formMetadata: Record<string, unknown> | null,
): Checklist | null {
  if (!fields || fields.length === 0) return null;

  // Counting is delegated so the agent's numbers and the UI's progress ring
  // can never drift. templateProgress excludes separators from both halves.
  const template = { id: '', name: '', fields } as Template;
  const { completed, total, fraction } = templateProgress(template, formMetadata);
  if (total === 0) return null;

  const items: ChecklistItem[] = fields.map((field) => {
    if (field.type === 'separator') {
      // Section heading. Carried through so the model can see the checklist's
      // structure, but it has no answer and isn't counted.
      return { label: field.label, type: field.type, required: false };
    }
    const raw = formMetadata?.[field.id];
    return {
      label: field.label,
      type: field.type,
      required: !!field.required,
      answered: isFieldSatisfied(field.type, unwrapValue(raw)),
      value: presentValue(field.type, raw),
    };
  });

  return { completed, total, fraction, items };
}

/** Shape PostgREST actually returns for TASK_SELECT. */
interface TaskQueryRow {
  id: string;
  reservation_id: string | null;
  property_id: string | null;
  property_name: string | null;
  template_id: string | null;
  title: string | null;
  description: unknown;
  priority: string | null;
  department_id: string | null;
  status: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  bin_id: string | null;
  is_binned: boolean | null;
  form_metadata: unknown;
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
}

/**
 * Fetch the comment + attachment tails for one task and assemble its view.
 *
 * Kept per-task rather than folded into one batched query: a per-task LIMIT
 * needs a window function, which PostgREST can't express. At a cap of five
 * tasks these run concurrently and the extra round trips are free, whereas
 * fetching every comment for five tasks and slicing in memory would pull an
 * unbounded amount of text to throw most of it away.
 */
async function buildTaskView(
  supabase: ToolContext['db'],
  task: TaskQueryRow,
  org: string,
  templateFields: FieldDefinition[] | null,
  commentLimit: number,
): Promise<{ ok: true; view: TaskDetailView } | { ok: false; message: string }> {
  // Newest-first + limit so a capped read keeps the RECENT comments (the
  // useful end of a thread); we reverse to oldest-first for presentation,
  // matching read_conversation_thread. `count: 'exact'` reports the true
  // total regardless of the limit.
  const [commentsRes, attachmentsRes] = await Promise.all([
    supabase
      .from('project_comments')
      .select('id, user_id, comment_content, created_at, users(id, name)', {
        count: 'exact',
      })
      .eq('task_id', task.id)
      .eq('org_id', org)
      .order('created_at', { ascending: false })
      .limit(commentLimit),
    supabase
      .from('project_attachments')
      .select(
        'id, file_name, file_type, mime_type, file_size, url, created_at, users(id, name)',
        { count: 'exact' },
      )
      .eq('task_id', task.id)
      .eq('org_id', org)
      .order('created_at', { ascending: false })
      .limit(ATTACHMENT_CAP),
  ]);

  if (commentsRes.error) return { ok: false, message: commentsRes.error.message };
  if (attachmentsRes.error) {
    return { ok: false, message: attachmentsRes.error.message };
  }

  const commentRows = (commentsRes.data ?? []) as unknown as Array<{
    id: string;
    user_id: string | null;
    comment_content: string | null;
    created_at: string;
    users: { id: string; name: string } | null;
  }>;
  const commentTotal = commentsRes.count ?? commentRows.length;
  const comments: TaskComment[] = commentRows
    .slice()
    .reverse()
    .map((c) => ({
      comment_id: c.id,
      user_id: c.user_id ?? null,
      user_name: c.users?.name ?? null,
      content: (c.comment_content ?? '').trim(),
      created_at: c.created_at,
    }));

  const attachmentRows = (attachmentsRes.data ?? []) as unknown as Array<{
    id: string;
    file_name: string | null;
    file_type: string | null;
    mime_type: string | null;
    file_size: number | null;
    url: string | null;
    created_at: string;
    users: { id: string; name: string } | null;
  }>;
  const attachmentTotal = attachmentsRes.count ?? attachmentRows.length;
  const attachments: TaskAttachment[] = attachmentRows.map((a) => ({
    attachment_id: a.id,
    file_name: a.file_name ?? null,
    file_type: a.file_type ?? null,
    mime_type: a.mime_type ?? null,
    file_size: a.file_size ?? null,
    url: a.url ?? null,
    uploaded_by_name: a.users?.name ?? null,
    created_at: a.created_at,
  }));

  const flattened = tiptapToPlainText(
    task.description as Parameters<typeof tiptapToPlainText>[0],
  );
  const descriptionTruncated = flattened.length > DESCRIPTION_CAP;
  const description = flattened.length === 0
    ? null
    : descriptionTruncated
      ? flattened.slice(0, DESCRIPTION_CAP)
      : flattened;

  const formMetadata =
    task.form_metadata && typeof task.form_metadata === 'object'
      ? (task.form_metadata as Record<string, unknown>)
      : null;

  const view: TaskDetailView = {
    task_id: task.id,
    task_url: taskUrl(task.id),
    title: task.title ?? null,
    description,
    description_truncated: descriptionTruncated,
    status: task.status ?? 'not_started',
    priority: task.priority ?? 'medium',
    property_id: task.property_id ?? null,
    property_name: task.property_name ?? null,
    template_id: task.template_id ?? null,
    template_name: task.templates?.name ?? null,
    department_id: task.department_id ?? null,
    department_name: task.departments?.name ?? null,
    bin_id: task.bin_id ?? null,
    bin_name: task.project_bins?.name ?? null,
    bin_is_system: !!task.project_bins?.is_system,
    is_binned: task.is_binned ?? false,
    scheduled_date: task.scheduled_date ?? null,
    scheduled_time: task.scheduled_time ?? null,
    created_at: task.created_at,
    updated_at: task.updated_at,
    completed_at: task.completed_at ?? null,
    reservation: task.reservations
      ? {
          reservation_id: task.reservations.id,
          guest_name: task.reservations.guest_name ?? null,
          check_in: task.reservations.check_in ?? null,
          check_out: task.reservations.check_out ?? null,
        }
      : null,
    assigned_users: (task.task_assignments ?? []).map((a) => ({
      user_id: a.user_id,
      name: a.users?.name ?? '',
      role: a.users?.role ?? '',
    })),
    checklist: buildChecklist(templateFields, formMetadata),
    comments: {
      total: commentTotal,
      returned: comments.length,
      truncated: commentTotal > comments.length,
      items: comments,
    },
    attachments: {
      total: attachmentTotal,
      returned: attachments.length,
      truncated: attachmentTotal > attachments.length,
      items: attachments,
    },
  };

  return { ok: true, view };
}

async function handler(
  input: Input,
  ctx: ToolContext,
): Promise<ToolResult<TaskDetailView[]>> {
  const org = requireOrgId(ctx);
  if (typeof org !== 'string') return org;

  const supabase = ctx.db;
  // Dedupe first: the model occasionally passes the same id twice when it has
  // seen a task in two different find_tasks results, and reading it twice
  // would double its weight in the answer for no reason.
  const taskIds = Array.from(new Set(input.task_ids));
  const commentLimit =
    input.comment_limit ??
    (taskIds.length > 1 ? MULTI_TASK_COMMENT_LIMIT : DEFAULT_COMMENT_LIMIT);

  // Org-filtered read. The ids are model-supplied, so the org filter is the
  // gate, not a nicety — src/server/tasks/getTaskById.ts is org-blind by
  // design and explicitly warns that any caller taking an id from a model
  // must verify org itself. We query directly rather than reuse it.
  const { data, error } = await supabase
    .from('turnover_tasks')
    .select(TASK_SELECT)
    .in('id', taskIds)
    .eq('org_id', org);

  if (error) {
    return { ok: false, error: { code: 'db_error', message: error.message } };
  }

  // Cast via unknown: the generic client types to-one embeds as arrays, but
  // PostgREST returns objects for them at runtime (same as find_tasks).
  const tasks = (data ?? []) as unknown as TaskQueryRow[];

  if (tasks.length === 0) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message:
          taskIds.length === 1
            ? `No task with id ${taskIds[0]}.`
            : `None of the ${taskIds.length} ids matched a task in this organization.`,
        hint: 'Call find_tasks to resolve a task by title, template, property, or schedule, then pass the task_id values it returns.',
      },
    };
  }

  // The checklist definition lives on the template, the answers on the task.
  // Neither half is meaningful alone, so fetch fields for every template in
  // play — in ONE query rather than per task, since a batch of tasks very
  // often shares a template (five turnovers, one Turnover Cleaning). Note
  // find_templates deliberately omits this column (it's heavy), which is why
  // we go direct.
  const templateIds = Array.from(
    new Set(tasks.map((t) => t.template_id).filter((id): id is string => !!id)),
  );
  const fieldsByTemplate = new Map<string, FieldDefinition[]>();
  if (templateIds.length > 0) {
    const { data: tmpls, error: tmplErr } = await supabase
      .from('templates')
      .select('id, fields')
      .in('id', templateIds)
      .eq('org_id', org);
    if (tmplErr) {
      return {
        ok: false,
        error: { code: 'db_error', message: tmplErr.message },
      };
    }
    for (const row of (tmpls ?? []) as Array<{ id: string; fields?: unknown }>) {
      if (Array.isArray(row.fields)) {
        fieldsByTemplate.set(row.id, row.fields as FieldDefinition[]);
      }
    }
  }

  // Concurrent: five tasks' comment and attachment tails fetched at once
  // rather than in sequence.
  const built = await Promise.all(
    tasks.map((t) =>
      buildTaskView(
        supabase,
        t,
        org,
        t.template_id ? fieldsByTemplate.get(t.template_id) ?? null : null,
        commentLimit,
      ),
    ),
  );

  const failed = built.find((b) => !b.ok);
  if (failed && !failed.ok) {
    return { ok: false, error: { code: 'db_error', message: failed.message } };
  }

  // Return in the order the caller asked for, not the order PostgREST
  // happened to return rows — the model usually passes its best candidate
  // first and reads the results the same way.
  const byId = new Map(
    built
      .filter((b): b is { ok: true; view: TaskDetailView } => b.ok)
      .map((b) => [b.view.task_id, b.view]),
  );
  const views = taskIds
    .map((id) => byId.get(id))
    .filter((v): v is TaskDetailView => !!v);

  // Ids that matched no row. Surfaced rather than silently dropped so the
  // model reports "I couldn't find one of those" instead of quietly answering
  // about a smaller set than it was asked about.
  const notFound = taskIds.filter((id) => !byId.has(id));

  const meta: ToolMeta = {
    returned: views.length,
    limit: MAX_TASKS_PER_CALL,
    truncated: false,
    comment_limit: commentLimit,
    ...(notFound.length > 0 ? { not_found_task_ids: notFound } : {}),
  };

  return { ok: true, data: views, meta };
}

export const getTask: ToolDefinition<Input, TaskDetailView[]> = {
  name: 'get_task',
  description:
    "Open one to five tasks and read everything on them: the full description, the template checklist (every field with its label and recorded answer, plus completed/total progress), all comments with their authors, attachment metadata, assignees, bin, department, and the linked reservation. Returns an ARRAY, in the order you passed the ids. Use this whenever the user asks about the CONTENT of a specific task — 'what do the comments say', 'what's the note on this one', 'how far along is the checklist', 'what did they write', 'what's left to do' — or any time you need detail find_tasks does not carry. find_tasks FINDS tasks (filters, lists) and returns comment_count/attachment_count only as numbers; get_task READS them. Resolve with find_tasks first and pass the task_id values it returned. IMPORTANT: when find_tasks leaves more than one plausible candidate, pass them ALL in a single call rather than opening one, finding it wrong, and opening the next — reading three at once is one round trip instead of three. Do not, however, call this on a whole list; if you have more than five candidates the conversation hasn't narrowed and you should filter with find_tasks instead. Comments come back oldest-first; when a task has more than comment_limit, the most recent are kept and comments.truncated is true. Any id that matched nothing is reported in meta.not_found_task_ids — mention it rather than quietly answering about fewer tasks than you were asked about. NOTE: tasks do not have an activity/audit history — if the user asks who changed what and when, say that isn't tracked yet rather than inferring it from timestamps.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      task_ids: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: MAX_TASKS_PER_CALL,
        description: `Task UUIDs, 1 to ${MAX_TASKS_PER_CALL}. Resolve them with find_tasks first — never construct one. Pass every plausible candidate at once when the conversation hasn't narrowed to a single task.`,
      },
      comment_limit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_COMMENT_LIMIT,
        description: `Max comments per task. Defaults to ${DEFAULT_COMMENT_LIMIT} for one task and ${MULTI_TASK_COMMENT_LIMIT} when several are requested; hard cap ${MAX_COMMENT_LIMIT}. The most recent are kept when a task has more.`,
      },
    },
    required: ['task_ids'],
    additionalProperties: false,
  },
  handler,
};
