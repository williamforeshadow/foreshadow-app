import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  logPropertyKnowledgeActivity,
  type KnowledgeSource,
} from '@/lib/logPropertyKnowledgeActivity';

// Service: create OR update a Policies & Instructions row in one shape (mirrors
// upsertPropertyAccessItem). Disambiguation is by policy_id presence:
//   - policy_id absent  → INSERT (title required)
//   - policy_id present → UPDATE (only the fields you pass change)
//
// `title` is the human-readable label AND the key the agent's upsert_policy
// operation matches on, so it can never be empty. `body` carries the instruction
// and is optional — a title-only policy ("No pets") is legitimate.

const inputSchema = z
  .object({
    property_id: z.string().uuid(),
    policy_id: z.string().uuid().optional(),
    title: z.string().nullable().optional(),
    body: z.string().nullable().optional(),
    sort_order: z.number().finite().optional(),
    actor_user_id: z.string().nullable().optional(),
    source: z.enum(['web', 'agent_slack', 'agent_web', 'system']).optional().default('web'),
  })
  .strict();

export type UpsertPolicyInput = z.infer<typeof inputSchema>;

export type PolicyErrorCode = 'invalid_input' | 'not_found' | 'db_error';
export interface PolicyError {
  code: PolicyErrorCode;
  message: string;
  field?: string;
}

export interface PropertyPolicyRow {
  id: string;
  property_id: string;
  title: string;
  body: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type UpsertPolicyResult =
  | {
      ok: true;
      policy: PropertyPolicyRow;
      mode: 'create' | 'update';
      changes?: Array<{ field: string; before: unknown; after: unknown }>;
    }
  | { ok: false; error: PolicyError };

type Supabase = ReturnType<typeof getSupabaseServer>;

const POLICY_COLUMNS = 'id, property_id, title, body, sort_order, created_at, updated_at';

function nullable(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

async function loadProperty(
  supabase: Supabase,
  propertyId: string,
): Promise<{ ok: true } | { ok: false; error: PolicyError }> {
  const { data, error } = await supabase
    .from('properties')
    .select('id')
    .eq('id', propertyId)
    .maybeSingle();
  if (error)
    return { ok: false, error: { code: 'db_error', message: error.message, field: 'property_id' } };
  if (!data)
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: `No property found with id ${propertyId}.`,
        field: 'property_id',
      },
    };
  return { ok: true };
}

async function loadPolicy(
  supabase: Supabase,
  propertyId: string,
  policyId: string,
): Promise<{ ok: true; policy: PropertyPolicyRow } | { ok: false; error: PolicyError }> {
  const { data, error } = await supabase
    .from('property_policies')
    .select(POLICY_COLUMNS)
    .eq('id', policyId)
    .eq('property_id', propertyId)
    .maybeSingle();
  if (error)
    return { ok: false, error: { code: 'db_error', message: error.message, field: 'policy_id' } };
  if (!data)
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: `No policy found with id ${policyId} on property ${propertyId}.`,
        field: 'policy_id',
      },
    };
  return { ok: true, policy: data as PropertyPolicyRow };
}

export async function upsertPropertyPolicy(rawInput: unknown): Promise<UpsertPolicyResult> {
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

  // ----- CREATE -----------------------------------------------------
  if (!input.policy_id) {
    const title = nullable(input.title);
    if (!title) {
      return {
        ok: false,
        error: { code: 'invalid_input', message: 'title is required for a policy.', field: 'title' },
      };
    }
    const payload = {
      property_id: input.property_id,
      title,
      body: nullable(input.body),
      sort_order: typeof input.sort_order === 'number' ? Math.trunc(input.sort_order) : 0,
      created_by_user_id: input.actor_user_id ?? null,
      updated_by_user_id: input.actor_user_id ?? null,
    };
    const { data, error } = await supabase
      .from('property_policies')
      .insert(payload)
      .select(POLICY_COLUMNS)
      .maybeSingle();
    if (error || !data) {
      return {
        ok: false,
        error: { code: 'db_error', message: error?.message ?? 'insert returned no row' },
      };
    }
    const created = data as PropertyPolicyRow;
    await logPropertyKnowledgeActivity({
      property_id: input.property_id,
      user_id: input.actor_user_id ?? null,
      resource_type: 'policy',
      resource_id: created.id,
      action: 'create',
      changes: { kind: 'snapshot', row: { title: created.title, body: created.body } },
      subject_label: created.title,
      source: (input.source ?? 'web') as KnowledgeSource,
    });
    return { ok: true, policy: created, mode: 'create' };
  }

  // ----- UPDATE -----------------------------------------------------
  const lookup = await loadPolicy(supabase, input.property_id, input.policy_id);
  if (!lookup.ok) return { ok: false, error: lookup.error };
  const existing = lookup.policy;

  const patch: Record<string, unknown> = {};
  const changes: Array<{ field: string; before: unknown; after: unknown }> = [];

  if (input.title !== undefined) {
    const next = nullable(input.title);
    if (!next) {
      return {
        ok: false,
        error: { code: 'invalid_input', message: 'title cannot be empty.', field: 'title' },
      };
    }
    if (next !== existing.title) {
      patch.title = next;
      changes.push({ field: 'title', before: existing.title, after: next });
    }
  }
  if (input.body !== undefined) {
    const next = nullable(input.body);
    if (next !== existing.body) {
      patch.body = next;
      changes.push({ field: 'body', before: existing.body, after: next });
    }
  }
  if (input.sort_order !== undefined) {
    const next = Math.trunc(input.sort_order);
    if (next !== existing.sort_order) {
      patch.sort_order = next;
      changes.push({ field: 'sort_order', before: existing.sort_order, after: next });
    }
  }

  if (Object.keys(patch).length === 0) {
    return { ok: true, policy: existing, mode: 'update', changes: [] };
  }
  patch.updated_at = new Date().toISOString();
  if (input.actor_user_id) patch.updated_by_user_id = input.actor_user_id;

  const { data, error } = await supabase
    .from('property_policies')
    .update(patch)
    .eq('id', input.policy_id)
    .eq('property_id', input.property_id)
    .select(POLICY_COLUMNS)
    .maybeSingle();
  if (error || !data) {
    return {
      ok: false,
      error: { code: 'db_error', message: error?.message ?? 'update returned no row' },
    };
  }
  const updated = data as PropertyPolicyRow;
  await logPropertyKnowledgeActivity({
    property_id: input.property_id,
    user_id: input.actor_user_id ?? null,
    resource_type: 'policy',
    resource_id: updated.id,
    action: 'update',
    changes: { kind: 'diff', entries: changes },
    subject_label: updated.title,
    source: (input.source ?? 'web') as KnowledgeSource,
  });
  return { ok: true, policy: updated, mode: 'update', changes };
}

export async function deletePropertyPolicy(
  propertyId: string,
  policyId: string,
  actorUserId: string | null,
  source: KnowledgeSource = 'web',
): Promise<{ ok: true } | { ok: false; error: PolicyError }> {
  const supabase = getSupabaseServer();
  const lookup = await loadPolicy(supabase, propertyId, policyId);
  if (!lookup.ok) return { ok: false, error: lookup.error };
  const existing = lookup.policy;

  const { error } = await supabase
    .from('property_policies')
    .delete()
    .eq('id', policyId)
    .eq('property_id', propertyId);
  if (error) return { ok: false, error: { code: 'db_error', message: error.message } };

  await logPropertyKnowledgeActivity({
    property_id: propertyId,
    user_id: actorUserId,
    resource_type: 'policy',
    resource_id: policyId,
    action: 'delete',
    changes: { kind: 'snapshot', row: { title: existing.title, body: existing.body } },
    subject_label: existing.title,
    source,
  });
  return { ok: true };
}
