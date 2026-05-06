import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  logPropertyKnowledgeActivity,
  type KnowledgeSource,
} from '@/lib/logPropertyKnowledgeActivity';

// Service: hard-delete a property contact. Mirrors deletePropertyNote.

const inputSchema = z.object({
  property_id: z.string().uuid(),
  contact_id: z.string().uuid(),
  // Activity-ledger bookkeeping. See upsertPropertyNote.ts.
  actor_user_id: z.string().nullable().optional(),
  source: z
    .enum(['web', 'agent_slack', 'agent_web', 'system'])
    .optional()
    .default('web'),
});

export type DeleteContactInput = z.infer<typeof inputSchema>;

export type DeleteContactErrorCode = 'invalid_input' | 'not_found' | 'db_error';

export interface DeleteContactError {
  code: DeleteContactErrorCode;
  message: string;
  field?: string;
}

export interface DeletedContactSnapshot {
  contact_id: string;
  property_id: string;
  category: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
}

export type DeleteContactResult =
  | { ok: true; snapshot: DeletedContactSnapshot }
  | { ok: false; error: DeleteContactError };

export async function deletePropertyContact(
  rawInput: unknown,
): Promise<DeleteContactResult> {
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message: first?.message ?? 'invalid input',
        field: first?.path?.join('.') || undefined,
      },
    };
  }
  const input = parsed.data;
  const supabase = getSupabaseServer();

  const { data: existing, error: loadErr } = await supabase
    .from('property_contacts')
    .select('id, property_id, category, name, role, phone, email')
    .eq('id', input.contact_id)
    .eq('property_id', input.property_id)
    .maybeSingle();
  if (loadErr) {
    return {
      ok: false,
      error: { code: 'db_error', message: loadErr.message, field: 'contact_id' },
    };
  }
  if (!existing) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: `No contact found with id ${input.contact_id} on property ${input.property_id}.`,
        field: 'contact_id',
      },
    };
  }

  const { error: delErr } = await supabase
    .from('property_contacts')
    .delete()
    .eq('id', input.contact_id)
    .eq('property_id', input.property_id);
  if (delErr) {
    return { ok: false, error: { code: 'db_error', message: delErr.message } };
  }

  const row = existing as {
    id: string;
    property_id: string;
    category: string;
    name: string;
    role: string | null;
    phone: string | null;
    email: string | null;
  };

  await logPropertyKnowledgeActivity({
    property_id: row.property_id,
    user_id: input.actor_user_id ?? null,
    resource_type: 'contact',
    resource_id: null,
    action: 'delete',
    changes: {
      kind: 'snapshot',
      row: {
        category: row.category,
        name: row.name,
        role: row.role,
        phone: row.phone,
        email: row.email,
      },
    },
    subject_label:
      row.role && row.role.trim() !== '' ? `${row.name} (${row.role})` : row.name,
    source: (input.source ?? 'web') as KnowledgeSource,
  });

  return {
    ok: true,
    snapshot: {
      contact_id: row.id,
      property_id: row.property_id,
      category: row.category,
      name: row.name,
      role: row.role,
      phone: row.phone,
      email: row.email,
    },
  };
}

// ---------- preview (no-write) ----------------------------------------------

export interface DeleteContactPlan {
  property: { property_id: string; name: string };
  contact: {
    contact_id: string;
    category: string;
    name: string;
    role: string | null;
    phone: string | null;
    email: string | null;
  };
}

export type PreviewDeleteContactResult =
  | { ok: true; plan: DeleteContactPlan; canonicalInput: DeleteContactInput }
  | { ok: false; error: DeleteContactError };

export async function previewDeletePropertyContact(
  rawInput: unknown,
): Promise<PreviewDeleteContactResult> {
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message: first?.message ?? 'invalid input',
        field: first?.path?.join('.') || undefined,
      },
    };
  }
  const input = parsed.data;
  const supabase = getSupabaseServer();

  const [propRes, contactRes] = await Promise.all([
    supabase
      .from('properties')
      .select('id, name')
      .eq('id', input.property_id)
      .maybeSingle(),
    supabase
      .from('property_contacts')
      .select('id, category, name, role, phone, email, property_id')
      .eq('id', input.contact_id)
      .eq('property_id', input.property_id)
      .maybeSingle(),
  ]);

  if (propRes.error) {
    return {
      ok: false,
      error: {
        code: 'db_error',
        message: propRes.error.message,
        field: 'property_id',
      },
    };
  }
  if (!propRes.data) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: `No property found with id ${input.property_id}.`,
        field: 'property_id',
      },
    };
  }
  if (contactRes.error) {
    return {
      ok: false,
      error: {
        code: 'db_error',
        message: contactRes.error.message,
        field: 'contact_id',
      },
    };
  }
  if (!contactRes.data) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: `No contact found with id ${input.contact_id} on property ${input.property_id}.`,
        field: 'contact_id',
      },
    };
  }

  const c = contactRes.data as {
    id: string;
    category: string;
    name: string;
    role: string | null;
    phone: string | null;
    email: string | null;
  };
  const p = propRes.data as { id: string; name: string };

  return {
    ok: true,
    plan: {
      property: { property_id: p.id, name: p.name },
      contact: {
        contact_id: c.id,
        category: c.category,
        name: c.name,
        role: c.role,
        phone: c.phone,
        email: c.email,
      },
    },
    canonicalInput: input,
  };
}
