import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { loadPropertyKnowledge, type Json } from '@/src/server/properties/propertyKnowledge';
import {
  visibilityKey,
  encodeFieldResourceId,
  RESOURCE_FIELD_SETS,
  type VisibilityResourceType,
} from '@/lib/propertyKnowledgeVisibility';
import type { ToolDefinition, ToolResult, ToolContext } from './types';

// get_property_knowledge_for_guest — the Concierge's view of a property.
//
// Same dossier loader as get_property_knowledge, but filtered to the org's
// UNLOCKED allowlist (public.property_knowledge_visibility), PER FIELD. Locked
// by default: with nothing unlocked this returns empty sections. Each row is
// redacted to only the fields the operator unlocked; a row with no unlocked
// fields is omitted entirely. The `photos` / `file` pseudo-fields gate the
// nested binary arrays. What's safe to expose is entirely the operator's
// lock/unlock decision.
//
// The property is bound through ToolContext (ctx.draft.propertyId) so the
// Concierge can only ever read ITS conversation's property — never another's.

const inputSchema = z.object({
  property_id: z
    .string()
    .uuid()
    .optional()
    .describe('Usually omit — the property is already known from the conversation.'),
});

type Input = z.infer<typeof inputSchema>;

export interface GuestPropertyKnowledge {
  access: Json | null;
  connectivity: Json | null;
  contacts: Json[];
  documents: Json[];
  tech_accounts: Json[];
  rooms: Json[];
  attributes: Json[];
  /** True when the property has no unlocked knowledge at all. */
  empty: boolean;
}

// Which nested arrays correspond to a row's `photos` pseudo-field, per type.
const PHOTO_ARRAY_KEY: Partial<Record<VisibilityResourceType, string>> = {
  room_field: 'property_room_photos',
  attribute_field: 'property_attribute_photos',
  tech_account_field: 'property_tech_account_photos',
};

async function loadUnlockedKeys(propertyId: string): Promise<Set<string>> {
  const { data, error } = await getSupabaseServer()
    .from('property_knowledge_visibility')
    .select('resource_type, resource_id')
    .eq('property_id', propertyId);
  if (error) throw new Error(error.message);
  const keys = new Set<string>();
  for (const r of (data ?? []) as Array<{ resource_type: VisibilityResourceType; resource_id: string }>) {
    keys.add(visibilityKey(r.resource_type, r.resource_id));
  }
  return keys;
}

/** Keep only the unlocked fields of a singleton field-bag (access / connectivity). */
function filterFields(
  row: Json | null,
  type: 'access_field' | 'connectivity_field',
  unlocked: Set<string>,
): Json | null {
  if (!row) return null;
  const out: Json = {};
  for (const [k, v] of Object.entries(row)) {
    if (unlocked.has(visibilityKey(type, k))) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Redact a collection row to only its unlocked fields. Returns null when no
 * field survived (so the row is dropped). `extra` lets callers attach context
 * (e.g. an attribute's room_title) that isn't itself a lockable field.
 */
function redactRow(
  row: Json,
  type: VisibilityResourceType,
  unlocked: Set<string>,
  extra?: Json,
): Json | null {
  const id = typeof row.id === 'string' ? row.id : null;
  if (!id) return null;
  const fields = RESOURCE_FIELD_SETS[type];
  const photoArrayKey = PHOTO_ARRAY_KEY[type];
  const out: Json = {};
  let kept = 0;
  for (const field of fields) {
    if (!unlocked.has(visibilityKey(type, encodeFieldResourceId(id, field)))) continue;
    if (field === 'photos' || field === 'file') {
      if (photoArrayKey && Array.isArray(row[photoArrayKey])) {
        out[photoArrayKey] = row[photoArrayKey];
        kept++;
      }
      continue;
    }
    out[field] = row[field] ?? null;
    kept++;
  }
  if (kept === 0) return null;
  out.id = id;
  return { ...out, ...(extra ?? {}) };
}

function redactRows(
  rows: Json[],
  type: VisibilityResourceType,
  unlocked: Set<string>,
): Json[] {
  return rows
    .map((r) => redactRow(r, type, unlocked))
    .filter((r): r is Json => r !== null);
}

async function handler(input: Input, ctx: ToolContext): Promise<ToolResult<GuestPropertyKnowledge>> {
  // Context binding wins; never trust a model-supplied id inside the Concierge.
  const propertyId = ctx.draft?.propertyId ?? input.property_id ?? null;
  if (!propertyId) {
    return {
      ok: false,
      error: { code: 'invalid_input', message: 'No property is bound to this draft.' },
    };
  }

  let dossier;
  try {
    dossier = await loadPropertyKnowledge(propertyId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load property knowledge';
    return { ok: false, error: { code: 'db_error', message } };
  }
  if (!dossier) {
    return { ok: false, error: { code: 'not_found', message: 'Property not found.' } };
  }

  let unlocked: Set<string>;
  try {
    unlocked = await loadUnlockedKeys(propertyId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load visibility';
    return { ok: false, error: { code: 'db_error', message } };
  }

  // Attributes are unlocked per-item, independent of their room — flatten them
  // out so an attribute can surface even if its room is locked. Tag each with
  // its room title for context.
  const attributes: Json[] = [];
  for (const room of dossier.rooms) {
    const roomAttributes = Array.isArray(room.property_attributes)
      ? (room.property_attributes as Json[])
      : [];
    for (const attribute of roomAttributes) {
      const redacted = redactRow(attribute, 'attribute_field', unlocked, {
        room_title: (room.title as string | null) ?? null,
      });
      if (redacted) attributes.push(redacted);
    }
  }

  const data: GuestPropertyKnowledge = {
    access: filterFields(dossier.access, 'access_field', unlocked),
    connectivity: filterFields(dossier.connectivity, 'connectivity_field', unlocked),
    contacts: redactRows(dossier.contacts, 'contact_field', unlocked),
    documents: redactRows(dossier.documents, 'document_field', unlocked),
    tech_accounts: redactRows(dossier.tech_accounts, 'tech_account_field', unlocked),
    rooms: redactRows(dossier.rooms, 'room_field', unlocked),
    attributes,
    empty: false,
  };
  data.empty =
    !data.access &&
    !data.connectivity &&
    data.contacts.length === 0 &&
    data.documents.length === 0 &&
    data.tech_accounts.length === 0 &&
    data.rooms.length === 0 &&
    data.attributes.length === 0;

  return { ok: true, data };
}

export const getPropertyKnowledgeForGuest: ToolDefinition<Input, GuestPropertyKnowledge> = {
  name: 'get_property_knowledge_for_guest',
  description:
    "Look up the guest-shareable facts the operator has unlocked for THIS property (wifi, entry info, parking, amenities, house notes — whatever the org chose to make visible). Call it with no arguments when the guest asks something property-specific. Returns only unlocked fields; if `empty` is true or a fact you need isn't present, it hasn't been shared — don't guess it, tell the guest you'll confirm with the team.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      property_id: {
        type: 'string',
        description: 'Usually omit — the property is already known from the conversation.',
      },
    },
    additionalProperties: false,
  },
  handler,
};
