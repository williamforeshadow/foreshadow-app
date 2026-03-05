import { NextResponse, NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// GET all departments
export async function GET() {
  try {
    const { data, error } = await getSupabaseServer()
      .from('departments')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ departments: data || [] });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch departments' },
      { status: 500 }
    );
  }
}

// POST - create a new department
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, icon } = body;

    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: 'Department name is required' },
        { status: 400 }
      );
    }

    const { data, error } = await getSupabaseServer()
      .from('departments')
      .insert({
        name: name.trim(),
        icon: icon || 'folder',
      })
      .select()
      .single();

    if (error) {
      // Check for unique constraint violation
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'A department with that name already exists' },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ department: data }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to create department' },
      { status: 500 }
    );
  }
}
