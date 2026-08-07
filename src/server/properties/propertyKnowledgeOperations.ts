/**
 * Ordered Property Knowledge operations against ONE property.
 *
 * This is the layer that lets "create a Gate room, put two attributes in it,
 * and pin this photo to one of them" be a single preview and a single Confirm.
 * The primitive engine in propertyKnowledgeWrite.ts still owns one-row-at-a-time
 * correctness (normalization, diffing, the activity ledger); this module owns
 * everything that only makes sense across several writes: resolving targets by
 * name, remembering rows an earlier operation will create, running the writes in
 * dependency order, and attaching photos to ids that did not exist at preview.
 *
 * Two invariants carry most of the weight:
 *
 *  1. Targets are addressed BY NAME and re-resolved at commit, never by ids
 *     baked into a token at preview. That is what keeps a plan honest when the
 *     world moves in between — if someone else creates the Gate room first, the
 *     commit updates it instead of making a duplicate.
 *  2. Photos live ON the operation that produces their target. That makes them
 *     part of the canonical input by construction, so the token path and the
 *     Confirm-button path cannot disagree about whether photos were included.
 */
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { normalizeAccessType } from '@/lib/propertyAccess';
import {
  accessItemFieldsSchema,
  attributeFieldsSchema,
  connectivityFieldsSchema,
  documentFieldsSchema,
  roomFieldsSchema,
  sourceSchema,
  planPropertyKnowledgeWriteFor,
  commitPropertyKnowledgeWriteFor,
  loadPropertyForKnowledgeWrite,
  type KnowledgeChange,
  type PropertyKnowledgeWriteError,
  type PropertyKnowledgeWriteInput,
} from './propertyKnowledgeWrite';
import {
  previewSlackFileAttachment,
  commitSlackFileAttachment,
} from '@/src/server/slack/attachInboundFile';

type Supabase = ReturnType<typeof getSupabaseServer>;

export const MAX_OPERATIONS = 20;
const MAX_PHOTOS_PER_OPERATION = 10;

// --- schema ----------------------------------------------------------------

/**
 * How an operation names the room it lands in.
 *
 * The name form is the one the model should reach for: it resolves the same way
 * whether the room already existed, is created by an earlier operation in this
 * same plan, or was created by a person seconds ago. The id form is an escape
 * hatch for "this exact row" — mainly renames, where following the name would be
 * ambiguous. It is single-property only; a room id means nothing across a batch.
 */
const roomRefSchema = z.union([
  z.object({
    title: z.string().min(1).max(120),
    scope: z.enum(['interior', 'exterior']),
    create_if_missing: z.boolean().optional(),
  }),
  z.object({ room_id: z.string().uuid() }),
]);

export type RoomRef = z.infer<typeof roomRefSchema>;

const photosSchema = z.object({
  inbound_file_ids: z.array(z.string().uuid()).min(1).max(MAX_PHOTOS_PER_OPERATION),
  caption: z.string().nullable().optional(),
});

/** Attribute fields minus room_id — the room is addressed only via `room`. */
const attributeOpFieldsSchema = attributeFieldsSchema.omit({ room_id: true });

export const propertyKnowledgeOperationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('upsert_room'),
    room: roomRefSchema,
    /**
     * `scope` is omitted because the room reference already carries it. `title`
     * stays: on a room that exists, setting it is how a rename is expressed
     * (the reference is the match key, this is the new name).
     */
    fields: roomFieldsSchema.omit({ scope: true }).optional(),
    photos: photosSchema.optional(),
  }),
  z.object({ op: z.literal('delete_room'), room: roomRefSchema }),
  z.object({
    op: z.literal('upsert_attribute'),
    room: roomRefSchema,
    fields: attributeOpFieldsSchema,
    photos: photosSchema.optional(),
  }),
  z.object({
    op: z.literal('delete_attribute'),
    room: roomRefSchema,
    title: z.string().min(1),
  }),
  z.object({ op: z.literal('upsert_access_item'), fields: accessItemFieldsSchema }),
  z.object({
    op: z.literal('delete_access_item'),
    fields: z.object({ type: z.string(), label: z.string().optional() }).strict(),
  }),
  z.object({ op: z.literal('upsert_connectivity'), fields: connectivityFieldsSchema }),
  z.object({
    op: z.literal('update_document'),
    document_id: z.string().uuid(),
    fields: documentFieldsSchema,
  }),
  z.object({ op: z.literal('delete_document'), document_id: z.string().uuid() }),
]);

export type PropertyKnowledgeOperation = z.infer<typeof propertyKnowledgeOperationSchema>;
export type PropertyKnowledgeOperationKind = PropertyKnowledgeOperation['op'];

export const propertyKnowledgeOperationsInputSchema = z.object({
  property_id: z.string().uuid(),
  operations: z.array(propertyKnowledgeOperationSchema).min(1).max(MAX_OPERATIONS),
  actor_user_id: z.string().nullable().optional(),
  source: sourceSchema,
});

export type PropertyKnowledgeOperationsInput = z.infer<
  typeof propertyKnowledgeOperationsInputSchema
>;

/** Operations that address a single uploaded file by id cannot fan out. */
export const BATCHABLE_OPS: readonly PropertyKnowledgeOperationKind[] = [
  'upsert_room',
  'delete_room',
  'upsert_attribute',
  'delete_attribute',
  'upsert_access_item',
  'delete_access_item',
  'upsert_connectivity',
];

// --- plan types ------------------------------------------------------------

export type OperationMode = 'create' | 'update' | 'delete' | 'noop' | 'skipped';

export interface OperationPhotoFile {
  inbound_file_id: string;
  name: string | null;
  ok: boolean;
  reason?: string;
}

export interface OperationPlanStep {
  index: number;
  op: PropertyKnowledgeOperationKind;
  mode: OperationMode;
  subject: { type: string; id: string | null; label: string };
  /**
   * The room this operation lands in or creates. Null for access, connectivity
   * and document operations, which do not live under a room.
   */
  room: {
    title: string;
    scope: string;
    id: string | null;
    will_be_created: boolean;
    /** Index of the operation that creates it, or null when this one does. */
    created_by_op: number | null;
  } | null;
  changes: KnowledgeChange[];
  photos: {
    inbound_file_ids: string[];
    files: OperationPhotoFile[];
    caption: string | null;
  } | null;
  /** Plan-time problem: this operation is blocked, the rest still run. */
  error: PropertyKnowledgeWriteError | null;
  /** Index of the operation whose failure would strand this one. */
  depends_on: number | null;
  summary: string;
}

export interface PropertyKnowledgeOperationsPlan {
  property: { property_id: string; name: string };
  operations: OperationPlanStep[];
  rooms_to_create: Array<{ title: string; scope: string; by_op: number | null }>;
  photos_to_attach: number;
  noop_count: number;
  blocked_count: number;
  summary: string;
}

export interface OperationCommitResult {
  index: number;
  op: PropertyKnowledgeOperationKind;
  ok: boolean;
  mode: OperationMode;
  subject: { type: string; id: string | null; label: string };
  row: unknown;
  changes: KnowledgeChange[];
  attachments: Array<{
    inbound_file_id: string;
    ok: boolean;
    row?: unknown;
    error?: string;
  }>;
  error?: PropertyKnowledgeWriteError;
  /** Set when this was skipped because the operation it depended on failed. */
  skipped_because?: number;
}

export interface OperationDrift {
  index: number;
  previewed_mode: OperationMode;
  actual_mode: OperationMode;
  note: string;
}

export interface PropertyKnowledgeOperationsCommitResult {
  ok: boolean;
  partial: boolean;
  property: { property_id: string; name: string };
  results: OperationCommitResult[];
  failures: OperationCommitResult[];
  drift: OperationDrift[];
  summary: string;
}

export type PreviewPropertyKnowledgeOperationsResult =
  | {
      ok: true;
      plan: PropertyKnowledgeOperationsPlan;
      canonicalInput: PropertyKnowledgeOperationsInput;
    }
  | { ok: false; error: PropertyKnowledgeWriteError };

// --- helpers ---------------------------------------------------------------

function sameTitle(a: string | null | undefined, b: string): boolean {
  return (a ?? '').trim().toLowerCase() === b.trim().toLowerCase();
}

function roomKey(scope: string, title: string): string {
  return `${scope}|${title.trim().toLowerCase()}`;
}

function isNamedRoom(ref: RoomRef): ref is Extract<RoomRef, { title: string }> {
  return 'title' in ref;
}

function opTouchesRoom(op: PropertyKnowledgeOperation): op is Extract<
  PropertyKnowledgeOperation,
  { room: RoomRef }
> {
  return 'room' in op;
}

function photosOf(op: PropertyKnowledgeOperation) {
  return 'photos' in op ? op.photos : undefined;
}

/**
 * What an earlier operation promised about a room, so later operations can plan
 * against a row that does not exist yet.
 */
interface RoomMemoEntry {
  id: string | null;
  /** Index of the operation that will create it, or null when it already exists. */
  willExistAfterOp: number | null;
  scope: string;
  title: string;
  /** Set when an operation renamed this room, so stale references fail loudly. */
  renamedTo?: { key: string; title: string };
}

class RoomMemo {
  private entries = new Map<string, RoomMemoEntry>();
  private byId = new Map<string, string>();

  get(scope: string, title: string): RoomMemoEntry | undefined {
    return this.entries.get(roomKey(scope, title));
  }

  getById(id: string): RoomMemoEntry | undefined {
    const key = this.byId.get(id);
    return key ? this.entries.get(key) : undefined;
  }

  set(entry: RoomMemoEntry) {
    this.entries.set(roomKey(entry.scope, entry.title), entry);
    if (entry.id) this.byId.set(entry.id, roomKey(entry.scope, entry.title));
  }

  /** Move an entry to a new title, leaving a tombstone at the old key. */
  rename(scope: string, from: string, to: string) {
    const oldKey = roomKey(scope, from);
    const existing = this.entries.get(oldKey);
    if (!existing) return;
    const moved = { ...existing, title: to, renamedTo: undefined };
    this.entries.set(roomKey(scope, to), moved);
    this.entries.set(oldKey, {
      ...existing,
      renamedTo: { key: roomKey(scope, to), title: to },
    });
    if (moved.id) this.byId.set(moved.id, roomKey(scope, to));
  }

  /** Record the real id once a create actually lands. */
  resolveId(scope: string, title: string, id: string) {
    const key = roomKey(scope, title);
    const existing = this.entries.get(key);
    if (existing) {
      existing.id = id;
      this.byId.set(id, key);
    }
  }
}

interface ResolvedRoom {
  id: string | null;
  scope: string;
  title: string;
  /** True when this room does not exist in the database yet. */
  willBeCreated: boolean;
  /** Index of the operation that creates it, or null when this one does. */
  createdByOp: number | null;
}

type RoomResolution =
  | { kind: 'ok'; room: ResolvedRoom }
  | { kind: 'missing'; scope: string; title: string }
  | { kind: 'error'; error: PropertyKnowledgeWriteError };

/**
 * Resolve a room reference against the database and the in-flight plan.
 *
 * The database is consulted first so a room created out of band between preview
 * and commit is picked up rather than duplicated; the memo covers rooms this
 * plan is itself about to create.
 */
async function resolveRoom(
  supabase: Supabase,
  propertyId: string,
  ref: RoomRef,
  memo: RoomMemo,
): Promise<RoomResolution> {
  if (!isNamedRoom(ref)) {
    const { data, error } = await supabase
      .from('property_rooms')
      .select('id, title, scope')
      .eq('id', ref.room_id)
      .eq('property_id', propertyId)
      .maybeSingle();
    if (error) return { kind: 'error', error: { code: 'db_error', message: error.message, field: 'room.room_id' } };
    if (!data) {
      // An explicit id is the caller asserting "this exact row". If it is gone,
      // creating something new would be a different write than the one approved.
      return {
        kind: 'error',
        error: { code: 'not_found', message: `No room found with id ${ref.room_id} on this property.`, field: 'room.room_id' },
      };
    }
    const row = data as { id: string; title: string | null; scope: string };
    const resolved = {
      id: row.id,
      scope: row.scope,
      title: row.title ?? '',
      willBeCreated: false,
      createdByOp: null,
    };
    memo.set({ id: row.id, willExistAfterOp: null, scope: row.scope, title: row.title ?? '' });
    return { kind: 'ok', room: resolved };
  }

  const memoed = memo.get(ref.scope, ref.title);
  if (memoed?.renamedTo) {
    return {
      kind: 'error',
      error: {
        code: 'invalid_input',
        message: `An earlier operation renamed the ${ref.scope} room "${ref.title}" to "${memoed.renamedTo.title}". Reference it by its new title.`,
        field: 'room.title',
      },
    };
  }

  const { data, error } = await supabase
    .from('property_rooms')
    .select('id, title')
    .eq('property_id', propertyId)
    .eq('scope', ref.scope);
  if (error) return { kind: 'error', error: { code: 'db_error', message: error.message, field: 'room' } };
  const matches = ((data ?? []) as Array<{ id: string; title: string | null }>).filter((r) =>
    sameTitle(r.title, ref.title),
  );
  if (matches.length > 1) {
    // Picking the first would silently write into a room the operator may not
    // have meant. Refusing is recoverable; guessing is not.
    return {
      kind: 'error',
      error: {
        code: 'invalid_input',
        message: `This property has ${matches.length} ${ref.scope} rooms titled "${ref.title}". Rename one, or address the room by id.`,
        field: 'room.title',
      },
    };
  }
  const match = matches[0];
  if (match) {
    memo.set({ id: match.id, willExistAfterOp: null, scope: ref.scope, title: ref.title });
    return {
      kind: 'ok',
      room: { id: match.id, scope: ref.scope, title: ref.title, willBeCreated: false, createdByOp: null },
    };
  }

  if (memoed) {
    return {
      kind: 'ok',
      room: {
        id: memoed.id,
        scope: ref.scope,
        title: ref.title,
        willBeCreated: memoed.id == null,
        createdByOp: memoed.willExistAfterOp,
      },
    };
  }
  return { kind: 'missing', scope: ref.scope, title: ref.title };
}

/**
 * Build the primitive-engine input for creating a room this plan needs.
 *
 * `extraFields` carries notes/sort_order from a bare upsert_room operation so
 * they land on the create rather than being dropped; the title and scope always
 * come from the resolved reference.
 */
function roomCreateInput(
  input: PropertyKnowledgeOperationsInput,
  scope: string,
  title: string,
  extraFields?: Record<string, unknown>,
): PropertyKnowledgeWriteInput {
  const { title: renamed, ...rest } = extraFields ?? {};
  return {
    action: 'upsert_room',
    property_id: input.property_id,
    fields: {
      ...rest,
      scope: scope as 'interior' | 'exterior',
      title: (typeof renamed === 'string' && renamed.trim()) || title,
    },
    actor_user_id: input.actor_user_id ?? null,
    source: input.source,
  } as PropertyKnowledgeWriteInput;
}

async function findAccessItemId(
  supabase: Supabase,
  propertyId: string,
  rawType: string,
  label: string | null,
): Promise<{ ok: true; id: string | null } | { ok: false; error: PropertyKnowledgeWriteError }> {
  const type = normalizeAccessType(rawType || 'other');
  const { data, error } = await supabase
    .from('property_access_items')
    .select('id, label')
    .eq('property_id', propertyId)
    .eq('type', type);
  if (error) return { ok: false, error: { code: 'db_error', message: error.message } };
  const rows = (data ?? []) as Array<{ id: string; label: string | null }>;
  // A property holds at most one meaningful item per type (one gate code, one
  // lockbox), so type is the key — except for 'other', where the label is the
  // only thing distinguishing two items.
  const match = type === 'other' && label ? rows.find((r) => sameTitle(r.label, label)) : rows[0];
  return { ok: true, id: match?.id ?? null };
}

async function findAttributeId(
  supabase: Supabase,
  propertyId: string,
  roomId: string,
  title: string,
): Promise<{ ok: true; id: string | null } | { ok: false; error: PropertyKnowledgeWriteError }> {
  const { data, error } = await supabase
    .from('property_attributes')
    .select('id, title')
    .eq('property_id', propertyId)
    .eq('room_id', roomId);
  if (error) return { ok: false, error: { code: 'db_error', message: error.message } };
  const rows = (data ?? []) as Array<{ id: string; title: string | null }>;
  return { ok: true, id: rows.find((r) => sameTitle(r.title, title))?.id ?? null };
}

/**
 * What an operation compiles down to, once its targets are resolved.
 *
 * `create_room_first` is the compound case: the room does not exist yet, so its
 * id cannot be known until the room write returns one.
 */
type ResolvedOperation =
  | { kind: 'write'; input: PropertyKnowledgeWriteInput; room: ResolvedRoom | null }
  | {
      kind: 'create_room_first';
      roomInput: PropertyKnowledgeWriteInput;
      room: ResolvedRoom;
      /** Attribute fields to write once the room id exists; null for a bare room op. */
      attributeFields: Record<string, unknown> | null;
    }
  | { kind: 'noop'; label: string; reason: string; room: ResolvedRoom | null }
  | { kind: 'error'; error: PropertyKnowledgeWriteError; room: ResolvedRoom | null };

/**
 * Compile one operation into primitive-engine work.
 *
 * Runs at BOTH preview and commit. At commit the memo already holds real ids for
 * rooms earlier operations created, so the same code path resolves them without
 * a second lookup.
 */
async function resolveOperation(
  supabase: Supabase,
  input: PropertyKnowledgeOperationsInput,
  op: PropertyKnowledgeOperation,
  index: number,
  memo: RoomMemo,
): Promise<ResolvedOperation> {
  const base = {
    property_id: input.property_id,
    actor_user_id: input.actor_user_id ?? null,
    source: input.source,
  };

  if (op.op === 'upsert_connectivity') {
    return {
      kind: 'write',
      input: { ...base, action: 'upsert_connectivity', fields: op.fields } as PropertyKnowledgeWriteInput,
      room: null,
    };
  }

  if (op.op === 'update_document' || op.op === 'delete_document') {
    return {
      kind: 'write',
      input: (op.op === 'update_document'
        ? { ...base, action: 'update_document', document_id: op.document_id, fields: op.fields }
        : { ...base, action: 'delete_document', document_id: op.document_id }) as PropertyKnowledgeWriteInput,
      room: null,
    };
  }

  if (op.op === 'upsert_access_item' || op.op === 'delete_access_item') {
    const rawType = (op.fields.type as string | undefined) ?? 'other';
    const label = (op.fields.label as string | undefined) ?? null;
    const found = await findAccessItemId(supabase, input.property_id, rawType, label);
    if (!found.ok) return { kind: 'error', error: found.error, room: null };
    if (op.op === 'delete_access_item') {
      if (!found.id) {
        return {
          kind: 'noop',
          label: label || rawType,
          reason: `No "${label || rawType}" access item on this property.`,
          room: null,
        };
      }
      return {
        kind: 'write',
        input: { ...base, action: 'delete_access_item', item_id: found.id } as PropertyKnowledgeWriteInput,
        room: null,
      };
    }
    return {
      kind: 'write',
      input: {
        ...base,
        action: 'upsert_access_item',
        ...(found.id ? { item_id: found.id } : {}),
        fields: op.fields,
      } as PropertyKnowledgeWriteInput,
      room: null,
    };
  }

  // --- everything below lives under a room --------------------------------
  const resolution = await resolveRoom(supabase, input.property_id, op.room, memo);
  if (resolution.kind === 'error') return { kind: 'error', error: resolution.error, room: null };

  const isDelete = op.op === 'delete_room' || op.op === 'delete_attribute';

  if (resolution.kind === 'missing') {
    // Deleting never creates: if the room is not there, neither is anything in
    // it, which is already the state the operator asked for.
    if (isDelete) {
      const label = op.op === 'delete_attribute' ? op.title : resolution.title;
      return {
        kind: 'noop',
        label,
        reason: `No ${resolution.scope} room titled "${resolution.title}" on this property.`,
        room: null,
      };
    }
    if (isNamedRoom(op.room) && op.room.create_if_missing === false) {
      return {
        kind: 'error',
        error: {
          code: 'not_found',
          message: `No ${resolution.scope} room titled "${resolution.title}" on this property.`,
          field: 'room',
        },
        room: null,
      };
    }
    const room: ResolvedRoom = {
      id: null,
      scope: resolution.scope,
      title: resolution.title,
      willBeCreated: true,
      createdByOp: null,
    };
    memo.set({ id: null, willExistAfterOp: index, scope: resolution.scope, title: resolution.title });
    return {
      kind: 'create_room_first',
      roomInput: roomCreateInput(
        input,
        resolution.scope,
        resolution.title,
        op.op === 'upsert_room' ? op.fields : undefined,
      ),
      room,
      attributeFields: op.op === 'upsert_attribute' ? { ...op.fields } : null,
    };
  }

  const room = resolution.room;

  if (op.op === 'upsert_room') {
    if (room.willBeCreated) {
      // An earlier operation in this plan already claimed this room; this one
      // only carries extra fields (and possibly photos) for it.
      return {
        kind: 'create_room_first',
        roomInput: roomCreateInput(input, room.scope, room.title, op.fields),
        room,
        attributeFields: null,
      };
    }
    const renamedTitle = op.fields && 'title' in op.fields ? (op.fields.title as string | null) : undefined;
    if (renamedTitle && !sameTitle(room.title, renamedTitle)) {
      memo.rename(room.scope, room.title, renamedTitle);
    }
    return {
      kind: 'write',
      input: {
        ...base,
        action: 'upsert_room',
        room_id: room.id!,
        fields: { ...(op.fields ?? {}), scope: room.scope as 'interior' | 'exterior' },
      } as PropertyKnowledgeWriteInput,
      room,
    };
  }

  if (op.op === 'delete_room') {
    if (!room.id) {
      return { kind: 'noop', label: room.title, reason: 'That room does not exist yet.', room };
    }
    return {
      kind: 'write',
      input: { ...base, action: 'delete_room', room_id: room.id } as PropertyKnowledgeWriteInput,
      room,
    };
  }

  if (op.op === 'delete_attribute') {
    if (!room.id) {
      return { kind: 'noop', label: op.title, reason: 'That room does not exist yet.', room };
    }
    const found = await findAttributeId(supabase, input.property_id, room.id, op.title);
    if (!found.ok) return { kind: 'error', error: found.error, room };
    if (!found.id) {
      return {
        kind: 'noop',
        label: op.title,
        reason: `No attribute titled "${op.title}" in the ${room.scope} "${room.title}" room.`,
        room,
      };
    }
    return {
      kind: 'write',
      input: { ...base, action: 'delete_attribute', attribute_id: found.id } as PropertyKnowledgeWriteInput,
      room,
    };
  }

  // upsert_attribute into a room that exists (or will, per the memo)
  const attributeTitle = (op.fields.title as string | undefined) ?? '';
  if (!attributeTitle) {
    return {
      kind: 'error',
      error: {
        code: 'invalid_input',
        message: 'fields.title is required — it is how the attribute is matched.',
        field: 'fields.title',
      },
      room,
    };
  }
  if (!room.id) {
    // The containing room is still pending from an earlier operation, so this
    // attribute has to be stitched on after that room write returns an id.
    return {
      kind: 'create_room_first',
      roomInput: roomCreateInput(input, room.scope, room.title),
      room,
      attributeFields: { ...op.fields },
    };
  }
  const found = await findAttributeId(supabase, input.property_id, room.id, attributeTitle);
  if (!found.ok) return { kind: 'error', error: found.error, room };
  return {
    kind: 'write',
    input: {
      ...base,
      action: 'upsert_attribute',
      ...(found.id ? { attribute_id: found.id } : {}),
      fields: { ...op.fields, room_id: room.id },
    } as PropertyKnowledgeWriteInput,
    room,
  };
}

// --- photo planning --------------------------------------------------------

function photoDestination(op: PropertyKnowledgeOperationKind) {
  return op === 'upsert_room' ? 'property_room_photo' : 'property_attribute_photo';
}

/**
 * Check the photos an operation carries before anything is written.
 *
 * When the target already exists we hand the real attachment planner the actual
 * ids, so the per-target photo caps surface at preview rather than mid-commit.
 * When the target is still pending we can only validate the file itself.
 */
async function planPhotos(
  supabase: Supabase,
  propertyId: string,
  op: PropertyKnowledgeOperation,
  targetId: string | null,
): Promise<OperationPlanStep['photos']> {
  const photos = photosOf(op);
  if (!photos) return null;
  const files: OperationPhotoFile[] = [];
  for (const inboundFileId of photos.inbound_file_ids) {
    const { data } = await supabase
      .from('slack_inbound_files')
      .select('id, name, mime_type, file_type, consumed_at')
      .eq('id', inboundFileId)
      .maybeSingle();
    const row = data as
      | { id: string; name: string | null; mime_type: string | null; file_type: string | null; consumed_at: string | null }
      | null;
    if (!row) {
      files.push({ inbound_file_id: inboundFileId, name: null, ok: false, reason: 'That uploaded file is no longer available.' });
      continue;
    }
    if (!(row.mime_type?.startsWith('image/') || row.file_type === 'image')) {
      files.push({ inbound_file_id: inboundFileId, name: row.name, ok: false, reason: 'Only images can be attached as photos.' });
      continue;
    }
    if (row.consumed_at) {
      files.push({ inbound_file_id: inboundFileId, name: row.name, ok: false, reason: 'That file has already been filed somewhere else.' });
      continue;
    }
    if (targetId) {
      const dest = photoDestination(op.op);
      const preview = await previewSlackFileAttachment({
        destination: dest,
        inbound_file_id: inboundFileId,
        property_id: propertyId,
        ...(dest === 'property_room_photo' ? { room_id: targetId } : { attribute_id: targetId }),
        caption: photos.caption ?? null,
      });
      if (!preview.ok) {
        files.push({ inbound_file_id: inboundFileId, name: row.name, ok: false, reason: preview.error.message });
        continue;
      }
    }
    files.push({ inbound_file_id: inboundFileId, name: row.name, ok: true });
  }
  return {
    inbound_file_ids: photos.inbound_file_ids,
    files,
    caption: photos.caption ?? null,
  };
}

async function attachPhotos(
  propertyId: string,
  op: PropertyKnowledgeOperation,
  targetId: string,
): Promise<OperationCommitResult['attachments']> {
  const photos = photosOf(op);
  if (!photos) return [];
  const dest = photoDestination(op.op);
  const out: OperationCommitResult['attachments'] = [];
  // Sequential: each attachment is a storage download plus an upload, and the
  // per-target cap is evaluated against the count as it grows.
  for (const inboundFileId of photos.inbound_file_ids) {
    try {
      const res = await commitSlackFileAttachment({
        destination: dest,
        inbound_file_id: inboundFileId,
        property_id: propertyId,
        ...(dest === 'property_room_photo' ? { room_id: targetId } : { attribute_id: targetId }),
        caption: photos.caption ?? null,
      });
      out.push(
        res.ok
          ? { inbound_file_id: inboundFileId, ok: true, row: res.row }
          : { inbound_file_id: inboundFileId, ok: false, error: res.error.message },
      );
    } catch (err) {
      out.push({
        inbound_file_id: inboundFileId,
        ok: false,
        error: err instanceof Error ? err.message : 'Attachment failed.',
      });
    }
  }
  return out;
}

// --- summaries -------------------------------------------------------------

function stepSummary(
  op: PropertyKnowledgeOperation,
  mode: OperationMode,
  room: OperationPlanStep['room'],
  label: string,
): string {
  const verb =
    mode === 'create' ? 'Create' : mode === 'delete' ? 'Delete' : mode === 'noop' ? 'No change to' : 'Update';
  switch (op.op) {
    case 'upsert_room':
    case 'delete_room':
      return `${verb} ${room?.scope ?? ''} room "${label}"`.replace('  ', ' ');
    case 'upsert_attribute':
    case 'delete_attribute':
      return `${verb} attribute "${label}"${room ? ` in the ${room.scope} "${room.title}" room` : ''}`;
    case 'upsert_access_item':
    case 'delete_access_item':
      return `${verb} access item "${label}"`;
    case 'upsert_connectivity':
      return `${verb} connectivity info`;
    default:
      return `${verb} document "${label}"`;
  }
}

function planSummary(
  propertyName: string,
  steps: OperationPlanStep[],
  roomsToCreate: number,
  photos: number,
): string {
  const writes = steps.filter((s) => s.mode !== 'noop' && s.mode !== 'skipped' && !s.error).length;
  const noops = steps.filter((s) => s.mode === 'noop').length;
  const blocked = steps.filter((s) => s.error).length;
  const parts = [`${writes} change${writes === 1 ? '' : 's'} at ${propertyName}`];
  if (roomsToCreate > 0) parts.push(`create ${roomsToCreate} room${roomsToCreate === 1 ? '' : 's'}`);
  if (photos > 0) parts.push(`attach ${photos} photo${photos === 1 ? '' : 's'}`);
  if (noops > 0) parts.push(`${noops} already correct`);
  if (blocked > 0) parts.push(`${blocked} blocked`);
  return parts.join(' — ');
}

// --- preview ---------------------------------------------------------------

/** Plan a set of operations against an already-resolved property. */
export async function planPropertyKnowledgeOperations(
  supabase: Supabase,
  property: { id: string; name: string },
  input: PropertyKnowledgeOperationsInput,
): Promise<
  | { ok: true; plan: PropertyKnowledgeOperationsPlan }
  | { ok: false; error: PropertyKnowledgeWriteError }
> {
  const memo = new RoomMemo();
  const steps: OperationPlanStep[] = [];
  const roomsToCreate: PropertyKnowledgeOperationsPlan['rooms_to_create'] = [];
  const seenRoomCreates = new Set<string>();
  let photoCount = 0;

  for (const [index, op] of input.operations.entries()) {
    const resolved = await resolveOperation(supabase, input, op, index, memo);

    const roomInfo: OperationPlanStep['room'] = resolved.room
      ? {
          title: resolved.room.title,
          scope: resolved.room.scope,
          id: resolved.room.id,
          will_be_created: resolved.room.willBeCreated,
          created_by_op: resolved.room.createdByOp,
        }
      : null;

    if (resolved.kind === 'error') {
      steps.push({
        index,
        op: op.op,
        mode: 'skipped',
        subject: { type: 'unknown', id: null, label: '' },
        room: roomInfo,
        changes: [],
        photos: null,
        error: resolved.error,
        depends_on: null,
        summary: `Blocked: ${resolved.error.message}`,
      });
      continue;
    }

    if (resolved.kind === 'noop') {
      steps.push({
        index,
        op: op.op,
        mode: 'noop',
        subject: { type: 'unknown', id: null, label: resolved.label },
        room: roomInfo,
        changes: [],
        photos: null,
        error: null,
        depends_on: null,
        summary: resolved.reason,
      });
      continue;
    }

    if (resolved.kind === 'create_room_first') {
      const room = resolved.room;
      const key = roomKey(room.scope, room.title);
      const ownsCreate = room.createdByOp === null || room.createdByOp === index;
      if (ownsCreate && !seenRoomCreates.has(key)) {
        seenRoomCreates.add(key);
        roomsToCreate.push({ title: room.title, scope: room.scope, by_op: index });
      }
      const isAttribute = resolved.attributeFields !== null;
      const label = isAttribute
        ? String(resolved.attributeFields!.title ?? 'attribute')
        : room.title;
      const photos = await planPhotos(supabase, input.property_id, op, null);
      photoCount += photos?.files.filter((f) => f.ok).length ?? 0;
      steps.push({
        index,
        op: op.op,
        mode: 'create',
        subject: { type: isAttribute ? 'attribute' : 'room', id: null, label },
        room: {
          title: room.title,
          scope: room.scope,
          id: null,
          will_be_created: true,
          created_by_op: ownsCreate ? null : room.createdByOp,
        },
        changes: isAttribute
          ? Object.entries(resolved.attributeFields!).map(([field, after]) => ({ field, before: null, after }))
          : [{ field: 'title', before: null, after: room.title }, { field: 'scope', before: null, after: room.scope }],
        photos,
        error: null,
        depends_on: ownsCreate ? null : room.createdByOp,
        summary: stepSummary(op, 'create', { ...roomInfo!, id: null, will_be_created: true, created_by_op: room.createdByOp }, label),
      });
      continue;
    }

    // A plain write — hand it to the primitive engine for the real diff.
    const planned = await planPropertyKnowledgeWriteFor(supabase, resolved.input, property);
    if (!planned.ok) {
      steps.push({
        index,
        op: op.op,
        mode: 'skipped',
        subject: { type: 'unknown', id: null, label: '' },
        room: roomInfo,
        changes: [],
        photos: null,
        error: planned.error,
        depends_on: null,
        summary: `Blocked: ${planned.error.message}`,
      });
      continue;
    }
    const mode: OperationMode =
      planned.plan.mode === 'update' && planned.plan.changes.length === 0 ? 'noop' : planned.plan.mode;
    const photos = await planPhotos(supabase, input.property_id, op, planned.plan.subject.id);
    photoCount += photos?.files.filter((f) => f.ok).length ?? 0;
    steps.push({
      index,
      op: op.op,
      mode,
      subject: planned.plan.subject,
      room: roomInfo,
      changes: planned.plan.changes,
      photos,
      error: null,
      depends_on: null,
      summary: stepSummary(op, mode, roomInfo, planned.plan.subject.label),
    });
  }

  return {
    ok: true,
    plan: {
      property: { property_id: property.id, name: property.name },
      operations: steps,
      rooms_to_create: roomsToCreate,
      photos_to_attach: photoCount,
      noop_count: steps.filter((s) => s.mode === 'noop').length,
      blocked_count: steps.filter((s) => s.error).length,
      summary: planSummary(property.name, steps, roomsToCreate.length, photoCount),
    },
  };
}

export async function previewPropertyKnowledgeOperations(
  rawInput: unknown,
): Promise<PreviewPropertyKnowledgeOperationsResult> {
  const parsed = propertyKnowledgeOperationsInputSchema.safeParse(rawInput);
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
  const prop = await loadPropertyForKnowledgeWrite(supabase, input.property_id);
  if (!prop.ok) return { ok: false, error: prop.error };
  const planned = await planPropertyKnowledgeOperations(supabase, prop.property, input);
  if (!planned.ok) return { ok: false, error: planned.error };
  return { ok: true, plan: planned.plan, canonicalInput: input };
}

// --- commit ----------------------------------------------------------------

/**
 * Run the operations in order against an already-resolved property.
 *
 * Nothing is rolled back when a later operation fails: there is no cross-table
 * transaction available here, and undoing an approved write is itself a write
 * the operator never approved. Instead, operations that depended on the failure
 * are skipped and independent ones still run — the operator confirmed a bundle,
 * not an all-or-nothing.
 */
export async function commitPropertyKnowledgeOperationsFor(
  supabase: Supabase,
  property: { id: string; name: string },
  input: PropertyKnowledgeOperationsInput,
  previewedPlan: PropertyKnowledgeOperationsPlan | null,
): Promise<PropertyKnowledgeOperationsCommitResult> {
  const memo = new RoomMemo();
  const results: OperationCommitResult[] = [];
  const drift: OperationDrift[] = [];
  /** Room key -> index of the operation whose failure stranded it. */
  const strandedRooms = new Map<string, number>();

  for (const [index, op] of input.operations.entries()) {
    const previewedMode = previewedPlan?.operations.find((s) => s.index === index)?.mode ?? null;

    const record = (r: OperationCommitResult) => {
      results.push(r);
      if (previewedMode && previewedMode !== r.mode && r.ok) {
        drift.push({
          index,
          previewed_mode: previewedMode,
          actual_mode: r.mode,
          note:
            previewedMode === 'create' && r.mode === 'update'
              ? 'It already existed by the time this ran, so it was updated instead of created.'
              : `Planned as ${previewedMode}, committed as ${r.mode}.`,
        });
      }
    };

    // Skip early if this operation's room was stranded by an earlier failure.
    if (opTouchesRoom(op) && isNamedRoom(op.room)) {
      const key = roomKey(op.room.scope, op.room.title);
      const blocker = strandedRooms.get(key);
      if (blocker !== undefined) {
        results.push({
          index,
          op: op.op,
          ok: false,
          mode: 'skipped',
          subject: { type: 'unknown', id: null, label: op.room.title },
          row: null,
          changes: [],
          attachments: [],
          skipped_because: blocker,
          error: {
            code: 'not_found',
            message: `Skipped because the ${op.room.scope} "${op.room.title}" room could not be created.`,
          },
        });
        continue;
      }
    }

    const resolved = await resolveOperation(supabase, input, op, index, memo);

    if (resolved.kind === 'error') {
      record({
        index,
        op: op.op,
        ok: false,
        mode: 'skipped',
        subject: { type: 'unknown', id: null, label: '' },
        row: null,
        changes: [],
        attachments: [],
        error: resolved.error,
      });
      continue;
    }

    if (resolved.kind === 'noop') {
      results.push({
        index,
        op: op.op,
        ok: true,
        mode: 'noop',
        subject: { type: 'unknown', id: null, label: resolved.label },
        row: null,
        changes: [],
        attachments: [],
      });
      continue;
    }

    if (resolved.kind === 'create_room_first') {
      const room = resolved.room;
      // Ordered, not parallel: the attribute write consumes the id the room
      // write returns, and a room failure must strand its dependents rather
      // than write them somewhere unintended.
      const roomPlan = await planPropertyKnowledgeWriteFor(supabase, resolved.roomInput, property);
      if (!roomPlan.ok) {
        strandedRooms.set(roomKey(room.scope, room.title), index);
        record({
          index,
          op: op.op,
          ok: false,
          mode: 'skipped',
          subject: { type: 'room', id: null, label: room.title },
          row: null,
          changes: [],
          attachments: [],
          error: roomPlan.error,
        });
        continue;
      }
      const roomRes = await commitPropertyKnowledgeWriteFor(supabase, resolved.roomInput, roomPlan.plan);
      const roomId = roomRes.ok ? (roomRes.row as { id?: string } | null)?.id : undefined;
      if (!roomRes.ok || !roomId) {
        strandedRooms.set(roomKey(room.scope, room.title), index);
        record({
          index,
          op: op.op,
          ok: false,
          mode: 'skipped',
          subject: { type: 'room', id: null, label: room.title },
          row: null,
          changes: [],
          attachments: [],
          error: roomRes.ok
            ? { code: 'db_error', message: 'The room was created but returned no id.' }
            : roomRes.error,
        });
        continue;
      }
      memo.resolveId(room.scope, room.title, roomId);

      if (!resolved.attributeFields) {
        // A bare room operation — the room itself is the subject.
        const attachments = await attachPhotos(input.property_id, op, roomId);
        record({
          index,
          op: op.op,
          ok: true,
          mode: 'create',
          subject: { type: 'room', id: roomId, label: room.title },
          row: roomRes.row,
          changes: roomRes.plan.changes,
          attachments,
        });
        continue;
      }

      const attrInput = {
        action: 'upsert_attribute',
        property_id: input.property_id,
        actor_user_id: input.actor_user_id ?? null,
        source: input.source,
        fields: { ...resolved.attributeFields, room_id: roomId },
      } as PropertyKnowledgeWriteInput;
      const attrPlan = await planPropertyKnowledgeWriteFor(supabase, attrInput, property);
      if (!attrPlan.ok) {
        record({
          index,
          op: op.op,
          ok: false,
          mode: 'skipped',
          subject: { type: 'attribute', id: null, label: String(resolved.attributeFields.title ?? '') },
          row: null,
          changes: [],
          attachments: [],
          error: attrPlan.error,
        });
        continue;
      }
      const attrRes = await commitPropertyKnowledgeWriteFor(supabase, attrInput, attrPlan.plan);
      if (!attrRes.ok) {
        record({
          index,
          op: op.op,
          ok: false,
          mode: 'skipped',
          subject: { type: 'attribute', id: null, label: String(resolved.attributeFields.title ?? '') },
          row: null,
          changes: [],
          attachments: [],
          error: attrRes.error,
        });
        continue;
      }
      const attributeId = (attrRes.row as { id?: string } | null)?.id ?? null;
      const attachments = attributeId ? await attachPhotos(input.property_id, op, attributeId) : [];
      record({
        index,
        op: op.op,
        ok: true,
        mode: 'create',
        subject: attrRes.plan.subject,
        row: attrRes.row,
        changes: attrRes.plan.changes,
        attachments,
      });
      continue;
    }

    // A plain write.
    const planned = await planPropertyKnowledgeWriteFor(supabase, resolved.input, property);
    if (!planned.ok) {
      record({
        index,
        op: op.op,
        ok: false,
        mode: 'skipped',
        subject: { type: 'unknown', id: null, label: '' },
        row: null,
        changes: [],
        attachments: [],
        error: planned.error,
      });
      continue;
    }
    const committed = await commitPropertyKnowledgeWriteFor(supabase, resolved.input, planned.plan);
    if (!committed.ok) {
      record({
        index,
        op: op.op,
        ok: false,
        mode: 'skipped',
        subject: planned.plan.subject,
        row: null,
        changes: [],
        attachments: [],
        error: committed.error,
      });
      continue;
    }
    const mode: OperationMode =
      committed.plan.mode === 'update' && committed.plan.changes.length === 0
        ? 'noop'
        : committed.plan.mode;
    const targetId = (committed.row as { id?: string } | null)?.id ?? committed.plan.subject.id;
    const attachments = targetId ? await attachPhotos(input.property_id, op, targetId) : [];
    record({
      index,
      op: op.op,
      ok: true,
      mode,
      subject: { ...committed.plan.subject, id: targetId ?? committed.plan.subject.id },
      row: committed.row,
      changes: committed.plan.changes,
      attachments,
    });
  }

  const failures = results.filter((r) => !r.ok);
  const landed = results.filter((r) => r.ok && r.mode !== 'noop');
  const failedAttachments = results.flatMap((r) => r.attachments.filter((a) => !a.ok));
  const attached = results.flatMap((r) => r.attachments.filter((a) => a.ok)).length;

  const parts: string[] = [];
  if (landed.length > 0) {
    parts.push(`${landed.length} change${landed.length === 1 ? '' : 's'} at ${property.name}`);
  }
  if (attached > 0) parts.push(`attached ${attached} photo${attached === 1 ? '' : 's'}`);
  const noops = results.filter((r) => r.mode === 'noop').length;
  if (noops > 0) parts.push(`${noops} already correct`);
  if (failures.length > 0) {
    parts.push(`${failures.length} could not be applied`);
  }
  if (failedAttachments.length > 0) {
    parts.push(`${failedAttachments.length} photo${failedAttachments.length === 1 ? '' : 's'} failed`);
  }

  return {
    ok: failures.length === 0 && failedAttachments.length === 0,
    partial: (failures.length > 0 || failedAttachments.length > 0) && landed.length > 0,
    property: { property_id: property.id, name: property.name },
    results,
    failures,
    drift,
    summary: parts.length > 0 ? parts.join(', ') : `Nothing to change at ${property.name}`,
  };
}

export async function commitPropertyKnowledgeOperations(
  rawInput: unknown,
): Promise<
  | { ok: true; result: PropertyKnowledgeOperationsCommitResult }
  | { ok: false; error: PropertyKnowledgeWriteError }
> {
  const preview = await previewPropertyKnowledgeOperations(rawInput);
  if (!preview.ok) return { ok: false, error: preview.error };
  const supabase = getSupabaseServer();
  const prop = await loadPropertyForKnowledgeWrite(supabase, preview.canonicalInput.property_id);
  if (!prop.ok) return { ok: false, error: prop.error };
  const result = await commitPropertyKnowledgeOperationsFor(
    supabase,
    prop.property,
    preview.canonicalInput,
    preview.plan,
  );
  return { ok: true, result };
}
