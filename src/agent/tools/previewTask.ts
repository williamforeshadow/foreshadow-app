import { z } from 'zod';
import {
  previewCreateTask,
  type CreateTaskPlan,
} from '@/src/server/tasks/createTask';
import { mintCreateTaskToken } from '@/src/server/tasks/createTaskConfirmation';
import type { ToolDefinition, ToolResult } from './types';

// preview_task — first half of the two-step write protocol for tasks.
//
// Validates the user's intent, resolves every FK to a display label, and
// returns a fully-formed plan + a single-use confirmation_token. The
// agent presents the plan to the user verbatim, asks for explicit
// confirmation, and only then calls create_task with the token.
//
// preview_task does NOT write. It is safe to call repeatedly while
// negotiating fields with the user. Each call mints a fresh token; the
// previous token is implicitly orphaned (it'll expire in 5 minutes).
//
// The model contract is intentionally narrow: the only way to write a
// task is via a confirmation_token issued by this tool. create_task does
// not accept the field inputs directly — it just validates and consumes
// the token. So skipping preview is structurally impossible.

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
  title: z
    .string()
    .min(1, 'title is required')
    .describe('Plain-text task title. Required. Keep concise.'),
  description: z
    .string()
    .optional()
    .describe(
      "Plain-text description. Will render as a multi-paragraph rich-text doc — separate paragraphs with blank lines. Omit if there's nothing to add beyond the title.",
    ),
  status: STATUS_ENUM
    .optional()
    .describe(
      "Task status. Defaults to 'not_started'. Use 'contingent' for tasks blocked on a precondition.",
    ),
  priority: PRIORITY_ENUM
    .optional()
    .describe(
      "Task priority. Defaults to 'medium'. Reserve 'urgent' for time-critical operational issues.",
    ),
  scheduled_date: dateString
    .optional()
    .describe(
      "When the task should be done, YYYY-MM-DD. Resolve relative dates ('tomorrow', 'next Friday') to a concrete date using the user's local clock before passing. Omit to leave unscheduled.",
    ),
  scheduled_time: timeString
    .optional()
    .describe(
      'Time of day, HH:MM (24-hour). Only meaningful with scheduled_date. Omit when no time was specified.',
    ),
  property_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Property UUID. Resolve property names with find_properties first. Omit for tasks that aren't tied to any property.",
    ),
  bin_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Sub-bin UUID. Resolve sub-bin names with find_bins first. When set, the task lands in that sub-bin (and is_binned is forced to true). To put a task in the default \"Task Bin\" instead, omit bin_id and pass is_binned=true. Omit both for free-floating tasks that aren't binned at all.",
    ),
  is_binned: z
    .boolean()
    .optional()
    .describe(
      "Whether the task is binned. Defaults to (bin_id != null) when omitted. Pass `true` with no bin_id to land the task in the default \"Task Bin\" (orphan binned). Passing `false` with a bin_id is rejected — a task in a sub-bin is binned by definition.",
    ),
  department_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      'Department UUID. Resolve department names with find_departments first. Omit if no department applies.',
    ),
  template_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Template UUID. Resolve template names with find_templates first. Tagging only — does NOT apply the template's automation config (that's reservation-only).",
    ),
  assigned_user_ids: z
    .array(z.string().uuid())
    .optional()
    .describe(
      "User UUIDs to assign. Resolve names with find_users first. Omit when no one should be assigned yet.",
    ),
});

type Input = z.infer<typeof inputSchema>;

export interface PreviewTaskResultData {
  /** Human-readable plan for presenting to the user. */
  plan: CreateTaskPlan;
  /**
   * Single-use, time-limited token. Pass to create_task to actually write.
   * Expires 5 minutes after issuance.
   */
  confirmation_token: string;
  /** ISO8601 expiration timestamp for the token. */
  expires_at: string;
}

async function handler(
  input: Input,
): Promise<ToolResult<PreviewTaskResultData>> {
  const result = await previewCreateTask(input);

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

  // Mint a token bound to the canonical (Zod-parsed) input. The token is
  // the only thing that lets the model commit; storing the canonical input
  // (rather than the raw input) means trivial whitespace / key-order
  // differences don't break round-tripping.
  const minted = mintCreateTaskToken(result.canonicalInput);

  return {
    ok: true,
    data: {
      plan: result.plan,
      confirmation_token: minted.token,
      expires_at: minted.expires_at,
    },
    meta: { returned: 1, limit: 1, truncated: false },
  };
}

export const previewTask: ToolDefinition<Input, PreviewTaskResultData> = {
  name: 'preview_task',
  description:
    "PREVIEW a task before creating it. ALWAYS call this first when the user asks to create a task. Validates the inputs, resolves every id you pass into a human-readable label (property name, template name, department name, assignee names), and returns a confirmation_token. After calling, present the plan to the user in plain English, ask for explicit confirmation ('shall I create this?'), and only call create_task with the returned confirmation_token after they agree. The token is single-use and expires in 5 minutes. If the user wants to change something, call preview_task again with the updated fields — each call mints a fresh token, the previous one is orphaned. preview_task never writes anything to the database; it is safe to call repeatedly.",
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
          "Plain-text description. Multi-paragraph supported (blank lines between paragraphs). Omit when there's nothing to add.",
      },
      status: {
        type: 'string',
        enum: ['contingent', 'not_started', 'in_progress', 'paused', 'complete'],
        description:
          "Task status. Defaults to 'not_started'. Use 'contingent' for blocked tasks.",
      },
      priority: {
        type: 'string',
        enum: ['urgent', 'high', 'medium', 'low'],
        description:
          "Task priority. Defaults to 'medium'. Reserve 'urgent' for time-critical issues.",
      },
      scheduled_date: {
        type: 'string',
        description:
          "Scheduled date, YYYY-MM-DD. Resolve relative dates with the user's local clock first. Omit to leave unscheduled.",
      },
      scheduled_time: {
        type: 'string',
        description:
          'Scheduled time, HH:MM (24-hour). Only meaningful with scheduled_date.',
      },
      property_id: {
        type: 'string',
        description:
          'Property UUID. Use find_properties to resolve names. Omit for free-floating tasks.',
      },
      bin_id: {
        type: 'string',
        description:
          "Sub-bin UUID. Use find_bins to resolve sub-bin names. Omit (and pass is_binned=true) when the user said \"bin it\" without naming a sub-bin to land the task in the default Task Bin; omit both for free-floating tasks.",
      },
      is_binned: {
        type: 'boolean',
        description:
          "Whether the task is binned. Defaults to (bin_id != null). Pass true with no bin_id for the Task Bin (orphan binned). Cannot be false when bin_id is set.",
      },
      department_id: {
        type: 'string',
        description:
          'Department UUID. Use find_departments to resolve names.',
      },
      template_id: {
        type: 'string',
        description:
          'Template UUID. Use find_templates to resolve names. Manual tasks only — does NOT apply automation config.',
      },
      assigned_user_ids: {
        type: 'array',
        items: { type: 'string' },
        description:
          'User UUIDs to assign. Use find_users to resolve names.',
      },
    },
    required: ['title'],
    additionalProperties: false,
  },
  handler,
};
