import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// GET - List all property projects with assignees
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const propertyName = searchParams.get('property_name');
    const userId = searchParams.get('user_id'); // For "My Assignments" filtering

    let query = getSupabaseServer()
      .from('property_projects')
      .select(`
        *,
        project_assignments(
          user_id,
          assigned_at,
          users(id, name, email, role, avatar)
        )
      `)
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

    // If filtering by user_id, filter projects that have this user assigned
    let filteredData = data;
    if (userId && data) {
      filteredData = data.filter(project => 
        project.project_assignments?.some((a: any) => a.user_id === userId)
      );
    }

    return NextResponse.json({ data: filteredData });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}

// POST - Create a new property project with optional assignees
export async function POST(request: Request) {
  console.log('POST /api/projects called');
  
  try {
    const body = await request.json();
    console.log('Request body:', JSON.stringify(body, null, 2));
    
    const { property_name, title, description, status, priority, assigned_user_ids, due_date } = body;

    if (!property_name || !title) {
      console.log('Validation failed: missing property_name or title');
      return NextResponse.json(
        { error: 'property_name and title are required' },
        { status: 400 }
      );
    }

    // Insert the project
    console.log('Inserting into getSupabaseServer()...');
    const { data: project, error } = await getSupabaseServer()
      .from('property_projects')
      .insert({
        property_name,
        title,
        description: description || null,
        status: status || 'not_started',
        priority: priority || 'medium',
        due_date: due_date || null
      })
      .select()
      .single();

    if (error) {
      console.error('getSupabaseServer() error:', error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    // Insert assignments if provided
    const userIds: string[] = Array.isArray(assigned_user_ids) ? assigned_user_ids : (assigned_user_ids ? [assigned_user_ids] : []);
    
    if (userIds.length > 0) {
      const assignments = userIds.map(userId => ({
        project_id: project.id,
        user_id: userId
      }));

      const { error: assignError } = await getSupabaseServer()
        .from('project_assignments')
        .insert(assignments);

      if (assignError) {
        console.error('Error creating assignments:', assignError);
        // Don't fail the whole request, project was created
      }
    }

    // Fetch the project with assignments
    const { data: fullProject, error: fetchError } = await getSupabaseServer()
      .from('property_projects')
      .select(`
        *,
        project_assignments(
          user_id,
          assigned_at,
          users(id, name, email, role, avatar)
        )
      `)
      .eq('id', project.id)
      .single();

    if (fetchError) {
      // Return basic project if fetch fails
      console.log('Success! Created project:', project);
      return NextResponse.json({ success: true, data: project });
    }

    console.log('Success! Created project with assignments:', fullProject);
    return NextResponse.json({ success: true, data: fullProject });
  } catch (err: any) {
    console.error('Caught error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to create project' },
      { status: 500 }
    );
  }
}
