import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { logProjectActivity } from '@/lib/logProjectActivity';

// Helper to format seconds to HH:MM:SS
function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// GET - Fetch time entries for a project or check for active timer
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('project_id');
    const userId = searchParams.get('user_id');
    const activeOnly = searchParams.get('active') === 'true';

    let query = getSupabaseServer()
      .from('project_time_entries')
      .select(`
        *,
        users (id, name, avatar)
      `)
      .order('created_at', { ascending: false });

    if (projectId) {
      query = query.eq('project_id', projectId);
    }

    if (userId) {
      query = query.eq('user_id', userId);
    }

    if (activeOnly) {
      query = query.is('end_time', null);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching time entries:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Calculate total duration for completed entries
    let totalSeconds = 0;
    let activeEntry = null;

    if (data) {
      for (const entry of data) {
        if (entry.end_time) {
          // Completed entry - add duration
          const start = new Date(entry.start_time).getTime();
          const end = new Date(entry.end_time).getTime();
          totalSeconds += Math.floor((end - start) / 1000);
        } else {
          // Active entry
          activeEntry = entry;
        }
      }
    }

    return NextResponse.json({
      data,
      totalSeconds,
      activeEntry,
    });
  } catch (err) {
    console.error('Error in GET /api/project-time-entries:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST - Start a new timer
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { project_id, user_id, notes } = body;

    if (!project_id || !user_id) {
      return NextResponse.json(
        { error: 'project_id and user_id are required' },
        { status: 400 }
      );
    }

    // Check if user already has an active timer on this project
    const { data: existingActive } = await getSupabaseServer()
      .from('project_time_entries')
      .select('id')
      .eq('project_id', project_id)
      .eq('user_id', user_id)
      .is('end_time', null)
      .single();

    if (existingActive) {
      return NextResponse.json(
        { error: 'Timer already running for this project', activeEntryId: existingActive.id },
        { status: 409 }
      );
    }

    // Create new time entry with start_time
    const { data, error } = await getSupabaseServer()
      .from('project_time_entries')
      .insert({
        project_id,
        user_id,
        notes: notes || null,
        start_time: new Date().toISOString(),
      })
      .select(`
        *,
        users (id, name, avatar)
      `)
      .single();

    if (error) {
      console.error('Error starting timer:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Log activity
    await logProjectActivity(project_id, user_id, 'timer_start', 'started the timer');

    return NextResponse.json({ data });
  } catch (err) {
    console.error('Error in POST /api/project-time-entries:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT - Stop a timer (set end_time)
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { entry_id, project_id, user_id } = body;

    // If entry_id provided, stop that specific entry
    if (entry_id) {
      const { data, error } = await getSupabaseServer()
        .from('project_time_entries')
        .update({ end_time: new Date().toISOString() })
        .eq('id', entry_id)
        .is('end_time', null)
        .select(`
          *,
          users (id, name, avatar)
        `)
        .single();

      if (error) {
        console.error('Error stopping timer:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      // Log activity
      if (data) {
        const durationSeconds = Math.floor(
          (new Date(data.end_time).getTime() - new Date(data.start_time).getTime()) / 1000
        );
        await logProjectActivity(
          data.project_id, 
          data.user_id, 
          'timer_stop', 
          `stopped the timer at ${formatDuration(durationSeconds)}`
        );
      }

      return NextResponse.json({ data });
    }

    // Otherwise, find and stop the active timer for this user/project
    if (!project_id || !user_id) {
      return NextResponse.json(
        { error: 'entry_id or (project_id and user_id) required' },
        { status: 400 }
      );
    }

    const { data, error } = await getSupabaseServer()
      .from('project_time_entries')
      .update({ end_time: new Date().toISOString() })
      .eq('project_id', project_id)
      .eq('user_id', user_id)
      .is('end_time', null)
      .select(`
        *,
        users (id, name, avatar)
      `)
      .single();

    if (error) {
      console.error('Error stopping timer:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Log activity
    if (data) {
      const durationSeconds = Math.floor(
        (new Date(data.end_time).getTime() - new Date(data.start_time).getTime()) / 1000
      );
      await logProjectActivity(
        project_id, 
        user_id, 
        'timer_stop', 
        `stopped the timer at ${formatDuration(durationSeconds)}`
      );
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error('Error in PUT /api/project-time-entries:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE - Remove a time entry
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const entryId = searchParams.get('entry_id');

    if (!entryId) {
      return NextResponse.json({ error: 'entry_id is required' }, { status: 400 });
    }

    const { error } = await getSupabaseServer()
      .from('project_time_entries')
      .delete()
      .eq('id', entryId);

    if (error) {
      console.error('Error deleting time entry:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error in DELETE /api/project-time-entries:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

