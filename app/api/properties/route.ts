import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';

// GET unique properties from reservations
export async function GET() {
  try {
    // Fetch from get_property_turnovers to get all properties
    const { data, error } = await supabase
      .rpc('get_property_turnovers');

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    // Extract unique property names and sort alphabetically
    const uniqueProperties = Array.from(
      new Set(data?.map((item: any) => item.property_name).filter(Boolean))
    ).sort();

    return NextResponse.json({ properties: uniqueProperties });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch properties' },
      { status: 500 }
    );
  }
}

