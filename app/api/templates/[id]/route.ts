import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// GET single template
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  try {
    const { data, error } = await getSupabaseServer()
      .from('templates')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ template: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch template' },
      { status: 500 }
    );
  }
}

// PUT update template
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  try {
    const body = await request.json();
    const { name, type, description, fields } = body;

    if (!name || !type || !fields) {
      return NextResponse.json(
        { error: 'Name, type, and fields are required' },
        { status: 400 }
      );
    }

    const { data, error } = await getSupabaseServer()
      .from('templates')
      .update({
        name,
        type,
        description,
        fields,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ template: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to update template' },
      { status: 500 }
    );
  }
}

// DELETE template
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  try {
    const { error } = await getSupabaseServer()
      .from('templates')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to delete template' },
      { status: 500 }
    );
  }
}

