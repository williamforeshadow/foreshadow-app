import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  logPropertyKnowledgeActivity,
  type KnowledgeSource,
} from '@/lib/logPropertyKnowledgeActivity';
import {
  CARD_SCOPES,
  CARD_TAGS,
  ROOM_TYPES,
  defaultRoomTitle,
  normalizeTagData,
  type CardScope,
  type CardTag,
  type RoomType,
} from '@/lib/propertyCards';

const ACCESS_FIELDS = [
  'guest_code',
  'cleaner_code',
  'backup_code',
  'code_rotation_notes',
  'outer_door_code',
  'gate_code',
  'elevator_notes',
  'unit_door_code',
  'key_location',
  'lockbox_code',
  'parking_spot_number',
  'parking_type',
  'parking_instructions',
] as const;

const CONNECTIVITY_FIELDS = [
  'wifi_ssid',
  'wifi_password',
  'wifi_router_location',
] as const;

const DOCUMENT_TAGS = ['lease', 'appliance_manual', 'inspection', 'insurance', 'other'] as const;
const PARKING_TYPES = ['assigned', 'street', 'garage', 'other'] as const;

const nullableString = z.union([z.string(), z.null()]);
const sourceSchema = z.enum(['web', 'agent_slack', 'agent_web', 'system']).optional();

const accessFieldsSchema = z
  .object(Object.fromEntries(ACCESS_FIELDS.map((f) => [f, nullableString.optional()])))
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'at least one access field is required');

const connectivityFieldsSchema = z
  .object(Object.fromEntries(CONNECTIVITY_FIELDS.map((f) => [f, nullableString.optional()])))
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'at least one connectivity field is required');

const roomFieldsSchema = z
  .object({
    scope: z.enum(['interior', 'exterior']).optional(),
    type: z.enum(ROOM_TYPES as [RoomType, ...RoomType[]]).optional(),
    title: nullableString.optional(),
    notes: nullableString.optional(),
    sort_order: z.number().finite().optional(),
  })
  .strict();

const cardFieldsSchema = z
  .object({
    room_id: z.string().uuid().optional(),
    tag: z.enum(CARD_TAGS as [CardTag, ...CardTag[]]).optional(),
    title: nullableString.optional(),
    body: nullableString.optional(),
    tag_data: z.record(z.string(), z.unknown()).optional(),
    sort_order: z.number().finite().optional(),
  })
  .strict();

const documentFieldsSchema = z
  .object({
    title: z.string().optional(),
    notes: nullableString.optional(),
    tag: z.enum(DOCUMENT_TAGS).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'at least one document field is required');

export const propertyKnowledgeWriteInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('upsert_access'),
    property_id: z.string().uuid(),
    fields: accessFieldsSchema,
    actor_user_id: z.string().nullable().optional(),
    source: sourceSchema,
  }),
  z.object({
    action: z.literal('upsert_connectivity'),
    property_id: z.string().uuid(),
    fields: connectivityFieldsSchema,
    actor_user_id: z.string().nullable().optional(),
    source: sourceSchema,
  }),
  z.object({
    action: z.literal('upsert_room'),
    property_id: z.string().uuid(),
    room_id: z.string().uuid().optional(),
    fields: roomFieldsSchema,
    actor_user_id: z.string().nullable().optional(),
    source: sourceSchema,
  }),
  z.object({
    action: z.literal('delete_room'),
    property_id: z.string().uuid(),
    room_id: z.string().uuid(),
    actor_user_id: z.string().nullable().optional(),
    source: sourceSchema,
  }),
  z.object({
    action: z.literal('upsert_card'),
    property_id: z.string().uuid(),
    card_id: z.string().uuid().optional(),
    fields: cardFieldsSchema,
    actor_user_id: z.string().nullable().optional(),
    source: sourceSchema,
  }),
  z.object({
    action: z.literal('delete_card'),
    property_id: z.string().uuid(),
    card_id: z.string().uuid(),
    actor_user_id: z.string().nullable().optional(),
    source: sourceSchema,
  }),
  z.object({
    action: z.literal('update_document'),
    property_id: z.string().uuid(),
    document_id: z.string().uuid(),
    fields: documentFieldsSchema,
    actor_user_id: z.string().nullable().optional(),
    source: sourceSchema,
  }),
  z.object({
    action: z.literal('delete_document'),
    property_id: z.string().uuid(),
    document_id: z.string().uuid(),
    actor_user_id: z.string().nullable().optional(),
    source: sourceSchema,
  }),
]);

export type PropertyKnowledgeWriteInput = z.infer<typeof propertyKnowledgeWriteInputSchema>;

export type PropertyKnowledgeWriteErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'db_error';

export interface PropertyKnowledgeWriteError {
  code: PropertyKnowledgeWriteErrorCode;
  message: string;
  field?: string;
}

export interface KnowledgeChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface PropertyKnowledgeWritePlan {
  action: PropertyKnowledgeWriteInput['action'];
  mode: 'create' | 'update' | 'delete';
  property: { property_id: string; name: string };
  subject: { type: string; id: string | null; label: string };
  changes: KnowledgeChange[];
  summary: string;
}

export type PreviewPropertyKnowledgeWriteResult =
  | { ok: true; plan: PropertyKnowledgeWritePlan; canonicalInput: PropertyKnowledgeWriteInput }
  | { ok: false; error: PropertyKnowledgeWriteError };

export type PropertyKnowledgeWriteResult =
  | { ok: true; plan: PropertyKnowledgeWritePlan; row: unknown }
  | { ok: false; error: PropertyKnowledgeWriteError };

type Supabase = ReturnType<typeof getSupabaseServer>;

function normalizeNullable(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

function normalizePatch(
  fields: Record<string, unknown>,
  allowed: readonly string[],
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const field of allowed) {
    if (field in fields) out[field] = normalizeNullable(fields[field] as string | null | undefined);
  }
  return out;
}

function diffFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  fields: readonly string[],
): KnowledgeChange[] {
  return fields
    .map((field) => ({
      field,
      before: before ? before[field] ?? null : null,
      after: after[field] ?? null,
    }))
    .filter((c) => c.before !== c.after);
}

function jsonChanged(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
}

async function loadProperty(
  supabase: Supabase,
  propertyId: string,
): Promise<{ ok: true; property: { id: string; name: string } } | { ok: false; error: PropertyKnowledgeWriteError }> {
  const { data, error } = await supabase
    .from('properties')
    .select('id, name')
    .eq('id', propertyId)
    .maybeSingle();
  if (error) return { ok: false, error: { code: 'db_error', message: error.message, field: 'property_id' } };
  if (!data) {
    return {
      ok: false,
      error: { code: 'not_found', message: `No property found with id ${propertyId}.`, field: 'property_id' },
    };
  }
  return { ok: true, property: data as { id: string; name: string } };
}

function source(input: PropertyKnowledgeWriteInput): KnowledgeSource {
  return (input.source ?? 'agent_web') as KnowledgeSource;
}

async function planSingleton(
  supabase: Supabase,
  input: Extract<PropertyKnowledgeWriteInput, { action: 'upsert_access' | 'upsert_connectivity' }>,
  property: { id: string; name: string },
): Promise<PreviewPropertyKnowledgeWriteResult> {
  const isAccess = input.action === 'upsert_access';
  const table = isAccess ? 'property_access' : 'property_connectivity';
  const allowed = isAccess ? ACCESS_FIELDS : CONNECTIVITY_FIELDS;
  const label = isAccess ? 'Access info' : 'Connectivity info';
  const patch = normalizePatch(input.fields, allowed);
  if ('parking_type' in patch && patch.parking_type && !PARKING_TYPES.includes(patch.parking_type as (typeof PARKING_TYPES)[number])) {
    return { ok: false, error: { code: 'invalid_input', message: 'parking_type must be one of: assigned, street, garage, other', field: 'fields.parking_type' } };
  }
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('property_id', input.property_id)
    .maybeSingle();
  if (error) return { ok: false, error: { code: 'db_error', message: error.message } };
  const before = (data as Record<string, unknown> | null) ?? null;
  const after = { ...(before ?? {}), property_id: input.property_id, ...patch };
  const changes = diffFields(before, after, Object.keys(patch));
  return {
    ok: true,
    plan: {
      action: input.action,
      mode: before ? 'update' : 'create',
      property: { property_id: property.id, name: property.name },
      subject: { type: isAccess ? 'access' : 'connectivity', id: (before?.id as string | undefined) ?? null, label },
      changes,
      summary: `${before ? 'Update' : 'Create'} ${label.toLowerCase()} for ${property.name}`,
    },
    canonicalInput: input,
  };
}

async function commitSingleton(
  supabase: Supabase,
  input: Extract<PropertyKnowledgeWriteInput, { action: 'upsert_access' | 'upsert_connectivity' }>,
  plan: PropertyKnowledgeWritePlan,
): Promise<PropertyKnowledgeWriteResult> {
  const isAccess = input.action === 'upsert_access';
  const table = isAccess ? 'property_access' : 'property_connectivity';
  const allowed = isAccess ? ACCESS_FIELDS : CONNECTIVITY_FIELDS;
  const label = isAccess ? 'Access info' : 'Connectivity info';
  const patch = normalizePatch(input.fields, allowed);

  const { data: before } = await supabase
    .from(table)
    .select('*')
    .eq('property_id', input.property_id)
    .maybeSingle();
  const payload: Record<string, unknown> = {
    property_id: input.property_id,
    ...patch,
    updated_at: new Date().toISOString(),
    updated_by_user_id: input.actor_user_id ?? null,
  };
  if (!before) payload.created_by_user_id = input.actor_user_id ?? null;

  const { data, error } = await supabase
    .from(table)
    .upsert(payload, { onConflict: 'property_id' })
    .select('*')
    .maybeSingle();
  if (error || !data) return { ok: false, error: { code: 'db_error', message: error?.message ?? 'upsert returned no row' } };

  const changes = diffFields((before as Record<string, unknown> | null) ?? null, data as Record<string, unknown>, Object.keys(patch));
  if (changes.length > 0 || !before) {
    await logPropertyKnowledgeActivity({
      property_id: input.property_id,
      user_id: input.actor_user_id ?? null,
      resource_type: isAccess ? 'access' : 'connectivity',
      resource_id: (data as { id?: string }).id ?? null,
      action: before ? 'update' : 'create',
      changes: before ? { kind: 'diff', entries: changes } : { kind: 'snapshot', row: patch },
      subject_label: label,
      source: source(input),
    });
  }

  return { ok: true, plan: { ...plan, changes }, row: data };
}

async function planRoom(
  supabase: Supabase,
  input: Extract<PropertyKnowledgeWriteInput, { action: 'upsert_room' | 'delete_room' }>,
  property: { id: string; name: string },
): Promise<PreviewPropertyKnowledgeWriteResult> {
  if (input.action === 'delete_room') {
    const { data, error } = await supabase
      .from('property_rooms')
      .select('id, scope, type, title, notes')
      .eq('id', input.room_id)
      .eq('property_id', input.property_id)
      .maybeSingle();
    if (error) return { ok: false, error: { code: 'db_error', message: error.message, field: 'room_id' } };
    if (!data) return { ok: false, error: { code: 'not_found', message: 'Room not found.', field: 'room_id' } };
    const row = data as Record<string, unknown>;
    return {
      ok: true,
      plan: {
        action: input.action,
        mode: 'delete',
        property: { property_id: property.id, name: property.name },
        subject: { type: 'room', id: input.room_id, label: (row.title as string | null) || `${row.scope} room` },
        changes: [{ field: 'delete', before: row, after: null }],
        summary: `Delete room "${(row.title as string | null) || row.type}" from ${property.name}`,
      },
      canonicalInput: input,
    };
  }

  const fields = input.fields;
  if (!input.room_id && (!fields.scope || !fields.type)) {
    return { ok: false, error: { code: 'invalid_input', message: 'scope and type are required when creating a room.', field: 'fields.scope' } };
  }
  if (fields.scope && !CARD_SCOPES.has(fields.scope as CardScope)) {
    return { ok: false, error: { code: 'invalid_input', message: 'Invalid room scope.', field: 'fields.scope' } };
  }
  const before = input.room_id
    ? await supabase.from('property_rooms').select('id, scope, type, title, notes, sort_order').eq('id', input.room_id).eq('property_id', input.property_id).maybeSingle()
    : null;
  if (before?.error) return { ok: false, error: { code: 'db_error', message: before.error.message } };
  if (input.room_id && !before?.data) return { ok: false, error: { code: 'not_found', message: 'Room not found.', field: 'room_id' } };
  const prev = (before?.data as Record<string, unknown> | null) ?? null;
  const title = normalizeNullable(fields.title) || (fields.type ? defaultRoomTitle(fields.type) : (prev?.title as string));
  const after: Record<string, unknown> = {
    ...(prev ?? {}),
    property_id: input.property_id,
    ...(fields.scope ? { scope: fields.scope } : {}),
    ...(fields.type ? { type: fields.type } : {}),
    ...(title ? { title } : {}),
    ...('notes' in fields ? { notes: normalizeNullable(fields.notes) } : {}),
    ...(fields.sort_order !== undefined ? { sort_order: Math.trunc(fields.sort_order) } : {}),
  };
  const changes = diffFields(prev, after, ['scope', 'type', 'title', 'notes', 'sort_order']);
  return {
    ok: true,
    plan: {
      action: input.action,
      mode: input.room_id ? 'update' : 'create',
      property: { property_id: property.id, name: property.name },
      subject: { type: 'room', id: input.room_id ?? null, label: (after.title as string) || 'Room' },
      changes,
      summary: `${input.room_id ? 'Update' : 'Create'} ${(after.scope as string) || ''} room "${(after.title as string) || ''}" for ${property.name}`,
    },
    canonicalInput: input,
  };
}

async function commitRoom(
  supabase: Supabase,
  input: Extract<PropertyKnowledgeWriteInput, { action: 'upsert_room' | 'delete_room' }>,
  plan: PropertyKnowledgeWritePlan,
): Promise<PropertyKnowledgeWriteResult> {
  if (input.action === 'delete_room') {
    const { data: room } = await supabase.from('property_rooms').select('id, scope, type, title, notes').eq('id', input.room_id).eq('property_id', input.property_id).maybeSingle();
    if (!room) return { ok: false, error: { code: 'not_found', message: 'Room not found.', field: 'room_id' } };
    const [{ data: roomPhotos }, { data: cards }] = await Promise.all([
      supabase.from('property_room_photos').select('storage_path').eq('room_id', input.room_id),
      supabase.from('property_cards').select('id').eq('room_id', input.room_id),
    ]);
    const cardIds = ((cards ?? []) as Array<{ id: string }>).map((c) => c.id);
    let cardPhotos: Array<{ storage_path: string | null }> = [];
    if (cardIds.length > 0) {
      const res = await supabase.from('property_card_photos').select('storage_path').in('card_id', cardIds);
      cardPhotos = (res.data ?? []) as Array<{ storage_path: string | null }>;
    }
    const { error } = await supabase.from('property_rooms').delete().eq('id', input.room_id).eq('property_id', input.property_id);
    if (error) return { ok: false, error: { code: 'db_error', message: error.message } };
    const paths = [...((roomPhotos ?? []) as Array<{ storage_path: string | null }>), ...cardPhotos].map((p) => p.storage_path).filter((p): p is string => !!p);
    if (paths.length > 0) await supabase.storage.from('property-photos').remove(paths);
    const row = room as Record<string, unknown>;
    await logPropertyKnowledgeActivity({
      property_id: input.property_id,
      user_id: input.actor_user_id ?? null,
      resource_type: 'room',
      resource_id: null,
      action: 'delete',
      changes: { kind: 'snapshot', row: { scope: row.scope, type: row.type, title: row.title, notes: row.notes } },
      subject_label: (row.title as string | null) || `${row.scope} room`,
      source: source(input),
    });
    return { ok: true, plan, row };
  }

  const fields = input.fields;
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by_user_id: input.actor_user_id ?? null,
  };
  if (fields.type) payload.type = fields.type;
  if (fields.title !== undefined || fields.type) payload.title = normalizeNullable(fields.title) || (fields.type ? defaultRoomTitle(fields.type) : undefined);
  if (fields.notes !== undefined) payload.notes = normalizeNullable(fields.notes);
  if (fields.sort_order !== undefined) payload.sort_order = Math.trunc(fields.sort_order);
  if (!input.room_id) {
    payload.property_id = input.property_id;
    payload.scope = fields.scope;
    payload.created_by_user_id = input.actor_user_id ?? null;
    if (payload.sort_order === undefined) payload.sort_order = 0;
    const { data, error } = await supabase.from('property_rooms').insert(payload).select('*').maybeSingle();
    if (error || !data) return { ok: false, error: { code: 'db_error', message: error?.message ?? 'insert returned no row' } };
    await logPropertyKnowledgeActivity({
      property_id: input.property_id,
      user_id: input.actor_user_id ?? null,
      resource_type: 'room',
      resource_id: (data as { id: string }).id,
      action: 'create',
      changes: { kind: 'snapshot', row: { scope: data.scope, type: data.type, title: data.title, notes: data.notes } },
      subject_label: data.title || `${data.scope} room`,
      source: source(input),
    });
    return { ok: true, plan, row: data };
  }
  const { data: before } = await supabase.from('property_rooms').select('id, title, type, notes, sort_order').eq('id', input.room_id).eq('property_id', input.property_id).maybeSingle();
  const { data, error } = await supabase.from('property_rooms').update(payload).eq('id', input.room_id).eq('property_id', input.property_id).select('*').maybeSingle();
  if (error || !data) return { ok: false, error: { code: error ? 'db_error' : 'not_found', message: error?.message ?? 'Room not found.', field: 'room_id' } };
  const changes = diffFields((before as Record<string, unknown> | null) ?? null, data as Record<string, unknown>, ['title', 'type', 'notes', 'sort_order']);
  if (changes.length > 0) {
    await logPropertyKnowledgeActivity({
      property_id: input.property_id,
      user_id: input.actor_user_id ?? null,
      resource_type: 'room',
      resource_id: data.id,
      action: 'update',
      changes: { kind: 'diff', entries: changes },
      subject_label: data.title || 'Room',
      source: source(input),
    });
  }
  return { ok: true, plan: { ...plan, changes }, row: data };
}

async function planCard(
  supabase: Supabase,
  input: Extract<PropertyKnowledgeWriteInput, { action: 'upsert_card' | 'delete_card' }>,
  property: { id: string; name: string },
): Promise<PreviewPropertyKnowledgeWriteResult> {
  if (input.action === 'delete_card') {
    const { data, error } = await supabase.from('property_cards').select('id, room_id, tag, title, body').eq('id', input.card_id).eq('property_id', input.property_id).maybeSingle();
    if (error) return { ok: false, error: { code: 'db_error', message: error.message } };
    if (!data) return { ok: false, error: { code: 'not_found', message: 'Card not found.', field: 'card_id' } };
    const row = data as Record<string, unknown>;
    return { ok: true, plan: { action: input.action, mode: 'delete', property: { property_id: property.id, name: property.name }, subject: { type: 'card', id: input.card_id, label: (row.title as string) || `${row.tag} card` }, changes: [{ field: 'delete', before: row, after: null }], summary: `Delete card "${(row.title as string) || row.tag}" from ${property.name}` }, canonicalInput: input };
  }
  const fields = input.fields;
  if (!input.card_id && (!fields.room_id || !fields.tag || !fields.title)) {
    return { ok: false, error: { code: 'invalid_input', message: 'room_id, tag, and title are required when creating a card.', field: 'fields.room_id' } };
  }
  const prevRes = input.card_id ? await supabase.from('property_cards').select('id, room_id, tag, title, body, tag_data, sort_order').eq('id', input.card_id).eq('property_id', input.property_id).maybeSingle() : null;
  if (prevRes?.error) return { ok: false, error: { code: 'db_error', message: prevRes.error.message } };
  if (input.card_id && !prevRes?.data) return { ok: false, error: { code: 'not_found', message: 'Card not found.', field: 'card_id' } };
  const roomId = fields.room_id ?? ((prevRes?.data as { room_id?: string } | null)?.room_id);
  if (roomId) {
    const { data: room, error } = await supabase.from('property_rooms').select('id, scope').eq('id', roomId).eq('property_id', input.property_id).maybeSingle();
    if (error) return { ok: false, error: { code: 'db_error', message: error.message, field: 'fields.room_id' } };
    if (!room) return { ok: false, error: { code: 'not_found', message: 'Room not found.', field: 'fields.room_id' } };
  }
  const prev = (prevRes?.data as Record<string, unknown> | null) ?? null;
  const tag = fields.tag ?? (prev?.tag as CardTag);
  const after: Record<string, unknown> = {
    ...(prev ?? {}),
    room_id: roomId,
    tag,
    ...(fields.title !== undefined ? { title: normalizeNullable(fields.title) } : {}),
    ...(fields.body !== undefined ? { body: normalizeNullable(fields.body) } : {}),
    ...(fields.tag_data !== undefined ? { tag_data: normalizeTagData(tag, fields.tag_data) } : {}),
    ...(fields.sort_order !== undefined ? { sort_order: Math.trunc(fields.sort_order) } : {}),
  };
  if (!after.title) return { ok: false, error: { code: 'invalid_input', message: 'title cannot be empty.', field: 'fields.title' } };
  const changes = ['room_id', 'tag', 'title', 'body', 'tag_data', 'sort_order']
    .map((field) => ({ field, before: prev ? prev[field] ?? null : null, after: (after as Record<string, unknown>)[field] ?? null }))
    .filter((c) => c.field === 'tag_data' ? jsonChanged(c.before, c.after) : c.before !== c.after);
  return { ok: true, plan: { action: input.action, mode: input.card_id ? 'update' : 'create', property: { property_id: property.id, name: property.name }, subject: { type: 'card', id: input.card_id ?? null, label: after.title as string }, changes, summary: `${input.card_id ? 'Update' : 'Create'} card "${after.title as string}" for ${property.name}` }, canonicalInput: input };
}

async function commitCard(
  supabase: Supabase,
  input: Extract<PropertyKnowledgeWriteInput, { action: 'upsert_card' | 'delete_card' }>,
  plan: PropertyKnowledgeWritePlan,
): Promise<PropertyKnowledgeWriteResult> {
  if (input.action === 'delete_card') {
    const [beforeRes, photosRes] = await Promise.all([
      supabase.from('property_cards').select('id, room_id, tag, title, body').eq('id', input.card_id).eq('property_id', input.property_id).maybeSingle(),
      supabase.from('property_card_photos').select('storage_path').eq('card_id', input.card_id),
    ]);
    if (!beforeRes.data) return { ok: false, error: { code: 'not_found', message: 'Card not found.', field: 'card_id' } };
    const { error } = await supabase.from('property_cards').delete().eq('id', input.card_id).eq('property_id', input.property_id);
    if (error) return { ok: false, error: { code: 'db_error', message: error.message } };
    const paths = ((photosRes.data ?? []) as Array<{ storage_path: string | null }>).map((p) => p.storage_path).filter((p): p is string => !!p);
    if (paths.length > 0) await supabase.storage.from('property-photos').remove(paths);
    const row = beforeRes.data as Record<string, unknown>;
    await logPropertyKnowledgeActivity({ property_id: input.property_id, user_id: input.actor_user_id ?? null, resource_type: 'card', resource_id: null, action: 'delete', changes: { kind: 'snapshot', row: { room_id: row.room_id, tag: row.tag, title: row.title, body: row.body } }, subject_label: (row.title as string | null) || `${row.tag} card`, source: source(input) });
    return { ok: true, plan, row };
  }
  const fields = input.fields;
  const tag = fields.tag;
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by_user_id: input.actor_user_id ?? null };
  if (fields.title !== undefined) payload.title = normalizeNullable(fields.title);
  if (fields.body !== undefined) payload.body = normalizeNullable(fields.body);
  if (fields.tag) payload.tag = fields.tag;
  if (fields.sort_order !== undefined) payload.sort_order = Math.trunc(fields.sort_order);
  if (fields.tag_data !== undefined) {
    const effectiveTag = tag ?? (await supabase.from('property_cards').select('tag').eq('id', input.card_id ?? '').eq('property_id', input.property_id).maybeSingle()).data?.tag;
    payload.tag_data = normalizeTagData(effectiveTag as CardTag, fields.tag_data);
  }
  if (fields.room_id) {
    const { data: room } = await supabase.from('property_rooms').select('id, scope').eq('id', fields.room_id).eq('property_id', input.property_id).maybeSingle();
    if (!room) return { ok: false, error: { code: 'not_found', message: 'Room not found.', field: 'fields.room_id' } };
    payload.room_id = fields.room_id;
    payload.scope = room.scope as CardScope;
  }
  if (!input.card_id) {
    if (!fields.room_id || !fields.tag || !fields.title) return { ok: false, error: { code: 'invalid_input', message: 'room_id, tag, and title are required when creating a card.' } };
    payload.property_id = input.property_id;
    payload.created_by_user_id = input.actor_user_id ?? null;
    if (payload.sort_order === undefined) payload.sort_order = 0;
    if (payload.tag_data === undefined) payload.tag_data = normalizeTagData(fields.tag, fields.tag_data);
    const { data, error } = await supabase.from('property_cards').insert(payload).select('*').maybeSingle();
    if (error || !data) return { ok: false, error: { code: 'db_error', message: error?.message ?? 'insert returned no row' } };
    await logPropertyKnowledgeActivity({ property_id: input.property_id, user_id: input.actor_user_id ?? null, resource_type: 'card', resource_id: data.id, action: 'create', changes: { kind: 'snapshot', row: { room_id: data.room_id, tag: data.tag, title: data.title, body: data.body } }, subject_label: data.title || `${data.tag} card`, source: source(input) });
    return { ok: true, plan, row: data };
  }
  const { data: before } = await supabase.from('property_cards').select('id, room_id, tag, title, body, tag_data, sort_order').eq('id', input.card_id).eq('property_id', input.property_id).maybeSingle();
  const { data, error } = await supabase.from('property_cards').update(payload).eq('id', input.card_id).eq('property_id', input.property_id).select('*').maybeSingle();
  if (error || !data) return { ok: false, error: { code: error ? 'db_error' : 'not_found', message: error?.message ?? 'Card not found.', field: 'card_id' } };
  const changes = ['room_id', 'tag', 'title', 'body', 'tag_data', 'sort_order']
    .map((field) => ({ field, before: before ? (before as Record<string, unknown>)[field] ?? null : null, after: (data as Record<string, unknown>)[field] ?? null }))
    .filter((c) => c.field === 'tag_data' ? jsonChanged(c.before, c.after) : c.before !== c.after);
  if (changes.length > 0) await logPropertyKnowledgeActivity({ property_id: input.property_id, user_id: input.actor_user_id ?? null, resource_type: 'card', resource_id: data.id, action: 'update', changes: { kind: 'diff', entries: changes }, subject_label: data.title || `${data.tag} card`, source: source(input) });
  return { ok: true, plan: { ...plan, changes }, row: data };
}

async function planDocument(
  supabase: Supabase,
  input: Extract<PropertyKnowledgeWriteInput, { action: 'update_document' | 'delete_document' }>,
  property: { id: string; name: string },
): Promise<PreviewPropertyKnowledgeWriteResult> {
  const { data, error } = await supabase
    .from('property_documents')
    .select('id, tag, title, notes, storage_path, original_filename, size_bytes')
    .eq('id', input.document_id)
    .eq('property_id', input.property_id)
    .maybeSingle();
  if (error) return { ok: false, error: { code: 'db_error', message: error.message } };
  if (!data) return { ok: false, error: { code: 'not_found', message: 'Document not found.', field: 'document_id' } };
  const before = data as Record<string, unknown>;
  if (input.action === 'delete_document') {
    return { ok: true, plan: { action: input.action, mode: 'delete', property: { property_id: property.id, name: property.name }, subject: { type: 'document', id: input.document_id, label: (before.title as string | null) || (before.original_filename as string | null) || `${before.tag} document` }, changes: [{ field: 'delete', before, after: null }], summary: `Delete document "${(before.title as string | null) || before.original_filename}" from ${property.name}` }, canonicalInput: input };
  }
  const after: Record<string, unknown> = {
    ...before,
    ...('title' in input.fields ? { title: normalizeNullable(input.fields.title) } : {}),
    ...('notes' in input.fields ? { notes: normalizeNullable(input.fields.notes) } : {}),
    ...(input.fields.tag ? { tag: input.fields.tag } : {}),
  };
  if (!after.title) return { ok: false, error: { code: 'invalid_input', message: 'title cannot be empty.', field: 'fields.title' } };
  const changes = diffFields(before, after, ['tag', 'title', 'notes']);
  return { ok: true, plan: { action: input.action, mode: 'update', property: { property_id: property.id, name: property.name }, subject: { type: 'document', id: input.document_id, label: (after.title as string) || (after.original_filename as string) }, changes, summary: `Update document "${(after.title as string) || after.original_filename}" for ${property.name}` }, canonicalInput: input };
}

async function commitDocument(
  supabase: Supabase,
  input: Extract<PropertyKnowledgeWriteInput, { action: 'update_document' | 'delete_document' }>,
  plan: PropertyKnowledgeWritePlan,
): Promise<PropertyKnowledgeWriteResult> {
  if (input.action === 'delete_document') {
    const { data: doc } = await supabase.from('property_documents').select('id, storage_path, tag, title, notes, original_filename, size_bytes').eq('id', input.document_id).eq('property_id', input.property_id).maybeSingle();
    if (!doc) return { ok: false, error: { code: 'not_found', message: 'Document not found.', field: 'document_id' } };
    const { error } = await supabase.from('property_documents').delete().eq('id', input.document_id).eq('property_id', input.property_id);
    if (error) return { ok: false, error: { code: 'db_error', message: error.message } };
    if (doc.storage_path) await supabase.storage.from('property-documents').remove([doc.storage_path]);
    await logPropertyKnowledgeActivity({ property_id: input.property_id, user_id: input.actor_user_id ?? null, resource_type: 'document', resource_id: null, action: 'delete', changes: { kind: 'snapshot', row: { tag: doc.tag, title: doc.title, notes: doc.notes, original_filename: doc.original_filename, size_bytes: doc.size_bytes } }, subject_label: doc.title || doc.original_filename || `${doc.tag} document`, source: source(input) });
    return { ok: true, plan, row: doc };
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by_user_id: input.actor_user_id ?? null };
  if ('title' in input.fields) patch.title = normalizeNullable(input.fields.title);
  if ('notes' in input.fields) patch.notes = normalizeNullable(input.fields.notes);
  if (input.fields.tag) patch.tag = input.fields.tag;
  const { data: before } = await supabase.from('property_documents').select('id, tag, title, notes, original_filename').eq('id', input.document_id).eq('property_id', input.property_id).maybeSingle();
  const { data, error } = await supabase.from('property_documents').update(patch).eq('id', input.document_id).eq('property_id', input.property_id).select('*').maybeSingle();
  if (error || !data) return { ok: false, error: { code: error ? 'db_error' : 'not_found', message: error?.message ?? 'Document not found.', field: 'document_id' } };
  const changes = diffFields((before as Record<string, unknown> | null) ?? null, data as Record<string, unknown>, ['tag', 'title', 'notes']);
  if (changes.length > 0) await logPropertyKnowledgeActivity({ property_id: input.property_id, user_id: input.actor_user_id ?? null, resource_type: 'document', resource_id: data.id, action: 'update', changes: { kind: 'diff', entries: changes }, subject_label: data.title || data.original_filename || `${data.tag} document`, source: source(input) });
  return { ok: true, plan: { ...plan, changes }, row: data };
}

export async function previewPropertyKnowledgeWrite(
  rawInput: unknown,
): Promise<PreviewPropertyKnowledgeWriteResult> {
  const parsed = propertyKnowledgeWriteInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: { code: 'invalid_input', message: first?.message ?? 'invalid input', field: first?.path.join('.') || undefined } };
  }
  const input = parsed.data;
  const supabase = getSupabaseServer();
  const prop = await loadProperty(supabase, input.property_id);
  if (!prop.ok) return { ok: false, error: prop.error };
  if (input.action === 'upsert_access' || input.action === 'upsert_connectivity') return planSingleton(supabase, input, prop.property);
  if (input.action === 'upsert_room' || input.action === 'delete_room') return planRoom(supabase, input, prop.property);
  if (input.action === 'upsert_card' || input.action === 'delete_card') return planCard(supabase, input, prop.property);
  return planDocument(supabase, input, prop.property);
}

export async function commitPropertyKnowledgeWrite(
  rawInput: unknown,
): Promise<PropertyKnowledgeWriteResult> {
  const preview = await previewPropertyKnowledgeWrite(rawInput);
  if (!preview.ok) return { ok: false, error: preview.error };
  const input = preview.canonicalInput;
  const supabase = getSupabaseServer();
  if (input.action === 'upsert_access' || input.action === 'upsert_connectivity') return commitSingleton(supabase, input, preview.plan);
  if (input.action === 'upsert_room' || input.action === 'delete_room') return commitRoom(supabase, input, preview.plan);
  if (input.action === 'upsert_card' || input.action === 'delete_card') return commitCard(supabase, input, preview.plan);
  return commitDocument(supabase, input, preview.plan);
}
