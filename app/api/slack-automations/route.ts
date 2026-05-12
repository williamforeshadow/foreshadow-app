import { NextResponse, NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  getSlackAutomationDispatchTrigger,
  getSlackAutomationSavePropertyIds,
  normalizeSlackAutomationConfig,
} from '@/lib/slackAutomationConfig';

// /api/slack-automations
//
// CRUD for Slack notification automations — org-level rules that fire
// Slack messages when reservation events occur (new booking, check-in,
// check-out) at specified properties.
//
// Backed by the `slack_automations` table:
//   id            uuid PK
//   name          text NOT NULL
//   enabled       boolean DEFAULT true
//   trigger       text NOT NULL ('new_booking' | 'check_in' | 'check_out')
//   property_ids  uuid[] — empty = all properties
//   config        jsonb NOT NULL (message, channel, attachments, flags)
//   created_at    timestamptz
//   updated_at    timestamptz

const VALID_TRIGGERS = ['new_booking', 'check_in', 'check_out', 'task_assigned', 'scheduled'];

export async function GET() {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('slack_automations')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[api/slack-automations] GET failed', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ automations: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, trigger, property_ids, config, enabled } = body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  const normalizedConfig = normalizeSlackAutomationConfig(config, {
    trigger,
    property_ids: Array.isArray(property_ids) ? property_ids : [],
  });
  const normalizedTrigger = getSlackAutomationDispatchTrigger(normalizedConfig);

  if (!VALID_TRIGGERS.includes(normalizedTrigger)) {
    return NextResponse.json(
      { error: `trigger must be one of: ${VALID_TRIGGERS.join(', ')}` },
      { status: 400 },
    );
  }
  if (!config || typeof config !== 'object') {
    return NextResponse.json({ error: 'config is required' }, { status: 400 });
  }

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('slack_automations')
    .insert({
      name: name.trim(),
      enabled: enabled ?? true,
      trigger: normalizedTrigger,
      property_ids: getSlackAutomationSavePropertyIds(normalizedConfig),
      config: normalizedConfig,
    })
    .select()
    .single();

  if (error) {
    console.error('[api/slack-automations] POST failed', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ automation: data }, { status: 201 });
}
