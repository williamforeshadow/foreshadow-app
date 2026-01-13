import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

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
    const { data, error } = await getSupabaseServer()
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

    // Fetch the complete card data with recalculated property_clean_status
    const { data: cardData, error: cardError } = await getSupabaseServer()
      .rpc('get_property_turnovers')
      .eq('id', cleaningId)
      .single();

    if (cardError) {
      // If we can't get the full card data, return basic data
      return NextResponse.json({
        success: true,
        data: data[0]
      });
    }

    return NextResponse.json({
      success: true,
      data: cardData
    });

  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

