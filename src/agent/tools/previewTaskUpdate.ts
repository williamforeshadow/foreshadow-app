import { z } from 'zod';
import {
  previewUpdateTask,
  type UpdateTaskPlan,
} from '@/src/server/tasks/updateTask';
import { mintUpdateTaskToken } from '@/src/server/tasks/updateTaskConfirmation';
import type { ToolDefinition, ToolResult } from './types';

// preview_task_update — first half of the two-step write protocol for
// modifying an existing task. Mirrors preview_task in shape: validates
// input, FK-validates ids the user is changing TO, resolves display
// labels, returns a precise change diff + a single-use
// confirmation_token.
//
// What this tool can change:
//   title, description, status, priority, scheduled_date,
//   scheduled_time, department_id, bin_id, is_binned, assigned_user_ids
//
// What this tool CANNOT change (locked at the schema layer):
//   property_id / property_name / template_id — locked after creation,
//   matching the UI's hard-block. If the user asks to change one of
//   these, explain that they're locked and offer to delete + recreate.
//
// Coupled fields handled automatically:
//   status='complete' → completed_at set to now
//   status away from 'complete' → completed_at cleared
//   bin_id changed → is_binned auto-derives unless explicitly set
//
// Assignment semantics:
//   assigned_user_ids is REPLACEMENT, not delta. Pass the full final
//   list. To clear all assignees, pass an empty array. The plan diff
//   surfaces the before/after lists so the user can confirm precisely.

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
  task_id: z
    .string()
    .uuid()
    .describe(
      'UUID of the task to update. Resolve with find_tasks first when the user names the task.',
    ),
  title: z
    .string()
    .min(1, 'title cannot be empty')
    .optional()
    .describe('New plain-text title. Omit to leave unchanged.'),
  description: z
    .string()
    .nullable()
    .optional()
    .describe(
      "New plain-text description (multi-paragraph supported, blank lines between paragraphs). Pass null to clear the description. Omit to leave unchanged.",
    ),
  status: STATUS_ENUM.optional().describe(
    "New status. Setting status='complete' also sets completed_at to now; transitioning away from 'complete' clears completed_at.",
  ),
  priority: PRIORITY_ENUM.optional().describe('New priority.'),
  scheduled_date: dateString
    .nullable()
    .optional()
    .describe(
      "New scheduled date YYYY-MM-DD. Pass null to unschedule. Resolve relative dates ('tomorrow') with the user's local clock first.",
    ),
  scheduled_time: timeString
    .nullable()
    .optional()
    .describe('New scheduled time HH:MM (24-hour). Pass null to clear.'),
  department_id: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe(
      'New department UUID. Resolve names with find_departments first. Pass null to clear.',
    ),
  bin_id: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe(
      'New sub-bin UUID. Resolve names with find_bins first. Pass null to remove from any sub-bin (and unset is_binned unless it is explicitly set true to land in the default Task Bin).',
    ),
  is_binned: z
    .boolean()
    .optional()
    .describe(
      "Override is_binned. Defaults: setting bin_id derives is_binned (true if bin_id != null, false if null). Setting is_binned=true with bin_id=null lands the task in the default Task Bin. is_binned=false with a non-null bin_id is rejected.",
    ),
  assigned_user_ids: z
    .array(z.string().uuid())
    .optional()
    .describe(
      'REPLACEMENT list of assignees. Pass the full final list of user UUIDs (resolve names with find_users first). Pass an empty array to clear all assignees. Omit to leave assignments unchanged.',
    ),
});

type Input = z.infer<typeof inputSchema>;

export interface PreviewTaskUpdateResultData {
  plan: UpdateTaskPlan;
  confirmation_token: string;
  expires_at: string;
}

async function handler(
  input: Input,
): Promise<ToolResult<PreviewTaskUpdateResultData>> {
  const result = await previewUpdateTask(input);

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
    if (result.error.code === 'locked_field') {
      return {
        ok: false,
        // Surface locked-field rejections as invalid_input so the
        // existing error code surface stays minimal — the message
        // makes the locked nature clear.
        error: {
          code: 'invalid_input',
          message: result.error.message,
          hint:
            'These fields cannot be changed on an existing task. Tell the user they are locked at creation. If they really need to change one, offer to delete this task and create a new one.',
        },
      };
    }
    if (result.error.code === 'not_found') {
      const field = result.error.field;
      const hint =
        field === 'task_id'
          ? 'Call find_tasks to resolve the task by name/template/property and use the returned task_id.'
          : field === 'bin_id'
            ? 'Call find_bins to resolve the sub-bin name into a valid id, or pass bin_id=null to remove from any sub-bin.'
            : field === 'department_id'
              ? 'Call find_departments to resolve the department name into a valid id, or pass department_id=null to clear.'
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

  // Empty diff = no-op preview. Return success but with an empty
  // changes array so the model can tell the user "nothing to change."
  // We still mint a token so a later "actually, also change X" doesn't
  // need to re-preview — but the model is instructed below to NOT
  // call update_task on an empty diff.
  const minted = mintUpdateTaskToken(result.canonicalInput);
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

export const previewTaskUpdate: ToolDefinition<Input, PreviewTaskUpdateResultData> = {
  name: 'preview_task_update',
  description:
    "PREVIEW changes to an existing task before applying them. ALWAYS call this first when the user asks to update, change, complete, reschedule, reassign, move (between bins), reprioritize, or rename a task. Validates inputs, FK-validates any new ids, returns a precise field-by-field diff (before/after for every field that will change) plus a confirmation_token. After calling: present the diff to the user in plain English, ask for explicit confirmation ('apply these changes?'), and only then call update_task with the returned token. Tokens are single-use and expire in 5 minutes. CRITICAL: if the diff is empty (no changes), tell the user nothing would change and DO NOT call update_task. Property and template are LOCKED — attempts to change them return an invalid_input error with a clear message; tell the user the field is locked and offer to delete + recreate. Assignments are REPLACEMENT (pass the full final list); status='complete' auto-sets completed_at; bin_id changes auto-update is_binned.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      task_id: {
        type: 'string',
        description:
          'UUID of the task to update. Use find_tasks to resolve from a name first.',
      },
      title: { type: 'string', minLength: 1, description: 'New title.' },
      description: {
        type: ['string', 'null'],
        description:
          'New plain-text description. Pass null to clear. Omit to leave unchanged.',
      },
      status: {
        type: 'string',
        enum: ['contingent', 'not_started', 'in_progress', 'paused', 'complete'],
        description:
          "New status. 'complete' sets completed_at to now; transitioning away clears it.",
      },
      priority: {
        type: 'string',
        enum: ['urgent', 'high', 'medium', 'low'],
        description: 'New priority.',
      },
      scheduled_date: {
        type: ['string', 'null'],
        description:
          'New scheduled date YYYY-MM-DD. Pass null to unschedule.',
      },
      scheduled_time: {
        type: ['string', 'null'],
        description: 'New scheduled time HH:MM. Pass null to clear.',
      },
      department_id: {
        type: ['string', 'null'],
        description:
          'New department UUID. Use find_departments to resolve names. Pass null to clear.',
      },
      bin_id: {
        type: ['string', 'null'],
        description:
          'New sub-bin UUID. Use find_bins to resolve names. Pass null to remove from any sub-bin.',
      },
      is_binned: {
        type: 'boolean',
        description:
          'Override is_binned. Use is_binned=true with bin_id=null to land in the default Task Bin.',
      },
      assigned_user_ids: {
        type: 'array',
        items: { type: 'string' },
        description:
          'REPLACEMENT list of assignee UUIDs. Pass the full final list. Empty array clears assignees. Omit to leave unchanged.',
      },
    },
    required: ['task_id'],
    additionalProperties: false,
  },
  handler,
};
