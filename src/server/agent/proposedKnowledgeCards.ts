import type { SupabaseClient } from '@supabase/supabase-js';

// Card-shaped proposed_knowledge rows for the ops agent chat, mirroring the
// shaping in app/api/messages/[conversationId]/route.ts so the chat renders
// agent knowledge proposals with the exact ProposedKnowledge bubble the inbox
// uses — plus the property fields, which the inbox gets from its conversation
// context but the chat must carry per card.
//
// Same dual-caller contract as proposedTaskCards.ts: loadSessionMessages
// (service client) for rehydration, GET /api/proposed-knowledge (session
// client, RLS-scoped) for post-decision refresh.

export interface AgentProposedKnowledgeCard {
  id: string;
  summary: string;
  guest_visible: boolean;
  triggering_message_id: string | null;
  /** KnowledgeTargetData shape (see components/messages/ProposedKnowledge). */
  target: unknown;
  property_id: string | null;
  property_name: string | null;
  status: 'pending' | 'accepted' | 'dismissed';
  decided_by_name: string | null;
  decided_at: string | null;
  resulting_resource_type: string | null;
  resulting_resource_id: string | null;
}

const CARD_COLUMNS =
  'id, summary, guest_visible, triggering_message_id, target, property_id, properties(name), status, decided_by, decided_at, resulting_resource_type, resulting_resource_id';

/**
 * Load knowledge-proposal rows by id, shaped for the ProposedKnowledge bubble.
 * Rows the client cannot see (RLS) or that don't exist are silently absent.
 * Order follows the input id order.
 */
export async function loadProposedKnowledgeCards(
  db: SupabaseClient,
  ids: string[],
): Promise<AgentProposedKnowledgeCard[]> {
  const wanted = Array.from(new Set(ids.filter((v) => typeof v === 'string' && v)));
  if (wanted.length === 0) return [];

  const { data, error } = await db
    .from('proposed_knowledge')
    .select(CARD_COLUMNS)
    .in('id', wanted);
  if (error) {
    console.error('[agent proposals] knowledge card load failed', { error });
    return [];
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>;

  const deciderIds = Array.from(
    new Set(
      rows
        .map((r) => r.decided_by as string | null)
        .filter((v): v is string => !!v),
    ),
  );
  const deciderNames = new Map<string, string>();
  if (deciderIds.length) {
    const { data: deciders } = await db
      .from('users')
      .select('id, name')
      .in('id', deciderIds);
    for (const u of (deciders ?? []) as Array<{ id: string; name: string | null }>) {
      deciderNames.set(u.id, u.name ?? '');
    }
  }

  const byId = new Map<string, AgentProposedKnowledgeCard>();
  for (const r of rows) {
    const decidedBy = (r.decided_by as string | null) ?? null;
    byId.set(r.id as string, {
      id: r.id as string,
      summary: (r.summary as string | null) ?? '',
      guest_visible: Boolean(r.guest_visible),
      triggering_message_id: (r.triggering_message_id as string | null) ?? null,
      target: r.target ?? null,
      property_id: (r.property_id as string | null) ?? null,
      property_name: ((r.properties as { name: string | null } | null)?.name) ?? null,
      status:
        ((r.status as string | null) ??
          'pending') as AgentProposedKnowledgeCard['status'],
      decided_by_name: decidedBy ? (deciderNames.get(decidedBy) ?? null) : null,
      decided_at: (r.decided_at as string | null) ?? null,
      resulting_resource_type: (r.resulting_resource_type as string | null) ?? null,
      resulting_resource_id: (r.resulting_resource_id as string | null) ?? null,
    });
  }

  return wanted
    .map((id) => byId.get(id))
    .filter((c): c is AgentProposedKnowledgeCard => c !== undefined);
}
