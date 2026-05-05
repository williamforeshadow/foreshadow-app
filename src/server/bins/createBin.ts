import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';

// Service: create a new sub-bin in the bins workspace.
//
// Mirrors the createTask service's split between this canonical service
// and the agent's preview/commit token dance (see previewBin / createBin
// tools). Both the agent and the HTTP route at /api/project-bins POST
// should funnel through here so UI and agent emit structurally identical
// rows and surface the same errors.
//
// What this service deliberately does NOT do:
//   - create the protected "Task Bin" (is_system=true). That row is
//     fixture data; sub-bin creation always inserts is_system=false.
//   - bind tasks to the new bin. Callers that want to bin tasks at the
//     same time as creating the bin (e.g. the agent's "create a sub-bin
//     for X and add these 3 tasks") sequence createBin first, then
//     pass the returned id to the task-creation path.
//
// Why a Zod-bound service rather than just calling the route:
//   - The agent runs in-process and shouldn't be self-fetching its own
//     HTTP routes. Direct service calls remove a network hop and make
//     errors structured (Zod / typed result) instead of stringly.
//   - Both the agent's preview_bin and the API route can share the same
//     DUPLICATE_NAME logic without divergence.

export const createBinInputSchema = z.object({
  name: z
    .string()
    .min(1, 'name is required')
    .max(80, 'name must be 80 characters or fewer')
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, 'name cannot be empty after trimming'),
  description: z
    .string()
    .max(500, 'description must be 500 characters or fewer')
    .nullable()
    .optional()
    .transform((s) => {
      if (s == null) return null;
      const trimmed = s.trim();
      return trimmed.length > 0 ? trimmed : null;
    }),
  // Optional. Stamped onto the row's created_by column when the caller
  // knows who's creating it (Slack route resolves the actor; the in-app
  // POST passes the logged-in user). FK-validated when present.
  created_by: z.string().uuid().nullable().optional(),
});

export type CreateBinInput = z.infer<typeof createBinInputSchema>;

export type CreateBinErrorCode =
  | 'invalid_input'
  | 'duplicate_name'
  | 'not_found'
  | 'db_error';

export interface CreateBinError {
  code: CreateBinErrorCode;
  message: string;
  field?: string;
}

export interface CreatedBin {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  sort_order: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type CreateBinResult =
  | { ok: true; bin: CreatedBin }
  | { ok: false; error: CreateBinError };

/**
 * Insert a new sub-bin. Returns the inserted row in the canonical
 * CreatedBin shape. Validation, FK pre-checks, sort_order assignment,
 * and duplicate-name detection all happen here so the route and the
 * agent share identical behavior.
 */
export async function createBin(rawInput: unknown): Promise<CreateBinResult> {
  const parsed = createBinInputSchema.safeParse(rawInput);
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

  if (input.created_by) {
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id')
      .eq('id', input.created_by)
      .maybeSingle();
    if (userErr) {
      return {
        ok: false,
        error: { code: 'db_error', message: userErr.message, field: 'created_by' },
      };
    }
    if (!user) {
      return {
        ok: false,
        error: {
          code: 'not_found',
          message: `No row in users with id ${input.created_by} (passed as created_by).`,
          field: 'created_by',
        },
      };
    }
  }

  // Duplicate-name check (case-insensitive). The DB doesn't have a unique
  // constraint on bin name today (system bins coexist with user bins,
  // soft-deleted rows in the future, etc.), so we enforce uniqueness in
  // the service. The agent UX especially needs this — without it the
  // model will happily mint "Marketing ideas (2)" without realising the
  // user already has one.
  const { data: existing, error: dupErr } = await supabase
    .from('project_bins')
    .select('id, name')
    .ilike('name', input.name)
    .limit(1);
  if (dupErr) {
    return {
      ok: false,
      error: { code: 'db_error', message: dupErr.message, field: 'name' },
    };
  }
  if (existing && existing.length > 0) {
    return {
      ok: false,
      error: {
        code: 'duplicate_name',
        message: `A bin named "${(existing[0] as { name: string }).name}" already exists. Pick a different name or use the existing bin.`,
        field: 'name',
      },
    };
  }

  // sort_order: append at the end. Mirrors the route's behavior (and the
  // UI's drag-to-reorder model — new bins land at the bottom). Reads the
  // current max in a single round-trip; concurrent creates can race here
  // but the consequence is just two bins sharing a sort_order, which the
  // UI tolerates (secondary sort by created_at handles ties).
  const { data: maxRow, error: maxErr } = await supabase
    .from('project_bins')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (maxErr) {
    return { ok: false, error: { code: 'db_error', message: maxErr.message } };
  }
  const nextSort =
    ((maxRow as { sort_order: number | null } | null)?.sort_order ?? -1) + 1;

  const { data: inserted, error: insertErr } = await supabase
    .from('project_bins')
    .insert({
      name: input.name,
      description: input.description ?? null,
      created_by: input.created_by ?? null,
      sort_order: nextSort,
    })
    .select(
      'id, name, description, is_system, sort_order, created_by, created_at, updated_at',
    )
    .single();

  if (insertErr || !inserted) {
    return {
      ok: false,
      error: {
        code: 'db_error',
        message: insertErr?.message ?? 'insert returned no row',
      },
    };
  }

  return { ok: true, bin: inserted as CreatedBin };
}

// ---------- agent preview path --------------------------------------------

export interface CreateBinPlan {
  /** What the bin will be called once written. */
  name: string;
  /** Optional description; null when none was provided. */
  description: string | null;
  /**
   * Who the row will be attributed to. Resolved server-side from the
   * actor passed at preview time so the agent can present a confident
   * "I'll create this on your behalf" without round-tripping find_users.
   */
  created_by_name: string | null;
  /**
   * Stable, single-line summary the model can read out to the user
   * verbatim. Keeps preview output deterministic across runs.
   */
  summary: string;
}

export type PreviewBinResult =
  | { ok: true; plan: CreateBinPlan; canonicalInput: CreateBinInput }
  | { ok: false; error: CreateBinError };

/**
 * Validate a bin-creation request without writing. Returns a human-
 * readable plan plus the canonical (Zod-parsed) input the caller will
 * later pass back through createBin. The agent's preview_bin tool wraps
 * this and binds the canonical input to a single-use confirmation token.
 *
 * Catches duplicate names here (not just at commit time) so the user
 * sees the conflict in the preview and can pick a different name before
 * confirming.
 */
export async function previewCreateBin(
  rawInput: unknown,
): Promise<PreviewBinResult> {
  const parsed = createBinInputSchema.safeParse(rawInput);
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

  let createdByName: string | null = null;
  if (input.created_by) {
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, name')
      .eq('id', input.created_by)
      .maybeSingle();
    if (userErr) {
      return {
        ok: false,
        error: { code: 'db_error', message: userErr.message, field: 'created_by' },
      };
    }
    if (!user) {
      return {
        ok: false,
        error: {
          code: 'not_found',
          message: `No row in users with id ${input.created_by} (passed as created_by).`,
          field: 'created_by',
        },
      };
    }
    createdByName = (user as { id: string; name: string }).name ?? null;
  }

  const { data: existing, error: dupErr } = await supabase
    .from('project_bins')
    .select('id, name')
    .ilike('name', input.name)
    .limit(1);
  if (dupErr) {
    return {
      ok: false,
      error: { code: 'db_error', message: dupErr.message, field: 'name' },
    };
  }
  if (existing && existing.length > 0) {
    return {
      ok: false,
      error: {
        code: 'duplicate_name',
        message: `A bin named "${(existing[0] as { name: string }).name}" already exists. Pick a different name or use the existing bin.`,
        field: 'name',
      },
    };
  }

  const summary = input.description
    ? `Create sub-bin "${input.name}" — ${input.description}`
    : `Create sub-bin "${input.name}"`;

  return {
    ok: true,
    plan: {
      name: input.name,
      description: input.description ?? null,
      created_by_name: createdByName,
      summary,
    },
    canonicalInput: input,
  };
}
