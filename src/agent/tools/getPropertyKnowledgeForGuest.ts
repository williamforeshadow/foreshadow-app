import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { loadPropertyKnowledge, type Json } from '@/src/server/properties/propertyKnowledge';
import { visibilityKey, type VisibilityResourceType } from '@/lib/propertyKnowledgeVisibility';
import type { ToolDefinition, ToolResult, ToolContext } from './types';

// get_property_knowledge_for_guest — the Concierge's view of a property.
//
// Same dossier loader as get_property_knowledge, but filtered to the org's
// UNLOCKED allowlist (public.property_knowledge_visibility). Locked by default:
// with nothing unlocked this returns empty sections. There is NO field-level
// filtering beyond the allowlist — if an item is unlocked, it is returned
// verbatim (nested photo arrays aside, which are binary refs, not text). What's
// safe to expose is entirely the operator's lock/unlock decision.
//
// The property is bound through ToolContext (ctx.draft.propertyId) so the
// Concierge can only ever read ITS conversation's property — never another's.

const inputSchema = z.object({
  // Optional + context-bound: the Concierge sets the property server-side, so
  // the model normally calls this with no arguments.
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
  notes: Json[];
  contacts: Json[];
  documents: Json[];
  tech_accounts: Json[];
  rooms: Json[];
  cards: Json[];
  /** True when the property has no unlocked knowledge at all. */
  empty: boolean;
}

const PHOTO_KEYS = [
  'property_tech_account_photos',
  'property_room_photos',
  'property_cards',
  'property_card_photos',
];

/** Strip nested photo/card arrays (binary refs / handled separately) from a row. */
function stripNested(row: Json): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(row)) {
    if (PHOTO_KEYS.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

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
  type: VisibilityResourceType,
  unlocked: Set<string>,
): Json | null {
  if (!row) return null;
  const out: Json = {};
  for (const [k, v] of Object.entries(row)) {
    if (unlocked.has(visibilityKey(type, k))) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Keep only the rows whose id is unlocked for `type`. */
function filterRows(rows: Json[], type: VisibilityResourceType, unlocked: Set<string>): Json[] {
  return rows
    .filter((r) => typeof r.id === 'string' && unlocked.has(visibilityKey(type, r.id as string)))
    .map(stripNested);
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

  // Cards are unlocked per-item, independent of their room — flatten them out so
  // a card can surface even if its room is locked. Tag each with its room title
  // for context.
  const cards: Json[] = [];
  for (const room of dossier.rooms) {
    const roomCards = Array.isArray(room.property_cards) ? (room.property_cards as Json[]) : [];
    for (const card of roomCards) {
      if (typeof card.id === 'string' && unlocked.has(visibilityKey('card', card.id))) {
        cards.push({ ...stripNested(card), room_title: room.title ?? null });
      }
    }
  }

  const data: GuestPropertyKnowledge = {
    access: filterFields(dossier.access, 'access_field', unlocked),
    connectivity: filterFields(dossier.connectivity, 'connectivity_field', unlocked),
    notes: filterRows(dossier.notes, 'note', unlocked),
    contacts: filterRows(dossier.contacts, 'contact', unlocked),
    documents: filterRows(dossier.documents, 'document', unlocked),
    tech_accounts: filterRows(dossier.tech_accounts, 'tech_account', unlocked),
    rooms: filterRows(dossier.rooms, 'room', unlocked),
    cards,
    empty: false,
  };
  data.empty =
    !data.access &&
    !data.connectivity &&
    data.notes.length === 0 &&
    data.contacts.length === 0 &&
    data.documents.length === 0 &&
    data.tech_accounts.length === 0 &&
    data.rooms.length === 0 &&
    data.cards.length === 0;

  return { ok: true, data };
}

export const getPropertyKnowledgeForGuest: ToolDefinition<Input, GuestPropertyKnowledge> = {
  name: 'get_property_knowledge_for_guest',
  description:
    "Look up the guest-shareable facts the operator has unlocked for THIS property (wifi, entry info, parking, amenities, house notes — whatever the org chose to make visible). Call it with no arguments when the guest asks something property-specific. Returns only unlocked items; if `empty` is true or a fact you need isn't present, it hasn't been shared — don't guess it, tell the guest you'll confirm with the team.",
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
