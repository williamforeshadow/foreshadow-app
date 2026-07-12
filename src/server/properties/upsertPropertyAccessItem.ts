import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  logPropertyKnowledgeActivity,
  type KnowledgeSource,
} from '@/lib/logPropertyKnowledgeActivity';
import {
  normalizeAccessType,
  defaultAccessLabel,
  accessValueKind,
  isParkingType,
} from '@/lib/propertyAccess';

// Service: create OR update a property access item in one shape (mirrors
// upsertPropertyContact). Disambiguation is by item_id presence:
//   - item_id absent  → INSERT (type required; label defaults from the type,
//     but a custom `other` item requires a label)
//   - item_id present → UPDATE (only the fields you pass change)
// The one per-type rule: a `parking_type` item's value must be one of the
// parking enum. value/notes are optional and empty/whitespace becomes NULL.

const inputSchema = z
  .object({
    property_id: z.string().uuid(),
    item_id: z.string().uuid().optional(),
    type: z.string().optional(),
    label: z.string().nullable().optional(),
    value: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    sort_order: z.number().finite().optional(),
    actor_user_id: z.string().nullable().optional(),
    source: z.enum(['web', 'agent_slack', 'agent_web', 'system']).optional().default('web'),
  })
  .strict();

export type UpsertAccessItemInput = z.infer<typeof inputSchema>;

export type AccessItemErrorCode = 'invalid_input' | 'not_found' | 'db_error';
export interface AccessItemError {
  code: AccessItemErrorCode;
  message: string;
  field?: string;
}

export interface PropertyAccessItemRow {
  id: string;
  property_id: string;
  type: string;
  label: string;
  value: string | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type UpsertAccessItemResult =
  | {
      ok: true;
      item: PropertyAccessItemRow;
      mode: 'create' | 'update';
      changes?: Array<{ field: string; before: unknown; after: unknown }>;
    }
  | { ok: false; error: AccessItemError };

type Supabase = ReturnType<typeof getSupabaseServer>;

const ACCESS_ITEM_COLUMNS =
  'id, property_id, type, label, value, notes, sort_order, created_at, updated_at';

function nullable(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

function validateValue(type: string, value: string | null): AccessItemError | null {
  if (value != null && accessValueKind(type) === 'parking_type' && !isParkingType(value)) {
    return {
      code: 'invalid_input',
      message: 'parking_type value must be one of: assigned, street, garage, other',
      field: 'value',
    };
  }
  return null;
}

async function loadProperty(
  supabase: Supabase,
  propertyId: string,
): Promise<{ ok: true } | { ok: false; error: AccessItemError }> {
  const { data, error } = await supabase
    .from('properties')
    .select('id')
    .eq('id', propertyId)
    .maybeSingle();
  if (error) return { ok: false, error: { code: 'db_error', message: error.message, field: 'property_id' } };
  if (!data)
    return {
      ok: false,
      error: { code: 'not_found', message: `No property found with id ${propertyId}.`, field: 'property_id' },
    };
  return { ok: true };
}

async function loadItem(
  supabase: Supabase,
  propertyId: string,
  itemId: string,
): Promise<{ ok: true; item: PropertyAccessItemRow } | { ok: false; error: AccessItemError }> {
  const { data, error } = await supabase
    .from('property_access_items')
    .select(ACCESS_ITEM_COLUMNS)
    .eq('id', itemId)
    .eq('property_id', propertyId)
    .maybeSingle();
  if (error) return { ok: false, error: { code: 'db_error', message: error.message, field: 'item_id' } };
  if (!data)
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: `No access item found with id ${itemId} on property ${propertyId}.`,
        field: 'item_id',
      },
    };
  return { ok: true, item: data as PropertyAccessItemRow };
}

function subjectLabel(row: { label: string; type: string }): string {
  return row.label || row.type || 'access item';
}

export async function upsertPropertyAccessItem(rawInput: unknown): Promise<UpsertAccessItemResult> {
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: { code: 'invalid_input', message: first?.message ?? 'invalid input', field: first?.path?.join('.') || undefined },
    };
  }
  const input = parsed.data;
  const supabase = getSupabaseServer();

  const propLookup = await loadProperty(supabase, input.property_id);
  if (!propLookup.ok) return { ok: false, error: propLookup.error };

  // ----- CREATE -----------------------------------------------------
  if (!input.item_id) {
    const type = normalizeAccessType(input.type);
    const label = nullable(input.label) ?? defaultAccessLabel(type);
    if (!label) {
      return {
        ok: false,
        error: { code: 'invalid_input', message: 'label is required for a custom (Other) access item.', field: 'label' },
      };
    }
    const value = nullable(input.value);
    const verr = validateValue(type, value);
    if (verr) return { ok: false, error: verr };

    const payload = {
      property_id: input.property_id,
      type,
      label,
      value,
      notes: nullable(input.notes),
      sort_order: typeof input.sort_order === 'number' ? Math.trunc(input.sort_order) : 0,
      created_by_user_id: input.actor_user_id ?? null,
      updated_by_user_id: input.actor_user_id ?? null,
    };
    const { data, error } = await supabase
      .from('property_access_items')
      .insert(payload)
      .select(ACCESS_ITEM_COLUMNS)
      .maybeSingle();
    if (error || !data) {
      return { ok: false, error: { code: 'db_error', message: error?.message ?? 'insert returned no row' } };
    }
    const created = data as PropertyAccessItemRow;
    await logPropertyKnowledgeActivity({
      property_id: input.property_id,
      user_id: input.actor_user_id ?? null,
      resource_type: 'access',
      resource_id: created.id,
      action: 'create',
      changes: { kind: 'snapshot', row: { type: created.type, label: created.label, value: created.value } },
      subject_label: subjectLabel(created),
      source: (input.source ?? 'web') as KnowledgeSource,
    });
    return { ok: true, item: created, mode: 'create' };
  }

  // ----- UPDATE -----------------------------------------------------
  const itemLookup = await loadItem(supabase, input.property_id, input.item_id);
  if (!itemLookup.ok) return { ok: false, error: itemLookup.error };
  const existing = itemLookup.item;

  const patch: Record<string, unknown> = {};
  const changes: Array<{ field: string; before: unknown; after: unknown }> = [];

  if (input.type !== undefined) {
    const next = normalizeAccessType(input.type);
    if (next !== existing.type) {
      patch.type = next;
      changes.push({ field: 'type', before: existing.type, after: next });
    }
  }
  if (input.label !== undefined) {
    const next = nullable(input.label);
    if (!next) {
      return { ok: false, error: { code: 'invalid_input', message: 'label cannot be empty.', field: 'label' } };
    }
    if (next !== existing.label) {
      patch.label = next;
      changes.push({ field: 'label', before: existing.label, after: next });
    }
  }
  for (const field of ['value', 'notes'] as const) {
    if (!(field in input)) continue;
    const next = nullable(input[field] ?? null);
    if (next !== existing[field]) {
      patch[field] = next;
      changes.push({ field, before: existing[field], after: next });
    }
  }
  if (input.sort_order !== undefined) {
    const next = Math.trunc(input.sort_order);
    if (next !== existing.sort_order) {
      patch.sort_order = next;
      changes.push({ field: 'sort_order', before: existing.sort_order, after: next });
    }
  }

  // Validate the effective (type, value) after the patch.
  const effType = (patch.type as string) ?? existing.type;
  const effValue = ('value' in patch ? (patch.value as string | null) : existing.value) ?? null;
  const verr = validateValue(effType, effValue);
  if (verr) return { ok: false, error: verr };

  if (Object.keys(patch).length === 0) {
    return { ok: true, item: existing, mode: 'update', changes: [] };
  }
  patch.updated_at = new Date().toISOString();
  if (input.actor_user_id) patch.updated_by_user_id = input.actor_user_id;

  const { data, error } = await supabase
    .from('property_access_items')
    .update(patch)
    .eq('id', input.item_id)
    .eq('property_id', input.property_id)
    .select(ACCESS_ITEM_COLUMNS)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, error: { code: 'db_error', message: error?.message ?? 'update returned no row' } };
  }
  const updated = data as PropertyAccessItemRow;
  await logPropertyKnowledgeActivity({
    property_id: input.property_id,
    user_id: input.actor_user_id ?? null,
    resource_type: 'access',
    resource_id: updated.id,
    action: 'update',
    changes: { kind: 'diff', entries: changes },
    subject_label: subjectLabel(updated),
    source: (input.source ?? 'web') as KnowledgeSource,
  });
  return { ok: true, item: updated, mode: 'update', changes };
}

export async function deletePropertyAccessItem(
  propertyId: string,
  itemId: string,
  actorUserId: string | null,
  source: KnowledgeSource = 'web',
): Promise<{ ok: true } | { ok: false; error: AccessItemError }> {
  const supabase = getSupabaseServer();
  const itemLookup = await loadItem(supabase, propertyId, itemId);
  if (!itemLookup.ok) return { ok: false, error: itemLookup.error };
  const existing = itemLookup.item;

  const { error } = await supabase
    .from('property_access_items')
    .delete()
    .eq('id', itemId)
    .eq('property_id', propertyId);
  if (error) return { ok: false, error: { code: 'db_error', message: error.message } };

  await logPropertyKnowledgeActivity({
    property_id: propertyId,
    user_id: actorUserId,
    resource_type: 'access',
    resource_id: itemId,
    action: 'delete',
    changes: { kind: 'snapshot', row: { type: existing.type, label: existing.label } },
    subject_label: subjectLabel(existing),
    source,
  });
  return { ok: true };
}
