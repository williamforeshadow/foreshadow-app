import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getCurrentAppUser } from '@/src/server/users/currentUser';
import { maybeGenerateProposedReplyForExternal } from '@/src/server/messages/proposedReply';
import { maybeGenerateProposedTaskForExternal } from '@/src/server/messages/proposedTask';
import { maybeGenerateProposedKnowledgeForExternal } from '@/src/server/messages/proposedKnowledge';

// Dev-only sandbox: spin up fake guest conversations that look real to the
// inbox and the AI, so UI work doesn't depend on live Hostaway traffic.
//
// Sandbox conversations use source='sandbox' and a synthetic
// external_conversation_id, so the Hostaway ingest (which matches on
// source+external id) never touches them. Generation reuses the EXACT eager
// hooks the webhook calls, so a sandbox guest message behaves identically to a
// real one (proposed reply + task triage + notifications).
//
// Disabled in production. Cleanup ('reset') deletes every sandbox conversation;
// guest_messages and proposed_tasks cascade via their FKs.

export const maxDuration = 60;

const SANDBOX_SOURCE = 'sandbox';

function devGuard(): NextResponse | null {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'Sandbox is disabled in production.' },
      { status: 403 },
    );
  }
  return null;
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

function uid(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function dateOnly(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

interface SeedMessage {
  role: 'guest' | 'host';
  body: string;
}

type Supabase = ReturnType<typeof getSupabaseServer>;

async function resolveProperty(
  supabase: Supabase,
  propertyId: string | null,
): Promise<{ id: string; name: string } | null> {
  if (propertyId) {
    const { data } = await supabase
      .from('properties')
      .select('id, name')
      .eq('id', propertyId)
      .maybeSingle();
    return data ? { id: data.id as string, name: data.name as string } : null;
  }
  const { data } = await supabase
    .from('properties')
    .select('id, name')
    .eq('is_active', true)
    .order('name', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ? { id: data.id as string, name: data.name as string } : null;
}

/** Insert messages for a conversation and refresh its denormalized summary. */
async function insertMessagesAndSummarize(
  supabase: Supabase,
  args: {
    conversationId: string;
    externalId: string;
    guestName: string;
    propertyName: string;
    messages: SeedMessage[];
    startOffsetMs?: number;
  },
): Promise<void> {
  const baseTime = Date.now() - (args.messages.length + 1) * 60_000;
  const rows = args.messages.map((m, i) => ({
    conversation_id: args.conversationId,
    hostaway_conversation_id: args.externalId,
    hostaway_message_id: `sandbox-${args.externalId}-${uid()}-${i}`,
    property_name: args.propertyName,
    guest_name: args.guestName,
    direction: m.role === 'guest' ? 'inbound' : 'outbound',
    body: m.body,
    sent_at: new Date(baseTime + (i + 1) * 60_000).toISOString(),
  }));
  const { error } = await supabase.from('guest_messages').insert(rows);
  if (error) throw new Error(error.message);

  // Refresh summary from the full thread so counts/preview stay correct.
  const { data: all } = await supabase
    .from('guest_messages')
    .select('direction, body, sent_at')
    .eq('conversation_id', args.conversationId)
    .order('sent_at', { ascending: true });
  const list = (all ?? []) as Array<{ direction: string; body: string | null; sent_at: string | null }>;
  const last = list[list.length - 1];
  await supabase
    .from('conversations')
    .update({
      last_message_at: last?.sent_at ?? new Date().toISOString(),
      last_direction: last?.direction ?? 'inbound',
      last_message_preview: (last?.body ?? '').slice(0, 140),
      message_count: list.length,
      unread: last?.direction === 'inbound',
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId);
}

async function runGeneration(externalId: string): Promise<void> {
  // Reuse the real eager hooks — identical behavior to a Hostaway webhook.
  await maybeGenerateProposedReplyForExternal(externalId, SANDBOX_SOURCE);
  await maybeGenerateProposedTaskForExternal(externalId, SANDBOX_SOURCE);
  await maybeGenerateProposedKnowledgeForExternal(externalId, SANDBOX_SOURCE);
}

// GET — list existing sandbox conversations for the control panel.
export async function GET() {
  const guard = devGuard();
  if (guard) return guard;
  const { response, user } = await requireUser();
  if (response || !user) return response;

  const { data, error } = await getSupabaseServer()
    .from('conversations')
    .select('id, guest_name, property_name, last_message_preview, last_message_at, message_count, app_status')
    .eq('source', SANDBOX_SOURCE)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversations: data ?? [] });
}

export async function POST(request: Request) {
  const guard = devGuard();
  if (guard) return guard;
  const { response, user } = await requireUser();
  if (response || !user) return response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body.action;
  const supabase = getSupabaseServer();

  try {
    if (action === 'reset') {
      const { data, error } = await supabase
        .from('conversations')
        .delete()
        .eq('source', SANDBOX_SOURCE)
        .select('id');
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, deleted: (data ?? []).length });
    }

    if (action === 'create') {
      const property = await resolveProperty(
        supabase,
        typeof body.property_id === 'string' ? body.property_id : null,
      );
      if (!property) {
        return NextResponse.json(
          { error: 'No property found. Create a property first, or pass property_id.' },
          { status: 400 },
        );
      }
      const guestName =
        typeof body.guest_name === 'string' && body.guest_name.trim()
          ? body.guest_name.trim()
          : 'Sandbox Guest';
      const bookingState = body.booking_state === 'inquiry' ? 'inquiry' : 'booked';
      const generate = body.generate !== false; // default on
      const seed: SeedMessage[] = Array.isArray(body.messages)
        ? (body.messages as SeedMessage[]).filter(
            (m) => m && (m.role === 'guest' || m.role === 'host') && typeof m.body === 'string' && m.body.trim(),
          )
        : [];
      if (seed.length === 0) {
        seed.push({ role: 'guest', body: 'Hi! Just checking in about our upcoming stay.' });
      }

      const externalId = `sandbox-${uid()}`;
      const { data: conv, error: convErr } = await supabase
        .from('conversations')
        .insert({
          source: SANDBOX_SOURCE,
          external_conversation_id: externalId,
          guest_name: guestName,
          property_id: property.id,
          property_name: property.name,
          channel: 'direct',
          booking_state: bookingState,
          check_in: bookingState === 'booked' ? dateOnly(-1) : null,
          check_out: bookingState === 'booked' ? dateOnly(2) : null,
          app_status: 'active',
          unread: true,
          archived: false,
        })
        .select('id')
        .single();
      if (convErr || !conv) throw new Error(convErr?.message ?? 'failed to create conversation');

      const conversationId = conv.id as string;
      await insertMessagesAndSummarize(supabase, {
        conversationId,
        externalId,
        guestName,
        propertyName: property.name,
        messages: seed,
      });

      if (generate) await runGeneration(externalId);

      return NextResponse.json({
        ok: true,
        conversation_id: conversationId,
        external_id: externalId,
        url: `/messages/${conversationId}`,
      });
    }

    if (action === 'append') {
      const conversationId = body.conversation_id;
      const role = body.role === 'host' ? 'host' : 'guest';
      const text = typeof body.body === 'string' ? body.body.trim() : '';
      const generate = body.generate !== false;
      if (typeof conversationId !== 'string' || !conversationId) {
        return NextResponse.json({ error: 'conversation_id is required' }, { status: 400 });
      }
      if (!text) {
        return NextResponse.json({ error: 'Message body is required' }, { status: 400 });
      }

      const { data: convRow } = await supabase
        .from('conversations')
        .select('id, source, external_conversation_id, guest_name, property_name')
        .eq('id', conversationId)
        .maybeSingle();
      if (!convRow || convRow.source !== SANDBOX_SOURCE) {
        return NextResponse.json(
          { error: 'Not a sandbox conversation.' },
          { status: 404 },
        );
      }

      await insertMessagesAndSummarize(supabase, {
        conversationId,
        externalId: convRow.external_conversation_id as string,
        guestName: (convRow.guest_name as string | null) ?? 'Sandbox Guest',
        propertyName: (convRow.property_name as string | null) ?? '',
        messages: [{ role, body: text }],
      });

      if (generate) {
        const ext = convRow.external_conversation_id as string;
        if (role === 'guest') {
          // Guest message → reply + task + knowledge (knowledge self-gates).
          await runGeneration(ext);
        } else {
          // Host message → knowledge only (reply/task are guest-triggered). This
          // is how the "landscaper comes every other Friday" case is tested.
          await maybeGenerateProposedKnowledgeForExternal(ext, SANDBOX_SOURCE);
        }
      }

      return NextResponse.json({ ok: true, conversation_id: conversationId });
    }

    return NextResponse.json({ error: `Unknown action: ${String(action)}` }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sandbox action failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
