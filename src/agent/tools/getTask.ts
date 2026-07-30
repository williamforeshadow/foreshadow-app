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

const inputSchema = z.object({
  task_id: z
    .string()
    .uuid()
    .describe(
      'UUID of the task to open. Resolve a task by name/property/schedule with find_tasks first and pass the task_id it returns.',
    ),
  comment_limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_COMMENT_LIMIT)
    .optional()
    .describe(
      `Max comments to return. Default ${DEFAULT_COMMENT_LIMIT}, hard cap ${MAX_COMMENT_LIMIT}. When a task has more, the MOST RECENT ones are kept and comments.truncated is true.`,
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

  if (type === 'photo') {
    return typeof value === 'string' && value !== '' ? '1 photo' : null;
  }
  if (type === 'photos') {
    if (!Array.isArray(value) || value.length === 0) return null;
    return `${value.length} photo${value.length === 1 ? '' : 's'}`;
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

async function handler(
  input: Input,
  ctx: ToolContext,
): Promise<ToolResult<TaskDetailView>> {
  const org = requireOrgId(ctx);
  if (typeof org !== 'string') return org;

  const supabase = ctx.db;
  const commentLimit = input.comment_limit ?? DEFAULT_COMMENT_LIMIT;

  // Org-filtered read. task_id is model-supplied, so the org filter is the
  // gate, not a nicety — src/server/tasks/getTaskById.ts is org-blind by
  // design and explicitly warns that any caller taking an id from a model
  // must verify org itself. We query directly rather than reuse it.
  const { data: row, error } = await supabase
    .from('turnover_tasks')
    .select(TASK_SELECT)
    .eq('id', input.task_id)
    .eq('org_id', org)
    .maybeSingle();

  if (error) {
    return { ok: false, error: { code: 'db_error', message: error.message } };
  }
  if (!row) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: `No task with id ${input.task_id}.`,
        hint: 'Call find_tasks to resolve a task by title, template, property, or schedule, then pass the task_id it returns.',
      },
    };
  }

  // Cast via unknown: the generic client types to-one embeds as arrays, but
  // PostgREST returns objects for them at runtime (same as find_tasks).
  const task = row as unknown as {
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
  };

  // The checklist definition lives on the template, the answers on the task.
  // Neither half is meaningful alone, so fetch the template's fields whenever
  // the task is templated. find_templates deliberately omits this column
  // (it's heavy), which is why we go direct.
  let templateFields: FieldDefinition[] | null = null;
  if (task.template_id) {
    const { data: tmpl, error: tmplErr } = await supabase
      .from('templates')
      .select('fields')
      .eq('id', task.template_id)
      .eq('org_id', org)
      .maybeSingle();
    if (tmplErr) {
      return {
        ok: false,
        error: { code: 'db_error', message: tmplErr.message },
      };
    }
    const raw = (tmpl as { fields?: unknown } | null)?.fields;
    if (Array.isArray(raw)) templateFields = raw as FieldDefinition[];
  }

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
      .eq('task_id', input.task_id)
      .eq('org_id', org)
      .order('created_at', { ascending: false })
      .limit(commentLimit),
    supabase
      .from('project_attachments')
      .select(
        'id, file_name, file_type, mime_type, file_size, url, created_at, users(id, name)',
        { count: 'exact' },
      )
      .eq('task_id', input.task_id)
      .eq('org_id', org)
      .order('created_at', { ascending: false })
      .limit(ATTACHMENT_CAP),
  ]);

  if (commentsRes.error) {
    return {
      ok: false,
      error: { code: 'db_error', message: commentsRes.error.message },
    };
  }
  if (attachmentsRes.error) {
    return {
      ok: false,
      error: { code: 'db_error', message: attachmentsRes.error.message },
    };
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

  const meta: ToolMeta = {
    returned: 1,
    limit: 1,
    truncated: false,
    comment_limit: commentLimit,
  };

  return { ok: true, data: view, meta };
}

export const getTask: ToolDefinition<Input, TaskDetailView> = {
  name: 'get_task',
  description:
    "Open ONE task and read everything on it: the full description, the template checklist (every field with its label and recorded answer, plus completed/total progress), all comments with their authors, attachment metadata, assignees, bin, department, and the linked reservation. Use this whenever the user asks about the CONTENT or history of a specific task — 'what do the comments say', 'what's the note on this one', 'how far along is the checklist', 'what did they write', 'what's left to do on it' — or any time you need detail that find_tasks does not carry. find_tasks is for FINDING tasks (filters, lists) and returns only comment_count/attachment_count as numbers; get_task is for reading one. Resolve the task with find_tasks first and pass the task_id it returned. Comments come back oldest-first; when a task has more than comment_limit, the most recent are kept and comments.truncated is true. NOTE: tasks do not have an activity/audit history — if the user asks who changed what and when, say that isn't tracked yet rather than inferring it from timestamps.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      task_id: {
        type: 'string',
        description:
          'Task UUID. Resolve it with find_tasks first — never construct one.',
      },
      comment_limit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_COMMENT_LIMIT,
        description: `Max comments to return. Default ${DEFAULT_COMMENT_LIMIT}, hard cap ${MAX_COMMENT_LIMIT}. The most recent are kept when a task has more.`,
      },
    },
    required: ['task_id'],
    additionalProperties: false,
  },
  handler,
};
