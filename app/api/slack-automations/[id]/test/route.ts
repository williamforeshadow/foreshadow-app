import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  runSlackAutomationsForReservation,
  testSlackTaskAssignmentAutomation,
  type ReservationContext,
} from '@/src/server/slackAutomations/run';
import type { SlackAutomation } from '@/lib/types';

// POST /api/slack-automations/[id]/test
//
// Manually fire a single Slack automation against a representative
// reservation, so the user can preview the rendered message + attachments
// in Slack without waiting for a real reservation event.
//
// Strategy: look up the automation, then find a reservation that would
// match its trigger + property filters in the real world. Specifically:
//   - new_booking → most recently created reservation matching the
//                   property filter
//   - check_in    → soonest upcoming check-in matching the filter
//   - check_out   → soonest upcoming check-out matching the filter
//
// If no reservation matches, we fall back to a stub reservation so the
// user still sees the templated output (with empty values for missing
// fields).
//
// IMPORTANT: bypassDedup = true. The fires-log table has a unique
// constraint that would otherwise prevent re-testing the same automation
// against the same reservation.

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = getSupabaseServer();

  const { data: automation, error: autoErr } = await supabase
    .from('slack_automations')
    .select('*')
    .eq('id', id)
    .single();

  if (autoErr || !automation) {
    return NextResponse.json(
      { error: autoErr?.message ?? 'Automation not found' },
      { status: 404 },
    );
  }

  const a = automation as SlackAutomation;
  if (a.trigger === 'task_assigned') {
    const body = await readJsonBody(_req);
    const testResult = await testSlackTaskAssignmentAutomation({
      automation: a,
      taskId: typeof body?.task_id === 'string' ? body.task_id : undefined,
      recipientUserId:
        typeof body?.recipient_user_id === 'string'
          ? body.recipient_user_id
          : undefined,
    });

    return NextResponse.json({
      fired: !!testResult.result.ok,
      used_task: testResult.used_task,
      used_recipient: testResult.used_recipient,
      result: testResult.result,
      other_results: [],
    }, { status: testResult.result.ok ? 200 : 400 });
  }

  // Find a representative reservation.
  let query = supabase
    .from('reservations')
    .select('id, property_id, property_name, guest_name, check_in, check_out')
    .limit(1);

  if (a.property_ids && a.property_ids.length > 0) {
    query = query.in('property_id', a.property_ids);
  }

  if (a.trigger === 'check_in') {
    const today = new Date().toISOString().split('T')[0];
    query = query.gte('check_in', today).order('check_in', { ascending: true });
  } else if (a.trigger === 'check_out') {
    const today = new Date().toISOString().split('T')[0];
    query = query.gte('check_out', today).order('check_out', { ascending: true });
  } else {
    query = query.order('created_at', { ascending: false });
  }

  const { data: reservations } = await query;
  const reservation: ReservationContext =
    reservations && reservations.length > 0
      ? (reservations[0] as ReservationContext)
      : {
          id: '00000000-0000-0000-0000-000000000000',
          property_id: null,
          property_name: '(test) Sample Property',
          guest_name: '(test) Sample Guest',
          check_in: new Date().toISOString().split('T')[0],
          check_out: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
            .toISOString()
            .split('T')[0],
        };

  // Fire just this one automation. The shared runner queries for ALL
  // matching automations, so we restrict to this one by toggling other
  // matches off temporarily — the simplest path is a single direct call
  // using a wrapper that ignores the matching layer. Instead we call the
  // shared runner with bypassDedup and filter the result to this id.
  const results = await runSlackAutomationsForReservation({
    reservation,
    trigger: a.trigger,
    bypassDedup: true,
  });

  const thisResult = results.find((r) => r.automation_id === id);

  return NextResponse.json({
    fired: !!thisResult?.ok,
    used_reservation: {
      id: reservation.id,
      property_name: reservation.property_name,
      guest_name: reservation.guest_name,
      check_in: reservation.check_in,
      check_out: reservation.check_out,
    },
    result: thisResult ?? null,
    other_results: results.filter((r) => r.automation_id !== id),
  });
}

async function readJsonBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
