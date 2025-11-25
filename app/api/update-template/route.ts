import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cleaningId, templateId } = body;

    if (!cleaningId) {
      return NextResponse.json(
        { error: 'Cleaning ID is required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('cleanings')
      .update({ template_id: templateId })
      .eq('id', cleaningId)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message || 'Failed to update template' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to update template' },
      { status: 500 }
    );
  }
}

