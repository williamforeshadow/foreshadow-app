import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

interface AutomationScheduleConfig {
  enabled: boolean;
  type: 'on' | 'before' | 'after';
  relative_to: 'check_out' | 'next_check_in';
  days_offset: number;
  time: string;
}

interface AutomationConfig {
  enabled: boolean;
  trigger_type: string;
  schedule: AutomationScheduleConfig;
  same_day_override: {
    enabled: boolean;
    schedule: Omit<AutomationScheduleConfig, 'enabled'>;
  };
  auto_assign: {
    enabled: boolean;
    user_ids: string[];
  };
}

/**
 * Calculate scheduled date and time based on automation config and reservation dates.
 * Returns { date: 'YYYY-MM-DD', time: 'HH:MM' } or { date: null, time: null }.
 */
function calculateSchedule(
  config: AutomationScheduleConfig,
  checkOut: string | null,
  nextCheckIn: string | null
): { date: string | null; time: string | null } {
  if (!config.enabled) return { date: null, time: null };

  // Determine the base date based on relative_to
  const baseDateStr = config.relative_to === 'check_out' ? checkOut : nextCheckIn;
  if (!baseDateStr) return { date: null, time: null };

  // Parse the base date (handle ISO string or date-only string)
  const baseDate = new Date(baseDateStr);
  if (isNaN(baseDate.getTime())) return { date: null, time: null };

  // Apply days offset
  let targetDate = new Date(baseDate);
  if (config.type === 'before') {
    targetDate.setDate(targetDate.getDate() - config.days_offset);
  } else if (config.type === 'after') {
    targetDate.setDate(targetDate.getDate() + config.days_offset);
  }
  // 'on' means same day, no offset needed

  // Extract date as YYYY-MM-DD
  const y = targetDate.getFullYear();
  const m = String(targetDate.getMonth() + 1).padStart(2, '0');
  const d = String(targetDate.getDate()).padStart(2, '0');
  const dateStr = `${y}-${m}-${d}`;

  // Time from config (24-hour format like "10:00" or "14:30")
  const timeStr = config.time || '10:00';

  return { date: dateStr, time: timeStr };
}

/**
 * Check if check_out and next_check_in are on the same day
 */
function isSameDayTurnover(checkOut: string | null, nextCheckIn: string | null): boolean {
  if (!checkOut || !nextCheckIn) return false;
  
  const checkOutDate = new Date(checkOut);
  const nextCheckInDate = new Date(nextCheckIn);
  
  return (
    checkOutDate.getFullYear() === nextCheckInDate.getFullYear() &&
    checkOutDate.getMonth() === nextCheckInDate.getMonth() &&
    checkOutDate.getDate() === nextCheckInDate.getDate()
  );
}

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

    const supabase = getSupabaseServer();

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

    // Get reservation details for scheduling calculation
    const { data: reservation, error: reservationError } = await supabase
      .from('reservations')
      .select('id, property_name, check_out, next_check_in')
      .eq('id', reservation_id)
      .single();

    if (reservationError || !reservation) {
      return NextResponse.json(
        { error: 'Reservation not found' },
        { status: 404 }
      );
    }

    // Get automation config for this property-template pair
    const { data: propertyTemplate } = await supabase
      .from('property_templates')
      .select('automation_config')
      .eq('property_name', reservation.property_name)
      .eq('template_id', template_id)
      .single();

    const automationConfig = propertyTemplate?.automation_config as AutomationConfig | null;

    // Calculate scheduled date/time if automation is configured
    let scheduledDate: string | null = null;
    let scheduledTime: string | null = null;
    let assignUserIds: string[] = [];

    if (automationConfig?.enabled && automationConfig.schedule.enabled) {
      const isSameDay = isSameDayTurnover(reservation.check_out, reservation.next_check_in);
      
      let schedule: { date: string | null; time: string | null };
      // Use same-day override config if applicable
      if (isSameDay && automationConfig.same_day_override.enabled) {
        schedule = calculateSchedule(
          { ...automationConfig.same_day_override.schedule, enabled: true },
          reservation.check_out,
          reservation.next_check_in
        );
      } else {
        schedule = calculateSchedule(
          automationConfig.schedule,
          reservation.check_out,
          reservation.next_check_in
        );
      }
      scheduledDate = schedule.date;
      scheduledTime = schedule.time;
    }

    // Get auto-assign user IDs if configured
    if (automationConfig?.enabled && automationConfig.auto_assign.enabled) {
      assignUserIds = automationConfig.auto_assign.user_ids || [];
    }

    // Insert new task with calculated schedule
    const { data: newTask, error: insertError } = await supabase
      .from('turnover_tasks')
      .insert({
        reservation_id,
        template_id,
        type: template.type,
        status: 'not_started',
        scheduled_date: scheduledDate,
        scheduled_time: scheduledTime
      })
      .select('*, templates(name, type)')
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      );
    }

    // Create task assignments if auto-assign is configured
    if (assignUserIds.length > 0) {
      const taskAssignments = assignUserIds.map(userId => ({
        task_id: newTask.id,
        user_id: userId
      }));

      await supabase
        .from('task_assignments')
        .insert(taskAssignments);
    }

    // Fetch the assignments to return with the task
    const { data: assignments } = await supabase
      .from('task_assignments')
      .select('user_id, users(name, avatar, role)')
      .eq('task_id', newTask.id);

    const assignedUsers = (assignments || []).map((a: any) => ({
      user_id: a.user_id,
      name: a.users?.name || '',
      avatar: a.users?.avatar || '',
      role: a.users?.role || ''
    }));

    // Format response to match expected task structure
    const formattedTask = {
      task_id: newTask.id,
      template_id: newTask.template_id,
      template_name: newTask.templates?.name || template.name,
      type: newTask.type,
      status: newTask.status,
      assigned_users: assignedUsers,
      scheduled_date: newTask.scheduled_date,
      scheduled_time: newTask.scheduled_time,
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
    const { data: templates, error } = await getSupabaseServer()
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
