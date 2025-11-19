import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { cleaningId, action } = await request.json();

    if (!cleaningId || !action) {
      return NextResponse.json(
        { error: 'Missing cleaningId or action' },
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

    // Update the card_actions field in cleanings table
    const { data, error } = await supabase
      .from('cleanings')
      .update({ card_actions: action })
      .eq('id', cleaningId)
      .select();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: 'Cleaning not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: data[0]
    });

  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

