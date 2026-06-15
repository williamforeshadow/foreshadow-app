import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  logPropertyKnowledgeActivity,
  type KnowledgeSource,
} from '@/lib/logPropertyKnowledgeActivity';
import { normalizeContactTags, type ContactTag } from '@/lib/propertyAttributes';

// Service: create OR update a property contact in one shape.
//
// Disambiguation is by contact_id presence:
//   - contact_id absent  → INSERT (name required)
//   - contact_id present → UPDATE (only the fields you pass change)
//
// Constraints mirror /api/properties/[id]/contacts:
//   - name cannot be empty (on create or when patching the name field)
//   - tags is a multi-select (cleaning / maintenance / contractors / owners /
//     stakeholders / emergency / other); unknown values are dropped
//   - role, phone, email, schedule, preferences, notes are optional; empty/
//     whitespace becomes NULL. `preferences` is surfaced in the UI for the
//     `owners` tag (it replaced the old owner-preferences notes).

const inputSchema = z
  .object({
    property_id: z.string().uuid(),
    contact_id: z.string().uuid().optional(),
    tags: z.array(z.string()).optional(),
    name: z.string().optional(),
    role: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    schedule: z.string().nullable().optional(),
    preferences: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    sort_order: z.number().finite().optional(),
    // Activity-ledger bookkeeping. See upsertPropertyContact callers.
    actor_user_id: z.string().nullable().optional(),
    source: z
      .enum(['web', 'agent_slack', 'agent_web', 'system'])
      .optional()
      .default('web'),
  })
  .strict();

export type UpsertContactInput = z.infer<typeof inputSchema>;

export type UpsertContactErrorCode = 'invalid_input' | 'not_found' | 'db_error';

export interface UpsertContactError {
  code: UpsertContactErrorCode;
  message: string;
  field?: string;
}

export interface PropertyContactRow {
  id: string;
  property_id: string;
  tags: ContactTag[];
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  schedule: string | null;
  preferences: string | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type UpsertContactResult =
  | {
      ok: true;
      contact: PropertyContactRow;
      mode: 'create' | 'update';
      changes?: Array<{ field: string; before: unknown; after: unknown }>;
    }
  | { ok: false; error: UpsertContactError };

type Supabase = ReturnType<typeof getSupabaseServer>;

const CONTACT_COLUMNS =
  'id, property_id, tags, name, role, phone, email, schedule, preferences, notes, sort_order, created_at, updated_at';

function normalizeRow(raw: Record<string, unknown>): PropertyContactRow {
  return {
    ...(raw as unknown as PropertyContactRow),
    tags: normalizeContactTags(raw.tags),
  };
}

async function loadProperty(
  supabase: Supabase,
  propertyId: string,
): Promise<{ ok: true; name: string } | { ok: false; error: UpsertContactError }> {
  const { data, error } = await supabase
    .from('properties')
    .select('id, name')
    .eq('id', propertyId)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      error: { code: 'db_error', message: error.message, field: 'property_id' },
    };
  }
  if (!data) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: `No property found with id ${propertyId}.`,
        field: 'property_id',
      },
    };
  }
  return { ok: true, name: (data as { name: string }).name };
}

async function loadContact(
  supabase: Supabase,
  propertyId: string,
  contactId: string,
): Promise<
  | { ok: true; contact: PropertyContactRow }
  | { ok: false; error: UpsertContactError }
> {
  const { data, error } = await supabase
    .from('property_contacts')
    .select(CONTACT_COLUMNS)
    .eq('id', contactId)
    .eq('property_id', propertyId)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      error: { code: 'db_error', message: error.message, field: 'contact_id' },
    };
  }
  if (!data) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: `No contact found with id ${contactId} on property ${propertyId}.`,
        field: 'contact_id',
      },
    };
  }
  return { ok: true, contact: normalizeRow(data as Record<string, unknown>) };
}

function nullable(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

export async function upsertPropertyContact(
  rawInput: unknown,
): Promise<UpsertContactResult> {
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

  const propLookup = await loadProperty(supabase, input.property_id);
  if (!propLookup.ok) return { ok: false, error: propLookup.error };

  // ----- CREATE path ------------------------------------------------
  if (!input.contact_id) {
    const name = (input.name ?? '').trim();
    if (!name) {
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          message: 'name is required and cannot be empty when creating a new contact.',
          field: 'name',
        },
      };
    }
    const payload = {
      property_id: input.property_id,
      tags: normalizeContactTags(input.tags),
      name,
      role: nullable(input.role),
      phone: nullable(input.phone),
      email: nullable(input.email),
      schedule: nullable(input.schedule),
      preferences: nullable(input.preferences),
      notes: nullable(input.notes),
      sort_order:
        typeof input.sort_order === 'number' ? Math.trunc(input.sort_order) : 0,
      created_by_user_id: input.actor_user_id ?? null,
      updated_by_user_id: input.actor_user_id ?? null,
    };
    const { data, error } = await supabase
      .from('property_contacts')
      .insert(payload)
      .select(CONTACT_COLUMNS)
      .maybeSingle();
    if (error || !data) {
      return {
        ok: false,
        error: {
          code: 'db_error',
          message: error?.message ?? 'insert returned no row',
        },
      };
    }
    const created = normalizeRow(data as Record<string, unknown>);
    await logPropertyKnowledgeActivity({
      property_id: input.property_id,
      user_id: input.actor_user_id ?? null,
      resource_type: 'contact',
      resource_id: created.id,
      action: 'create',
      changes: {
        kind: 'snapshot',
        row: {
          tags: created.tags,
          name: created.name,
          role: created.role,
          phone: created.phone,
          email: created.email,
          schedule: created.schedule,
        },
      },
      subject_label: contactSubjectLabel(created),
      source: (input.source ?? 'web') as KnowledgeSource,
    });
    return { ok: true, contact: created, mode: 'create' };
  }

  // ----- UPDATE path -------------------------------------------------
  const contactLookup = await loadContact(
    supabase,
    input.property_id,
    input.contact_id,
  );
  if (!contactLookup.ok) return { ok: false, error: contactLookup.error };
  const existing = contactLookup.contact;

  const patch: Record<string, unknown> = {};
  const changes: Array<{ field: string; before: unknown; after: unknown }> = [];

  if (input.tags !== undefined) {
    const next = normalizeContactTags(input.tags);
    if (JSON.stringify(next) !== JSON.stringify(existing.tags)) {
      patch.tags = next;
      changes.push({ field: 'tags', before: existing.tags, after: next });
    }
  }

  if (input.name !== undefined) {
    const next = input.name.trim();
    if (!next) {
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          message: 'name cannot be empty.',
          field: 'name',
        },
      };
    }
    if (next !== existing.name) {
      patch.name = next;
      changes.push({ field: 'name', before: existing.name, after: next });
    }
  }

  for (const field of ['role', 'phone', 'email', 'schedule', 'preferences', 'notes'] as const) {
    if (!(field in input)) continue;
    const next = nullable(input[field] ?? null);
    if (next !== existing[field]) {
      patch[field] = next;
      changes.push({ field, before: existing[field], after: next });
    }
  }

  if (input.sort_order !== undefined) {
    const next = Math.trunc(input.sort_order);
    if (next !== existing.sort_order) {
      patch.sort_order = next;
      changes.push({
        field: 'sort_order',
        before: existing.sort_order,
        after: next,
      });
    }
  }

  if (Object.keys(patch).length === 0) {
    return { ok: true, contact: existing, mode: 'update', changes: [] };
  }

  patch.updated_at = new Date().toISOString();
  if (input.actor_user_id) {
    patch.updated_by_user_id = input.actor_user_id;
  }

  const { data, error } = await supabase
    .from('property_contacts')
    .update(patch)
    .eq('id', input.contact_id)
    .eq('property_id', input.property_id)
    .select(CONTACT_COLUMNS)
    .maybeSingle();
  if (error || !data) {
    return {
      ok: false,
      error: {
        code: 'db_error',
        message: error?.message ?? 'update returned no row',
      },
    };
  }
  const updated = normalizeRow(data as Record<string, unknown>);
  await logPropertyKnowledgeActivity({
    property_id: input.property_id,
    user_id: input.actor_user_id ?? null,
    resource_type: 'contact',
    resource_id: updated.id,
    action: 'update',
    changes: { kind: 'diff', entries: changes },
    subject_label: contactSubjectLabel(updated),
    source: (input.source ?? 'web') as KnowledgeSource,
  });
  return {
    ok: true,
    contact: updated,
    mode: 'update',
    changes,
  };
}

/**
 * Human-readable label for the activity ledger UI. Snapshot at write
 * time so the ledger renders cleanly even after the contact is gone.
 * Includes the role inline when present so different "Maria"s can be
 * told apart in the timeline.
 */
function contactSubjectLabel(row: { name: string; role: string | null }): string {
  if (row.role && row.role.trim() !== '') {
    return `${row.name} (${row.role})`;
  }
  return row.name;
}

// ---------- preview (no-write) ----------------------------------------------

export interface UpsertContactPlan {
  mode: 'create' | 'update';
  property: { property_id: string; name: string };
  tags: ContactTag[];
  contact_summary: {
    name: string;
    role: string | null;
    phone: string | null;
    email: string | null;
    schedule: string | null;
    preferences: string | null;
    notes: string | null;
  };
  changes?: Array<{ field: string; before: unknown; after: unknown }>;
  contact_id?: string;
}

export type PreviewUpsertContactResult =
  | { ok: true; plan: UpsertContactPlan; canonicalInput: UpsertContactInput }
  | { ok: false; error: UpsertContactError };

export async function previewUpsertPropertyContact(
  rawInput: unknown,
): Promise<PreviewUpsertContactResult> {
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

  const propLookup = await loadProperty(supabase, input.property_id);
  if (!propLookup.ok) return { ok: false, error: propLookup.error };
  const propertyName = propLookup.name;

  if (!input.contact_id) {
    const name = (input.name ?? '').trim();
    if (!name) {
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          message: 'name is required and cannot be empty when creating a new contact.',
          field: 'name',
        },
      };
    }
    return {
      ok: true,
      plan: {
        mode: 'create',
        property: { property_id: input.property_id, name: propertyName },
        tags: normalizeContactTags(input.tags),
        contact_summary: {
          name,
          role: nullable(input.role),
          phone: nullable(input.phone),
          email: nullable(input.email),
          schedule: nullable(input.schedule),
          preferences: nullable(input.preferences),
          notes: nullable(input.notes),
        },
      },
      canonicalInput: input,
    };
  }

  const contactLookup = await loadContact(
    supabase,
    input.property_id,
    input.contact_id,
  );
  if (!contactLookup.ok) return { ok: false, error: contactLookup.error };
  const existing = contactLookup.contact;

  const changes: Array<{ field: string; before: unknown; after: unknown }> = [];

  if (input.tags !== undefined) {
    const next = normalizeContactTags(input.tags);
    if (JSON.stringify(next) !== JSON.stringify(existing.tags)) {
      changes.push({ field: 'tags', before: existing.tags, after: next });
    }
  }
  if (input.name !== undefined) {
    const next = input.name.trim();
    if (!next) {
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          message: 'name cannot be empty.',
          field: 'name',
        },
      };
    }
    if (next !== existing.name) {
      changes.push({ field: 'name', before: existing.name, after: next });
    }
  }
  for (const field of ['role', 'phone', 'email', 'schedule', 'preferences', 'notes'] as const) {
    if (!(field in input)) continue;
    const next = nullable(input[field] ?? null);
    if (next !== existing[field]) {
      changes.push({ field, before: existing[field], after: next });
    }
  }
  if (input.sort_order !== undefined) {
    const next = Math.trunc(input.sort_order);
    if (next !== existing.sort_order) {
      changes.push({
        field: 'sort_order',
        before: existing.sort_order,
        after: next,
      });
    }
  }

  // Compose the resulting summary by overlaying input on top of existing.
  const summary = {
    name:
      input.name !== undefined && input.name.trim() !== ''
        ? input.name.trim()
        : existing.name,
    role: 'role' in input ? nullable(input.role ?? null) : existing.role,
    phone: 'phone' in input ? nullable(input.phone ?? null) : existing.phone,
    email: 'email' in input ? nullable(input.email ?? null) : existing.email,
    schedule:
      'schedule' in input ? nullable(input.schedule ?? null) : existing.schedule,
    preferences:
      'preferences' in input ? nullable(input.preferences ?? null) : existing.preferences,
    notes: 'notes' in input ? nullable(input.notes ?? null) : existing.notes,
  };

  return {
    ok: true,
    plan: {
      mode: 'update',
      property: { property_id: input.property_id, name: propertyName },
      tags: input.tags !== undefined ? normalizeContactTags(input.tags) : existing.tags,
      contact_summary: summary,
      changes,
      contact_id: existing.id,
    },
    canonicalInput: input,
  };
}
