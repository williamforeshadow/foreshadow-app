import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET - Fetch all project views for a user (to determine which have unread activity)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');

    if (!userId) {
      return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('project_views')
      .select('project_id, last_viewed_at')
      .eq('user_id', userId);

    if (error) {
      console.error('Error fetching project views:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Convert to a map for easy lookup: { project_id: last_viewed_at }
    const viewsMap: Record<string, string> = {};
    (data || []).forEach((view: any) => {
      viewsMap[view.project_id] = view.last_viewed_at;
    });

    return NextResponse.json({ data: viewsMap });
  } catch (err) {
    console.error('Error in GET /api/project-views:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST - Record that a user viewed a project (upsert)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { project_id, user_id } = body;

    if (!project_id || !user_id) {
      return NextResponse.json(
        { error: 'project_id and user_id are required' },
        { status: 400 }
      );
    }

    // Upsert: insert if not exists, update timestamp if exists
    const { data, error } = await supabase
      .from('project_views')
      .upsert(
        {
          project_id,
          user_id,
          last_viewed_at: new Date().toISOString()
        },
        {
          onConflict: 'project_id,user_id'
        }
      )
      .select()
      .single();

    if (error) {
      console.error('Error recording project view:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error('Error in POST /api/project-views:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

