/**
 * The SAME ordered list of Property Knowledge operations, applied to many
 * properties in one confirmation.
 *
 * This is a fan-out, nothing more: every property runs the identical operations
 * list through propertyKnowledgeOperations.ts, which owns all the real logic
 * (name resolution, the intra-plan room memo, ordered commit, photos). What
 * lives here is the per-property loop, the caps that keep one serverless
 * invocation from doing unbounded work, and the aggregation the model needs to
 * narrate a multi-property plan without listing every row.
 *
 * Targets are matched BY NAME per property — which is what makes one operations
 * list meaningful across properties whose rooms and items have different ids.
 */
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  sourceSchema,
  loadPropertyForKnowledgeWrite,
  type PropertyKnowledgeWriteError,
} from './propertyKnowledgeWrite';
import {
  BATCHABLE_OPS,
  MAX_OPERATIONS,
  planPropertyKnowledgeOperations,
  commitPropertyKnowledgeOperationsFor,
  propertyKnowledgeOperationSchema,
  type OperationCommitResult,
  type OperationDrift,
  type OperationMode,
  type OperationPlanStep,
  type PropertyKnowledgeOperation,
  type PropertyKnowledgeOperationsInput,
} from './propertyKnowledgeOperations';

const MAX_PROPERTIES = 25;
/** Total per-property operations one confirmation may plan and commit. */
const MAX_TOTAL_OPERATIONS = 100;
/**
 * Photo copies (files x properties). Each copy is a full storage download plus
 * an upload, run sequentially; without a ceiling a wide batch would blow the
 * function's time limit and leave a half-committed confirmation behind.
 */
const MAX_PHOTO_COPIES = 20;
/** Above this, per-property `changes` are dropped to keep the result readable. */
const FULL_DETAIL_LIMIT = 40;

export const propertyKnowledgeBatchInputSchema = z.object({
  property_ids: z.array(z.string().uuid()).min(1).max(MAX_PROPERTIES),
  operations: z.array(propertyKnowledgeOperationSchema).min(1).max(MAX_OPERATIONS),
  actor_user_id: z.string().nullable().optional(),
  source: sourceSchema,
});

export type PropertyKnowledgeBatchInput = z.infer<typeof propertyKnowledgeBatchInputSchema>;

export interface PropertyKnowledgeBatchPropertyPlan {
  property_id: string;
  property_name: string;
  operations: OperationPlanStep[];
  noop_count: number;
  rooms_to_create: number;
  blocked_count: number;
  summary: string;
}

export interface PropertyKnowledgeBatchFailure {
  property_id: string;
  property_name: string | null;
  error: PropertyKnowledgeWriteError;
}

export interface PropertyKnowledgeBatchPlan {
  /** The shared operation list, described once, so the model can say it once. */
  shared_operations: Array<{ index: number; op: string; label: string }>;
  properties: PropertyKnowledgeBatchPropertyPlan[];
  failures: PropertyKnowledgeBatchFailure[];
  totals: {
    properties: number;
    writes: number;
    noops: number;
    rooms_to_create: number;
    photos: number;
    blocked: number;
  };
  /**
   * Set when the operations carry photos: the same uploaded file is copied onto
   * every property, which is worth saying out loud since a photo is usually of
   * one physical place.
   */
  photos_fanout: { file_count: number; property_count: number; copies: number } | null;
  /** True when every property resolved to the same per-operation modes. */
  uniform: boolean;
  /** Set when per-property detail was trimmed to keep the result readable. */
  truncated: boolean;
  summary: string;
}

export interface PropertyKnowledgeBatchPropertyResult {
  property_id: string;
  property_name: string;
  ok: boolean;
  results: OperationCommitResult[];
  failures: OperationCommitResult[];
  drift: OperationDrift[];
  summary: string;
}

export type PreviewPropertyKnowledgeBatchResult =
  | { ok: true; plan: PropertyKnowledgeBatchPlan; canonicalInput: PropertyKnowledgeBatchInput }
  | { ok: false; error: PropertyKnowledgeWriteError };

export type CommitPropertyKnowledgeBatchResult =
  | {
      ok: true;
      results: PropertyKnowledgeBatchPropertyResult[];
      failures: PropertyKnowledgeBatchPropertyResult[];
      summary: string;
    }
  | { ok: false; error: PropertyKnowledgeWriteError };

/**
 * Reject the operation shapes that cannot mean the same thing on every property.
 *
 * A room id or document id names exactly one row on one property, so accepting
 * one here would either write into another property's room or fail the foreign
 * key. Refusing up front is clearer than either.
 */
function validateBatchable(
  operations: PropertyKnowledgeOperation[],
  propertyCount: number,
): PropertyKnowledgeWriteError | null {
  if (operations.length * propertyCount > MAX_TOTAL_OPERATIONS) {
    return {
      code: 'invalid_input',
      message: `That is ${operations.length * propertyCount} writes (${operations.length} operations x ${propertyCount} properties). The limit is ${MAX_TOTAL_OPERATIONS} — narrow the property list or split the operations.`,
      field: 'property_ids',
    };
  }
  let photoFiles = 0;
  for (const [index, op] of operations.entries()) {
    if (!BATCHABLE_OPS.includes(op.op)) {
      return {
        code: 'invalid_input',
        message: `Operation ${index} (${op.op}) addresses a single uploaded file by id, so it cannot be applied across properties. Use preview_property_knowledge_write for it.`,
        field: `operations.${index}.op`,
      };
    }
    if ('room' in op && 'room_id' in op.room) {
      return {
        code: 'invalid_input',
        message: `Operation ${index} names its room by id. Room ids are per-property — use room { title, scope } so each property resolves its own.`,
        field: `operations.${index}.room.room_id`,
      };
    }
    if ('photos' in op && op.photos) photoFiles += op.photos.inbound_file_ids.length;
  }
  if (photoFiles * propertyCount > MAX_PHOTO_COPIES) {
    return {
      code: 'invalid_input',
      message: `That would copy ${photoFiles * propertyCount} photos (${photoFiles} files x ${propertyCount} properties). The limit is ${MAX_PHOTO_COPIES} — narrow the property list.`,
      field: 'operations',
    };
  }
  return null;
}

/** How one shared operation is named in the plan the model presents. */
function operationLabel(op: PropertyKnowledgeOperation): string {
  // Policies are roomless and keyed by title, so they match neither of the
  // shapes below (no `room`, and their `fields` carries no label/type).
  if (op.op === 'upsert_policy') {
    return `policy "${String((op.fields as { title?: string }).title ?? 'policy')}"`;
  }
  if (op.op === 'delete_policy') return `policy "${op.title}"`;

  if ('room' in op && 'title' in op.room) {
    if (op.op === 'upsert_attribute') {
      return `${String((op.fields as { title?: string }).title ?? 'attribute')} (in ${op.room.scope} "${op.room.title}")`;
    }
    if (op.op === 'delete_attribute') {
      return `${op.title} (in ${op.room.scope} "${op.room.title}")`;
    }
    return `${op.room.scope} room "${op.room.title}"`;
  }

  if ('fields' in op) {
    const f = op.fields as { label?: string; type?: string };
    return String(f.label ?? f.type ?? 'connectivity');
  }
  return op.op;
}

function sharedOperations(operations: PropertyKnowledgeOperation[]) {
  return operations.map((op, index) => ({
    index,
    op: op.op,
    label: operationLabel(op),
  }));
}

function countPhotoFiles(operations: PropertyKnowledgeOperation[]): number {
  return operations.reduce(
    (n, op) => n + ('photos' in op && op.photos ? op.photos.inbound_file_ids.length : 0),
    0,
  );
}

export async function previewPropertyKnowledgeBatch(
  rawInput: unknown,
): Promise<PreviewPropertyKnowledgeBatchResult> {
  const parsed = propertyKnowledgeBatchInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message: first?.message ?? 'invalid input',
        field: first?.path.join('.') || undefined,
      },
    };
  }
  const input = parsed.data;
  const invalid = validateBatchable(input.operations, input.property_ids.length);
  if (invalid) return { ok: false, error: invalid };

  const supabase = getSupabaseServer();
  const properties: PropertyKnowledgeBatchPropertyPlan[] = [];
  const failures: PropertyKnowledgeBatchFailure[] = [];

  for (const propertyId of input.property_ids) {
    const prop = await loadPropertyForKnowledgeWrite(supabase, propertyId);
    if (!prop.ok) {
      failures.push({ property_id: propertyId, property_name: null, error: prop.error });
      continue;
    }
    const perProperty: PropertyKnowledgeOperationsInput = {
      property_id: propertyId,
      operations: input.operations,
      actor_user_id: input.actor_user_id ?? null,
      source: input.source,
    };
    const planned = await planPropertyKnowledgeOperations(supabase, prop.property, perProperty);
    if (!planned.ok) {
      failures.push({
        property_id: propertyId,
        property_name: prop.property.name,
        error: planned.error,
      });
      continue;
    }
    properties.push({
      property_id: propertyId,
      property_name: prop.property.name,
      operations: planned.plan.operations,
      noop_count: planned.plan.noop_count,
      rooms_to_create: planned.plan.rooms_to_create.length,
      blocked_count: planned.plan.blocked_count,
      summary: planned.plan.summary,
    });
  }

  const totals = properties.reduce(
    (acc, p) => {
      acc.writes += p.operations.filter(
        (o) => o.mode !== 'noop' && o.mode !== 'skipped' && !o.error,
      ).length;
      acc.noops += p.noop_count;
      acc.rooms_to_create += p.rooms_to_create;
      acc.blocked += p.blocked_count;
      acc.photos += p.operations.reduce(
        (n, o) => n + (o.photos?.files.filter((f) => f.ok).length ?? 0),
        0,
      );
      return acc;
    },
    { properties: properties.length, writes: 0, noops: 0, rooms_to_create: 0, photos: 0, blocked: 0 },
  );

  // Uniform means the model can describe the operations once instead of walking
  // every property — the common case, and the difference between a readable
  // preview and twelve near-identical lines.
  const modeSignature = (p: PropertyKnowledgeBatchPropertyPlan) =>
    p.operations.map((o) => o.mode).join(',');
  const uniform =
    properties.length > 0 && properties.every((p) => modeSignature(p) === modeSignature(properties[0]));

  const photoFiles = countPhotoFiles(input.operations);
  const truncated = properties.length * input.operations.length > FULL_DETAIL_LIMIT;
  if (truncated) {
    // Keep the first property whole as the worked example; the rest carry modes
    // only. `uniform` is what makes that safe to narrate.
    for (const p of properties.slice(1)) {
      p.operations = p.operations.map((o) => ({ ...o, changes: [], photos: null }));
    }
  }

  const summaryParts = [
    `${totals.writes} change${totals.writes === 1 ? '' : 's'} across ${totals.properties} propert${totals.properties === 1 ? 'y' : 'ies'}`,
  ];
  if (totals.rooms_to_create > 0) {
    summaryParts.push(`create ${totals.rooms_to_create} room${totals.rooms_to_create === 1 ? '' : 's'}`);
  }
  if (totals.photos > 0) summaryParts.push(`attach ${totals.photos} photo${totals.photos === 1 ? '' : 's'}`);
  if (totals.noops > 0) summaryParts.push(`${totals.noops} already correct`);
  if (totals.blocked > 0) summaryParts.push(`${totals.blocked} blocked`);
  if (failures.length > 0) summaryParts.push(`${failures.length} could not be planned`);

  return {
    ok: true,
    plan: {
      shared_operations: sharedOperations(input.operations),
      properties,
      failures,
      totals,
      photos_fanout:
        photoFiles > 0
          ? {
              file_count: photoFiles,
              property_count: properties.length,
              copies: photoFiles * properties.length,
            }
          : null,
      uniform,
      truncated,
      summary: summaryParts.join(' — '),
    },
    canonicalInput: input,
  };
}

export async function commitPropertyKnowledgeBatch(
  rawInput: unknown,
): Promise<CommitPropertyKnowledgeBatchResult> {
  const preview = await previewPropertyKnowledgeBatch(rawInput);
  if (!preview.ok) return { ok: false, error: preview.error };
  const input = preview.canonicalInput;
  const supabase = getSupabaseServer();

  const results: PropertyKnowledgeBatchPropertyResult[] = [];

  for (const propertyId of input.property_ids) {
    const prop = await loadPropertyForKnowledgeWrite(supabase, propertyId);
    if (!prop.ok) {
      results.push({
        property_id: propertyId,
        property_name: propertyId,
        ok: false,
        results: [],
        failures: [],
        drift: [],
        summary: prop.error.message,
      });
      continue;
    }
    const previewedPlan = preview.plan.properties.find((p) => p.property_id === propertyId);
    // Each property is an independent sequence: one property's failure skips its
    // own dependents and nothing else. The operator confirmed a bundle.
    const committed = await commitPropertyKnowledgeOperationsFor(
      supabase,
      prop.property,
      {
        property_id: propertyId,
        operations: input.operations,
        actor_user_id: input.actor_user_id ?? null,
        source: input.source,
      },
      previewedPlan
        ? {
            property: { property_id: propertyId, name: prop.property.name },
            operations: previewedPlan.operations,
            rooms_to_create: [],
            photos_to_attach: 0,
            noop_count: previewedPlan.noop_count,
            blocked_count: previewedPlan.blocked_count,
            summary: previewedPlan.summary,
          }
        : null,
    );
    results.push({
      property_id: propertyId,
      property_name: prop.property.name,
      ok: committed.ok,
      results: committed.results,
      failures: committed.failures,
      drift: committed.drift,
      summary: committed.summary,
    });
  }

  const failures = results.filter((r) => !r.ok);
  const landed = results.filter((r) => r.ok);
  const summary =
    failures.length === 0
      ? `Updated ${landed.length} propert${landed.length === 1 ? 'y' : 'ies'}.`
      : `Updated ${landed.length} of ${results.length} properties; ${failures.length} had problems: ${failures
          .map((f) => f.property_name)
          .join(', ')}.`;

  return { ok: true, results, failures, summary };
}

/** Modes a property's operations resolved to — used by callers building text. */
export function propertyModes(plan: PropertyKnowledgeBatchPropertyPlan): OperationMode[] {
  return plan.operations.map((o) => o.mode);
}
