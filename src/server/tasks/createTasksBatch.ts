import { z } from 'zod';
import {
  createTask,
  previewCreateTask,
  type CreateTaskInput,
  type CreateTaskPlan,
  type CreatedTask,
} from './createTask';
import {
  createBin,
  previewCreateBin,
  type CreateBinInput,
  type CreatedBin,
} from '@/src/server/bins/createBin';

// Service: create N tasks in one shot, optionally targeting a brand-new
// sub-bin created in the same operation.
//
// Why a dedicated batch path rather than asking the agent to loop the
// single-task tools:
//   - One user confirmation instead of N (the agent's preview/commit
//     dance forces an explicit "shall I create this?" after every preview
//     call; doing five tasks would be five round-trips and five "yes"s).
//   - One token instead of N. The in-memory token store stays small.
//   - Honest atomic semantics: this service does ALL the FK / duplicate-
//     name validation up-front (dry run via previewCreateTask /
//     previewCreateBin), so the commit step is mostly mechanical and the
//     "I created 4 of 5, here's the failure" message reflects real state
//     rather than half-validated guesses.
//   - The "shared bin destination" case is the dominant one ("add these
//     5 tasks to the Marketing ideas bin"). Modelling it as a single
//     `shared_bin` that fans out across rows lets the model — and the
//     plan presented to the user — speak in those terms.
//
// What this service deliberately does NOT do:
//   - per-task bin overrides. Every task in a batch shares the same
//     destination. If a user really wants a heterogeneous mix they
//     should split into multiple batches (or use the single-task path).
//     Keeping it homogeneous makes the plan readable and avoids the
//     "agent invented different bins for half the tasks" failure mode.
//   - true DB-level transaction. The Supabase JS client doesn't expose
//     transactions and rolling back tasks-already-created from JS is
//     fragile. We instead do tight up-front validation so commits rarely
//     fail mid-way, and report partial failures honestly when they do.

const STATUS_VALUES = [
  'contingent',
  'not_started',
  'in_progress',
  'paused',
  'complete',
] as const;
const PRIORITY_VALUES = ['urgent', 'high', 'medium', 'low'] as const;

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const timeString = z
  .string()
  .regex(/^\d{2}:\d{2}$/, 'expected HH:MM (24-hour)');

// Per-task input. Deliberately a SUBSET of CreateTaskInput — bin_id /
// is_binned are ABSENT here because the batch shares one destination via
// `shared_bin`. Including them per-task would invite the model to
// scatter tasks across bins it never asked the user about.
const taskItemSchema = z.object({
  title: z.string().min(1, 'title is required'),
  description: z.string().optional(),
  status: z.enum(STATUS_VALUES).optional(),
  priority: z.enum(PRIORITY_VALUES).optional(),
  scheduled_date: dateString.optional(),
  scheduled_time: timeString.optional(),
  property_id: z.string().uuid().optional(),
  department_id: z.string().uuid().optional(),
  template_id: z.string().uuid().optional(),
  assigned_user_ids: z.array(z.string().uuid()).optional(),
});

export type CreateTasksBatchItem = z.infer<typeof taskItemSchema>;

// Shared bin destination. Exactly one of three modes:
//   1. existing sub-bin — pass `bin_id` only.
//   2. new sub-bin — pass `new_sub_bin: { name, description? }`. The
//      service creates the bin first, then routes every task to it.
//   3. Task Bin (orphan binned) — pass `is_binned: true` with no bin_id
//      and no new_sub_bin.
//   4. Free-floating (no bin) — omit shared_bin entirely OR pass
//      `is_binned: false`.
//
// We check exactly-one-mode in a refine() below rather than via discriminated
// union because the model finds object-with-optional-fields easier to
// emit than a tagged union.
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
  .optional()
  .refine(
    (s) => {
      if (!s) return true;
      // bin_id and new_sub_bin are mutually exclusive.
      if (s.bin_id && s.new_sub_bin) return false;
      // is_binned=false with bin_id or new_sub_bin makes no sense.
      if (s.is_binned === false && (s.bin_id || s.new_sub_bin)) return false;
      return true;
    },
    {
      message:
        'shared_bin must be one of: { bin_id }, { new_sub_bin }, { is_binned: true } (Task Bin), or omitted (free-floating). Combinations are rejected.',
    },
  );

export const createTasksBatchInputSchema = z.object({
  tasks: z
    .array(taskItemSchema)
    .min(1, 'tasks must contain at least one task')
    .max(20, 'tasks may contain at most 20 entries per batch'),
  shared_bin: sharedBinSchema,
  /**
   * Stamped onto the new sub-bin's created_by column when shared_bin
   * has new_sub_bin set. Ignored otherwise. FK-validated.
   */
  created_by: z.string().uuid().optional(),
});

export type CreateTasksBatchInput = z.infer<typeof createTasksBatchInputSchema>;

export type CreateTasksBatchErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'duplicate_name'
  | 'db_error';

export interface CreateTasksBatchError {
  code: CreateTasksBatchErrorCode;
  message: string;
  /** Index into the input `tasks` array, when the failure is task-specific. */
  task_index?: number;
  field?: string;
}

export interface BatchTaskFailure {
  task_index: number;
  title: string;
  error: CreateTasksBatchError;
}

export interface CreateTasksBatchResult {
  /** Tasks that were successfully written. May be shorter than `input.tasks`. */
  tasks: CreatedTask[];
  /** Per-task failures, in input order. Empty when everything succeeded. */
  failures: BatchTaskFailure[];
  /**
   * The sub-bin created at the start of the batch when `new_sub_bin` was
   * requested. Null when the batch targeted an existing bin / Task Bin /
   * no bin.
   */
  created_bin: CreatedBin | null;
}

export type CreateTasksBatchOutcome =
  | { ok: true; result: CreateTasksBatchResult }
  | { ok: false; error: CreateTasksBatchError };

// ---------- preview path --------------------------------------------------

export interface CreateTasksBatchPlan {
  /**
   * Single shared destination summary. Exactly one of these will be
   * non-null on a valid plan; null on all four means the batch is
   * free-floating tasks.
   */
  shared_destination: {
    /** Existing sub-bin we'll route tasks into. */
    existing_bin: { id: string; name: string; is_system: boolean } | null;
    /** New sub-bin we'll create first, then route tasks into. */
    new_sub_bin: { name: string; description: string | null } | null;
    /** True when tasks land in the Task Bin (is_binned=true, no bin). */
    task_bin: boolean;
    /** True when tasks are unbinned. */
    free_floating: boolean;
  };
  /** Per-task plan in the same order as the input. */
  tasks: CreateTaskPlan[];
  /** Stable single-line summary. */
  summary: string;
}

export type PreviewCreateTasksBatchResult =
  | {
      ok: true;
      plan: CreateTasksBatchPlan;
      canonicalInput: CreateTasksBatchInput;
    }
  | { ok: false; error: CreateTasksBatchError };

// ---------- helpers -------------------------------------------------------

/**
 * Build a flattened CreateTaskInput from a batch item + the shared bin.
 * The bin selection is applied uniformly across all items.
 */
function applySharedBin(
  item: CreateTasksBatchItem,
  sharedBin: CreateTasksBatchInput['shared_bin'],
  resolvedNewBinId: string | null,
): CreateTaskInput {
  let bin_id: string | null | undefined;
  let is_binned: boolean | undefined;

  if (sharedBin?.new_sub_bin) {
    bin_id = resolvedNewBinId ?? undefined;
    is_binned = true;
  } else if (sharedBin?.bin_id) {
    bin_id = sharedBin.bin_id;
    is_binned = true;
  } else if (sharedBin?.is_binned === true) {
    bin_id = null;
    is_binned = true;
  } else {
    bin_id = null;
    is_binned = false;
  }

  return {
    ...item,
    bin_id,
    is_binned,
  };
}

function summarizePlan(plan: CreateTasksBatchPlan): string {
  const n = plan.tasks.length;
  const dest = plan.shared_destination;
  if (dest.new_sub_bin) {
    return `Create new sub-bin "${dest.new_sub_bin.name}" and add ${n} task${n === 1 ? '' : 's'} to it`;
  }
  if (dest.existing_bin) {
    return `Add ${n} task${n === 1 ? '' : 's'} to the "${dest.existing_bin.name}" sub-bin`;
  }
  if (dest.task_bin) {
    return `Add ${n} task${n === 1 ? '' : 's'} to the Task Bin`;
  }
  return `Create ${n} free-floating task${n === 1 ? '' : 's'}`;
}

// ---------- preview entrypoint --------------------------------------------

/**
 * Validate a batch request without writing anything. Resolves every FK
 * for every task and surfaces the first failure with its index. Catches
 * duplicate-name conflicts on `new_sub_bin` here so the user sees them
 * in the preview instead of after committing 5 tasks against a doomed
 * batch.
 */
export async function previewCreateTasksBatch(
  rawInput: unknown,
): Promise<PreviewCreateTasksBatchResult> {
  const parsed = createTasksBatchInputSchema.safeParse(rawInput);
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

  // Validate the shared bin first.
  //   - bin_id: cheap FK existence check via previewCreateTask down below
  //     (we'll get a not_found on the first task if the bin is bogus).
  //     But surfacing it once at the top is friendlier than N times.
  //   - new_sub_bin: previewCreateBin already does name + duplicate
  //     validation. Run it now with a NULL placeholder bin_id for tasks
  //     so we know upfront whether the bin is creatable.
  let newSubBinPlanInput: CreateBinInput | null = null;
  if (input.shared_bin?.new_sub_bin) {
    const binPreview = await previewCreateBin({
      name: input.shared_bin.new_sub_bin.name,
      description: input.shared_bin.new_sub_bin.description ?? null,
      created_by: input.created_by ?? null,
    });
    if (!binPreview.ok) {
      const e = binPreview.error;
      // Pass through the bin's error code if it's one our batch type
      // accepts; widen everything else to invalid_input.
      const code: CreateTasksBatchErrorCode =
        e.code === 'duplicate_name'
          ? 'duplicate_name'
          : e.code === 'not_found'
            ? 'not_found'
            : e.code === 'db_error'
              ? 'db_error'
              : 'invalid_input';
      return {
        ok: false,
        error: {
          code,
          message: e.message,
          field: e.field ? `shared_bin.new_sub_bin.${e.field}` : 'shared_bin.new_sub_bin',
        },
      };
    }
    newSubBinPlanInput = binPreview.canonicalInput;
  }

  // Per-task validation. We build the per-task input by applying the
  // shared bin (with a placeholder bin_id when new_sub_bin is set, since
  // the real id won't exist until commit). previewCreateTask handles
  // every other FK; passing a missing bin_id is fine because the
  // placeholder isn't a UUID and we'll branch on new_sub_bin separately.
  const taskPlans: CreateTaskPlan[] = [];
  for (let i = 0; i < input.tasks.length; i++) {
    // For new_sub_bin we deliberately strip bin_id from the per-task
    // preview (it doesn't exist yet) and rely on the bin's own preview
    // above. The only loss is per-task bin label resolution, which we
    // re-derive below from the new_sub_bin spec.
    const sharedBinForPreview =
      input.shared_bin?.new_sub_bin
        ? // Preview as if the task were going to the Task Bin so
          // is_binned=true is on the input but no bin_id is checked.
          { is_binned: true }
        : input.shared_bin;

    const taskInput = applySharedBin(input.tasks[i], sharedBinForPreview, null);
    const result = await previewCreateTask(taskInput);
    if (!result.ok) {
      return {
        ok: false,
        error: {
          code:
            result.error.code === 'invalid_input'
              ? 'invalid_input'
              : result.error.code === 'not_found'
                ? 'not_found'
                : 'db_error',
          message: `Task ${i + 1} of ${input.tasks.length} ("${input.tasks[i].title}"): ${result.error.message}`,
          task_index: i,
          field: result.error.field,
        },
      };
    }
    taskPlans.push(result.plan);
  }

  // Build plan.shared_destination from the ORIGINAL input so the agent
  // sees the user-facing intent (existing bin / new bin / task bin /
  // free-floating) rather than the per-task preview's interpretation.
  const dest = ((): CreateTasksBatchPlan['shared_destination'] => {
    if (input.shared_bin?.new_sub_bin) {
      return {
        existing_bin: null,
        new_sub_bin: {
          name: input.shared_bin.new_sub_bin.name,
          description: input.shared_bin.new_sub_bin.description ?? null,
        },
        task_bin: false,
        free_floating: false,
      };
    }
    if (input.shared_bin?.bin_id) {
      // Pull the resolved label off the first task's plan (every task
      // shares the same bin, so plan[0].bin is canonical).
      const bin = taskPlans[0]?.bin;
      return {
        existing_bin: bin
          ? { id: bin.id, name: bin.name, is_system: bin.is_system }
          : null,
        new_sub_bin: null,
        task_bin: false,
        free_floating: false,
      };
    }
    if (input.shared_bin?.is_binned === true) {
      return {
        existing_bin: null,
        new_sub_bin: null,
        task_bin: true,
        free_floating: false,
      };
    }
    return {
      existing_bin: null,
      new_sub_bin: null,
      task_bin: false,
      free_floating: true,
    };
  })();

  const plan: CreateTasksBatchPlan = {
    shared_destination: dest,
    tasks: taskPlans,
    summary: '', // filled in below; needs the rest of plan first
  };
  plan.summary = summarizePlan(plan);

  // The canonical input we mint a token against. Critical: store the
  // user's *original* shared_bin spec (not the placeholder we used for
  // per-task preview), so commit can re-derive the right routing —
  // including running createBin for new_sub_bin.
  return {
    ok: true,
    plan,
    canonicalInput: {
      tasks: input.tasks,
      shared_bin: input.shared_bin,
      created_by: input.created_by,
    },
    // Reuse newSubBinPlanInput? Not needed — commit re-runs createBin
    // anyway to get a fresh duplicate-name check at write-time. The
    // preview step's value is catching obvious cases early.
  };
  // newSubBinPlanInput is intentionally unused beyond preview; commit
  // re-validates by calling createBin directly.
  void newSubBinPlanInput;
}

// ---------- commit entrypoint ---------------------------------------------

/**
 * Execute the batch. If shared_bin.new_sub_bin is set, create the bin
 * first; if that fails, return early without creating any tasks. Then
 * iterate the task list, calling createTask for each. Failures are
 * collected and returned alongside successes — the caller decides how
 * to message a partial outcome. Returns ok:false ONLY when zero tasks
 * landed (and ok:true with a non-empty `failures` list otherwise).
 */
export async function createTasksBatch(
  rawInput: unknown,
): Promise<CreateTasksBatchOutcome> {
  const parsed = createTasksBatchInputSchema.safeParse(rawInput);
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

  // Step 1: bin creation, if requested. Must come first because every
  // task needs the resulting bin_id.
  let createdBin: CreatedBin | null = null;
  if (input.shared_bin?.new_sub_bin) {
    const binResult = await createBin({
      name: input.shared_bin.new_sub_bin.name,
      description: input.shared_bin.new_sub_bin.description ?? null,
      created_by: input.created_by ?? null,
    });
    if (!binResult.ok) {
      return {
        ok: false,
        error: {
          code:
            binResult.error.code === 'duplicate_name'
              ? 'duplicate_name'
              : binResult.error.code === 'not_found'
                ? 'not_found'
                : binResult.error.code === 'invalid_input'
                  ? 'invalid_input'
                  : 'db_error',
          message: `Sub-bin creation failed before any tasks were created: ${binResult.error.message}`,
          field: binResult.error.field
            ? `shared_bin.new_sub_bin.${binResult.error.field}`
            : 'shared_bin.new_sub_bin',
        },
      };
    }
    createdBin = binResult.bin;
  }

  // Step 2: tasks. Sequential (rather than Promise.all) so partial
  // failures have a clear order in the result and the user-facing error
  // message can pinpoint which task choked.
  const tasks: CreatedTask[] = [];
  const failures: BatchTaskFailure[] = [];

  for (let i = 0; i < input.tasks.length; i++) {
    const taskInput = applySharedBin(
      input.tasks[i],
      input.shared_bin,
      createdBin?.id ?? null,
    );
    const result = await createTask(taskInput);
    if (result.ok) {
      tasks.push(result.task);
    } else {
      failures.push({
        task_index: i,
        title: input.tasks[i].title,
        error: {
          code:
            result.error.code === 'invalid_input'
              ? 'invalid_input'
              : result.error.code === 'not_found'
                ? 'not_found'
                : 'db_error',
          message: result.error.message,
          task_index: i,
          field: result.error.field,
        },
      });
    }
  }

  // If literally nothing landed AND there's no bin to brag about, treat
  // the whole batch as a failure so the action-claim backstop doesn't
  // get tricked by a "I created tasks" claim when the count is zero.
  if (tasks.length === 0 && !createdBin) {
    return {
      ok: false,
      error: failures[0]?.error ?? {
        code: 'db_error',
        message: 'Batch failed: no tasks were created.',
      },
    };
  }

  return {
    ok: true,
    result: { tasks, failures, created_bin: createdBin },
  };
}
