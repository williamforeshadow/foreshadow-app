import { NextResponse } from 'next/server';
import {
  PROPERTY_NOTIFICATION_TYPES,
  type PropertyNotificationType,
} from '@/lib/notifications';
import { requireAuthContext } from '@/lib/requireAuthContext';

// Per-property opt-in preferences for the two conversation-scoped proposal
// notifications. Opt-IN: a row means the user wants that (property, type); its
// channel flags say where. Turning all channels off DELETES the row so the
// recipient query (notifyProposal.ts) stays "row presence = opted in".

function isPropertyType(value: unknown): value is PropertyNotificationType {
  return (
    typeof value === 'string' &&
    (PROPERTY_NOTIFICATION_TYPES as readonly string[]).includes(value)
  );
}

export async function GET() {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, appUser } = ctx;

  const { data, error } = await supabase
    .from('notification_property_preferences')
    .select('property_id, type, native_enabled, slack_enabled, push_enabled')
    .eq('user_id', appUser.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ preferences: data ?? [] });
}

export async function PATCH(request: Request) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, appUser, orgId } = ctx;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!isPropertyType(body.type)) {
    return NextResponse.json({ error: 'Invalid notification type' }, { status: 400 });
  }
  const propertyId = body.property_id;
  if (typeof propertyId !== 'string' || !propertyId) {
    return NextResponse.json({ error: 'property_id is required' }, { status: 400 });
  }

  const native = typeof body.native_enabled === 'boolean' ? body.native_enabled : true;
  const slack = typeof body.slack_enabled === 'boolean' ? body.slack_enabled : false;
  const push = typeof body.push_enabled === 'boolean' ? body.push_enabled : true;

  // All channels off → opt OUT entirely (delete the row).
  if (!native && !slack && !push) {
    const { error } = await supabase
      .from('notification_property_preferences')
      .delete()
      .eq('user_id', appUser.id)
      .eq('property_id', propertyId)
      .eq('type', body.type);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return GET();
  }

  const { error } = await supabase
    .from('notification_property_preferences')
    .upsert(
      {
        user_id: appUser.id,
        property_id: propertyId,
        type: body.type,
        native_enabled: native,
        slack_enabled: slack,
        push_enabled: push,
        updated_at: new Date().toISOString(),
        org_id: orgId,
      },
      { onConflict: 'user_id,property_id,type' },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return GET();
}
