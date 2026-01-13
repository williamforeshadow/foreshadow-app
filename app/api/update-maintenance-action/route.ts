import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { maintenanceId, action } = body;

    if (!maintenanceId || !action) {
      return NextResponse.json(
        { error: 'Maintenance ID and action are required' },
        { status: 400 }
      );
    }

    // Validate action value
    const validActions = ['not_started', 'in_progress', 'paused', 'completed'];
    if (!validActions.includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action value' },
        { status: 400 }
      );
    }

    // Update card_actions (trigger will auto-update status)
    const { data, error } = await getSupabaseServer()
      .from('maintenance_cards')
      .update({ card_actions: action })
      .eq('id', maintenanceId)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message || 'Failed to update maintenance action' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to update maintenance action' },
      { status: 500 }
    );
  }
}

