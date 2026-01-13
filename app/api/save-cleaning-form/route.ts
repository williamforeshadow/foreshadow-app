import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

export async function POST(request: NextRequest) {
  try {
    const { cleaningId, formData } = await request.json();

    if (!cleaningId) {
      return NextResponse.json(
        { error: 'cleaningId is required' },
        { status: 400 }
      );
    }

    const { data, error } = await getSupabaseServer()
      .from('cleanings')
      .update({
        form_metadata: formData
      })
      .eq('id', cleaningId)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message || 'Failed to save form data' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

