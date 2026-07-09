import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAuthContext } from '@/lib/requireAuthContext';
import { normalizeTags } from '@/lib/propertyAttributes';
import {
  encodeFieldResourceId,
  RESOURCE_FIELD_SETS,
  type VisibilityResourceType,
} from '@/lib/propertyKnowledgeVisibility';
import type { KnowledgeTarget } from '@/src/server/messages/draftKnowledge';

// Accept / dismiss a concierge-proposed knowledge addition.
//
// A proposed_knowledge row carries a structured `target`. Accepting (the human
// click is the confirmation) replays it through the SAME non-token property
// write path the Knowledge UI uses — create a room if needed, then a room note
// or an attribute — and, when the reviewer chose guest-visible, unlocks the new
// item's default fields via property_knowledge_visibility (per-field model).

export const maxDuration = 60;

type Supabase = SupabaseClient;

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

/** Resolve the target room: reuse an existing one (by id), else create it. */
async function ensureRoom(
  supabase: Supabase,
  propertyId: string,
  room: Extract<KnowledgeTarget, { kind: 'room_note' | 'attribute' }>['room'],
  actorId: string,
  orgId: string,
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
  const title = room.title?.trim() || 'New room';
  const { data, error } = await supabase
    .from('property_rooms')
    .insert({
      property_id: propertyId,
      scope: room.scope,
      title,
      notes: null,
      sort_order: 0,
      created_by_user_id: actorId,
      updated_by_user_id: actorId,
      org_id: orgId,
    })
    .select('id, scope, notes')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'failed to create room');
  return { id: data.id as string, scope: data.scope as string, notes: null };
}

/** Unlock a set of per-field visibility entries (best-effort idempotent upsert). */
async function unlockFields(
  supabase: Supabase,
  propertyId: string,
  entries: Array<{ type: VisibilityResourceType; resourceId: string }>,
  actorId: string,
  orgId: string,
): Promise<void> {
  if (entries.length === 0) return;
  await supabase
    .from('property_knowledge_visibility')
    .upsert(
      entries.map((e) => ({
        property_id: propertyId,
        resource_type: e.type,
        resource_id: e.resourceId,
        created_by_user_id: actorId,
        org_id: orgId,
      })),
      { onConflict: 'property_id,resource_type,resource_id', ignoreDuplicates: true },
    );
}

// POST — accept: write the knowledge, optionally unlock it, mark accepted.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, appUser, orgId } = ctx;

  const { id } = await context.params;
  const actorId = appUser.id;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

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

  // Optional inline edits from the proposal bubble, merged over the stored
  // target. Omitted fields keep the concierge's draft.
  const editTitle = typeof body.title === 'string' ? body.title.trim() : undefined;
  const editBody = typeof body.body === 'string' ? body.body : undefined;
  const editNotes = typeof body.notes === 'string' ? body.notes : undefined;
  const editTags = Array.isArray(body.tags) ? normalizeTags(body.tags) : undefined;

  if (!proposal.property_id) {
    return NextResponse.json(
      { error: 'This conversation has no linked property, so the proposal cannot be saved.' },
      { status: 400 },
    );
  }
  const propertyId = proposal.property_id;

  let resourceType: string;
  let resourceId: string;
  // The per-field visibility entries to unlock when guest_visible is chosen.
  let visibilityEntries: Array<{ type: VisibilityResourceType; resourceId: string }> = [];

  try {
    if (target.kind === 'room_note') {
      const room = await ensureRoom(supabase, propertyId, target.room, actorId, orgId);
      const notesText =
        editNotes != null && editNotes.trim() !== '' ? editNotes.trim() : target.notes;
      // Append to any existing room notes rather than overwrite.
      const nextNotes = room.notes ? `${room.notes}\n${notesText}` : notesText;
      const { error } = await supabase
        .from('property_rooms')
        .update({ notes: nextNotes, updated_by_user_id: actorId, updated_at: new Date().toISOString() })
        .eq('id', room.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      resourceType = 'room';
      resourceId = room.id;
      // A guest-visible room is all-or-nothing: unlock its whole field set
      // (title/notes/photos) so it matches the Guest Visibility toggle.
      visibilityEntries = RESOURCE_FIELD_SETS.room_field.map((field) => ({
        type: 'room_field' as const,
        resourceId: encodeFieldResourceId(room.id, field),
      }));
    } else {
      // attribute
      const room = await ensureRoom(supabase, propertyId, target.room, actorId, orgId);
      const attrTitle = editTitle && editTitle !== '' ? editTitle : target.attribute.title;
      const attrBody =
        editBody !== undefined
          ? editBody.trim() === ''
            ? null
            : editBody.trim()
          : target.attribute.body;
      const attrTags = editTags !== undefined ? editTags : normalizeTags(target.attribute.tags);
      const { data: attribute, error } = await supabase
        .from('property_attributes')
        .insert({
          property_id: propertyId,
          room_id: room.id,
          scope: room.scope,
          tags: attrTags,
          title: attrTitle,
          body: attrBody,
          sort_order: 0,
          created_by_user_id: actorId,
          updated_by_user_id: actorId,
          org_id: orgId,
        })
        .select('id')
        .single();
      if (error || !attribute) {
        return NextResponse.json({ error: error?.message ?? 'failed to create attribute' }, { status: 500 });
      }
      resourceType = 'attribute';
      resourceId = attribute.id as string;
      // A guest-visible attribute is all-or-nothing: unlock its whole field set
      // (title/body/tags/photos) so it matches the Guest Visibility toggle.
      visibilityEntries = RESOURCE_FIELD_SETS.attribute_field.map((field) => ({
        type: 'attribute_field' as const,
        resourceId: encodeFieldResourceId(resourceId, field),
      }));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to write knowledge';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (guestVisible) {
    await unlockFields(supabase, propertyId, visibilityEntries, actorId, orgId);
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
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, appUser } = ctx;

  const { id } = await context.params;
  const actorId = appUser.id;

  const { data, error } = await supabase
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
