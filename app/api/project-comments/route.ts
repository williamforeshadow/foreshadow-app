import { NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';
import { logProjectActivity } from '@/lib/logProjectActivity';
import {
  notifyTaskCommented,
  notifyTaskMentioned,
} from '@/src/server/notifications/notify';
import { resolveAndStoreMentions } from '@/src/server/comments/commentMentions';
import { stripMentionTokens } from '@/lib/mentions';

// GET - List comments for a specific project or task with user details
export async function GET(request: Request) {
  try {
    const ctx = await requireAuthContext();
    if (ctx instanceof NextResponse) return ctx;
    const { supabase } = ctx;

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('project_id');
    const taskId = searchParams.get('task_id');

    if (!projectId && !taskId) {
      return NextResponse.json(
        { error: 'project_id or task_id is required' },
        { status: 400 }
      );
    }

    let query = supabase
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
    const ctx = await requireAuthContext();
    if (ctx instanceof NextResponse) return ctx;
    const { supabase, service, orgId } = ctx;

    const body = await request.json();
    const { project_id, task_id, comment_content } = body;
    // Author is the VERIFIED session user — the body's user_id (still sent by
    // older clients) is ignored rather than trusted.
    const user_id = ctx.appUser.id;

    if ((!project_id && !task_id) || !comment_content) {
      return NextResponse.json(
        { error: '(project_id or task_id) and comment_content are required' },
        { status: 400 }
      );
    }

    const insertData: Record<string, unknown> = {
      user_id,
      comment_content,
      org_id: orgId,
    };
    if (task_id) insertData.task_id = task_id;
    if (project_id) insertData.project_id = project_id;

    const { data, error } = await supabase
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
      // Mentions are task-comment-only in phase 1 (matching the notification
      // pipeline, which is task-scoped). Uses the service client so mention
      // resolution/storage isn't subject to the author's RLS view.
      const mentions = await resolveAndStoreMentions({
        supabase: service,
        orgId,
        commentId: data.id,
        commentContent: comment_content,
      });
      const preview = stripMentionTokens(comment_content);
      const actor = {
        user_id,
        name: data.users?.name ?? null,
      };
      await notifyTaskCommented({
        taskId: task_id,
        commentId: data.id,
        actor,
        commentPreview: preview,
        excludeUserIds: mentions.userIds,
      });
      await notifyTaskMentioned({
        taskId: task_id,
        commentId: data.id,
        mentionedUserIds: mentions.userIds,
        actor,
        commentPreview: preview,
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
