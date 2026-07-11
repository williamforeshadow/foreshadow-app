import type { TextBlock } from '@anthropic-ai/sdk/resources/messages';
import { getAnthropic, MODEL } from '@/src/agent/anthropic';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { loadPropertyKnowledge } from '@/src/server/properties/propertyKnowledge';
import {
  ATTRIBUTE_TAGS,
  normalizeTags,
  type AttributeTag,
  CONTACT_TAGS,
  normalizeContactTags,
  type ContactTag,
} from '@/lib/propertyAttributes';
import { LOCKABLE_CONNECTIVITY_FIELDS } from '@/lib/propertyKnowledgeVisibility';
import {
  getConversationContext,
  type ConversationContext,
} from './conversationContext';
import type { GuestMessageRecord } from '@/lib/messages';

// Knowledge-triage generator — the concierge's "did this conversation teach us
// something durable about the PROPERTY worth saving for next time?" pass. The
// operator-facing sibling of draftReply/draftTask. It reads the conversation AND
// the property's current knowledge tree, and proposes additions (a room note, a
// room attribute, a wifi detail, or a vendor/contact) — rarely. The result
// compounds: an accepted, guest-visible
// fact later informs the concierge's replies.
//
// Single structured call, temp 0. Domain-agnostic; what qualifies is judged from
// the conversation, not assumptions.

const TRIAGE_MAX_TOKENS = 900;
const MAX_THREAD_MESSAGES = 40;

type RoomScope = 'interior' | 'exterior';

export interface RoomRef {
  /** Existing room id to add under, or null to create a new room. */
  id: string | null;
  scope: RoomScope;
  title: string | null;
}

export interface ConnectivityFields {
  wifi_ssid: string | null;
  wifi_password: string | null;
  wifi_router_location: string | null;
}

export interface ContactFields {
  /** Existing contact id to UPDATE, or null to create a new contact. */
  id: string | null;
  tags: ContactTag[];
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  schedule: string | null;
  notes: string | null;
}

export type KnowledgeTarget =
  | { kind: 'room_note'; room: RoomRef; notes: string }
  | { kind: 'attribute'; room: RoomRef; attribute: { tags: AttributeTag[]; title: string; body: string | null } }
  | { kind: 'connectivity'; fields: ConnectivityFields }
  | { kind: 'contact'; contact: ContactFields };

export interface KnowledgeProposalDraft {
  target: KnowledgeTarget;
  summary: string;
  guest_visible: boolean;
  reasoning: string;
}

export interface KnowledgeTriageResult {
  proposals: KnowledgeProposalDraft[];
  reasoning: string;
}

const SYSTEM_PROMPT = `You review a conversation between a guest (or resident/customer) and a property or hospitality operations team, and decide whether it revealed a durable, reusable fact about the PROPERTY worth saving to its knowledge base — something that would help staff or the AI handle the same situation better next time, with a different guest.

This is rare. The overwhelming majority of conversations reveal nothing new to save. Propose ONLY a concrete, lasting fact about the property that has been clearly established in the conversation and is NOT already in the knowledge base shown below.

Save it when it's a discovered fix or quirk (e.g. the TV only works on a certain input; an appliance needs a specific step), a confirmed amenity/access detail, or a recurring fact (e.g. a landscaper or pool service comes on a schedule). Do NOT save: anything specific to THIS guest, one-off logistics, a broken/defective/needs-repair item (that's operational work — it belongs in a task, not the property's durable knowledge), a transient problem that is really just a task to do, an unresolved/uncertain issue, or anything already in the knowledge base. A permanent, non-actionable oddity of the house (nothing to fix, just how it is) is fine to record as a "quirk". When unsure, propose nothing.

Ground every proposal ONLY in what the conversation actually established — never invent details, names, times, or numbers.

UPDATES & CORRECTIONS: a fact that CHANGES or corrects a value already on file, or already listed as awaiting review, IS worth proposing — save the corrected value (for example a new wifi password, or a vendor whose schedule changed). Only skip it when the value is unchanged (already exactly on file or already proposed).

WHERE to put each fact (choose the best target):
- A discrete thing tied to a specific room/area — an appliance, amenity, safety item, utility, or a quirk about a particular object → an ATTRIBUTE under that room. Tag it appropriately (you may apply multiple tags). Use an existing room when one fits (reference its id); if the relevant room clearly exists in the property but isn't in the list, create it (set room.id to null and give scope + title). For a property-wide fact not tied to a specific room, create or reuse a general/whole-property area (scope "interior") and attach the attribute there.
- A general characteristic of a room or area ITSELF — its layout, condition, or a standing quirk (e.g. "basement tends to smell") → a ROOM NOTE on that room's notes. (A person or service is NOT a room note — see CONTACT below.)
- The property's Wi-Fi — network name (SSID), password, or router location, often a correction to what's on file → a CONNECTIVITY target carrying whichever of these fields (${LOCKABLE_CONNECTIVITY_FIELDS.join(', ')}) were established.
- A person, company, or recurring vendor/service tied to the property — a cleaner, landscaper, pool service, trash/recycling pickup, HOA, handyman, emergency contact, or the owner — especially a recurring one someone (usually the host) mentions in passing (e.g. "heads up, the landscapers come 10am Friday") → a CONTACT. Capture whatever was given: name, role, phone, email, schedule. A recurring schedule alone is enough — do not wait for a phone number; give the contact a sensible name/role. Tag with one or more of: ${CONTACT_TAGS.join(', ')}. If the fact UPDATES a contact already on file (e.g. that vendor's schedule or number changed), set contact.id to that contact's id and restate its details including the change; otherwise set contact.id to null to create a new one.

Rooms have a scope ("interior" or "exterior") and a title. Valid attribute tags: ${ATTRIBUTE_TAGS.join(', ')} (use "quirk" for a quirky behavior, "appliance" for a device, "amenity" for a guest amenity, "safety" for a hazard, "utility" for shutoffs/utilities, "access" for entry, "other" otherwise). You may combine tags (e.g. a guest-facing device = ["appliance","amenity"]).

VISIBILITY: set guest_visible true when this is something you'd happily share with any guest (how to use an amenity, a TV input, parking, the wifi network + password). Set it false when it's internal (an operational note, a vendor/contact, or anything you would not tell a guest).

Output: respond with ONLY a single JSON object, no prose, no code fences:
{"proposals": [{"target": <Target>, "summary": string, "guest_visible": boolean, "reasoning": string}], "reasoning": string}
"proposals" is an array of zero or more (usually zero or one). "summary" is a short human-readable line like "Living Room - quirk: TV must be on HDMI 2" or "Contact - Landscaping (maintenance): Fridays 10am".
A <Target> is exactly one of:
- {"kind":"room_note","room":{"id":string|null,"scope":"interior"|"exterior","title":string|null},"notes":string}
- {"kind":"attribute","room":{"id":string|null,"scope":"interior"|"exterior","title":string|null},"attribute":{"tags":string[],"title":string,"body":string|null}}
- {"kind":"connectivity","fields":{"wifi_ssid":string|null,"wifi_password":string|null,"wifi_router_location":string|null}}
- {"kind":"contact","contact":{"id":string|null,"tags":string[],"name":string,"role":string|null,"phone":string|null,"email":string|null,"schedule":string|null,"notes":string|null}}
Keep "reasoning" to one short sentence.`;

interface KnowledgeRoom {
  id: string;
  scope: string;
  title: string | null;
  notes: string | null;
  attributes: Array<{ tags: AttributeTag[]; title: string }>;
}

interface KnowledgeContact {
  id: string;
  name: string;
}

/** Compact the property's current knowledge into prompt text for placement + dedup. */
async function loadKnowledgeContext(propertyId: string | null): Promise<{
  block: string;
  rooms: KnowledgeRoom[];
  contacts: KnowledgeContact[];
}> {
  if (!propertyId) return { block: '(no property linked)', rooms: [], contacts: [] };
  const knowledge = await loadPropertyKnowledge(propertyId);
  if (!knowledge) return { block: '(property knowledge unavailable)', rooms: [], contacts: [] };

  const rooms: KnowledgeRoom[] = (knowledge.rooms as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    scope: (r.scope as string) ?? 'interior',
    title: (r.title as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    attributes: ((r.property_attributes as Array<Record<string, unknown>> | null) ?? []).map((a) => ({
      tags: normalizeTags(a.tags),
      title: (a.title as string | null) ?? '',
    })),
  }));

  const lines: string[] = [];
  lines.push('Existing rooms/areas (reference a room by its id to add under it):');
  if (rooms.length === 0) {
    lines.push('- (none yet)');
  } else {
    for (const room of rooms) {
      const label = room.title || room.scope;
      const noteStr = room.notes ? ` | room note: "${room.notes.slice(0, 120)}"` : '';
      const attrStr = room.attributes.length
        ? ` | attributes: ${room.attributes.map((a) => `${a.tags.join('/') || 'untagged'} "${a.title}"`).join(', ')}`
        : '';
      lines.push(`- [id: ${room.id}] ${room.scope} "${label}"${noteStr}${attrStr}`);
    }
  }

  // Wi-Fi (single row) + vendors/contacts — surfaced so the model dedups
  // connectivity and contact proposals against what's already on file.
  const conn = (knowledge.connectivity as Record<string, unknown> | null) ?? null;
  if (conn && (conn.wifi_ssid || conn.wifi_password || conn.wifi_router_location)) {
    const parts: string[] = [];
    if (conn.wifi_ssid) parts.push(`network "${conn.wifi_ssid}"`);
    if (conn.wifi_password) parts.push(`password "${conn.wifi_password}"`);
    if (conn.wifi_router_location) parts.push(`router at "${conn.wifi_router_location}"`);
    lines.push(`Wi-Fi on file: ${parts.join(', ')}`);
  } else {
    lines.push('Wi-Fi on file: (none)');
  }

  // Vendors/contacts on file — with ids so a proposal can reference one to UPDATE
  // it, and with real values so the model can tell an unchanged fact from a change.
  const rawContacts = (knowledge.contacts as Array<Record<string, unknown>> | null) ?? [];
  const contacts: KnowledgeContact[] = rawContacts.map((c) => ({
    id: c.id as string,
    name: (c.name as string) || 'contact',
  }));
  lines.push(
    'Existing vendors/contacts (reference a contact by its id to UPDATE it; do NOT re-propose an unchanged one):',
  );
  if (rawContacts.length === 0) {
    lines.push('- (none yet)');
  } else {
    for (const c of rawContacts) {
      const tags = normalizeContactTags(c.tags);
      const bits: string[] = [];
      if (tags.length) bits.push(tags.join('/'));
      if (c.role) bits.push(`role "${String(c.role).slice(0, 60)}"`);
      if (c.phone) bits.push(`phone "${c.phone}"`);
      if (c.email) bits.push(`email "${c.email}"`);
      if (c.schedule) bits.push(`schedule "${String(c.schedule).slice(0, 80)}"`);
      const detail = bits.length ? ` — ${bits.join(', ')}` : '';
      lines.push(`- [id: ${c.id}] "${(c.name as string) || 'contact'}"${detail}`);
    }
  }

  return { block: lines.join('\n'), rooms, contacts };
}

/** Value-aware, one-line description of a stored proposal target (for pending dedup). */
function describePendingTarget(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const kind = t.kind;
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  if (kind === 'connectivity') {
    const f = (t.fields as Record<string, unknown> | null) ?? {};
    const parts: string[] = [];
    if (s(f.wifi_ssid)) parts.push(`network "${s(f.wifi_ssid)}"`);
    if (s(f.wifi_password)) parts.push(`password "${s(f.wifi_password)}"`);
    if (s(f.wifi_router_location)) parts.push(`router "${s(f.wifi_router_location)}"`);
    return `Wi-Fi — ${parts.join(', ') || 'details'}`;
  }
  if (kind === 'contact') {
    const c = (t.contact as Record<string, unknown> | null) ?? {};
    const bits: string[] = [];
    const tags = normalizeContactTags(c.tags);
    if (tags.length) bits.push(tags.join('/'));
    if (s(c.schedule)) bits.push(`schedule "${s(c.schedule)}"`);
    if (s(c.phone)) bits.push(`phone "${s(c.phone)}"`);
    return `Contact — "${s(c.name) || 'contact'}"${bits.length ? ` (${bits.join(', ')})` : ''}`;
  }
  const room = (t.room as Record<string, unknown> | null) ?? {};
  const where = `${room.scope === 'exterior' ? 'Exterior' : 'Interior'} → ${s(room.title) || 'room'}`;
  if (kind === 'room_note') return `${where} — note: "${(s(t.notes) ?? '').slice(0, 100)}"`;
  if (kind === 'attribute') {
    const a = (t.attribute as Record<string, unknown> | null) ?? {};
    return `${where} — ${s(a.title) || 'attribute'}`;
  }
  return null;
}

/**
 * Pending proposals for the whole PROPERTY (across every thread) — value-aware, so
 * the model dedups true repeats yet still proposes a correction when a value here
 * has since changed. Falls back to the conversation when no property is linked.
 */
async function loadPendingProposalDigest(
  propertyId: string | null,
  conversationId: string,
): Promise<string[]> {
  const base = getSupabaseServer()
    .from('proposed_knowledge')
    .select('target, summary')
    .eq('status', 'pending');
  const { data, error } = await (propertyId
    ? base.eq('property_id', propertyId)
    : base.eq('conversation_id', conversationId));
  if (error) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of (data ?? []) as Array<{ target: unknown; summary: string | null }>) {
    const line = describePendingTarget(row.target) ?? (row.summary ?? '').trim();
    if (line && !seen.has(line)) {
      seen.add(line);
      out.push(line);
    }
  }
  return out;
}

function parseRoomRef(raw: unknown, rooms: KnowledgeRoom[]): RoomRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const scope = r.scope === 'exterior' ? 'exterior' : r.scope === 'interior' ? 'interior' : null;
  let id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : null;
  // Only honor an id that actually exists; otherwise treat as a create.
  const existing = id ? rooms.find((room) => room.id === id) : undefined;
  if (id && !existing) id = null;
  // Derive scope from the existing room when referenced; require it on create.
  const finalScope = existing ? (existing.scope === 'exterior' ? 'exterior' : 'interior') : scope;
  if (!finalScope) return null;
  const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim() : null;
  return { id, scope: finalScope, title };
}

function parseTarget(
  raw: unknown,
  rooms: KnowledgeRoom[],
  contacts: KnowledgeContact[],
): KnowledgeTarget | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const kind = t.kind;

  if (kind === 'room_note') {
    const room = parseRoomRef(t.room, rooms);
    const notes = typeof t.notes === 'string' ? t.notes.trim() : '';
    if (!room || !notes) return null;
    return { kind: 'room_note', room, notes };
  }
  if (kind === 'attribute') {
    const room = parseRoomRef(t.room, rooms);
    const a = t.attribute;
    if (!room || !a || typeof a !== 'object') return null;
    const aa = a as Record<string, unknown>;
    const tags = normalizeTags(aa.tags);
    const title = typeof aa.title === 'string' ? aa.title.trim() : '';
    if (!title) return null;
    const body = typeof aa.body === 'string' && aa.body.trim() ? aa.body.trim() : null;
    return { kind: 'attribute', room, attribute: { tags, title, body } };
  }
  if (kind === 'connectivity') {
    const f =
      t.fields && typeof t.fields === 'object' ? (t.fields as Record<string, unknown>) : {};
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const fields: ConnectivityFields = {
      wifi_ssid: str(f.wifi_ssid),
      wifi_password: str(f.wifi_password),
      wifi_router_location: str(f.wifi_router_location),
    };
    if (!fields.wifi_ssid && !fields.wifi_password && !fields.wifi_router_location) return null;
    return { kind: 'connectivity', fields };
  }
  if (kind === 'contact') {
    const c =
      t.contact && typeof t.contact === 'object' ? (t.contact as Record<string, unknown>) : null;
    if (!c) return null;
    const name = typeof c.name === 'string' ? c.name.trim() : '';
    if (!name) return null;
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    // Honor a contact id only when it matches an existing contact; else create.
    let id = typeof c.id === 'string' && c.id.trim() ? c.id.trim() : null;
    if (id && !contacts.some((x) => x.id === id)) id = null;
    return {
      kind: 'contact',
      contact: {
        id,
        tags: normalizeContactTags(c.tags),
        name,
        role: str(c.role),
        phone: str(c.phone),
        email: str(c.email),
        schedule: str(c.schedule),
        notes: str(c.notes),
      },
    };
  }
  return null;
}

function parseTriageJson(
  raw: string,
  rooms: KnowledgeRoom[],
  contacts: KnowledgeContact[],
): KnowledgeTriageResult | null {
  const unfenced = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const reasoning = typeof o.reasoning === 'string' ? o.reasoning : '';
  const rawProposals = Array.isArray(o.proposals) ? o.proposals : [];
  const proposals: KnowledgeProposalDraft[] = [];
  for (const p of rawProposals) {
    if (!p || typeof p !== 'object') continue;
    const pp = p as Record<string, unknown>;
    const target = parseTarget(pp.target, rooms, contacts);
    if (!target) continue;
    const summary = typeof pp.summary === 'string' && pp.summary.trim() ? pp.summary.trim() : describeTarget(target);
    const guest_visible = pp.guest_visible === true;
    const pReasoning = typeof pp.reasoning === 'string' ? pp.reasoning : '';
    proposals.push({ target, summary, guest_visible, reasoning: pReasoning });
  }
  return { proposals, reasoning };
}

/** Fallback human-readable summary if the model omits one. */
export function describeTarget(target: KnowledgeTarget): string {
  // Roomless kinds first — they have no `target.room` to read.
  if (target.kind === 'connectivity') {
    const set = [
      target.fields.wifi_ssid ? 'network' : null,
      target.fields.wifi_password ? 'password' : null,
      target.fields.wifi_router_location ? 'router location' : null,
    ]
      .filter(Boolean)
      .join(' + ');
    return `Wi-Fi — ${set || 'details'}`;
  }
  if (target.kind === 'contact') {
    const tags = target.contact.tags.join('/');
    const verb = target.contact.id ? 'Contact update' : 'Contact';
    return `${verb} — ${target.contact.name}${tags ? ` (${tags})` : ''}`;
  }
  const where = `${target.room.scope === 'exterior' ? 'Exterior' : 'Interior'} → ${target.room.title || 'room'}`;
  if (target.kind === 'room_note') return `${where} — note: ${target.notes.slice(0, 80)}`;
  const tagLabel = target.attribute.tags.join('/') || 'attribute';
  return `${where} — ${tagLabel}: ${target.attribute.title}`;
}

export async function generateProposedKnowledgeFromContext(
  ctx: ConversationContext,
): Promise<KnowledgeTriageResult> {
  const nowMs = Date.now();
  const sent = ctx.messages.filter((m) => !isFuture(m, nowMs));
  const recent = sent.slice(-MAX_THREAD_MESSAGES);
  if (recent.length === 0) {
    return { proposals: [], reasoning: 'No messages to review.' };
  }

  const propertyId = ctx.conversation.property_id ?? null;
  const [{ block: knowledgeBlock, rooms, contacts }, pendingDigest] = await Promise.all([
    loadKnowledgeContext(propertyId),
    loadPendingProposalDigest(propertyId, ctx.conversation.id),
  ]);

  const propertyName =
    ctx.reservation?.property_name ?? ctx.conversation.property_name ?? null;
  const transcript = recent
    .map((m) => `${m.direction === 'outbound' ? 'Host' : 'Guest'}: ${(m.body ?? '').trim() || '(no text)'}`)
    .join('\n');

  const userParts = [
    propertyName ? `Property: ${propertyName}` : 'Property: (unnamed)',
    '',
    'Current property knowledge (do NOT propose anything already here):',
    knowledgeBlock,
  ];
  if (pendingDigest.length) {
    userParts.push(
      '',
      'Already proposed and awaiting review (do NOT duplicate — but DO propose a correction if one of these values has since changed):',
      pendingDigest.map((s) => `- ${s}`).join('\n'),
    );
  }
  userParts.push(
    '',
    'Conversation (oldest to newest):',
    transcript,
    '',
    'Decide whether this conversation established any durable, reusable fact about the property worth saving (usually none). Respond with the JSON object only.',
  );

  const client = getAnthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: TRIAGE_MAX_TOKENS,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userParts.join('\n') }],
  });

  const text = response.content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  const parsed = parseTriageJson(text, rooms, contacts);
  if (!parsed) {
    console.warn('[knowledge triage] unparseable model output', { raw: text.slice(0, 200) });
    return { proposals: [], reasoning: 'Unparseable triage output.' };
  }
  return parsed;
}

function isFuture(m: GuestMessageRecord, nowMs: number): boolean {
  const ts = m.sent_at;
  return !!ts && new Date(ts).getTime() > nowMs;
}

export async function generateProposedKnowledge(
  conversationId: string,
): Promise<KnowledgeTriageResult> {
  const ctx = await getConversationContext(conversationId);
  if (!ctx) throw new Error('Conversation not found');
  return generateProposedKnowledgeFromContext(ctx);
}
