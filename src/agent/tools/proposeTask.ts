import { z } from 'zod';
import { previewCreateTask } from '@/src/server/tasks/createTask';
import { requireOrgId, type ToolContext, type ToolDefinition, type ToolResult } from './types';

// propose_task — the web surface's task-creation path.
//
// Replaces the preview_task → create_task token protocol in the chat panel.
// Instead of staging a 5-minute pending action behind a Confirm button, this
// inserts a durable proposed_tasks row (the same table the concierge's
// unprompted drafts live in). The chat renders it as the standard
// proposed-task card; the user accepts it as-is, opens it to edit fields
// before accepting, or dismisses it — the click IS the confirmation, handled
// by /api/proposed-tasks/[id] outside the model loop. Nothing here writes a
// task; a proposal is inert until a human decides it.
//
// Slack keeps the preview/commit pair (no card surface there), so this tool
// is registered for the web surface only.

const STATUS_ENUM = z.enum([
  'contingent',
  'not_started',
  'in_progress',
  'paused',
  'complete',
]);
const PRIORITY_ENUM = z.enum(['urgent', 'high', 'medium', 'low']);

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const timeString = z
  .string()
  .regex(/^\d{2}:\d{2}$/, 'expected HH:MM (24-hour)');

const inputSchema = z.object({
  title: z.string().min(1, 'title is required'),
  description: z.string().optional(),
  status: STATUS_ENUM.optional(),
  priority: PRIORITY_ENUM.optional(),
  scheduled_date: dateString.optional(),
  scheduled_time: timeString.optional(),
  property_id: z.string().uuid().optional(),
  bin_id: z.string().uuid().optional(),
  is_binned: z.boolean().optional(),
  department_id: z.string().uuid().optional(),
  template_id: z.string().uuid().optional(),
  assigned_user_ids: z.array(z.string().uuid()).optional(),
  attachment_inbound_file_ids: z.array(z.string().uuid()).optional(),
  replaces_proposal_id: z.string().uuid().optional(),
});

type Input = z.infer<typeof inputSchema>;

export interface ProposeTaskResultData {
  /** The persisted proposal's id — the card the user will decide on. */
  proposal_id: string;
  /** Resolved display labels (property/department/template/assignee names). */
  plan: unknown;
  /** Present when replaces_proposal_id was passed and the old row was retired. */
  replaced_proposal_id?: string;
}

async function handler(
  input: Input,
  ctx: ToolContext,
): Promise<ToolResult<ProposeTaskResultData>> {
  const org = requireOrgId(ctx);
  if (typeof org !== 'string') return org;

  const {
    attachment_inbound_file_ids,
    replaces_proposal_id,
    ...taskInput
  } = input;

  // Same validation + label resolution the old preview path ran, so a
  // proposal that stores successfully will also accept successfully, and the
  // model gets real names (not ids) to caption the card with.
  const result = await previewCreateTask(taskInput, org);
  if (!result.ok) {
    if (result.error.code === 'invalid_input') {
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          message: result.error.message,
          hint: result.error.field
            ? `Check the "${result.error.field}" field and call again.`
            : undefined,
        },
      };
    }
    if (result.error.code === 'not_found') {
      const field = result.error.field;
      const hint =
        field === 'property_id'
          ? 'Call find_properties to resolve a property name into a valid id.'
          : field === 'bin_id'
            ? 'Call find_bins to resolve a bin name into a valid id.'
            : field === 'department_id'
              ? 'Call find_departments to resolve a department name into a valid id.'
              : field === 'template_id'
                ? 'Call find_templates to resolve a template name into a valid id.'
                : field === 'assigned_user_ids'
                  ? 'Call find_users to resolve assignee names into valid ids.'
                  : `Confirm the ${field ?? 'id'} with the user, or omit it.`;
      return {
        ok: false,
        error: { code: 'not_found', message: result.error.message, hint },
      };
    }
    return {
      ok: false,
      error: { code: 'db_error', message: result.error.message },
    };
  }

  const canonical = result.canonicalInput;
  const { data, error } = await ctx.db
    .from('proposed_tasks')
    .insert({
      org_id: org,
      conversation_id: null,
      triggering_message_id: null,
      source: 'agent',
      agent_session_id: ctx.sessionId ?? null,
      title: canonical.title,
      description: canonical.description ?? null,
      priority: canonical.priority ?? 'medium',
      task_status: canonical.status ?? null,
      property_id: canonical.property_id ?? null,
      department_id: canonical.department_id ?? null,
      template_id: canonical.template_id ?? null,
      bin_id: canonical.bin_id ?? null,
      is_binned: canonical.is_binned ?? null,
      suggested_assignee_ids: canonical.assigned_user_ids ?? [],
      scheduled_date: canonical.scheduled_date ?? null,
      scheduled_time: canonical.scheduled_time ?? null,
      attachment_inbound_file_ids: attachment_inbound_file_ids ?? [],
      status: 'pending',
    })
    .select('id')
    .single();
  if (error || !data) {
    return {
      ok: false,
      error: { code: 'db_error', message: error?.message ?? 'insert failed' },
    };
  }

  // Supersede: retire the proposal this one replaces so the user is never
  // looking at two live cards for the same intent. Best-effort — a failure
  // leaves a stale pending card, which the user can dismiss by hand.
  let replaced: string | undefined;
  if (replaces_proposal_id) {
    const { data: old } = await ctx.db
      .from('proposed_tasks')
      .update({
        status: 'dismissed',
        decided_by: ctx.actor?.appUserId ?? null,
        decided_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', replaces_proposal_id)
      .eq('source', 'agent')
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (old?.id) replaced = replaces_proposal_id;
  }

  return {
    ok: true,
    data: {
      proposal_id: data.id as string,
      plan: result.plan,
      ...(replaced ? { replaced_proposal_id: replaced } : {}),
    },
    meta: { returned: 1, limit: 1, truncated: false },
  };
}

export const proposeTask: ToolDefinition<Input, ProposeTaskResultData> = {
  name: 'propose_task',
  surfaces: ['web'],
  description:
    "PROPOSE a new task for the user to approve. This is how tasks get created here: call it as soon as you can write a title, and the proposal renders as a task card directly below your reply with its own Create/Dismiss controls — the user can also open the card to edit any field before creating. Nothing is written until they decide, so proposing is always safe, and you should propose rather than ask: a field the user did not mention is a decision, not a gap — leave it unset and let the card collect corrections. Validates every id you pass and resolves them to display names (property, department, template, assignees), returned in `plan` — if an id doesn't resolve, you get an error naming the field instead of a proposal. For several tasks in one request, call this once per task in the same turn; each gets its own card. Your reply should be a short caption for the card(s) — do not restate the fields the card already shows, do not mention buttons, and never claim the task was created: it exists only as a proposal until the user acts. If the user asks to change a proposal you just made and it hasn't been decided yet, call propose_task again with the corrected fields and pass replaces_proposal_id so the old card is retired.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      title: {
        type: 'string',
        minLength: 1,
        description: 'Plain-text task title. Required. Keep concise.',
      },
      description: {
        type: 'string',
        description:
          "Task description. Write it as you naturally would and the formatting is preserved as real rich text: each line is its own paragraph, \"- item\" lines become a bulleted list, \"1. item\" a numbered one, \"## Heading\" a heading, and \"[ ] item\" / \"[x] item\" tickable checkboxes. Reach for a list whenever the content IS a list. Omit when there's nothing to add beyond the title.",
      },
      status: {
        type: 'string',
        enum: ['contingent', 'not_started', 'in_progress', 'paused', 'complete'],
        description:
          "Initial task status. Defaults to 'not_started'. Use 'contingent' for tasks blocked on a precondition. Do not ask the user which status they want.",
      },
      priority: {
        type: 'string',
        enum: ['urgent', 'high', 'medium', 'low'],
        description:
          "Task priority. Defaults to 'medium'. Reserve 'urgent' for time-critical issues. Do not ask the user which priority they want.",
      },
      scheduled_date: {
        type: 'string',
        description:
          "Scheduled date, YYYY-MM-DD. Resolve relative dates against the user's local clock first. Omit to leave unscheduled — unscheduled is a normal state, so do not ask for a date the user did not give.",
      },
      scheduled_time: {
        type: 'string',
        description:
          'Scheduled time, HH:MM (24-hour). Only meaningful with scheduled_date. Omit when no time was stated.',
      },
      property_id: {
        type: 'string',
        description:
          'Property UUID. Resolve a named property with find_properties. Omit entirely when no property was mentioned — plenty of tasks belong to no property, so do not ask which one.',
      },
      bin_id: {
        type: 'string',
        description:
          'Sub-bin UUID. Use find_bins to resolve sub-bin names. Omit (and pass is_binned=true) to land the task in the default Task Bin. Omit both when the user said nothing about bins — do not ask.',
      },
      is_binned: {
        type: 'boolean',
        description:
          'Whether the task is binned. Defaults to (bin_id != null). Pass true with no bin_id for the default Task Bin. Cannot be false when bin_id is set.',
      },
      department_id: {
        type: 'string',
        description:
          'Department UUID. Use find_departments to resolve a named department. Omit when none was mentioned — do not ask.',
      },
      template_id: {
        type: 'string',
        description:
          'Template UUID. Use find_templates to resolve a named template. Tagging only — does NOT apply automation config. Omit when none was mentioned.',
      },
      assigned_user_ids: {
        type: 'array',
        items: { type: 'string' },
        description:
          'User UUIDs to assign. Use find_users to resolve names. Omit when nobody was named — unassigned is a normal state, so do not ask who should do it.',
      },
      attachment_inbound_file_ids: {
        type: 'array',
        items: { type: 'string' },
        description:
          'inbound_file_id UUIDs to attach once the task is created on approval. Use only ids from the uploaded-files context block.',
      },
      replaces_proposal_id: {
        type: 'string',
        description:
          'proposal_id of a still-pending proposal from THIS conversation that this one corrects. The old card is retired so only the corrected one remains. Omit for a brand-new proposal.',
      },
    },
    required: ['title'],
    additionalProperties: false,
  },
  handler,
};
