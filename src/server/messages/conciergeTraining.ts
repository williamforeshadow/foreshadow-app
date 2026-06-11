import { getSupabaseServer } from '@/lib/supabaseServer';

// Concierge Training loader — the per-property "agent intelligence" rules
// (named operating procedures) the guest-messaging agent references when
// drafting replies. Read in two places:
//   - draftReply.ts auto-injects the conversation property's rules into every
//     draft (the inbox path has no tool loop, so a tool alone can't reach it).
//   - the find_concierge_training agent tool, for operator Q&A.
// Voice/grounding stays in draftReply.ts; this module only fetches + formats.

export interface TrainingRule {
  id: string;
  title: string;
  instructions: string;
  applies_to_all: boolean;
  /** Properties this rule is scoped to. Empty when applies_to_all. */
  property_ids: string[];
}

interface TrainingRow {
  id: string;
  title: string | null;
  instructions: string | null;
  applies_to_all: boolean | null;
  is_active: boolean | null;
  sort_order: number | null;
  created_at: string | null;
}

/** Which drafting path a rule belongs to: guest replies or task triage. */
export type TrainingCategory = 'reply' | 'task';

/**
 * Active training rules that apply to a property: every rule with
 * applies_to_all = true, plus rules explicitly linked to `propertyId`. When
 * `propertyId` is null (unknown property), only global rules are returned.
 * Filtered to the given `category` ('reply' by default) so reply rules never
 * bleed into the task triage prompt and vice versa. Ordered by sort_order then
 * created_at. property_ids is left empty here — the draft path doesn't need it;
 * the CRUD/list path hydrates associations itself.
 */
export async function getConciergeTrainingForProperty(
  propertyId: string | null,
  category: TrainingCategory = 'reply',
): Promise<TrainingRule[]> {
  const supabase = getSupabaseServer();

  // Collect candidate rule ids: global rules + rules linked to this property.
  let linkedIds: string[] = [];
  if (propertyId) {
    const { data: links, error: linkErr } = await supabase
      .from('concierge_training_properties')
      .select('training_id')
      .eq('property_id', propertyId);
    if (linkErr) throw new Error(linkErr.message);
    linkedIds = ((links ?? []) as Array<{ training_id: string }>).map((r) => r.training_id);
  }

  let q = supabase
    .from('concierge_training')
    .select('id, title, instructions, applies_to_all, is_active, sort_order, created_at')
    .eq('is_active', true)
    .eq('category', category);

  // Global rules OR (when we have a property) the linked ones.
  if (linkedIds.length > 0) {
    const idList = linkedIds.map((id) => `"${id}"`).join(',');
    q = q.or(`applies_to_all.eq.true,id.in.(${idList})`);
  } else {
    q = q.eq('applies_to_all', true);
  }

  const { data, error } = await q
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);

  const linkedSet = new Set(linkedIds);
  return ((data ?? []) as TrainingRow[]).map((r) => ({
    id: r.id,
    title: (r.title ?? '').trim(),
    instructions: (r.instructions ?? '').trim(),
    applies_to_all: Boolean(r.applies_to_all),
    property_ids: r.applies_to_all
      ? []
      : propertyId && linkedSet.has(r.id)
        ? [propertyId]
        : [],
  }));
}

/**
 * Render rules into a compact prompt block. Returns '' when there are none so
 * callers can skip the section entirely.
 */
export function formatTrainingForPrompt(rules: TrainingRule[]): string {
  const usable = rules.filter((r) => r.title || r.instructions);
  if (usable.length === 0) return '';
  return usable
    .map((r) => {
      const title = r.title || 'Untitled procedure';
      const body = r.instructions || '(no details provided)';
      return `### ${title}\n${body}`;
    })
    .join('\n\n');
}
