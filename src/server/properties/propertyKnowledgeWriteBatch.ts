import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { normalizeAccessType } from '@/lib/propertyAccess';
import {
  previewPropertyKnowledgeWrite,
  commitPropertyKnowledgeWrite,
  type KnowledgeChange,
  type PropertyKnowledgeWriteError,
  type PropertyKnowledgeWriteInput,
} from './propertyKnowledgeWrite';

// Batch Property Knowledge writes — "apply this one fact to N properties".
//
// Why this exists: the single-write engine takes exactly one property_id and
// one action, so "add the gate code to all three Long Branch properties" fanned
// out into three previews, three pending actions, and three plan bullets. Worse,
// an attribute needs a room_id that does not exist until its room is committed,
// so creating a room and putting an attribute in it could never fit inside one
// confirmation — the agent was forced to tell the operator "this is step 1 of 2"
// and wait for them to ask again.
//
// This layer sits ON TOP of the single-write engine rather than replacing it.
// Every actual mutation still goes through previewPropertyKnowledgeWrite /
// commitPropertyKnowledgeWrite, so field normalization, diffing, the activity
// ledger, and the org guard all keep working exactly as before. What's added
// here is only the two things the single engine structurally cannot do:
//
//   1. Fan out one write across many properties.
//   2. Resolve-or-create the containing room, then land the attribute in it,
//      inside a single confirmation. (Compare preview_tasks_batch's new_sub_bin
//      shorthand — same problem, same shape of answer.)
//
// Targets are matched BY NAME, not by id, because ids are per-property and the
// caller has only one set of fields for the whole batch. That also makes the
// operation idempotent: running the same instruction twice updates in place
// instead of creating duplicates.
//
// Deletes fan out too, resolved by the same name matching: "remove the gate code
// everywhere" is the mirror of adding it. A delete whose target isn't on a given
// property is a NO-OP, not a failure — the thing is already gone, which is the
// outcome the operator asked for.
//
// Document edits stay on the single tool: a document is one uploaded file
// addressed by id, so there is no name to fan out over.

const BATCH_ACTIONS = [
  'upsert_access_item',
  'upsert_connectivity',
  'upsert_room',
  'upsert_attribute',
  'delete_access_item',
  'delete_room',
  'delete_attribute',
] as const;

/** Deletes resolve their target the same way upserts do — by name — but a
 *  missing target is a no-op, not an error: the thing is already gone. */
const DELETE_ACTIONS = new Set<string>([
  'delete_access_item',
  'delete_room',
  'delete_attribute',
]);

export type PropertyKnowledgeBatchAction = (typeof BATCH_ACTIONS)[number];

/** Ceiling on properties per batch. Generous for real portfolios, low enough
 *  that a plan still reads as a reviewable list rather than a wall of text. */
const MAX_PROPERTIES = 25;

export const propertyKnowledgeBatchInputSchema = z.object({
  action: z.enum(BATCH_ACTIONS),
  property_ids: z.array(z.string().uuid()).min(1).max(MAX_PROPERTIES),
  fields: z.record(z.string(), z.unknown()),
  room: z
    .object({
      title: z.string().min(1).max(120),
      scope: z.enum(['interior', 'exterior']),
      /** Ignored on delete actions — deleting never creates a room. */
      create_if_missing: z.boolean().optional(),
    })
    .optional(),
  actor_user_id: z.string().nullable().optional(),
  source: z.enum(['web', 'agent_slack', 'agent_web', 'system']).optional(),
});

export type PropertyKnowledgeBatchInput = z.infer<
  typeof propertyKnowledgeBatchInputSchema
>;

export interface PropertyKnowledgeBatchStep {
  property_id: string;
  property_name: string;
  /** 'noop': the target already matches the request, or a delete has nothing
   *  to delete on this property. */
  mode: 'create' | 'update' | 'delete' | 'noop';
  /** Set when this property has no matching room yet and the batch will create
   *  one before writing the attribute. Null on every other action. */
  creates_room: { title: string; scope: string } | null;
  subject_label: string;
  changes: KnowledgeChange[];
}

export interface PropertyKnowledgeBatchFailure {
  property_id: string;
  property_name: string | null;
  error: PropertyKnowledgeWriteError;
}

export interface PropertyKnowledgeBatchPlan {
  action: PropertyKnowledgeBatchAction;
  steps: PropertyKnowledgeBatchStep[];
  failures: PropertyKnowledgeBatchFailure[];
  /** Properties whose write would change nothing. Split out so the agent can
   *  say "2 of 3 already have this" instead of implying it wrote to all three. */
  noop_count: number;
  rooms_to_create: number;
  summary: string;
}

export type PreviewPropertyKnowledgeBatchResult =
  | {
      ok: true;
      plan: PropertyKnowledgeBatchPlan;
      canonicalInput: PropertyKnowledgeBatchInput;
    }
  | { ok: false; error: PropertyKnowledgeWriteError };

export interface PropertyKnowledgeBatchCommitResult {
  property_id: string;
  property_name: string;
  ok: boolean;
  created_room: { id: string; title: string } | null;
  row: unknown;
  error?: PropertyKnowledgeWriteError;
}

export type CommitPropertyKnowledgeBatchResult =
  | {
      ok: true;
      plan: PropertyKnowledgeBatchPlan;
      results: PropertyKnowledgeBatchCommitResult[];
      failures: PropertyKnowledgeBatchCommitResult[];
    }
  | { ok: false; error: PropertyKnowledgeWriteError };

type Supabase = ReturnType<typeof getSupabaseServer>;

function sameTitle(a: string | null | undefined, b: string): boolean {
  return (a ?? '').trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * What a single property in the batch resolves to.
 *
 * `delegate` is the common case: we worked out which row to hit and can hand a
 * normal single-write input to the existing engine. `room_then_attribute` is
 * the compound case the single engine cannot express — create the room, then
 * write the attribute into the id that room creation returns.
 */
type ResolvedStep =
  | { kind: 'delegate'; input: PropertyKnowledgeWriteInput }
  /** Nothing to do on this property — a delete whose target isn't there. */
  | { kind: 'noop'; label: string; reason: string }
  | {
      kind: 'room_then_attribute';
      roomInput: Extract<PropertyKnowledgeWriteInput, { action: 'upsert_room' }>;
      attributeFields: Record<string, unknown>;
    }
  | { kind: 'error'; error: PropertyKnowledgeWriteError };

async function loadPropertyName(
  supabase: Supabase,
  propertyId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('properties')
    .select('name')
    .eq('id', propertyId)
    .maybeSingle();
  return (data as { name?: string } | null)?.name ?? null;
}

/**
 * Work out which row in `propertyId` this batch should write, by name.
 *
 * Runs at BOTH preview and commit time rather than baking ids into the token.
 * That keeps the operation correct when the world moves between the two — most
 * obviously when a previous batch (or a person in the web UI) created the room
 * in between, in which case commit updates it instead of making a duplicate.
 */
async function resolveStep(
  supabase: Supabase,
  input: PropertyKnowledgeBatchInput,
  propertyId: string,
): Promise<ResolvedStep> {
  const base = {
    property_id: propertyId,
    actor_user_id: input.actor_user_id ?? null,
    source: input.source,
  };

  if (input.action === 'upsert_connectivity') {
    // Singleton per property — nothing to match, the engine upserts by
    // property_id on its own.
    return {
      kind: 'delegate',
      input: {
        ...base,
        action: 'upsert_connectivity',
        fields: input.fields,
      } as PropertyKnowledgeWriteInput,
    };
  }

  if (
    input.action === 'upsert_access_item' ||
    input.action === 'delete_access_item'
  ) {
    // Access items are keyed by type; a property holds at most one of each
    // meaningful type (one gate code, one lockbox). For 'other' the label is
    // what distinguishes them, so it joins the match key.
    const type = normalizeAccessType(
      (input.fields.type as string | undefined) ?? 'other',
    );
    const label = (input.fields.label as string | undefined) ?? null;
    const { data, error } = await supabase
      .from('property_access_items')
      .select('id, type, label')
      .eq('property_id', propertyId)
      .eq('type', type);
    if (error) {
      return { kind: 'error', error: { code: 'db_error', message: error.message } };
    }
    const rows = (data ?? []) as Array<{ id: string; label: string | null }>;
    const match =
      type === 'other' && label
        ? rows.find((r) => sameTitle(r.label, label))
        : rows[0];
    if (input.action === 'delete_access_item') {
      if (!match) {
        return {
          kind: 'noop',
          label: label || type,
          reason: `No "${label || type}" access item on this property.`,
        };
      }
      return {
        kind: 'delegate',
        input: {
          ...base,
          action: 'delete_access_item',
          item_id: match.id,
        } as PropertyKnowledgeWriteInput,
      };
    }
    return {
      kind: 'delegate',
      input: {
        ...base,
        action: 'upsert_access_item',
        ...(match ? { item_id: match.id } : {}),
        fields: input.fields,
      } as PropertyKnowledgeWriteInput,
    };
  }

  if (input.action === 'upsert_room' || input.action === 'delete_room') {
    const title = (input.fields.title as string | undefined) ?? '';
    const scope = input.fields.scope as string | undefined;
    if (!title || !scope) {
      return {
        kind: 'error',
        error: {
          code: 'invalid_input',
          message: 'fields.title and fields.scope are required for a room batch.',
          field: 'fields.title',
        },
      };
    }
    const { data, error } = await supabase
      .from('property_rooms')
      .select('id, title')
      .eq('property_id', propertyId)
      .eq('scope', scope);
    if (error) {
      return { kind: 'error', error: { code: 'db_error', message: error.message } };
    }
    const match = ((data ?? []) as Array<{ id: string; title: string | null }>).find(
      (r) => sameTitle(r.title, title),
    );
    if (input.action === 'delete_room') {
      if (!match) {
        return {
          kind: 'noop',
          label: title,
          reason: `No ${scope} room titled "${title}" on this property.`,
        };
      }
      // Deleting a room cascades its attributes and photos; the single engine's
      // delete plan surfaces those counts, so delegate and let it say so.
      return {
        kind: 'delegate',
        input: {
          ...base,
          action: 'delete_room',
          room_id: match.id,
        } as PropertyKnowledgeWriteInput,
      };
    }
    return {
      kind: 'delegate',
      input: {
        ...base,
        action: 'upsert_room',
        ...(match ? { room_id: match.id } : {}),
        fields: input.fields,
      } as PropertyKnowledgeWriteInput,
    };
  }

  // --- attributes: resolve the room first, then the attribute inside it ------
  const isDelete = DELETE_ACTIONS.has(input.action);
  if (!input.room) {
    return {
      kind: 'error',
      error: {
        code: 'invalid_input',
        message:
          'An attribute batch needs a `room` (title + scope) so the containing room can be resolved per property.',
        field: 'room',
      },
    };
  }
  if (input.fields.room_id) {
    // A room_id is meaningful for exactly one property, so accepting one here
    // would silently write every property's attribute into another property's
    // room (or fail the FK check). Refuse loudly instead.
    return {
      kind: 'error',
      error: {
        code: 'invalid_input',
        message:
          'Do not pass fields.room_id in a batch — room ids are per-property. Use `room` { title, scope } instead.',
        field: 'fields.room_id',
      },
    };
  }
  const attributeTitle = (input.fields.title as string | undefined) ?? '';
  if (!attributeTitle) {
    return {
      kind: 'error',
      error: {
        code: 'invalid_input',
        message: 'fields.title is required — it is how the attribute is matched per property.',
        field: 'fields.title',
      },
    };
  }

  const { data: roomRows, error: roomErr } = await supabase
    .from('property_rooms')
    .select('id, title')
    .eq('property_id', propertyId)
    .eq('scope', input.room.scope);
  if (roomErr) {
    return { kind: 'error', error: { code: 'db_error', message: roomErr.message } };
  }
  const room = ((roomRows ?? []) as Array<{ id: string; title: string | null }>).find(
    (r) => sameTitle(r.title, input.room!.title),
  );

  if (!room) {
    // Deleting never creates. If the room isn't there, neither is the
    // attribute — nothing to do on this property.
    if (isDelete) {
      return {
        kind: 'noop',
        label: attributeTitle,
        reason: `No ${input.room.scope} room titled "${input.room.title}" on this property.`,
      };
    }
    if (input.room.create_if_missing === false) {
      return {
        kind: 'error',
        error: {
          code: 'not_found',
          message: `No ${input.room.scope} room titled "${input.room.title}" on this property.`,
          field: 'room',
        },
      };
    }
    // The compound case: the room does not exist yet, so its id cannot be known
    // until commit. Carry the attribute's fields alongside the room write and
    // stitch them together at commit time.
    return {
      kind: 'room_then_attribute',
      roomInput: {
        ...base,
        action: 'upsert_room',
        fields: { scope: input.room.scope, title: input.room.title },
      } as Extract<PropertyKnowledgeWriteInput, { action: 'upsert_room' }>,
      attributeFields: input.fields,
    };
  }

  const { data: attrRows, error: attrErr } = await supabase
    .from('property_attributes')
    .select('id, title')
    .eq('property_id', propertyId)
    .eq('room_id', room.id);
  if (attrErr) {
    return { kind: 'error', error: { code: 'db_error', message: attrErr.message } };
  }
  const attr = ((attrRows ?? []) as Array<{ id: string; title: string | null }>).find(
    (r) => sameTitle(r.title, attributeTitle),
  );

  if (isDelete) {
    if (!attr) {
      return {
        kind: 'noop',
        label: attributeTitle,
        reason: `No attribute titled "${attributeTitle}" in the ${input.room.scope} "${input.room.title}" room.`,
      };
    }
    return {
      kind: 'delegate',
      input: {
        ...base,
        action: 'delete_attribute',
        attribute_id: attr.id,
      } as PropertyKnowledgeWriteInput,
    };
  }

  return {
    kind: 'delegate',
    input: {
      ...base,
      action: 'upsert_attribute',
      ...(attr ? { attribute_id: attr.id } : {}),
      fields: { ...input.fields, room_id: room.id },
    } as PropertyKnowledgeWriteInput,
  };
}

function buildSummary(
  action: PropertyKnowledgeBatchAction,
  steps: PropertyKnowledgeBatchStep[],
  failures: PropertyKnowledgeBatchFailure[],
  roomsToCreate: number,
): string {
  const deleting = DELETE_ACTIONS.has(action);
  const noun = action.includes('attribute')
    ? 'attribute'
    : action.includes('access_item')
      ? 'access item'
      : action.includes('room')
        ? 'room'
        : 'connectivity info';
  const writes = steps.filter((s) => s.mode !== 'noop').length;
  const noops = steps.length - writes;
  const parts = [
    `${deleting ? 'Remove' : 'Write'} ${noun} across ${
      steps.length + failures.length
    } propert${steps.length + failures.length === 1 ? 'y' : 'ies'}`,
  ];
  if (writes > 0) parts.push(`${writes} to ${deleting ? 'remove' : 'change'}`);
  if (noops > 0) parts.push(`${noops} ${deleting ? 'not present' : 'already correct'}`);
  if (roomsToCreate > 0) {
    parts.push(
      `${roomsToCreate} room${roomsToCreate === 1 ? '' : 's'} to create first`,
    );
  }
  if (failures.length > 0) parts.push(`${failures.length} blocked`);
  return `${parts[0]} — ${parts.slice(1).join(', ')}`;
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
  const supabase = getSupabaseServer();

  const steps: PropertyKnowledgeBatchStep[] = [];
  const failures: PropertyKnowledgeBatchFailure[] = [];
  let roomsToCreate = 0;

  for (const propertyId of input.property_ids) {
    const name = await loadPropertyName(supabase, propertyId);
    if (!name) {
      failures.push({
        property_id: propertyId,
        property_name: null,
        error: {
          code: 'not_found',
          message: `No property found with id ${propertyId}.`,
          field: 'property_ids',
        },
      });
      continue;
    }

    const resolved = await resolveStep(supabase, input, propertyId);
    if (resolved.kind === 'error') {
      failures.push({ property_id: propertyId, property_name: name, error: resolved.error });
      continue;
    }

    if (resolved.kind === 'noop') {
      steps.push({
        property_id: propertyId,
        property_name: name,
        mode: 'noop',
        creates_room: null,
        subject_label: resolved.label,
        changes: [],
      });
      continue;
    }

    if (resolved.kind === 'room_then_attribute') {
      // The attribute cannot be previewed against a room that does not exist,
      // so describe it directly. Every field still passes through the engine's
      // validation at commit; this is a description, not a shortcut around it.
      roomsToCreate += 1;
      steps.push({
        property_id: propertyId,
        property_name: name,
        mode: 'create',
        creates_room: { title: input.room!.title, scope: input.room!.scope },
        subject_label: String(input.fields.title ?? 'attribute'),
        changes: Object.entries(input.fields)
          .filter(([field]) => field !== 'room_id')
          .map(([field, after]) => ({ field, before: null, after })),
      });
      continue;
    }

    const preview = await previewPropertyKnowledgeWrite(resolved.input);
    if (!preview.ok) {
      failures.push({ property_id: propertyId, property_name: name, error: preview.error });
      continue;
    }
    steps.push({
      property_id: propertyId,
      property_name: name,
      // An update that changes nothing is a no-op — surfaced so the agent can
      // report it honestly rather than claiming it wrote to every property.
      // Pass the engine's mode through as-is. An update that changes nothing is
      // reported as a no-op so the agent can say "already correct" rather than
      // implying it wrote to every property.
      mode:
        preview.plan.mode === 'update' && preview.plan.changes.length === 0
          ? 'noop'
          : preview.plan.mode,
      creates_room: null,
      subject_label: preview.plan.subject.label,
      changes: preview.plan.changes,
    });
  }

  if (steps.length === 0) {
    return {
      ok: false,
      error: {
        code: failures.length > 0 ? (failures[0].error.code ?? 'invalid_input') : 'invalid_input',
        message:
          failures.length > 0
            ? `No property in the batch can be written. First problem: ${failures[0].error.message}`
            : 'The batch resolved to no writes.',
        field: failures[0]?.error.field,
      },
    };
  }

  return {
    ok: true,
    plan: {
      action: input.action,
      steps,
      failures,
      noop_count: steps.filter((s) => s.mode === 'noop').length,
      rooms_to_create: roomsToCreate,
      summary: buildSummary(input.action, steps, failures, roomsToCreate),
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

  const results: PropertyKnowledgeBatchCommitResult[] = [];

  for (const step of preview.plan.steps) {
    const resolved = await resolveStep(supabase, input, step.property_id);
    if (resolved.kind === 'noop') {
      results.push({
        property_id: step.property_id,
        property_name: step.property_name,
        ok: true,
        created_room: null,
        row: null,
      });
      continue;
    }
    if (resolved.kind === 'error') {
      results.push({
        property_id: step.property_id,
        property_name: step.property_name,
        ok: false,
        created_room: null,
        row: null,
        error: resolved.error,
      });
      continue;
    }

    if (resolved.kind === 'room_then_attribute') {
      // Ordered, not parallel: the attribute write consumes the id the room
      // write returns. A failure here skips the attribute rather than writing
      // it somewhere unintended.
      const roomRes = await commitPropertyKnowledgeWrite(resolved.roomInput);
      if (!roomRes.ok) {
        results.push({
          property_id: step.property_id,
          property_name: step.property_name,
          ok: false,
          created_room: null,
          row: null,
          error: roomRes.error,
        });
        continue;
      }
      const roomId = (roomRes.row as { id?: string } | null)?.id;
      if (!roomId) {
        results.push({
          property_id: step.property_id,
          property_name: step.property_name,
          ok: false,
          created_room: null,
          row: null,
          error: {
            code: 'db_error',
            message: 'Room was created but returned no id, so the attribute was skipped.',
          },
        });
        continue;
      }
      const attrRes = await commitPropertyKnowledgeWrite({
        action: 'upsert_attribute',
        property_id: step.property_id,
        actor_user_id: input.actor_user_id ?? null,
        source: input.source,
        fields: { ...resolved.attributeFields, room_id: roomId },
      });
      results.push({
        property_id: step.property_id,
        property_name: step.property_name,
        ok: attrRes.ok,
        created_room: { id: roomId, title: input.room!.title },
        row: attrRes.ok ? attrRes.row : null,
        ...(attrRes.ok ? {} : { error: attrRes.error }),
      });
      continue;
    }

    const res = await commitPropertyKnowledgeWrite(resolved.input);
    results.push({
      property_id: step.property_id,
      property_name: step.property_name,
      ok: res.ok,
      created_room: null,
      row: res.ok ? res.row : null,
      ...(res.ok ? {} : { error: res.error }),
    });
  }

  return {
    ok: true,
    plan: preview.plan,
    results: results.filter((r) => r.ok),
    failures: results.filter((r) => !r.ok),
  };
}
