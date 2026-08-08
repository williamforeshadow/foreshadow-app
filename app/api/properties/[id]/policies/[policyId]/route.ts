import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';
import {
  upsertPropertyPolicy,
  deletePropertyPolicy,
} from '@/src/server/properties/upsertPropertyPolicy';

function statusFor(code: string): number {
  return code === 'not_found' ? 404 : code === 'invalid_input' ? 400 : 500;
}

// PATCH /api/properties/[id]/policies/[policyId] — partial update (only provided fields change).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; policyId: string }> },
) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { appUser } = ctx;

  const { id, policyId } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const result = await upsertPropertyPolicy({
    property_id: id,
    policy_id: policyId,
    ...('title' in body ? { title: body.title as string | null } : {}),
    ...('body' in body ? { body: body.body as string | null } : {}),
    ...('sort_order' in body ? { sort_order: body.sort_order as number } : {}),
    actor_user_id: appUser.id,
    source: 'web',
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error.message },
      { status: statusFor(result.error.code) },
    );
  }
  return NextResponse.json({ policy: result.policy });
}

// DELETE /api/properties/[id]/policies/[policyId]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; policyId: string }> },
) {
  const ctx = await requireAuthContext();
  if (ctx instanceof NextResponse) return ctx;
  const { appUser } = ctx;

  const { id, policyId } = await params;
  const result = await deletePropertyPolicy(id, policyId, appUser.id, 'web');
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error.message },
      { status: statusFor(result.error.code) },
    );
  }
  return NextResponse.json({ ok: true });
}
