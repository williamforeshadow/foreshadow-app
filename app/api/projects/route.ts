import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// GET - List all property projects with assignees
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const propertyName = searchParams.get('property_name');
    const userId = searchParams.get('user_id'); // For "My Assignments" filtering
    const viewerUserId = searchParams.get('viewer_user_id'); // For unread comment count

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
      filteredData = data.filter((project: any) => 
        project.project_assignments?.some((a: any) => a.user_id === userId)
      );
    }

    // Calculate unread comment counts if viewerUserId is provided
    let unreadCounts: Record<string, number> = {};
    if (viewerUserId) {
      // Fetch project views for the viewer
      const { data: viewsData } = await getSupabaseServer()
        .from('project_views')
        .select('project_id, last_viewed_at')
        .eq('user_id', viewerUserId);
      
      const viewsMap: Record<string, string> = {};
      (viewsData || []).forEach((view: any) => {
        viewsMap[view.project_id] = view.last_viewed_at;
      });

      // Fetch all comments
      const { data: allComments } = await getSupabaseServer()
        .from('project_comments')
        .select('project_id, user_id, created_at');

      // Calculate unread counts (comments not by current user, after last view)
      (allComments || []).forEach((comment: any) => {
        const lastViewed = viewsMap[comment.project_id];
        const isOwnComment = comment.user_id === viewerUserId;
        const isUnread = !isOwnComment && (!lastViewed || new Date(comment.created_at) > new Date(lastViewed));
        
        if (isUnread) {
          unreadCounts[comment.project_id] = (unreadCounts[comment.project_id] || 0) + 1;
        }
      });
    }

    // Transform to flatten user data in assignments and add unread count
    const transformedData = filteredData?.map((project: any) => ({
      ...project,
      unread_comment_count: unreadCounts[project.id] || 0,
      project_assignments: project.project_assignments?.map((a: any) => ({
        ...a,
        user: a.users || null, // Map users to user for frontend
      })) || [],
    })) || [];

    return NextResponse.json({ data: transformedData });
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
    
    const { property_name, title, description, status, priority, assigned_user_ids, scheduled_date, scheduled_time } = body;

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
        scheduled_date: scheduled_date || null,
        scheduled_time: scheduled_time || null
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

    // Transform to flatten user data in assignments
    const transformedProject = {
      ...fullProject,
      project_assignments: fullProject.project_assignments?.map((a: any) => ({
        ...a,
        user: a.users || null, // Map users to user for frontend
      })) || [],
    };

    console.log('Success! Created project with assignments:', transformedProject);
    return NextResponse.json({ success: true, data: transformedProject });
  } catch (err: any) {
    console.error('Caught error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to create project' },
      { status: 500 }
    );
  }
}
