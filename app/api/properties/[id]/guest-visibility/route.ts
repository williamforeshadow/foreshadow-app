import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getCurrentAppUser } from '@/src/server/users/currentUser';
import {
  isVisibilityResourceType,
  isSingletonFieldType,
  isLockableField,
  decodeFieldResourceId,
  type VisibilityRow,
} from '@/lib/propertyKnowledgeVisibility';

// Property-knowledge guest visibility (the Concierge lock/unlock allowlist).
// GET  -> the unlocked items for a property (so the Knowledge UI renders state).
// PUT  -> { resource_type, resource_id, visible }: unlock = upsert, lock = delete.
// Default is locked (no row). The ops agent is unaffected — it always sees
// everything via get_property_knowledge.

// GET /api/properties/[id]/guest-visibility
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { error: authError } = await getCurrentAppUser();
  if (authError === 'unauthenticated') {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const { id: propertyId } = await context.params;

  try {
    const { data, error } = await getSupabaseServer()
      .from('property_knowledge_visibility')
      .select('resource_type, resource_id')
      .eq('property_id', propertyId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ unlocked: (data ?? []) as VisibilityRow[] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load visibility';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/properties/[id]/guest-visibility
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { user, error: authError } = await getCurrentAppUser();
  if (authError === 'unauthenticated') {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const { id: propertyId } = await context.params;

  try {
    const body = await request.json();
    const resourceType = body.resource_type;
    const resourceId = typeof body.resource_id === 'string' ? body.resource_id : '';
    const visible = Boolean(body.visible);

    if (!isVisibilityResourceType(resourceType)) {
      return NextResponse.json({ error: 'Invalid resource_type' }, { status: 400 });
    }
    if (!resourceId) {
      return NextResponse.json({ error: 'resource_id is required' }, { status: 400 });
    }
    // Validate the field. Singletons key by bare column name; collection items
    // key by `${rowId}:${field}`.
    if (isSingletonFieldType(resourceType)) {
      if (!isLockableField(resourceType, resourceId)) {
        return NextResponse.json({ error: 'Invalid field for resource_type' }, { status: 400 });
      }
    } else {
      const { rowId, field } = decodeFieldResourceId(resourceId);
      if (!rowId || !isLockableField(resourceType, field)) {
        return NextResponse.json({ error: 'Invalid resource_id for resource_type' }, { status: 400 });
      }
    }

    const supabase = getSupabaseServer();

    if (visible) {
      const { error } = await supabase
        .from('property_knowledge_visibility')
        .upsert(
          {
            property_id: propertyId,
            resource_type: resourceType,
            resource_id: resourceId,
            created_by_user_id: user?.id ?? null,
          },
          { onConflict: 'property_id,resource_type,resource_id', ignoreDuplicates: true },
        );
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    } else {
      const { error } = await supabase
        .from('property_knowledge_visibility')
        .delete()
        .eq('property_id', propertyId)
        .eq('resource_type', resourceType)
        .eq('resource_id', resourceId);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, visible });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update visibility';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
