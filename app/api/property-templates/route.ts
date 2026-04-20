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
//
// Accepts either `property_name` (legacy) or `property_id` (canonical UUID).
// Whichever is provided, we resolve to the other via the `properties` table and
// dual-write both into `property_templates` so the DB functions can join on
// either column during the property_name → property_id migration.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      property_name: inputPropertyName,
      property_id: inputPropertyId,
      template_id,
      enabled = true,
      automation_config,
      field_overrides,
    } = body;

    if (!template_id) {
      return NextResponse.json(
        { error: 'template_id is required' },
        { status: 400 }
      );
    }

    if (!inputPropertyName && !inputPropertyId) {
      return NextResponse.json(
        { error: 'property_name or property_id is required' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseServer();

    // Resolve the missing half of (property_name, property_id)
    let resolvedName: string | null = inputPropertyName || null;
    let resolvedId: string | null = inputPropertyId || null;

    if (resolvedId && !resolvedName) {
      const { data: prop } = await supabase
        .from('properties')
        .select('name')
        .eq('id', resolvedId)
        .maybeSingle();
      if (!prop) {
        return NextResponse.json(
          { error: `No property found with id ${resolvedId}` },
          { status: 400 }
        );
      }
      resolvedName = prop.name;
    } else if (resolvedName && !resolvedId) {
      const { data: prop } = await supabase
        .from('properties')
        .select('id')
        .eq('name', resolvedName)
        .maybeSingle();
      if (!prop) {
        return NextResponse.json(
          { error: `No property found with name "${resolvedName}"` },
          { status: 400 }
        );
      }
      resolvedId = prop.id;
    }

    const upsertPayload: {
      property_name: string;
      property_id: string;
      template_id: string;
      enabled: boolean;
      automation_config?: object | null;
      field_overrides?: object | null;
    } = {
      property_name: resolvedName!,
      property_id: resolvedId!,
      template_id,
      enabled,
    };

    if (automation_config !== undefined) {
      upsertPayload.automation_config = automation_config;
    }

    if (field_overrides !== undefined) {
      upsertPayload.field_overrides = field_overrides;
    }

    // Upsert on the canonical (property_id, template_id) unique constraint.
    const { data, error } = await supabase
      .from('property_templates')
      .upsert(upsertPayload, {
        onConflict: 'property_id,template_id',
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
//
// Accepts either ?property_name=... (legacy) or ?property_id=... (canonical).
// property_id is preferred when both are supplied.
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const property_name = searchParams.get('property_name');
    const property_id = searchParams.get('property_id');
    const template_id = searchParams.get('template_id');

    if (!property_name && !property_id) {
      return NextResponse.json(
        { error: 'property_name or property_id is required' },
        { status: 400 }
      );
    }

    let query = getSupabaseServer()
      .from('property_templates')
      .delete();

    if (property_id) {
      query = query.eq('property_id', property_id);
    } else {
      query = query.eq('property_name', property_name as string);
    }

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
