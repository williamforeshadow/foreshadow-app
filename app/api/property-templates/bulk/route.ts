import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// POST bulk update property assignments for a template
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { template_id, property_names } = body;

    if (!template_id || !Array.isArray(property_names)) {
      return NextResponse.json(
        { error: 'Template ID and property names array are required' },
        { status: 400 }
      );
    }

    // Step 1: Delete all existing assignments for this template
    const { error: deleteError } = await getSupabaseServer()
      .from('property_templates')
      .delete()
      .eq('template_id', template_id);

    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message },
        { status: 500 }
      );
    }

    // Step 2: Insert new assignments
    if (property_names.length > 0) {
      const assignments = property_names.map(property_name => ({
        property_name,
        template_id,
        enabled: true
      }));

      const { error: insertError } = await getSupabaseServer()
        .from('property_templates')
        .insert(assignments);

      if (insertError) {
        return NextResponse.json(
          { error: insertError.message },
          { status: 500 }
        );
      }
    }

    // Step 3: Trigger task generation for affected reservations
    // This will be handled automatically by the trigger on reservations table
    
    return NextResponse.json({ 
      success: true,
      message: `Template assigned to ${property_names.length} properties`
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to save property assignments' },
      { status: 500 }
    );
  }
}

