import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// GET all property-template assignments
export async function GET() {
  try {
    const { data, error } = await getSupabaseServer()
      .from('property_templates')
      .select('*');

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ assignments: data || [] });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch property templates' },
      { status: 500 }
    );
  }
}

// POST/UPDATE property-template assignment
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { property_name, template_id, enabled = true, automation_config } = body;

    if (!property_name || !template_id) {
      return NextResponse.json(
        { error: 'Property name and template ID are required' },
        { status: 400 }
      );
    }

    // Build the upsert payload
    const upsertPayload: {
      property_name: string;
      template_id: string;
      enabled: boolean;
      automation_config?: object | null;
    } = {
      property_name,
      template_id,
      enabled
    };

    // Only include automation_config if it was provided in the request
    if (automation_config !== undefined) {
      upsertPayload.automation_config = automation_config;
    }

    // Use upsert to handle both insert and update
    // The unique constraint is now on (property_name, template_id)
    const { data, error } = await getSupabaseServer()
      .from('property_templates')
      .upsert(upsertPayload, {
        onConflict: 'property_name,template_id'
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ assignment: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to save property template' },
      { status: 500 }
    );
  }
}

// DELETE property-template assignment
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const property_name = searchParams.get('property_name');
    const template_id = searchParams.get('template_id');

    if (!property_name) {
      return NextResponse.json(
        { error: 'Property name is required' },
        { status: 400 }
      );
    }

    // Build query - can delete specific template or all for property
    let query = getSupabaseServer()
      .from('property_templates')
      .delete()
      .eq('property_name', property_name);
    
    // If template_id is provided, only delete that specific assignment
    if (template_id) {
      query = query.eq('template_id', template_id);
    }

    const { error } = await query;

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to delete property template' },
      { status: 500 }
    );
  }
}

