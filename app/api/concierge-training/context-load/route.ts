import { NextResponse, type NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';
import { getAnthropic, MODEL } from '@/src/agent/anthropic';
import {
  formatTrainingForPrompt,
  formatTrainingIndexForPrompt,
  type TrainingRule,
  type TrainingExample,
} from '@/src/server/messages/conciergeTraining';

// GET /api/concierge-training/context-load?category=reply|task
//
// How many tokens the org's standing instructions actually cost on every draft.
//
// The training page used to estimate this client-side as `chars / 4` over raw
// title + instructions + example text. That was wrong twice over. The divisor was
// calibrated for a tokenizer we no longer use — the current model counts roughly a
// third more tokens for identical text — and the character count ignored everything
// the renderer adds around the fields: a "### " heading per block, the blank lines
// between blocks, the numbered example headings, and a ~70-character preamble on
// every block that carries worked examples.
//
// So this renders the SAME strings the draft path injects, via the same two
// formatters, and asks the API to count them. Token counting is free and exact.
//
// The durability argument is the real one: a hardcoded divisor silently goes stale
// on the next model change, which is precisely how it broke this time. Counting
// against MODEL means the number re-derives itself whenever the model moves, with
// no one having to remember this file exists.

export const maxDuration = 30;

interface Row {
  id: string;
  title: string | null;
  instructions: string | null;
  tier: string | null;
  is_active: boolean;
}

/** Shape a DB row into what the prompt formatters expect. */
function toRule(row: Row, examples: TrainingExample[]): TrainingRule {
  return {
    id: row.id,
    title: row.title ?? '',
    instructions: row.instructions ?? '',
    applies_to_all: true, // irrelevant to rendering; the formatters ignore it
    tier: row.tier === 'situational' ? 'situational' : 'always',
    property_ids: [],
    examples,
  };
}

export async function GET(request: NextRequest) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  const category = request.nextUrl.searchParams.get('category') === 'task' ? 'task' : 'reply';

  // RLS-scoped: the user's own org only. Mirrors the list route's ordering so the
  // rendered string matches what a draft would actually see.
  const { data: ruleRows, error: rulesErr } = await supabase
    .from('concierge_training')
    .select('id, title, instructions, tier, is_active')
    .eq('category', category)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (rulesErr) {
    return NextResponse.json({ error: rulesErr.message }, { status: 500 });
  }
  const rows = (ruleRows ?? []) as Row[];

  // Examples ride into the always-tier block, so they are part of the standing
  // cost and must be counted with it.
  const { data: exampleRows } = await supabase
    .from('concierge_training_examples')
    .select('id, training_id, label, transcript')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  const examplesByRule = new Map<string, TrainingExample[]>();
  for (const e of (exampleRows ?? []) as Array<{
    id: string;
    training_id: string;
    label: string | null;
    transcript: string | null;
  }>) {
    const list = examplesByRule.get(e.training_id) ?? [];
    list.push({ id: e.id, label: e.label, transcript: e.transcript ?? '' });
    examplesByRule.set(e.training_id, list);
  }

  const rules = rows.map((r) => toRule(r, examplesByRule.get(r.id) ?? []));
  const always = rules.filter((r) => r.tier !== 'situational');
  const situational = rules.filter((r) => r.tier === 'situational');

  // Both of these are injected on EVERY draft: the always block in full, and the
  // situational index as a title + id line per procedure. The old estimate charged
  // situational blocks a flat invented 50 tokens; the index is real text, so count it.
  const alwaysText = formatTrainingForPrompt(always);
  const indexText = formatTrainingIndexForPrompt(situational);

  async function countTokens(text: string): Promise<number> {
    if (!text.trim()) return 0;
    const res = await getAnthropic().messages.countTokens({
      model: MODEL,
      messages: [{ role: 'user', content: text }],
    });
    return res.input_tokens;
  }

  try {
    // Counted together in one call, then split proportionally is NOT good enough —
    // they're separate prompt regions and the operator tunes them separately, so
    // each gets its own count.
    const [alwaysTokens, indexTokens] = await Promise.all([
      countTokens(alwaysText),
      countTokens(indexText),
    ]);

    return NextResponse.json({
      category,
      model: MODEL,
      always_tokens: alwaysTokens,
      index_tokens: indexTokens,
      total_tokens: alwaysTokens + indexTokens,
      always_count: always.length,
      situational_count: situational.length,
    });
  } catch (err) {
    // The bar is a guardrail, not a gate. A counting failure should leave the page
    // working rather than block it; the client falls back to showing nothing.
    console.error('[context-load] token count failed', err);
    return NextResponse.json({ error: 'Could not count tokens' }, { status: 502 });
  }
}
