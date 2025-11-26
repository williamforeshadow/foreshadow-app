import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const staff = searchParams.get('staff');
    const priority = searchParams.get('priority');

    let query = supabase
      .from('maintenance_cards')
      .select('*')
      .order('created_at', { ascending: false });

    // Apply filters if provided
    if (staff) {
      query = query.ilike('assigned_staff', `%${staff}%`);
    }
    if (priority) {
      query = query.eq('priority', priority);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: error.message || 'Failed to fetch maintenance cards' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch maintenance cards' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      property_name,
      title,
      description,
      assigned_staff,
      scheduled_start,
      priority = 'medium'
    } = body;

    if (!title) {
      return NextResponse.json(
        { error: 'Title is required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('maintenance_cards')
      .insert({
        property_name: property_name || null,
        title,
        description: description || null,
        assigned_staff: assigned_staff || null,
        scheduled_start: scheduled_start || null,
        priority,
        card_actions: 'not_started'
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message || 'Failed to create maintenance card' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to create maintenance card' },
      { status: 500 }
    );
  }
}

