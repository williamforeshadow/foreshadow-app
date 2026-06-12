import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getCurrentAppUser } from '@/src/server/users/currentUser';
import { getActorUserIdFromRequest } from '@/lib/getActorFromRequest';
import { upsertPropertyNote } from '@/src/server/properties/upsertPropertyNote';
import { normalizeTagData, defaultRoomTitle, type CardTag, type RoomType } from '@/lib/propertyCards';
import type { KnowledgeTarget } from '@/src/server/messages/draftKnowledge';

// Accept / dismiss a concierge-proposed knowledge addition.
//
// A proposed_knowledge row carries a structured `target`. Accepting (the human
// click is the confirmation) replays it through the SAME non-token property write
// path the Knowledge UI uses — create a room if needed, then a room note / card,
// or a property note — and, when the reviewer chose guest-visible, unlocks the
// new item via property_knowledge_visibility.

export const maxDuration = 60;

type Supabase = ReturnType<typeof getSupabaseServer>;

interface ProposedKnowledgeRow {
  id: string;
  conversation_id: string;
  property_id: string | null;
  target: KnowledgeTarget;
  guest_visible: boolean;
  status: 'pending' | 'accepted' | 'dismissed';
  resulting_resource_type: string | null;
  resulting_resource_id: string | null;
}

async function requireUser() {
  const { user, error } = await getCurrentAppUser();
  if (error === 'unauthenticated') {
    return { response: NextResponse.json({ error: 'Not signed in' }, { status: 401 }), user: null };
  }
  if (error === 'unlinked' || !user) {
    return {
      response: NextResponse.json(
        { error: 'No Foreshadow profile is linked to this account' },
        { status: 403 },
      ),
      user: null,
    };
  }
  return { response: null, user };
}

/** Resolve the target room: reuse an existing one (by id), else create it. */
async function ensureRoom(
  supabase: Supabase,
  propertyId: string,
  room: Extract<KnowledgeTarget, { kind: 'room_note' | 'card' }>['room'],
  actorId: string,
): Promise<{ id: string; scope: string; notes: string | null }> {
  if (room.id) {
    const { data } = await supabase
      .from('property_rooms')
      .select('id, scope, notes')
      .eq('id', room.id)
      .eq('property_id', propertyId)
      .maybeSingle();
    if (data) {
      return {
        id: data.id as string,
        scope: data.scope as string,
        notes: (data.notes as string | null) ?? null,
      };
    }
    // Fall through to create when the referenced room no longer exists.
  }
  const title = room.title?.trim() || defaultRoomTitle(room.type as RoomType);
  const { data, error } = await supabase
    .from('property_rooms')
    .insert({
      property_id: propertyId,
      scope: room.scope,
      type: room.type,
      title,
      notes: null,
      sort_order: 0,
      created_by_user_id: actorId,
      updated_by_user_id: actorId,
    })
    .select('id, scope, notes')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'failed to create room');
  return { id: data.id as string, scope: data.scope as string, notes: null };
}

async function setVisible(
  supabase: Supabase,
  propertyId: string,
  resourceType: string,
  resourceId: string,
  actorId: string,
): Promise<void> {
  await supabase
    .from('property_knowledge_visibility')
    .upsert(
      {
        property_id: propertyId,
        resource_type: resourceType,
        resource_id: resourceId,
        created_by_user_id: actorId,
      },
      { onConflict: 'property_id,resource_type,resource_id', ignoreDuplicates: true },
    );
}

// POST — accept: write the knowledge, optionally unlock it, mark accepted.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { response, user } = await requireUser();
  if (response || !user) return response;

  const { id } = await context.params;
  const actorId = getActorUserIdFromRequest(request) ?? user.id;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const supabase = getSupabaseServer();
  const { data: row, error: loadErr } = await supabase
    .from('proposed_knowledge')
    .select('id, conversation_id, property_id, target, guest_visible, status, resulting_resource_type, resulting_resource_id')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });

  const proposal = row as ProposedKnowledgeRow;
  if (proposal.status !== 'pending') {
    return NextResponse.json({
      already: true,
      resource_type: proposal.resulting_resource_type,
      resource_id: proposal.resulting_resource_id,
    });
  }

  const target = proposal.target;
  const guestVisible =
    typeof body.guest_visible === 'boolean' ? body.guest_visible : proposal.guest_visible;

  // Property notes are the only target that can be property-less; room note/card
  // need a property to attach to.
  if (!proposal.property_id && target.kind !== 'property_note') {
    return NextResponse.json(
      { error: 'This conversation has no linked property, so it can only become a property note.' },
      { status: 400 },
    );
  }

  let resourceType: string;
  let resourceId: string;

  try {
    if (target.kind === 'property_note') {
      if (!proposal.property_id) {
        return NextResponse.json({ error: 'No linked property' }, { status: 400 });
      }
      const result = await upsertPropertyNote({
        property_id: proposal.property_id,
        scope: target.scope,
        title: target.title,
        body: target.body,
        actor_user_id: actorId,
        source: 'web',
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error.message }, { status: 400 });
      }
      resourceType = 'note';
      resourceId = result.note.id;
    } else if (target.kind === 'room_note') {
      const propertyId = proposal.property_id as string;
      const room = await ensureRoom(supabase, propertyId, target.room, actorId);
      // Append to any existing room notes rather than overwrite.
      const nextNotes = room.notes ? `${room.notes}\n${target.notes}` : target.notes;
      const { error } = await supabase
        .from('property_rooms')
        .update({ notes: nextNotes, updated_by_user_id: actorId, updated_at: new Date().toISOString() })
        .eq('id', room.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      resourceType = 'room';
      resourceId = room.id;
    } else {
      // card
      const propertyId = proposal.property_id as string;
      const room = await ensureRoom(supabase, propertyId, target.room, actorId);
      const { data: card, error } = await supabase
        .from('property_cards')
        .insert({
          property_id: propertyId,
          room_id: room.id,
          scope: room.scope,
          tag: target.card.tag,
          title: target.card.title,
          body: target.card.body,
          tag_data: normalizeTagData(target.card.tag as CardTag, undefined),
          sort_order: 0,
          created_by_user_id: actorId,
          updated_by_user_id: actorId,
        })
        .select('id')
        .single();
      if (error || !card) {
        return NextResponse.json({ error: error?.message ?? 'failed to create card' }, { status: 500 });
      }
      resourceType = 'card';
      resourceId = card.id as string;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to write knowledge';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (guestVisible && proposal.property_id) {
    await setVisible(supabase, proposal.property_id, resourceType, resourceId, actorId);
  }

  await supabase
    .from('proposed_knowledge')
    .update({
      status: 'accepted',
      resulting_resource_type: resourceType,
      resulting_resource_id: resourceId,
      decided_by: actorId,
      decided_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'pending');

  return NextResponse.json({
    ok: true,
    resource_type: resourceType,
    resource_id: resourceId,
    guest_visible: guestVisible,
  });
}

// DELETE — dismiss.
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { response, user } = await requireUser();
  if (response || !user) return response;

  const { id } = await context.params;
  const actorId = getActorUserIdFromRequest(request) ?? user.id;

  const { data, error } = await getSupabaseServer()
    .from('proposed_knowledge')
    .update({
      status: 'dismissed',
      decided_by: actorId,
      decided_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, dismissed: Boolean(data) });
}
