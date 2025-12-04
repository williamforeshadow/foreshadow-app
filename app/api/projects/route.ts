import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET - List all property projects (optionally filter by property_name)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const propertyName = searchParams.get('property_name');

    let query = supabase
      .from('property_projects')
      .select('*')
      .order('property_name', { ascending: true })
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false });

    if (propertyName) {
      query = query.eq('property_name', propertyName);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}

// POST - Create a new property project
export async function POST(request: Request) {
  console.log('POST /api/projects called');
  
  try {
    const body = await request.json();
    console.log('Request body:', JSON.stringify(body, null, 2));
    
    const { property_name, title, description, status, priority, assigned_staff, due_date } = body;

    if (!property_name || !title) {
      console.log('Validation failed: missing property_name or title');
      return NextResponse.json(
        { error: 'property_name and title are required' },
        { status: 400 }
      );
    }

    console.log('Inserting into Supabase...');
    const { data, error } = await supabase
      .from('property_projects')
      .insert({
        property_name,
        title,
        description: description || null,
        status: status || 'not_started',
        priority: priority || 'medium',
        assigned_staff: assigned_staff || null,
        due_date: due_date || null
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    console.log('Success! Created project:', data);
    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    console.error('Caught error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to create project' },
      { status: 500 }
    );
  }
}

