import { NextResponse, NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// PUT - update a department
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, icon } = body;

    const updateData: Record<string, any> = {};
    if (name !== undefined) updateData.name = name.trim();
    if (icon !== undefined) updateData.icon = icon;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    const { data, error } = await getSupabaseServer()
      .from('departments')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
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

    return NextResponse.json({ department: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to update department' },
      { status: 500 }
    );
  }
}

// DELETE - delete a department
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check if department is in use by templates or tasks
    const { count: templateCount } = await getSupabaseServer()
      .from('templates')
      .select('id', { count: 'exact', head: true })
      .eq('department_id', id);

    const { count: taskCount } = await getSupabaseServer()
      .from('turnover_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('department_id', id);

    const { count: projectCount } = await getSupabaseServer()
      .from('property_projects')
      .select('id', { count: 'exact', head: true })
      .eq('department_id', id);

    const totalUsage = (templateCount || 0) + (taskCount || 0) + (projectCount || 0);

    if (totalUsage > 0) {
      return NextResponse.json(
        { 
          error: `Cannot delete this department — it is referenced by ${templateCount || 0} template(s), ${taskCount || 0} task(s), and ${projectCount || 0} project(s). Remove all associations first.` 
        },
        { status: 409 }
      );
    }

    const { error } = await getSupabaseServer()
      .from('departments')
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
      { error: err.message || 'Failed to delete department' },
      { status: 500 }
    );
  }
}
