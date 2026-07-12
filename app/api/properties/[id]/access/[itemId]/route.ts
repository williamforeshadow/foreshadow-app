import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';
import {
  upsertPropertyAccessItem,
  deletePropertyAccessItem,
} from '@/src/server/properties/upsertPropertyAccessItem';

function statusFor(code: string): number {
  return code === 'not_found' ? 404 : code === 'invalid_input' ? 400 : 500;
}

// PATCH /api/properties/[id]/access/[itemId] — partial update (only provided fields change).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { appUser } = ctx;

  const { id, itemId } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const result = await upsertPropertyAccessItem({
    property_id: id,
    item_id: itemId,
    ...('type' in body ? { type: body.type as string } : {}),
    ...('label' in body ? { label: body.label as string | null } : {}),
    ...('value' in body ? { value: body.value as string | null } : {}),
    ...('notes' in body ? { notes: body.notes as string | null } : {}),
    ...('sort_order' in body ? { sort_order: body.sort_order as number } : {}),
    actor_user_id: appUser.id,
    source: 'web',
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error.message }, { status: statusFor(result.error.code) });
  }
  return NextResponse.json({ item: result.item });
}

// DELETE /api/properties/[id]/access/[itemId]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { appUser } = ctx;

  const { id, itemId } = await params;
  const result = await deletePropertyAccessItem(id, itemId, appUser.id, 'web');
  if (!result.ok) {
    return NextResponse.json({ error: result.error.message }, { status: statusFor(result.error.code) });
  }
  return NextResponse.json({ ok: true });
}
