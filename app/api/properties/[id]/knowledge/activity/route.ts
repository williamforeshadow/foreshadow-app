import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 250;

function clampLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function parseOffset(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

// GET /api/properties/[id]/knowledge/activity?limit=100&offset=0
// Returns newest-first property knowledge activity rows with user metadata
// flattened for the UI.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const limit = clampLimit(req.nextUrl.searchParams.get('limit'));
  const offset = parseOffset(req.nextUrl.searchParams.get('offset'));

  const { data, error, count } = await getSupabaseServer()
    .from('property_knowledge_activity_log')
    .select(
      `
      *,
      users (id, name, email, role, avatar)
      `,
      { count: 'exact' },
    )
    .eq('property_id', id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const activities =
    data?.map((row: any) => ({
      id: row.id,
      property_id: row.property_id,
      user_id: row.user_id,
      user_name: row.users?.name ?? null,
      user_email: row.users?.email ?? null,
      user_role: row.users?.role ?? null,
      user_avatar: row.users?.avatar ?? null,
      resource_type: row.resource_type,
      resource_id: row.resource_id,
      action: row.action,
      changes: row.changes,
      subject_label: row.subject_label,
      source: row.source,
      created_at: row.created_at,
    })) ?? [];

  return NextResponse.json({
    activities,
    total: count ?? 0,
    hasMore: offset + limit < (count ?? 0),
    limit,
    offset,
  });
}
