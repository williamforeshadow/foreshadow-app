import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import type { ToolDefinition, ToolResult } from './types';

// find_templates — resolve task templates (e.g. "Turnover Cleaning - Pet")
// into template_id values.
//
// Templates carry name + department association + a JSONB `fields` schema
// for the form rendered when the task is opened. The agent doesn't need
// the field schema to create or filter; only id, name, and department.
// Heavy fields are intentionally omitted to keep the projection slim.
//
// Note: tagging a manually-created task with a template_id does NOT apply
// that template's automation_config (auto-scheduling, auto-assignment).
// Those only apply to reservation-spawned tasks coming from /api/tasks.

const inputSchema = z.object({
  query: z
    .string()
    .min(2, 'query must be at least 2 characters')
    .optional()
    .describe(
      "Substring search against the template's name (case-insensitive). Use this when the user says 'turnover cleaning' or 'pet template' to enumerate matches.",
    ),
  department_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      'Restrict to templates owned by a specific department. Resolve a department name with find_departments first.',
    ),
  ids: z
    .array(z.string().uuid())
    .optional()
    .describe(
      'Batch lookup by template UUID. Other filters are ignored when set.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Max rows to return. Default 25, hard cap 100.'),
});

type Input = z.infer<typeof inputSchema>;

export interface TemplateRow {
  id: string;
  name: string;
  department_id: string | null;
  department_name: string | null;
  description: string | null;
}

// Joined SELECT: pull department label inline so the agent can present
// "Turnover Cleaning - Pet (Cleaning)" without a follow-up call.
const SELECT = 'id, name, description, department_id, departments(id, name)';
const DEFAULT_LIMIT = 25;

function sanitizeSearchTerm(raw: string): string {
  return raw.replace(/[%_,()\\]/g, ' ').trim();
}

async function handler(input: Input): Promise<ToolResult<TemplateRow[]>> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const supabase = getSupabaseServer();

  // Optional FK pre-validation for department_id so the agent gets a
  // structured not_found instead of a silent empty result when it passed
  // a stale or invented id.
  if (input.department_id) {
    const { data: dept, error: deptErr } = await supabase
      .from('departments')
      .select('id')
      .eq('id', input.department_id)
      .maybeSingle();
    if (deptErr) {
      return {
        ok: false,
        error: { code: 'db_error', message: deptErr.message },
      };
    }
    if (!dept) {
      return {
        ok: false,
        error: {
          code: 'not_found',
          message: `No department with id ${input.department_id}.`,
          hint: 'Call find_departments to resolve a department name into a valid id.',
        },
      };
    }
  }

  let query = supabase
    .from('templates')
    .select(SELECT)
    .order('name', { ascending: true })
    .limit(limit + 1);

  if (input.ids && input.ids.length > 0) {
    query = query.in('id', input.ids);
  } else {
    if (input.department_id) {
      query = query.eq('department_id', input.department_id);
    }
    if (input.query) {
      const term = sanitizeSearchTerm(input.query);
      if (term.length > 0) {
        query = query.ilike('name', `%${term}%`);
      }
    }
  }

  const { data, error } = await query;
  if (error) {
    return { ok: false, error: { code: 'db_error', message: error.message } };
  }

  const raw = (data ?? []) as Array<{
    id: string;
    name: string;
    description: string | null;
    department_id: string | null;
    departments: { id: string; name: string } | null;
  }>;

  const truncated = raw.length > limit;
  const trimmed = truncated ? raw.slice(0, limit) : raw;

  const rows: TemplateRow[] = trimmed.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    department_id: r.department_id ?? null,
    department_name: r.departments?.name ?? null,
  }));

  return {
    ok: true,
    data: rows,
    meta: { returned: rows.length, limit, truncated },
  };
}

export const findTemplates: ToolDefinition<Input, TemplateRow[]> = {
  name: 'find_templates',
  description:
    "Find task templates by name or department. Use this to resolve template names ('turnover cleaning', 'pet template', 'deep clean') into template_id values that create_task accepts. Templates are typically named after the recurring task they describe (e.g. 'Turnover Cleaning - Pet'). Each template belongs to at most one department, returned as department_name for display. Tagging a task with a template_id is purely descriptive for manually-created tasks — automation behavior (auto-scheduling from a reservation, auto-assignment) only triggers for reservation-spawned tasks, not manual ones.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        minLength: 2,
        description:
          "Case-insensitive substring match against template name. Minimum 2 characters.",
      },
      department_id: {
        type: 'string',
        description:
          'Restrict to a specific department. Resolve department names with find_departments first.',
      },
      ids: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Batch lookup by template UUID. When provided, other filters are ignored.',
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
