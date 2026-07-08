import type { TextBlock } from '@anthropic-ai/sdk/resources/messages';
import { getAnthropic, MODEL } from '@/src/agent/anthropic';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { loadPropertyKnowledge } from '@/src/server/properties/propertyKnowledge';
import { ATTRIBUTE_TAGS, normalizeTags, type AttributeTag } from '@/lib/propertyAttributes';
import {
  getConversationContext,
  type ConversationContext,
} from './conversationContext';
import type { GuestMessageRecord } from '@/lib/messages';

// Knowledge-triage generator — the concierge's "did this conversation teach us
// something durable about the PROPERTY worth saving for next time?" pass. The
// operator-facing sibling of draftReply/draftTask. It reads the conversation AND
// the property's current knowledge tree, and proposes additions (a room note or
// a room attribute) — rarely. The result compounds: an accepted, guest-visible
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

export type KnowledgeTarget =
  | { kind: 'room_note'; room: RoomRef; notes: string }
  | { kind: 'attribute'; room: RoomRef; attribute: { tags: AttributeTag[]; title: string; body: string | null } };

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

WHERE to put each fact (choose the best target):
- A discrete thing tied to a specific room/area — an appliance, amenity, safety item, utility, or a quirk about a particular object → an ATTRIBUTE under that room. Tag it appropriately (you may apply multiple tags). Use an existing room when one fits (reference its id); if the relevant room clearly exists in the property but isn't in the list, create it (set room.id to null and give scope + title). For a property-wide fact not tied to a specific room, create or reuse a general/whole-property area (scope "interior") and attach the attribute there.
- A general characteristic or recurring fact about a room or area AS A WHOLE (e.g. "basement tends to smell", "landscaper comes every other Friday" for the yard) → a ROOM NOTE on that room's notes.

Rooms have a scope ("interior" or "exterior") and a title. Valid attribute tags: ${ATTRIBUTE_TAGS.join(', ')} (use "quirk" for a quirky behavior, "appliance" for a device, "amenity" for a guest amenity, "safety" for a hazard, "utility" for shutoffs/utilities, "access" for entry, "other" otherwise). You may combine tags (e.g. a guest-facing device = ["appliance","amenity"]).

VISIBILITY: set guest_visible true when this is something you'd happily share with any guest (how to use an amenity, a TV input, parking, wifi). Set it false when it's internal (an operational note or anything you would not tell a guest).

Output: respond with ONLY a single JSON object, no prose, no code fences:
{"proposals": [{"target": <Target>, "summary": string, "guest_visible": boolean, "reasoning": string}], "reasoning": string}
"proposals" is an array of zero or more (usually zero or one). "summary" is a short human-readable line like "Living Room - quirk: TV must be on HDMI 2".
A <Target> is exactly one of:
- {"kind":"room_note","room":{"id":string|null,"scope":"interior"|"exterior","title":string|null},"notes":string}
- {"kind":"attribute","room":{"id":string|null,"scope":"interior"|"exterior","title":string|null},"attribute":{"tags":string[],"title":string,"body":string|null}}
Keep "reasoning" to one short sentence.`;

interface KnowledgeRoom {
  id: string;
  scope: string;
  title: string | null;
  notes: string | null;
  attributes: Array<{ tags: AttributeTag[]; title: string }>;
}

/** Compact the property's current knowledge into prompt text for placement + dedup. */
async function loadKnowledgeContext(propertyId: string | null): Promise<{
  block: string;
  rooms: KnowledgeRoom[];
}> {
  if (!propertyId) return { block: '(no property linked)', rooms: [] };
  const knowledge = await loadPropertyKnowledge(propertyId);
  if (!knowledge) return { block: '(property knowledge unavailable)', rooms: [] };

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
  return { block: lines.join('\n'), rooms };
}

/** Existing pending/accepted knowledge-proposal summaries for this conversation (dedup). */
async function loadExistingProposalSummaries(conversationId: string): Promise<string[]> {
  const { data, error } = await getSupabaseServer()
    .from('proposed_knowledge')
    .select('summary, status')
    .eq('conversation_id', conversationId)
    .in('status', ['pending', 'accepted']);
  if (error) return [];
  return ((data ?? []) as Array<{ summary: string | null }>)
    .map((r) => (r.summary ?? '').trim())
    .filter(Boolean);
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

function parseTarget(raw: unknown, rooms: KnowledgeRoom[]): KnowledgeTarget | null {
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
  return null;
}

function parseTriageJson(raw: string, rooms: KnowledgeRoom[]): KnowledgeTriageResult | null {
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
    const target = parseTarget(pp.target, rooms);
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
  const [{ block: knowledgeBlock, rooms }, existingSummaries] = await Promise.all([
    loadKnowledgeContext(propertyId),
    loadExistingProposalSummaries(ctx.conversation.id),
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
  if (existingSummaries.length) {
    userParts.push(
      '',
      'Already proposed for this conversation (do NOT duplicate):',
      existingSummaries.map((s) => `- ${s}`).join('\n'),
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

  const parsed = parseTriageJson(text, rooms);
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
