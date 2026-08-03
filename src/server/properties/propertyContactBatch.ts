import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  previewUpsertPropertyContact,
  upsertPropertyContact,
  type UpsertContactError,
} from './upsertPropertyContact';
import {
  previewDeletePropertyContact,
  deletePropertyContact,
} from './deletePropertyContact';

// Batch property contacts — "this vendor works at all of these properties".
//
// Contacts are stored per property, but the people they describe are usually
// not: one cleaner, handyman, or owner typically covers several units. Adding
// them one property at a time meant N previews for a single fact, which is the
// same shape of busywork the Property Knowledge batch removed.
//
// Layered on the existing single-contact engine — every mutation still goes
// through previewUpsertPropertyContact / upsertPropertyContact (or the delete
// pair), so validation, tag normalization, and the change diff are unchanged.
// What's added is per-property resolution and the fan-out.
//
// Matching is BY NAME, case-insensitively, within each property: the caller has
// one set of fields for the whole list and contact ids are per-property. That
// also makes the operation idempotent — running it twice updates in place
// rather than creating a second "Maria".

const CONTACT_TAGS = [
  'cleaning',
  'maintenance',
  'contractors',
  'owners',
  'stakeholders',
  'emergency',
  'other',
] as const;

const MAX_PROPERTIES = 25;

export const propertyContactBatchInputSchema = z.object({
  action: z.enum(['upsert', 'delete']),
  property_ids: z.array(z.string().uuid()).min(1).max(MAX_PROPERTIES),
  /** The match key across every property. Required for both actions. */
  name: z.string().min(1).max(200),
  tags: z.array(z.enum(CONTACT_TAGS)).optional(),
  role: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  schedule: z.string().nullable().optional(),
  preferences: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  sort_order: z.number().int().optional(),
  actor_user_id: z.string().nullable().optional(),
  source: z.enum(['web', 'agent_slack', 'agent_web', 'system']).optional(),
});

export type PropertyContactBatchInput = z.infer<
  typeof propertyContactBatchInputSchema
>;

export interface PropertyContactBatchStep {
  property_id: string;
  property_name: string;
  /** 'noop': an update that changes nothing, or a delete with nothing to delete. */
  mode: 'create' | 'update' | 'delete' | 'noop';
  contact_id: string | null;
  changes: Array<{ field: string; before: unknown; after: unknown }>;
}

export interface PropertyContactBatchFailure {
  property_id: string;
  property_name: string | null;
  error: UpsertContactError;
}

export interface PropertyContactBatchPlan {
  action: 'upsert' | 'delete';
  contact_name: string;
  steps: PropertyContactBatchStep[];
  failures: PropertyContactBatchFailure[];
  created_count: number;
  updated_count: number;
  deleted_count: number;
  noop_count: number;
  summary: string;
}

export type PreviewPropertyContactBatchResult =
  | {
      ok: true;
      plan: PropertyContactBatchPlan;
      canonicalInput: PropertyContactBatchInput;
    }
  | { ok: false; error: UpsertContactError };

export interface PropertyContactBatchCommitResult {
  property_id: string;
  property_name: string;
  ok: boolean;
  mode: PropertyContactBatchStep['mode'];
  row: unknown;
  error?: UpsertContactError;
}

export type CommitPropertyContactBatchResult =
  | {
      ok: true;
      plan: PropertyContactBatchPlan;
      results: PropertyContactBatchCommitResult[];
      failures: PropertyContactBatchCommitResult[];
    }
  | { ok: false; error: UpsertContactError };

type Supabase = ReturnType<typeof getSupabaseServer>;

function sameName(a: string | null | undefined, b: string): boolean {
  return (a ?? '').trim().toLowerCase() === b.trim().toLowerCase();
}

async function loadPropertyName(
  supabase: Supabase,
  propertyId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('properties')
    .select('name')
    .eq('id', propertyId)
    .maybeSingle();
  return (data as { name?: string } | null)?.name ?? null;
}

/**
 * Find this contact on one property by name. Re-run at commit time rather than
 * baked into the token, so a contact created between preview and confirm is
 * updated instead of duplicated.
 */
async function resolveContactId(
  supabase: Supabase,
  propertyId: string,
  name: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('property_contacts')
    .select('id, name')
    .eq('property_id', propertyId);
  const match = ((data ?? []) as Array<{ id: string; name: string | null }>).find(
    (r) => sameName(r.name, name),
  );
  return match?.id ?? null;
}

/** Strip batch-only keys so what's left is a single-contact input. */
function contactFields(input: PropertyContactBatchInput) {
  const {
    action: _action,
    property_ids: _ids,
    actor_user_id,
    source,
    ...fields
  } = input;
  return { ...fields, actor_user_id: actor_user_id ?? null, source };
}

function buildSummary(plan: Omit<PropertyContactBatchPlan, 'summary'>): string {
  const total = plan.steps.length + plan.failures.length;
  const parts = [
    `${plan.action === 'delete' ? 'Remove' : 'Save'} contact "${plan.contact_name}" across ${total} propert${total === 1 ? 'y' : 'ies'}`,
  ];
  if (plan.created_count > 0) parts.push(`${plan.created_count} to add`);
  if (plan.updated_count > 0) parts.push(`${plan.updated_count} to update`);
  if (plan.deleted_count > 0) parts.push(`${plan.deleted_count} to remove`);
  if (plan.noop_count > 0) {
    parts.push(
      `${plan.noop_count} ${plan.action === 'delete' ? 'not present' : 'already correct'}`,
    );
  }
  if (plan.failures.length > 0) parts.push(`${plan.failures.length} blocked`);
  return `${parts[0]} — ${parts.slice(1).join(', ')}`;
}

export async function previewPropertyContactBatch(
  rawInput: unknown,
): Promise<PreviewPropertyContactBatchResult> {
  const parsed = propertyContactBatchInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message: first?.message ?? 'invalid input',
        field: first?.path.join('.') || undefined,
      },
    };
  }
  const input = parsed.data;
  const supabase = getSupabaseServer();

  const steps: PropertyContactBatchStep[] = [];
  const failures: PropertyContactBatchFailure[] = [];

  for (const propertyId of input.property_ids) {
    const propertyName = await loadPropertyName(supabase, propertyId);
    if (!propertyName) {
      failures.push({
        property_id: propertyId,
        property_name: null,
        error: {
          code: 'not_found',
          message: `No property found with id ${propertyId}.`,
          field: 'property_ids',
        },
      });
      continue;
    }

    const contactId = await resolveContactId(supabase, propertyId, input.name);

    if (input.action === 'delete') {
      // Nothing to delete is the state the user asked for, not an error.
      if (!contactId) {
        steps.push({
          property_id: propertyId,
          property_name: propertyName,
          mode: 'noop',
          contact_id: null,
          changes: [],
        });
        continue;
      }
      const preview = await previewDeletePropertyContact({
        property_id: propertyId,
        contact_id: contactId,
      });
      if (!preview.ok) {
        failures.push({ property_id: propertyId, property_name: propertyName, error: preview.error });
        continue;
      }
      steps.push({
        property_id: propertyId,
        property_name: propertyName,
        mode: 'delete',
        contact_id: contactId,
        changes: [],
      });
      continue;
    }

    const preview = await previewUpsertPropertyContact({
      ...contactFields(input),
      property_id: propertyId,
      ...(contactId ? { contact_id: contactId } : {}),
    });
    if (!preview.ok) {
      failures.push({ property_id: propertyId, property_name: propertyName, error: preview.error });
      continue;
    }
    const changes = preview.plan.changes ?? [];
    steps.push({
      property_id: propertyId,
      property_name: propertyName,
      mode:
        preview.plan.mode === 'update' && changes.length === 0
          ? 'noop'
          : preview.plan.mode,
      contact_id: contactId,
      changes,
    });
  }

  if (steps.length === 0) {
    return {
      ok: false,
      error: {
        code: failures[0]?.error.code ?? 'invalid_input',
        message:
          failures.length > 0
            ? `No property in the batch can be written. First problem: ${failures[0].error.message}`
            : 'The batch resolved to no writes.',
        field: failures[0]?.error.field,
      },
    };
  }

  const base = {
    action: input.action,
    contact_name: input.name,
    steps,
    failures,
    created_count: steps.filter((s) => s.mode === 'create').length,
    updated_count: steps.filter((s) => s.mode === 'update').length,
    deleted_count: steps.filter((s) => s.mode === 'delete').length,
    noop_count: steps.filter((s) => s.mode === 'noop').length,
  };
  return {
    ok: true,
    plan: { ...base, summary: buildSummary(base) },
    canonicalInput: input,
  };
}

export async function commitPropertyContactBatch(
  rawInput: unknown,
): Promise<CommitPropertyContactBatchResult> {
  const preview = await previewPropertyContactBatch(rawInput);
  if (!preview.ok) return { ok: false, error: preview.error };
  const input = preview.canonicalInput;
  const supabase = getSupabaseServer();

  const results: PropertyContactBatchCommitResult[] = [];

  for (const step of preview.plan.steps) {
    const contactId = await resolveContactId(supabase, step.property_id, input.name);

    if (input.action === 'delete') {
      if (!contactId) {
        results.push({
          property_id: step.property_id,
          property_name: step.property_name,
          ok: true,
          mode: 'noop',
          row: null,
        });
        continue;
      }
      const res = await deletePropertyContact({
        property_id: step.property_id,
        contact_id: contactId,
      });
      results.push({
        property_id: step.property_id,
        property_name: step.property_name,
        ok: res.ok,
        mode: 'delete',
        row: res.ok ? res.snapshot : null,
        ...(res.ok ? {} : { error: res.error }),
      });
      continue;
    }

    const res = await upsertPropertyContact({
      ...contactFields(input),
      property_id: step.property_id,
      ...(contactId ? { contact_id: contactId } : {}),
    });
    results.push({
      property_id: step.property_id,
      property_name: step.property_name,
      ok: res.ok,
      mode: res.ok ? (res.mode as 'create' | 'update') : step.mode,
      row: res.ok ? res.contact : null,
      ...(res.ok ? {} : { error: res.error }),
    });
  }

  return {
    ok: true,
    plan: preview.plan,
    results: results.filter((r) => r.ok),
    failures: results.filter((r) => !r.ok),
  };
}
