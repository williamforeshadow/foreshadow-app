import { z } from 'zod';
import type { KnowledgeTarget } from '@/src/server/messages/draftKnowledge';
import { requireOrgId, type ToolContext, type ToolDefinition, type ToolResult } from './types';

// propose_property_knowledge — the web surface's path for ADDING or UPDATING
// individual Property Knowledge facts.
//
// One call per fact, mirroring propose_task: Property Knowledge is a record of
// each individual entity on the property, so each fact gets its own durable
// proposed_knowledge row and renders as the same inline-editable knowledge
// bubble the concierge inbox uses (every field editable in place, a
// guest-visibility pill, Save/Dismiss controls). The human click on Save IS
// the confirmation — /api/proposed-knowledge/[id] replays the target through
// the same write services the Knowledge UI uses.
//
// The preview/commit pair (preview_property_knowledge_write) remains the path
// for what a proposal card cannot express: Access items, room renames/deletes,
// document metadata/deletes, deletes of any kind, and multi-property batches.

const ROOM_SCOPE = z.enum(['interior', 'exterior']);
const ATTRIBUTE_TAG = z.enum([
  'appliance',
  'amenity',
  'safety',
  'quirk',
  'utility',
  'access',
  'other',
]);
const CONTACT_TAG = z.enum([
  'cleaning',
  'maintenance',
  'contractors',
  'owners',
  'stakeholders',
  'emergency',
  'other',
]);

const roomRef = z.object({
  scope: ROOM_SCOPE,
  title: z.string().min(1),
});

const targetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('attribute'),
    room: roomRef,
    attribute: z.object({
      tags: z.array(ATTRIBUTE_TAG).min(1),
      title: z.string().min(1),
      body: z.string().nullable().optional(),
    }),
  }),
  z.object({
    kind: z.literal('room_note'),
    room: roomRef,
    notes: z.string().min(1),
  }),
  z.object({
    kind: z.literal('policy'),
    policy: z.object({
      title: z.string().min(1),
      body: z.string().nullable().optional(),
    }),
  }),
  z.object({
    kind: z.literal('connectivity'),
    fields: z.object({
      wifi_ssid: z.string().nullable().optional(),
      wifi_password: z.string().nullable().optional(),
      wifi_router_location: z.string().nullable().optional(),
    }),
  }),
  z.object({
    kind: z.literal('contact'),
    contact: z.object({
      id: z.string().uuid().nullable().optional(),
      tags: z.array(CONTACT_TAG).min(1),
      name: z.string().min(1),
      role: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
      schedule: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
    }),
  }),
]);

const inputSchema = z.object({
  property_id: z.string().uuid(),
  target: targetSchema,
  guest_visible: z.boolean().optional(),
  photo_inbound_file_ids: z.array(z.string().uuid()).optional(),
  replaces_proposal_id: z.string().uuid().optional(),
});

type Input = z.infer<typeof inputSchema>;

export interface ProposeKnowledgeResultData {
  proposal_id: string;
  property_name: string;
  summary: string;
  replaced_proposal_id?: string;
}

/** Human-readable one-liner for the bubble header/tombstone. */
function buildSummary(t: Input['target']): string {
  switch (t.kind) {
    case 'attribute':
      return `${t.room.title} · ${t.attribute.title}`;
    case 'room_note':
      return `${t.room.title} · ${t.room.scope === 'exterior' ? 'Area' : 'Room'} note`;
    case 'policy':
      return `Policy · ${t.policy.title}`;
    case 'connectivity':
      return 'Wi-Fi · Connectivity';
    case 'contact':
      return `Contact · ${t.contact.name}`;
  }
}

async function handler(
  input: Input,
  ctx: ToolContext,
): Promise<ToolResult<ProposeKnowledgeResultData>> {
  const org = requireOrgId(ctx);
  if (typeof org !== 'string') return org;

  // Resolve the property (and get its display name for the model's caption).
  const { data: property, error: propErr } = await ctx.db
    .from('properties')
    .select('id, name')
    .eq('id', input.property_id)
    .eq('org_id', org)
    .maybeSingle();
  if (propErr) {
    return { ok: false, error: { code: 'db_error', message: propErr.message } };
  }
  if (!property) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: `No property with id ${input.property_id}.`,
        hint: 'Call find_properties to resolve a property name into a valid id.',
      },
    };
  }

  // Room-targeted kinds: resolve the room title to an existing room id so the
  // accept path UPDATES it instead of creating a same-named duplicate (the
  // accept route only reuses rooms BY ID; a title-only ref always creates).
  let target: KnowledgeTarget;
  if (input.target.kind === 'attribute' || input.target.kind === 'room_note') {
    const { data: room } = await ctx.db
      .from('property_rooms')
      .select('id')
      .eq('property_id', input.property_id)
      .eq('scope', input.target.room.scope)
      .ilike('title', input.target.room.title.trim())
      .limit(1)
      .maybeSingle();
    const resolvedRoom = {
      id: (room?.id as string | undefined) ?? null,
      scope: input.target.room.scope,
      title: input.target.room.title.trim(),
    };
    target =
      input.target.kind === 'attribute'
        ? {
            kind: 'attribute',
            room: resolvedRoom,
            attribute: {
              tags: input.target.attribute.tags,
              title: input.target.attribute.title,
              body: input.target.attribute.body ?? null,
            },
          }
        : { kind: 'room_note', room: resolvedRoom, notes: input.target.notes };
  } else if (input.target.kind === 'policy') {
    target = {
      kind: 'policy',
      policy: {
        title: input.target.policy.title,
        body: input.target.policy.body ?? null,
      },
    };
  } else if (input.target.kind === 'connectivity') {
    target = {
      kind: 'connectivity',
      fields: {
        wifi_ssid: input.target.fields.wifi_ssid ?? null,
        wifi_password: input.target.fields.wifi_password ?? null,
        wifi_router_location: input.target.fields.wifi_router_location ?? null,
      },
    };
  } else {
    target = {
      kind: 'contact',
      contact: {
        id: input.target.contact.id ?? null,
        tags: input.target.contact.tags,
        name: input.target.contact.name,
        role: input.target.contact.role ?? null,
        phone: input.target.contact.phone ?? null,
        email: input.target.contact.email ?? null,
        schedule: input.target.contact.schedule ?? null,
        notes: input.target.contact.notes ?? null,
      },
    };
  }

  const summary = buildSummary(input.target);

  // Default visibility mirrors the concierge bubble's instinct: room facts
  // and wifi default shareable; contacts and policies default internal
  // unless the model explicitly chose.
  const guestVisible =
    input.guest_visible ??
    (target.kind === 'attribute' ||
      target.kind === 'room_note' ||
      target.kind === 'connectivity');

  const { data, error } = await ctx.db
    .from('proposed_knowledge')
    .insert({
      org_id: org,
      conversation_id: null,
      triggering_message_id: null,
      source: 'agent',
      agent_session_id: ctx.sessionId ?? null,
      property_id: input.property_id,
      target,
      summary,
      guest_visible: guestVisible,
      attachment_inbound_file_ids: input.photo_inbound_file_ids ?? [],
      status: 'pending',
    })
    .select('id')
    .single();
  if (error || !data) {
    return {
      ok: false,
      error: { code: 'db_error', message: error?.message ?? 'insert failed' },
    };
  }

  // Supersede a still-pending card this one corrects. Best-effort.
  let replaced: string | undefined;
  if (input.replaces_proposal_id) {
    const { data: old } = await ctx.db
      .from('proposed_knowledge')
      .update({
        status: 'dismissed',
        decided_by: ctx.actor?.appUserId ?? null,
        decided_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.replaces_proposal_id)
      .eq('source', 'agent')
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (old?.id) replaced = input.replaces_proposal_id;
  }

  return {
    ok: true,
    data: {
      proposal_id: data.id as string,
      property_name: property.name as string,
      summary,
      ...(replaced ? { replaced_proposal_id: replaced } : {}),
    },
    meta: { returned: 1, limit: 1, truncated: false },
  };
}

export const proposePropertyKnowledge: ToolDefinition<
  Input,
  ProposeKnowledgeResultData
> = {
  name: 'propose_property_knowledge',
  surfaces: ['web'],
  description:
    "PROPOSE one Property Knowledge fact for the user to approve. This is how individual knowledge facts get added or updated here: each call stores a durable proposal that renders as an editable knowledge card below your reply — every field editable in place, a guest-visibility toggle, and Save/Dismiss controls. Nothing is written until the user decides, so propose rather than ask. Property Knowledge holds records of each individual entity on the property, so make ONE call per fact — a request carrying three facts is three calls in the same turn, each its own card. Kinds: 'attribute' (a discrete thing under a room/area — appliance, amenity, safety item, quirk; room named by scope+title and created on accept if missing), 'room_note' (free text on a room/area), 'policy' (a stay-wide or property-wide rule — checkout, quiet hours, parking; matched by title, so the same call creates or updates), 'connectivity' (wifi SSID/password/router location; pass only the fields you are setting), 'contact' (a vendor/person; pass contact.id from get_property_knowledge to UPDATE an existing contact, omit to create). Attribute-vs-policy test is SCOPE: a fact governing one object/area is an attribute on it even when phrased as a rule; a rule governing the stay or whole property is a policy. Uploaded photos: pass photo_inbound_file_ids (ids from the uploaded-files context block) on an attribute or room_note proposal and they attach to the resulting record when the user accepts — they are not shown on the card. guest_visible marks whether the concierge may share the fact with guests; it defaults on for attributes/room notes/wifi and off for contacts and policies, and the user can flip it on the card. Your reply is a short caption beside the card(s) — do not restate the fields, and never claim the knowledge was saved. If the user corrects an undecided proposal, call again with the fixed fields and replaces_proposal_id. Use this for adding/updating facts on ONE property. Still use preview_property_knowledge_write for: Access items, renaming/deleting rooms, document metadata/deletes, deleting attributes/policies/notes, and preview_property_knowledge_batch for the same operations across MANY properties.",
  inputSchema,
  jsonSchema: {
    type: 'object' as const,
    properties: {
      property_id: {
        type: 'string',
        description:
          'Property UUID. Resolve a named property with find_properties first.',
      },
      target: {
        type: 'object',
        description:
          "The fact, discriminated by `kind`. Shapes: {kind:'attribute', room:{scope:'interior'|'exterior', title}, attribute:{tags:[appliance|amenity|safety|quirk|utility|access|other], title, body}} · {kind:'room_note', room:{scope, title}, notes} · {kind:'policy', policy:{title, body}} · {kind:'connectivity', fields:{wifi_ssid?, wifi_password?, wifi_router_location?}} · {kind:'contact', contact:{id?, tags:[cleaning|maintenance|contractors|owners|stakeholders|emergency|other], name, role?, phone?, email?, schedule?, notes?}}.",
        properties: {
          kind: {
            type: 'string',
            enum: ['attribute', 'room_note', 'policy', 'connectivity', 'contact'],
          },
        },
        required: ['kind'],
      },
      guest_visible: {
        type: 'boolean',
        description:
          'Whether the concierge may share this fact with guests. Defaults: true for attribute/room_note/connectivity, false for policy/contact. Omit unless the user said, or the content clearly implies, otherwise (access codes and internal-only notes should be false).',
      },
      photo_inbound_file_ids: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Uploaded photos to attach to the resulting record when accepted (attribute and room_note proposals only). Use only ids from the uploaded-files context block.',
      },
      replaces_proposal_id: {
        type: 'string',
        description:
          'proposal_id of a still-pending knowledge proposal from THIS conversation that this one corrects; the old card is retired. Omit for a new proposal.',
      },
    },
    required: ['property_id', 'target'],
    additionalProperties: false,
  },
  handler,
};
