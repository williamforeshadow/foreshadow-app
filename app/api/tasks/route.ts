import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST - Add a new task to a turnover card
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { reservation_id, template_id } = body;

    if (!reservation_id || !template_id) {
      return NextResponse.json(
        { error: 'reservation_id and template_id are required' },
        { status: 400 }
      );
    }

    // Get template details
    const { data: template, error: templateError } = await supabase
      .from('templates')
      .select('id, name, type')
      .eq('id', template_id)
      .single();

    if (templateError || !template) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      );
    }

    // Check if this task already exists for this reservation
    const { data: existing } = await supabase
      .from('turnover_tasks')
      .select('id')
      .eq('reservation_id', reservation_id)
      .eq('template_id', template_id)
      .single();

    if (existing) {
      return NextResponse.json(
        { error: 'This task already exists for this turnover' },
        { status: 409 }
      );
    }

    // Insert new task
    const { data: newTask, error: insertError } = await supabase
      .from('turnover_tasks')
      .insert({
        reservation_id,
        template_id,
        type: template.type,
        status: 'not_started',
        card_actions: 'not_started'
      })
      .select('*, templates(name, type)')
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      );
    }

    // Format response to match expected task structure
    const formattedTask = {
      task_id: newTask.id,
      template_id: newTask.template_id,
      template_name: newTask.templates?.name || template.name,
      type: newTask.type,
      status: newTask.status,
      card_actions: newTask.card_actions,
      assigned_staff: newTask.assigned_staff,
      scheduled_start: newTask.scheduled_start,
      form_metadata: newTask.form_metadata,
      completed_at: newTask.completed_at
    };

    return NextResponse.json({ 
      success: true, 
      data: formattedTask 
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to add task' },
      { status: 500 }
    );
  }
}

// GET - Get all templates for adding tasks
export async function GET() {
  try {
    const { data: templates, error } = await supabase
      .from('templates')
      .select('id, name, type')
      .order('type', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: templates });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch templates' },
      { status: 500 }
    );
  }
}

