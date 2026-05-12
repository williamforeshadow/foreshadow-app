import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { logProjectActivity } from '@/lib/logProjectActivity';
import { notifyTaskCommented } from '@/src/server/notifications/notify';

// GET - List comments for a specific project or task with user details
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('project_id');
    const taskId = searchParams.get('task_id');

    if (!projectId && !taskId) {
      return NextResponse.json(
        { error: 'project_id or task_id is required' },
        { status: 400 }
      );
    }

    let query = getSupabaseServer()
      .from('project_comments')
      .select(`
        *,
        users(id, name, email, role, avatar)
      `)
      .order('created_at', { ascending: true });

    if (taskId) {
      query = query.eq('task_id', taskId);
    } else {
      query = query.eq('project_id', projectId!);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    // Transform to flatten user data
    const transformedData = data?.map((comment: any) => ({
      ...comment,
      user_name: comment.users?.name || null,
      user_avatar: comment.users?.avatar || null,
    })) || [];

    return NextResponse.json({ data: transformedData });
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
    const { project_id, task_id, user_id, comment_content } = body;

    if ((!project_id && !task_id) || !user_id || !comment_content) {
      return NextResponse.json(
        { error: '(project_id or task_id), user_id, and comment_content are required' },
        { status: 400 }
      );
    }

    const insertData: Record<string, unknown> = {
      user_id,
      comment_content,
    };
    if (task_id) insertData.task_id = task_id;
    if (project_id) insertData.project_id = project_id;

    const { data, error } = await getSupabaseServer()
      .from('project_comments')
      .insert(insertData)
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

    // Log activity (only for projects — tasks don't have activity log yet)
    if (project_id) {
      const truncatedComment = comment_content.length > 50 
        ? comment_content.substring(0, 50) + '...' 
        : comment_content;
      await logProjectActivity(project_id, user_id, 'comment', `commented "${truncatedComment}"`, null, comment_content);
    }

    if (task_id) {
      await notifyTaskCommented({
        taskId: task_id,
        commentId: data.id,
        actor: {
          user_id,
          name: data.users?.name ?? null,
        },
        commentPreview: comment_content,
      });
    }

    // Transform to flatten user data
    const transformedData = {
      ...data,
      user_name: data.users?.name || null,
      user_avatar: data.users?.avatar || null,
    };

    return NextResponse.json({ success: true, data: transformedData });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to create comment' },
      { status: 500 }
    );
  }
}
