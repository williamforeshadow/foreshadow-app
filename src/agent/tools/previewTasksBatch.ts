import { z } from 'zod';
import {
  previewCreateTasksBatch,
  type CreateTasksBatchPlan,
} from '@/src/server/tasks/createTasksBatch';
import { mintCreateTasksBatchToken } from '@/src/server/tasks/createTasksBatchConfirmation';
import type { ToolDefinition, ToolResult } from './types';

// preview_tasks_batch — first half of the batch task write protocol.
//
// Validates an array of task inputs PLUS one shared bin destination,
// resolves every FK on every task, and (when the destination is a
// new sub-bin) also validates the bin name + duplicate-name conflict.
// Returns a single plan + single token. The agent presents the plan,
// asks for explicit confirmation, then calls create_tasks_batch with
// the token.
//
// One token covers everything: the new sub-bin (if any) AND every
// task. The user confirms once, the commit step runs the full
// orchestration in order.
//
// Why batch instead of N single-task calls:
//   - One confirmation instead of N. The single-task preview/commit
//     dance was designed for one-off creates; looping it for "add 5
//     tasks" forces the user through 5 explicit "yes"s.
//   - Up-front validation. Every task and the bin (if new) are
//     validated together, so the user sees ALL conflicts in the plan
//     instead of discovering them one task at a time.
//   - Atomic-ish bin+tasks creation. If the user wants a brand-new
//     sub-bin populated with several tasks, this is the only path that
//     lets them confirm both in one breath.

const STATUS_VALUES = [
  'contingent',
  'not_started',
  'in_progress',
  'paused',
  'complete',
] as const;
const PRIORITY_VALUES = ['urgent', 'high', 'medium', 'low'] as const;

const taskItemSchema = z.object({
  title: z
    .string()
    .min(1)
    .describe('Plain-text task title. Required. Keep concise.'),
  description: z
    .string()
    .optional()
    .describe(
      "Plain-text description. Multi-paragraph supported (blank lines between paragraphs). Omit when there's nothing to add.",
    ),
  status: z
    .enum(STATUS_VALUES)
    .optional()
    .describe(
      "Task status. Defaults to 'not_started'. Use 'contingent' for blocked tasks.",
    ),
  priority: z
    .enum(PRIORITY_VALUES)
    .optional()
    .describe(
      "Task priority. Defaults to 'medium'. Reserve 'urgent' for time-critical issues.",
    ),
  scheduled_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe(
      "Scheduled date, YYYY-MM-DD. Resolve relative dates with the user's local clock first. Omit to leave unscheduled.",
    ),
  scheduled_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional()
    .describe('Scheduled time, HH:MM (24-hour). Only meaningful with scheduled_date.'),
  property_id: z
    .string()
    .uuid()
    .optional()
    .describe('Property UUID. Use find_properties to resolve names. Omit for free-floating tasks.'),
  department_id: z
    .string()
    .uuid()
    .optional()
    .describe('Department UUID. Use find_departments to resolve names.'),
  template_id: z
    .string()
    .uuid()
    .optional()
    .describe('Template UUID. Use find_templates to resolve names. Manual tagging only.'),
  assigned_user_ids: z
    .array(z.string().uuid())
    .optional()
    .describe('User UUIDs to assign. Use find_users to resolve names.'),
});

const sharedBinSchema = z
  .object({
    bin_id: z.string().uuid().optional(),
    is_binned: z.boolean().optional(),
    new_sub_bin: z
      .object({
        name: z.string().min(1).max(80),
        description: z.string().max(500).optional(),
      })
      .optional(),
  })
  .optional();

const inputSchema = z.object({
  tasks: z
    .array(taskItemSchema)
    .min(1)
    .max(20)
    .describe(
      'Array of tasks to create. At least 1, at most 20 per batch. Every task in the batch shares the same bin destination (set via shared_bin); per-task bin overrides are intentionally not supported — split into multiple batches if you need different destinations.',
    ),
  shared_bin: sharedBinSchema.describe(
    "Shared bin destination for every task in the batch. Exactly one mode at a time: { bin_id } puts every task in an existing sub-bin (resolve with find_bins); { new_sub_bin: { name, description? } } creates a new sub-bin first and routes every task into it; { is_binned: true } drops every task into the default Task Bin; omitting shared_bin (or passing { is_binned: false }) creates free-floating, unbinned tasks. Combinations are rejected.",
  ),
  created_by: z
    .string()
    .uuid()
    .optional()
    .describe(
      "User UUID stamped onto the new sub-bin's created_by column when shared_bin.new_sub_bin is set. Pass the talking-to user's user_id from the actor block. Ignored when not creating a new sub-bin.",
    ),
});

type Input = z.infer<typeof inputSchema>;

export interface PreviewTasksBatchResultData {
  plan: CreateTasksBatchPlan;
  confirmation_token: string;
  expires_at: string;
}

async function handler(
  input: Input,
): Promise<ToolResult<PreviewTasksBatchResultData>> {
  const result = await previewCreateTasksBatch(input);

  if (!result.ok) {
    if (result.error.code === 'invalid_input') {
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          message: result.error.message,
          hint: result.error.field
            ? `Check the "${result.error.field}" field${typeof result.error.task_index === 'number' ? ` on task index ${result.error.task_index}` : ''} and call again.`
            : undefined,
        },
      };
    }
    if (result.error.code === 'duplicate_name') {
      return {
        ok: false,
        error: {
          code: 'duplicate_name',
          message: result.error.message,
          hint: 'Either pick a different name for the new sub-bin OR call find_bins to get the existing bin\'s id and pass it as shared_bin.bin_id instead.',
        },
      };
    }
    if (result.error.code === 'not_found') {
      return {
        ok: false,
        error: {
          code: 'not_found',
          message: result.error.message,
          hint:
            typeof result.error.task_index === 'number'
              ? `Re-resolve the missing id on task index ${result.error.task_index} and call preview_tasks_batch again.`
              : 'Re-resolve the missing id and call preview_tasks_batch again.',
        },
      };
    }
    return {
      ok: false,
      error: { code: 'db_error', message: result.error.message },
    };
  }

  const minted = mintCreateTasksBatchToken(result.canonicalInput);
  return {
    ok: true,
    data: {
      plan: result.plan,
      confirmation_token: minted.token,
      expires_at: minted.expires_at,
    },
    meta: {
      returned: result.plan.tasks.length,
      limit: 20,
      truncated: false,
    },
  };
}

export const previewTasksBatch: ToolDefinition<
  Input,
  PreviewTasksBatchResultData
> = {
  name: 'preview_tasks_batch',
  description:
    "PREVIEW the creation of multiple tasks in one shot. ALWAYS call this first when the user asks to create more than one task at a time, OR when the user asks to create a sub-bin and add tasks to it. Validates every task input, validates the shared bin destination (existing sub-bin via bin_id, brand-new sub-bin via new_sub_bin, default Task Bin via is_binned=true, or free-floating when omitted), resolves every FK, and returns a single plan + single confirmation_token. After calling: present the plan to the user (mention the destination AND the per-task summary), ask for explicit confirmation, then call create_tasks_batch with the token. Tokens are single-use and expire in 5 minutes. preview_tasks_batch never writes; safe to call repeatedly. For SINGLE-task creation, prefer preview_task — it's slightly cheaper and gives a richer per-task plan.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      tasks: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        description:
          'Array of tasks to create (1-20 per batch). Every task shares the same bin destination via shared_bin.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 1, description: 'Plain-text title. Required.' },
            description: { type: 'string', description: 'Plain-text description; multi-paragraph supported.' },
            status: {
              type: 'string',
              enum: ['contingent', 'not_started', 'in_progress', 'paused', 'complete'],
              description: "Defaults to 'not_started'.",
            },
            priority: {
              type: 'string',
              enum: ['urgent', 'high', 'medium', 'low'],
              description: "Defaults to 'medium'.",
            },
            scheduled_date: { type: 'string', description: 'YYYY-MM-DD.' },
            scheduled_time: { type: 'string', description: 'HH:MM (24-hour).' },
            property_id: { type: 'string', description: 'Use find_properties.' },
            department_id: { type: 'string', description: 'Use find_departments.' },
            template_id: { type: 'string', description: 'Use find_templates.' },
            assigned_user_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Use find_users.',
            },
          },
          required: ['title'],
          additionalProperties: false,
        },
      },
      shared_bin: {
        type: 'object',
        description:
          "Shared bin destination. Exactly one mode at a time. Existing sub-bin: { bin_id }. New sub-bin: { new_sub_bin: { name, description? } }. Task Bin (orphan binned): { is_binned: true }. Free-floating: omit shared_bin entirely.",
        properties: {
          bin_id: { type: 'string', description: 'Existing sub-bin UUID; resolve via find_bins.' },
          is_binned: {
            type: 'boolean',
            description: "Pass true with no bin_id / no new_sub_bin to land all tasks in the Task Bin.",
          },
          new_sub_bin: {
            type: 'object',
            properties: {
              name: { type: 'string', minLength: 1, maxLength: 80, description: 'New sub-bin name.' },
              description: { type: 'string', maxLength: 500, description: 'Optional description.' },
            },
            required: ['name'],
            additionalProperties: false,
            description: 'Create this sub-bin first, then route every task into it.',
          },
        },
        additionalProperties: false,
      },
      created_by: {
        type: 'string',
        description: "Actor user_id; only used when creating a new sub-bin via new_sub_bin.",
      },
    },
    required: ['tasks'],
    additionalProperties: false,
  },
  handler,
};
