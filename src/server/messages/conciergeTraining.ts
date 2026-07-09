import { getSupabaseServer } from '@/lib/supabaseServer';

// Concierge Training loader — the per-property "agent intelligence" rules
// (named operating procedures) the guest-messaging agent references when
// drafting replies. Read in two places:
//   - draftReply.ts auto-injects the conversation property's rules into every
//     draft (the inbox path has no tool loop, so a tool alone can't reach it).
//   - the find_concierge_training agent tool, for operator Q&A.
// Voice/grounding stays in draftReply.ts; this module only fetches + formats.

export type TrainingTier = 'always' | 'situational';

/** A worked example transcript attached to a training rule. */
export interface TrainingExample {
  id: string;
  label: string | null;
  transcript: string;
}

export interface TrainingRule {
  id: string;
  title: string;
  instructions: string;
  applies_to_all: boolean;
  /**
   * 'always' → pinned into every draft. 'situational' → indexed by title and
   * loaded on demand via get_concierge_procedure. Defaults to 'always' for any
   * row missing the column.
   */
  tier: TrainingTier;
  /** Properties this rule is scoped to. Empty when applies_to_all. */
  property_ids: string[];
  /** Worked examples the model can imitate. Empty when none attached. */
  examples: TrainingExample[];
}

interface TrainingRow {
  id: string;
  title: string | null;
  instructions: string | null;
  applies_to_all: boolean | null;
  tier: string | null;
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
  orgId: string | null,
  category: TrainingCategory = 'reply',
): Promise<TrainingRule[]> {
  // Fail safe: without an org, return no rules rather than reading every org's
  // global training (this runs on the RLS-bypassing service-role client).
  if (!orgId) return [];
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
    .select('id, title, instructions, applies_to_all, tier, is_active, sort_order, created_at')
    .eq('org_id', orgId)
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

  const rows = (data ?? []) as TrainingRow[];

  // Hydrate worked examples for the matched rules in one query, grouped by rule.
  const examplesByRule = await fetchExamplesByRule(rows.map((r) => r.id));

  const linkedSet = new Set(linkedIds);
  return rows.map((r) => ({
    id: r.id,
    title: (r.title ?? '').trim(),
    instructions: (r.instructions ?? '').trim(),
    applies_to_all: Boolean(r.applies_to_all),
    tier: r.tier === 'situational' ? 'situational' : 'always',
    property_ids: r.applies_to_all
      ? []
      : propertyId && linkedSet.has(r.id)
        ? [propertyId]
        : [],
    examples: examplesByRule.get(r.id) ?? [],
  }));
}

interface ExampleRow {
  id: string;
  training_id: string;
  label: string | null;
  transcript: string | null;
}

/**
 * Load worked examples for a set of rules, grouped by training_id and ordered
 * by sort_order then created_at. Returns an empty map when there are no rules.
 */
async function fetchExamplesByRule(
  ruleIds: string[],
): Promise<Map<string, TrainingExample[]>> {
  const byRule = new Map<string, TrainingExample[]>();
  if (ruleIds.length === 0) return byRule;

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('concierge_training_examples')
    .select('id, training_id, label, transcript')
    .in('training_id', ruleIds)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as ExampleRow[]) {
    const transcript = (row.transcript ?? '').trim();
    if (!transcript) continue;
    const list = byRule.get(row.training_id) ?? [];
    list.push({ id: row.id, label: row.label?.trim() || null, transcript });
    byRule.set(row.training_id, list);
  }
  return byRule;
}

/**
 * Render rules into a compact prompt block. Returns '' when there are none so
 * callers can skip the section entirely.
 */
export function formatTrainingForPrompt(rules: TrainingRule[]): string {
  const usable = rules.filter((r) => r.title || r.instructions || r.examples.length > 0);
  if (usable.length === 0) return '';
  return usable
    .map((r) => {
      const title = r.title || 'Untitled procedure';
      const body = r.instructions || '(no details provided)';
      const examples = formatExamplesForPrompt(r.examples);
      return examples ? `### ${title}\n${body}\n\n${examples}` : `### ${title}\n${body}`;
    })
    .join('\n\n');
}

/**
 * Render worked examples as a reference block for the model. Examples are
 * imitation targets for tone and judgment — the model should not quote them
 * verbatim. Returns '' when there are none.
 */
export function formatExamplesForPrompt(examples: TrainingExample[]): string {
  const usable = examples.filter((e) => e.transcript.trim());
  if (usable.length === 0) return '';
  const body = usable
    .map((e, i) => {
      const heading = e.label ? `${i + 1}. ${e.label}` : `${i + 1}.`;
      return `${heading}\n${e.transcript.trim()}`;
    })
    .join('\n\n');
  return `Worked examples (reference for tone & judgment — do not quote verbatim):\n${body}`;
}

/**
 * Render situational rules as a compact INDEX (title + id only). The body is
 * deliberately omitted — it's loaded on demand via get_concierge_procedure when
 * the guest's message matches a listed title. Returns '' when there are none.
 */
export function formatTrainingIndexForPrompt(rules: TrainingRule[]): string {
  const usable = rules.filter((r) => r.title);
  if (usable.length === 0) return '';
  return usable.map((r) => `- ${r.title} [id: ${r.id}]`).join('\n');
}
