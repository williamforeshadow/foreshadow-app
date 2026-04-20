import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// POST bulk update property assignments for a template
//
// Accepts either `property_names: string[]` (legacy) or `property_ids: string[]`
// (canonical UUIDs). Internally we resolve the missing half against the
// `properties` table and dual-write both columns on each row, so DB functions
// can continue joining on either during the property_name → property_id
// migration. When both are provided, `property_ids` wins.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { template_id, property_names, property_ids, automation_config } = body;

    if (!template_id) {
      return NextResponse.json(
        { error: 'template_id is required' },
        { status: 400 }
      );
    }

    const hasIds = Array.isArray(property_ids);
    const hasNames = Array.isArray(property_names);

    if (!hasIds && !hasNames) {
      return NextResponse.json(
        { error: 'property_ids or property_names array is required' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseServer();

    // Resolve to { id, name } pairs by whichever side the caller provided.
    let pairs: Array<{ property_id: string; property_name: string }> = [];
    let missing: string[] = [];

    type PropRow = { id: string; name: string };

    if (hasIds && property_ids.length > 0) {
      const { data: props, error: propErr } = await supabase
        .from('properties')
        .select('id, name')
        .in('id', property_ids);
      if (propErr) {
        return NextResponse.json({ error: propErr.message }, { status: 500 });
      }
      const rows: PropRow[] = (props as PropRow[] | null) || [];
      const foundIds = new Set(rows.map((p) => p.id));
      missing = property_ids.filter((pid: string) => !foundIds.has(pid));
      pairs = rows.map((p) => ({ property_id: p.id, property_name: p.name }));
    } else if (hasNames && property_names.length > 0) {
      const { data: props, error: propErr } = await supabase
        .from('properties')
        .select('id, name')
        .in('name', property_names);
      if (propErr) {
        return NextResponse.json({ error: propErr.message }, { status: 500 });
      }
      const rows: PropRow[] = (props as PropRow[] | null) || [];
      const foundNames = new Set(rows.map((p) => p.name));
      missing = property_names.filter((n: string) => !foundNames.has(n));
      pairs = rows.map((p) => ({ property_id: p.id, property_name: p.name }));
    }

    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: `No property row found for: ${missing.join(', ')}. Ensure properties are synced from Hostaway or created manually first.`,
        },
        { status: 400 }
      );
    }

    // Step 1: Delete all existing assignments for this template
    const { error: deleteError } = await supabase
      .from('property_templates')
      .delete()
      .eq('template_id', template_id);

    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message },
        { status: 500 }
      );
    }

    // Step 2: Insert new assignments (dual-write property_id + property_name)
    if (pairs.length > 0) {
      const assignments = pairs.map(pair => ({
        property_id: pair.property_id,
        property_name: pair.property_name,
        template_id,
        enabled: true,
        // Include automation_config if provided (applies to all properties in bulk)
        ...(automation_config !== undefined && { automation_config }),
      }));

      const { error: insertError } = await supabase
        .from('property_templates')
        .insert(assignments);

      if (insertError) {
        return NextResponse.json(
          { error: insertError.message },
          { status: 500 }
        );
      }
    }

    // Step 3: Trigger task generation is handled automatically by the
    // sync_tasks_on_template_change trigger.

    return NextResponse.json({
      success: true,
      message: `Template assigned to ${pairs.length} properties`,
      count: pairs.length,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to save property assignments' },
      { status: 500 }
    );
  }
}
