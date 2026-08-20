import type { SupabaseClient } from '@supabase/supabase-js';
import { taskUrl } from '@/src/lib/links';

// Card-shaped proposed_tasks rows for the ops agent chat.
//
// The chat panel renders agent task proposals with the same ProposedTask
// component the concierge inbox uses, so this loader shapes rows the same way
// app/api/messages/[conversationId]/route.ts does — plus the property fields,
// which the inbox gets from its conversation context but the chat has to carry
// on each card.
//
// Used by two callers with different clients:
//   - loadSessionMessages (service client) for transcript rehydration
//   - GET /api/proposed-tasks (session client, RLS-scoped) for post-decision
//     refresh from the chat panel

export interface AgentProposedTaskCard {
  id: string;
  title: string;
  description: string | null;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  triggering_message_id: string | null;
  department_id: string | null;
  department_name: string | null;
  suggested_assignee_ids: string[];
  scheduled_date: string | null;
  scheduled_time: string | null;
  property_id: string | null;
  property_name: string | null;
  status: 'pending' | 'accepted' | 'dismissed';
  decided_by_name: string | null;
  decided_at: string | null;
  resulting_task_id: string | null;
  task_url: string | null;
}

const CARD_COLUMNS =
  'id, title, description, priority, triggering_message_id, department_id, departments(name), suggested_assignee_ids, scheduled_date, scheduled_time, property_id, properties(name), status, decided_by, decided_at, resulting_task_id';

/**
 * Load proposal rows by id, shaped for the ProposedTask card. Rows the client
 * cannot see (RLS) or that don't exist are silently absent — callers render
 * whatever comes back. Order follows the input id order.
 */
export async function loadProposedTaskCards(
  db: SupabaseClient,
  ids: string[],
): Promise<AgentProposedTaskCard[]> {
  const wanted = Array.from(new Set(ids.filter((v) => typeof v === 'string' && v)));
  if (wanted.length === 0) return [];

  const { data, error } = await db
    .from('proposed_tasks')
    .select(CARD_COLUMNS)
    .in('id', wanted);
  if (error) {
    console.error('[agent proposals] card load failed', { error });
    return [];
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>;

  // Decider names for tombstones, one batched lookup.
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

  const byId = new Map<string, AgentProposedTaskCard>();
  for (const r of rows) {
    const resultingTaskId = (r.resulting_task_id as string | null) ?? null;
    const decidedBy = (r.decided_by as string | null) ?? null;
    byId.set(r.id as string, {
      id: r.id as string,
      title: (r.title as string | null) ?? '',
      description: (r.description as string | null) ?? null,
      priority:
        ((r.priority as string | null) ?? 'medium') as AgentProposedTaskCard['priority'],
      triggering_message_id: (r.triggering_message_id as string | null) ?? null,
      department_id: (r.department_id as string | null) ?? null,
      department_name:
        ((r.departments as { name: string | null } | null)?.name) ?? null,
      suggested_assignee_ids: (r.suggested_assignee_ids as string[] | null) ?? [],
      scheduled_date: (r.scheduled_date as string | null) ?? null,
      scheduled_time: (r.scheduled_time as string | null) ?? null,
      property_id: (r.property_id as string | null) ?? null,
      property_name: ((r.properties as { name: string | null } | null)?.name) ?? null,
      status:
        ((r.status as string | null) ?? 'pending') as AgentProposedTaskCard['status'],
      decided_by_name: decidedBy ? (deciderNames.get(decidedBy) ?? null) : null,
      decided_at: (r.decided_at as string | null) ?? null,
      resulting_task_id: resultingTaskId,
      task_url: resultingTaskId ? taskUrl(resultingTaskId) : null,
    });
  }

  return wanted
    .map((id) => byId.get(id))
    .filter((c): c is AgentProposedTaskCard => c !== undefined);
}
