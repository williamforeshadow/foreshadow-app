import type { TextBlock } from '@anthropic-ai/sdk/resources/messages';
import { getAnthropic, MODEL } from '@/src/agent/anthropic';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { loadPropertyKnowledge } from '@/src/server/properties/propertyKnowledge';
import { ROOM_TYPES, CARD_TAGS, type RoomType, type CardTag } from '@/lib/propertyCards';
import {
  getConversationContext,
  type ConversationContext,
} from './conversationContext';
import type { GuestMessageRecord } from '@/lib/messages';

// Knowledge-triage generator — the concierge's "did this conversation teach us
// something durable about the PROPERTY worth saving for next time?" pass. The
// operator-facing sibling of draftReply/draftTask. It reads the conversation AND
// the property's current knowledge tree, and proposes additions (a room note, a
// room card, or a property note) — rarely. The result compounds: an accepted,
// guest-visible fact later informs the concierge's replies.
//
// Single structured call, temp 0. Domain-agnostic; what qualifies is judged from
// the conversation, not assumptions.

const TRIAGE_MAX_TOKENS = 900;
const MAX_THREAD_MESSAGES = 40;

type NoteScope = 'known_issues' | 'owner_preferences';
type RoomScope = 'interior' | 'exterior';

export interface RoomRef {
  /** Existing room id to add under, or null to create a new room. */
  id: string | null;
  scope: RoomScope;
  type: RoomType;
  title: string | null;
}

export type KnowledgeTarget =
  | { kind: 'room_note'; room: RoomRef; notes: string }
  | { kind: 'card'; room: RoomRef; card: { tag: CardTag; title: string; body: string | null } }
  | { kind: 'property_note'; scope: NoteScope; title: string | null; body: string };

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

Save it when it's a discovered fix or quirk (e.g. the TV only works on a certain input; an appliance needs a specific step), a confirmed amenity/access detail, a recurring fact (e.g. a landscaper or pool service comes on a schedule), or a known defect/issue worth recording. Do NOT save: anything specific to THIS guest, one-off logistics, a transient problem that is really just a task to do, an unresolved/uncertain issue, or anything already in the knowledge base. When unsure, propose nothing.

Ground every proposal ONLY in what the conversation actually established — never invent details, names, times, or numbers.

WHERE to put each fact (choose the best target):
- A discrete thing in a specific room/area — an appliance, amenity, safety item, utility, or a quirk about a particular object → a CARD under that room. Use an existing room when one fits (reference its id); if the relevant room clearly exists in the property but isn't in the list, create it (set room.id to null and give scope + type).
- A general characteristic or recurring fact about a room or area AS A WHOLE (e.g. "basement tends to smell", "landscaper comes every other Friday" for the yard) → a ROOM NOTE on that room's notes.
- A property-wide fact not tied to one room: a defect/issue → a property note with scope "known_issues"; an owner instruction or preference → scope "owner_preferences".

Rooms have a scope ("interior" or "exterior") and a type. Valid room types: ${ROOM_TYPES.join(', ')}. Valid card tags: ${CARD_TAGS.join(', ')} (use "quirk" for a quirky behavior, "appliance" for a device, "amenity" for a guest amenity, "safety" for a hazard, "utility" for shutoffs/utilities, "access" for entry, "other" otherwise).

VISIBILITY: set guest_visible true when this is something you'd happily share with any guest (how to use an amenity, a TV input, parking, wifi). Set it false when it's internal (a defect, an owner preference, anything you would not tell a guest).

Output: respond with ONLY a single JSON object, no prose, no code fences:
{"proposals": [{"target": <Target>, "summary": string, "guest_visible": boolean, "reasoning": string}], "reasoning": string}
"proposals" is an array of zero or more (usually zero or one). "summary" is a short human-readable line like "Living Room - quirk card: TV must be on HDMI 2".
A <Target> is exactly one of:
- {"kind":"room_note","room":{"id":string|null,"scope":"interior"|"exterior","type":string,"title":string|null},"notes":string}
- {"kind":"card","room":{"id":string|null,"scope":"interior"|"exterior","type":string,"title":string|null},"card":{"tag":string,"title":string,"body":string|null}}
- {"kind":"property_note","scope":"known_issues"|"owner_preferences","title":string|null,"body":string}
Keep "reasoning" to one short sentence.`;

interface KnowledgeRoom {
  id: string;
  scope: string;
  type: string;
  title: string | null;
  notes: string | null;
  cards: Array<{ tag: string; title: string }>;
}

/** Compact the property's current knowledge into prompt text for placement + dedup. */
async function loadKnowledgeContext(propertyId: string | null): Promise<{
  block: string;
  rooms: KnowledgeRoom[];
}> {
  if (!propertyId) return { block: '(no property linked — only property-wide notes are possible)', rooms: [] };
  const knowledge = await loadPropertyKnowledge(propertyId);
  if (!knowledge) return { block: '(property knowledge unavailable)', rooms: [] };

  const rooms: KnowledgeRoom[] = (knowledge.rooms as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    scope: (r.scope as string) ?? 'interior',
    type: (r.type as string) ?? 'other',
    title: (r.title as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    cards: ((r.property_cards as Array<Record<string, unknown>> | null) ?? []).map((c) => ({
      tag: (c.tag as string) ?? 'other',
      title: (c.title as string | null) ?? '',
    })),
  }));

  const notes = (knowledge.notes as unknown as Array<Record<string, unknown>>).map((n) => ({
    scope: (n.scope as string) ?? '',
    title: (n.title as string | null) ?? null,
    body: (n.body as string | null) ?? '',
  }));

  const lines: string[] = [];
  lines.push('Existing rooms/areas (reference a room by its id to add under it):');
  if (rooms.length === 0) {
    lines.push('- (none yet)');
  } else {
    for (const room of rooms) {
      const label = room.title || room.type;
      const noteStr = room.notes ? ` | room note: "${room.notes.slice(0, 120)}"` : '';
      const cardStr = room.cards.length
        ? ` | cards: ${room.cards.map((c) => `${c.tag} "${c.title}"`).join(', ')}`
        : '';
      lines.push(`- [id: ${room.id}] ${room.scope}/${room.type} "${label}"${noteStr}${cardStr}`);
    }
  }
  lines.push('');
  lines.push('Existing property notes:');
  if (notes.length === 0) {
    lines.push('- (none yet)');
  } else {
    for (const n of notes) {
      lines.push(`- [${n.scope}] ${n.title ? `"${n.title}": ` : ''}${n.body.slice(0, 120)}`);
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
  const type = typeof r.type === 'string' && ROOM_TYPES.includes(r.type as RoomType) ? (r.type as RoomType) : null;
  let id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : null;
  // Only honor an id that actually exists; otherwise treat as a create.
  const existing = id ? rooms.find((room) => room.id === id) : undefined;
  if (id && !existing) id = null;
  // Derive scope/type from the existing room when referenced; require them on create.
  const finalScope = existing ? (existing.scope === 'exterior' ? 'exterior' : 'interior') : scope;
  const finalType = existing ? (ROOM_TYPES.includes(existing.type as RoomType) ? (existing.type as RoomType) : 'other') : type;
  if (!finalScope || !finalType) return null;
  const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim() : null;
  return { id, scope: finalScope, type: finalType, title };
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
  if (kind === 'card') {
    const room = parseRoomRef(t.room, rooms);
    const c = t.card;
    if (!room || !c || typeof c !== 'object') return null;
    const cc = c as Record<string, unknown>;
    const tag = typeof cc.tag === 'string' && CARD_TAGS.includes(cc.tag as CardTag) ? (cc.tag as CardTag) : 'other';
    const title = typeof cc.title === 'string' ? cc.title.trim() : '';
    if (!title) return null;
    const body = typeof cc.body === 'string' && cc.body.trim() ? cc.body.trim() : null;
    return { kind: 'card', room, card: { tag, title, body } };
  }
  if (kind === 'property_note') {
    const scope: NoteScope = t.scope === 'owner_preferences' ? 'owner_preferences' : 'known_issues';
    const body = typeof t.body === 'string' ? t.body.trim() : '';
    if (!body) return null;
    const title = typeof t.title === 'string' && t.title.trim() ? t.title.trim() : null;
    return { kind: 'property_note', scope, title, body };
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
  if (target.kind === 'property_note') {
    const scope = target.scope === 'owner_preferences' ? 'Owner preferences' : 'Known issues';
    return `${scope} note: ${target.body.slice(0, 80)}`;
  }
  const where = `${target.room.scope === 'exterior' ? 'Exterior' : 'Interior'} → ${target.room.title || target.room.type}`;
  if (target.kind === 'room_note') return `${where} — note: ${target.notes.slice(0, 80)}`;
  return `${where} — ${target.card.tag} card: ${target.card.title}`;
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
