import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET - List comments for a specific project with user details
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('project_id');

    if (!projectId) {
      return NextResponse.json(
        { error: 'project_id is required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('project_comments')
      .select(`
        *,
        users(id, name, email, role, avatar)
      `)
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch comments' },
      { status: 500 }
    );
  }
}

// POST - Create a new comment
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { project_id, user_id, comment_content } = body;

    if (!project_id || !user_id || !comment_content) {
      return NextResponse.json(
        { error: 'project_id, user_id, and comment_content are required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('project_comments')
      .insert({
        project_id,
        user_id,
        comment_content
      })
      .select(`
        *,
        users(id, name, email, role, avatar)
      `)
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to create comment' },
      { status: 500 }
    );
  }
}
