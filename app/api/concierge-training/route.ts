import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getCurrentAppUser } from '@/src/server/users/currentUser';

// Concierge Training CRUD — list + create. Per-property operating-procedure
// rules the guest-messaging agent references when drafting replies. All access
// is service-role here; the UI page is gated client-side. Mirrors the
// departments route conventions ({ error } JSON, 23505 -> 409).

export type ConciergeTrainingCategory = 'reply' | 'task';
export type ConciergeTrainingTier = 'always' | 'situational';

export interface ConciergeTrainingRule {
  id: string;
  title: string;
  instructions: string;
  /** Which drafting path the rule feeds: guest replies or task triage. */
  category: ConciergeTrainingCategory;
  /**
   * 'always' → pinned into every reply/task draft. 'situational' → listed by
   * title only and loaded on demand when the guest's message matches.
   */
  tier: ConciergeTrainingTier;
  applies_to_all: boolean;
  is_active: boolean;
  sort_order: number;
  property_ids: string[];
  created_at: string;
  updated_at: string;
}

function normalizeCategory(value: unknown): ConciergeTrainingCategory {
  return value === 'task' ? 'task' : 'reply';
}

function normalizeTier(value: unknown): ConciergeTrainingTier {
  return value === 'situational' ? 'situational' : 'always';
}

// GET /api/concierge-training — all rules with their associated property ids.
export async function GET() {
  const { error: authError } = await getCurrentAppUser();
  if (authError === 'unauthenticated') {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  try {
    const supabase = getSupabaseServer();
    const { data: rows, error } = await supabase
      .from('concierge_training')
      .select('id, title, instructions, category, tier, applies_to_all, is_active, sort_order, created_at, updated_at')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { data: links, error: linkErr } = await supabase
      .from('concierge_training_properties')
      .select('training_id, property_id');
    if (linkErr) {
      return NextResponse.json({ error: linkErr.message }, { status: 500 });
    }

    const byRule = new Map<string, string[]>();
    for (const l of (links ?? []) as Array<{ training_id: string; property_id: string }>) {
      const list = byRule.get(l.training_id) ?? [];
      list.push(l.property_id);
      byRule.set(l.training_id, list);
    }

    const rules: ConciergeTrainingRule[] = ((rows ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      title: (r.title as string | null) ?? '',
      instructions: (r.instructions as string | null) ?? '',
      category: normalizeCategory(r.category),
      tier: normalizeTier(r.tier),
      applies_to_all: Boolean(r.applies_to_all),
      is_active: Boolean(r.is_active),
      sort_order: (r.sort_order as number | null) ?? 0,
      property_ids: byRule.get(r.id as string) ?? [],
      created_at: r.created_at as string,
      updated_at: r.updated_at as string,
    }));

    return NextResponse.json({ rules });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load concierge training';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/concierge-training — create a rule (+ property associations).
export async function POST(request: NextRequest) {
  const { user, error: authError } = await getCurrentAppUser();
  if (authError === 'unauthenticated') {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const instructions = typeof body.instructions === 'string' ? body.instructions.trim() : '';
    const category = normalizeCategory(body.category);
    const tier = normalizeTier(body.tier);
    const appliesToAll = Boolean(body.applies_to_all);
    const isActive = typeof body.is_active === 'boolean' ? body.is_active : true;
    const propertyIds: string[] = Array.isArray(body.property_ids)
      ? body.property_ids.filter((p: unknown): p is string => typeof p === 'string')
      : [];

    if (!title) {
      return NextResponse.json({ error: 'A title is required' }, { status: 400 });
    }

    const supabase = getSupabaseServer();
    const { data: rule, error } = await supabase
      .from('concierge_training')
      .insert({
        title,
        instructions,
        category,
        tier,
        applies_to_all: appliesToAll,
        is_active: isActive,
        created_by_user_id: user?.id ?? null,
        updated_by_user_id: user?.id ?? null,
      })
      .select('id, title, instructions, category, tier, applies_to_all, is_active, sort_order, created_at, updated_at')
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let property_ids: string[] = [];
    if (!appliesToAll && propertyIds.length > 0) {
      property_ids = [...new Set(propertyIds)];
      const { error: linkErr } = await supabase
        .from('concierge_training_properties')
        .insert(property_ids.map((property_id) => ({ training_id: rule.id, property_id })));
      if (linkErr) {
        return NextResponse.json({ error: linkErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({ rule: { ...rule, property_ids } }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create rule';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
