import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET - Fetch activity log for a project
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('project_id');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    if (!projectId) {
      return NextResponse.json({ error: 'project_id is required' }, { status: 400 });
    }

    const { data, error, count } = await supabase
      .from('project_activity_log')
      .select(`
        *,
        users (id, name, avatar)
      `, { count: 'exact' })
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching activity log:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      data,
      total: count,
      hasMore: (offset + limit) < (count || 0)
    });
  } catch (err) {
    console.error('Error in GET /api/project-activity:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST - Log a new activity
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { project_id, user_id, action_type, description, old_value, new_value } = body;

    if (!project_id || !user_id || !action_type || !description) {
      return NextResponse.json(
        { error: 'project_id, user_id, action_type, and description are required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('project_activity_log')
      .insert({
        project_id,
        user_id,
        action_type,
        description,
        old_value: old_value || null,
        new_value: new_value || null
      })
      .select(`
        *,
        users (id, name, avatar)
      `)
      .single();

    if (error) {
      console.error('Error logging activity:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error('Error in POST /api/project-activity:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Helper function to log activity (can be imported by other API routes)
export async function logProjectActivity(
  projectId: string,
  userId: string,
  actionType: string,
  description: string,
  oldValue?: string,
  newValue?: string
) {
  try {
    const { error } = await supabase
      .from('project_activity_log')
      .insert({
        project_id: projectId,
        user_id: userId,
        action_type: actionType,
        description,
        old_value: oldValue || null,
        new_value: newValue || null
      });

    if (error) {
      console.error('Error logging activity:', error);
    }
  } catch (err) {
    console.error('Error in logProjectActivity:', err);
  }
}

