import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuthContext();
    if (ctx instanceof NextResponse) return ctx;
    const { supabase } = ctx;

    const { cleaningId, staffName } = await request.json();

    if (!cleaningId) {
      return NextResponse.json(
        { error: 'Missing cleaningId' },
        { status: 400 }
      );
    }

    // Update the assigned_staff field in cleanings table
    // staffName can be null to unassign
    const { data, error } = await supabase
      .from('cleanings')
      .update({ assigned_staff: staffName })
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

