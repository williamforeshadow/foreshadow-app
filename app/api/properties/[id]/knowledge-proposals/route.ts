import { NextResponse, type NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';

// GET /api/properties/[id]/knowledge-proposals
//
// The property-scoped action queue of PENDING concierge knowledge proposals —
// the same proposed_knowledge rows that surface in guest threads, gathered in
// one place so operators can review a week's worth at once instead of hunting
// through conversations. Pending only; newest first. Each row carries provenance
// (which conversation/guest produced it) for a "view thread" link.
//
// Accepting/dismissing still goes through /api/proposed-knowledge/[id] — this
// route is read-only. proposed_knowledge is org-scoped, so we confirm the
// property belongs to the caller's org and filter by org_id defensively.

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, orgId } = ctx;

  const { id: propertyId } = await params;

  // Confirm the property is in the caller's org before returning anything.
  const { data: prop, error: propErr } = await supabase
    .from('properties')
    .select('id')
    .eq('id', propertyId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (propErr) {
    return NextResponse.json({ error: propErr.message }, { status: 500 });
  }
  if (!prop) {
    return NextResponse.json({ error: 'Property not found' }, { status: 404 });
  }

  const { data: rows, error } = await supabase
    .from('proposed_knowledge')
    .select(
      'id, summary, guest_visible, triggering_message_id, target, conversation_id, generated_at',
    )
    .eq('property_id', propertyId)
    .eq('org_id', orgId)
    .eq('status', 'pending')
    .order('generated_at', { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rowsArr = (rows ?? []) as Array<Record<string, unknown>>;

  // Provenance: resolve each proposal's conversation to a guest name + channel.
  const convIds = Array.from(
    new Set(
      rowsArr
        .map((r) => r.conversation_id as string | null)
        .filter((v): v is string => !!v),
    ),
  );
  const convById = new Map<string, { guest_name: string | null; channel: string | null }>();
  if (convIds.length) {
    const { data: convs } = await supabase
      .from('conversations')
      .select('id, guest_name, channel')
      .in('id', convIds);
    for (const c of (convs ?? []) as Array<{
      id: string;
      guest_name: string | null;
      channel: string | null;
    }>) {
      convById.set(c.id, { guest_name: c.guest_name, channel: c.channel });
    }
  }

  const proposals = rowsArr.map((r) => {
    const conversationId = (r.conversation_id as string | null) ?? null;
    const conv = conversationId ? convById.get(conversationId) : undefined;
    return {
      // ProposedKnowledgeData shape (consumed by the shared bubble). Pending
      // only, so the decided_* / resulting_* fields are always empty.
      id: r.id as string,
      summary: (r.summary as string | null) ?? '',
      guest_visible: Boolean(r.guest_visible),
      triggering_message_id: (r.triggering_message_id as string | null) ?? null,
      target: (r.target as Record<string, unknown> | null) ?? null,
      status: 'pending' as const,
      decided_by_name: null,
      decided_at: null,
      resulting_resource_type: null,
      resulting_resource_id: null,
      // Ledger-only provenance (ignored by the bubble).
      conversation_id: conversationId,
      guest_name: conv?.guest_name ?? null,
      channel: conv?.channel ?? null,
      generated_at: (r.generated_at as string | null) ?? null,
    };
  });

  return NextResponse.json({ proposals });
}
