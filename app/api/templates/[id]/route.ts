import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';

// GET single template
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  try {
    const { data, error } = await supabase
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
    const { name, description, fields } = body;

    if (!name || !fields) {
      return NextResponse.json(
        { error: 'Name and fields are required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('templates')
      .update({
        name,
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
    const { error } = await supabase
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

