import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// GET all templates
export async function GET() {
  try {
    const { data, error } = await getSupabaseServer()
      .from('templates')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ templates: data || [] });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch templates' },
      { status: 500 }
    );
  }
}

// POST create new template
export async function POST(request: Request) {
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
      .insert({
        name,
        type,
        description,
        fields
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ template: data }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to create template' },
      { status: 500 }
    );
  }
}

