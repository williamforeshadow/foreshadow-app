import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  logPropertyKnowledgeActivity,
  type KnowledgeSource,
} from '@/lib/logPropertyKnowledgeActivity';

// Service: create OR update a property note in one shape.
//
// Notes are scoped key-value content under a property — owner
// preferences and known issues. We expose ONE upsert tool to the agent
// instead of separate add/update tools because the LLM has a hard time
// picking between near-identical surfaces and the validation logic is
// 95% shared. Disambiguation is by note_id presence:
//   - note_id absent  → INSERT (scope + body required)
//   - note_id present → UPDATE (only the fields you pass change)
//
// Constraints mirror /api/properties/[id]/notes:
//   - body cannot be empty (validated client-side and by this service)
//   - title is optional; empty/whitespace becomes NULL
//   - scope is immutable on update (the route doesn't accept it; we
//     refuse it here too with a clear message)
//   - sort_order is editable on either path

const SCOPES = ['owner_preferences', 'known_issues'] as const;
export type NoteScope = (typeof SCOPES)[number];

const inputSchema = z
  .object({
    property_id: z.string().uuid(),
    note_id: z.string().uuid().optional(),
    scope: z.enum(SCOPES).optional(),
    title: z.string().nullable().optional(),
    body: z.string().optional(),
    sort_order: z.number().finite().optional(),
    // Actor + source are bookkeeping fields for the activity ledger.
    // The agent tool layer binds actor_user_id from ctx.actor; HTTP
    // routes pull it from the x-actor-user-id header. Both are
    // optional — null actor produces an "unattributed" ledger entry
    // and skips the per-row created_by/updated_by stamp.
    actor_user_id: z.string().nullable().optional(),
    source: z
      .enum(['web', 'agent_slack', 'agent_web', 'system'])
      .optional()
      .default('web'),
  })
  .strict();

export type UpsertNoteInput = z.infer<typeof inputSchema>;

export type UpsertNoteErrorCode = 'invalid_input' | 'not_found' | 'db_error';

export interface UpsertNoteError {
  code: UpsertNoteErrorCode;
  message: string;
  field?: string;
}

export interface PropertyNoteRow {
  id: string;
  property_id: string;
  scope: NoteScope;
  title: string | null;
  body: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type UpsertNoteResult =
  | {
      ok: true;
      note: PropertyNoteRow;
      mode: 'create' | 'update';
      changes?: Array<{ field: string; before: unknown; after: unknown }>;
    }
  | { ok: false; error: UpsertNoteError };

type Supabase = ReturnType<typeof getSupabaseServer>;

async function loadProperty(
  supabase: Supabase,
  propertyId: string,
): Promise<{ ok: true; name: string } | { ok: false; error: UpsertNoteError }> {
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

async function loadNote(
  supabase: Supabase,
  propertyId: string,
  noteId: string,
): Promise<{ ok: true; note: PropertyNoteRow } | { ok: false; error: UpsertNoteError }> {
  const { data, error } = await supabase
    .from('property_notes')
    .select('id, property_id, scope, title, body, sort_order, created_at, updated_at')
    .eq('id', noteId)
    .eq('property_id', propertyId)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      error: { code: 'db_error', message: error.message, field: 'note_id' },
    };
  }
  if (!data) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: `No note found with id ${noteId} on property ${propertyId}.`,
        field: 'note_id',
      },
    };
  }
  return { ok: true, note: data as PropertyNoteRow };
}

function normalizeTitle(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeBody(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed;
}

/** Insert OR update depending on whether note_id is present. */
export async function upsertPropertyNote(
  rawInput: unknown,
): Promise<UpsertNoteResult> {
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
  if (!input.note_id) {
    if (!input.scope) {
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          message: 'scope is required when creating a new note.',
          field: 'scope',
        },
      };
    }
    const body = normalizeBody(input.body);
    if (!body) {
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          message: 'body is required and cannot be empty when creating a new note.',
          field: 'body',
        },
      };
    }
    const payload = {
      property_id: input.property_id,
      scope: input.scope,
      title: normalizeTitle(input.title ?? null),
      body,
      sort_order:
        typeof input.sort_order === 'number' ? Math.trunc(input.sort_order) : 0,
      created_by_user_id: input.actor_user_id ?? null,
      updated_by_user_id: input.actor_user_id ?? null,
    };
    const { data, error } = await supabase
      .from('property_notes')
      .insert(payload)
      .select('id, property_id, scope, title, body, sort_order, created_at, updated_at')
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
    const created = data as PropertyNoteRow;
    await logPropertyKnowledgeActivity({
      property_id: input.property_id,
      user_id: input.actor_user_id ?? null,
      resource_type: 'note',
      resource_id: created.id,
      action: 'create',
      changes: {
        kind: 'snapshot',
        row: {
          scope: created.scope,
          title: created.title,
          body: created.body,
        },
      },
      subject_label: noteSubjectLabel(created),
      source: (input.source ?? 'web') as KnowledgeSource,
    });
    return { ok: true, note: created, mode: 'create' };
  }

  // ----- UPDATE path -------------------------------------------------
  // scope is immutable on update — the HTTP PATCH route doesn't accept
  // it and the agent shouldn't either. Surface a clear error if the
  // model tries to "move" a note across scopes.
  if (input.scope) {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message:
          'scope cannot be changed on an existing note. Delete this note and create a new one in the desired scope if you really need to move it.',
        field: 'scope',
      },
    };
  }

  const noteLookup = await loadNote(supabase, input.property_id, input.note_id);
  if (!noteLookup.ok) return { ok: false, error: noteLookup.error };
  const existing = noteLookup.note;

  const patch: Record<string, unknown> = {};
  const changes: Array<{ field: string; before: unknown; after: unknown }> = [];

  // title is optional and nullable. Distinguish "not passed" from
  // "explicitly cleared" by checking the parsed input shape directly.
  if ('title' in input) {
    const next = normalizeTitle(input.title ?? null);
    if (next !== existing.title) {
      patch.title = next;
      changes.push({ field: 'title', before: existing.title, after: next });
    }
  }

  if (input.body !== undefined) {
    const next = normalizeBody(input.body);
    if (!next) {
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          message: 'body cannot be empty.',
          field: 'body',
        },
      };
    }
    if (next !== existing.body) {
      patch.body = next;
      changes.push({ field: 'body', before: existing.body, after: next });
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
    return {
      ok: true,
      note: existing,
      mode: 'update',
      changes: [],
    };
  }

  patch.updated_at = new Date().toISOString();
  // Stamp the updater regardless of which fields changed. created_by
  // is set on insert and never overwritten.
  if (input.actor_user_id) {
    patch.updated_by_user_id = input.actor_user_id;
  }

  const { data, error } = await supabase
    .from('property_notes')
    .update(patch)
    .eq('id', input.note_id)
    .eq('property_id', input.property_id)
    .select('id, property_id, scope, title, body, sort_order, created_at, updated_at')
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
  const updated = data as PropertyNoteRow;
  await logPropertyKnowledgeActivity({
    property_id: input.property_id,
    user_id: input.actor_user_id ?? null,
    resource_type: 'note',
    resource_id: updated.id,
    action: 'update',
    changes: { kind: 'diff', entries: changes },
    subject_label: noteSubjectLabel(updated),
    source: (input.source ?? 'web') as KnowledgeSource,
  });
  return {
    ok: true,
    note: updated,
    mode: 'update',
    changes,
  };
}

/**
 * Human-readable label for the activity ledger UI. Snapshot at write
 * time so the ledger renders cleanly even after the note row is gone.
 * Prefer the title; fall back to the scope label so we never log a
 * blank string.
 */
function noteSubjectLabel(row: {
  scope: string;
  title: string | null;
}): string {
  if (row.title && row.title.trim() !== '') return row.title;
  if (row.scope === 'owner_preferences') return 'Owner preferences note';
  if (row.scope === 'known_issues') return 'Known issues note';
  return `${row.scope} note`;
}

// ---------- preview (no-write) ----------------------------------------------

export interface UpsertNotePlan {
  mode: 'create' | 'update';
  property: { property_id: string; name: string };
  scope: NoteScope;
  title_preview: string | null;
  body_preview: string;
  body_length: number;
  /** When mode='update', the field-by-field diff. Empty array = no-op. */
  changes?: Array<{ field: string; before: unknown; after: unknown }>;
  /** When mode='update', the existing row's id (echoed for the prompt). */
  note_id?: string;
}

export type PreviewUpsertNoteResult =
  | { ok: true; plan: UpsertNotePlan; canonicalInput: UpsertNoteInput }
  | { ok: false; error: UpsertNoteError };

function previewBody(body: string): string {
  return body.length <= 200 ? body : body.slice(0, 197) + '...';
}

/** Validate + render a plan without writing. */
export async function previewUpsertPropertyNote(
  rawInput: unknown,
): Promise<PreviewUpsertNoteResult> {
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

  // ----- CREATE preview ----------------------------------------------
  if (!input.note_id) {
    if (!input.scope) {
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          message: 'scope is required when creating a new note.',
          field: 'scope',
        },
      };
    }
    const body = normalizeBody(input.body);
    if (!body) {
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          message: 'body is required and cannot be empty when creating a new note.',
          field: 'body',
        },
      };
    }
    return {
      ok: true,
      plan: {
        mode: 'create',
        property: { property_id: input.property_id, name: propertyName },
        scope: input.scope,
        title_preview: normalizeTitle(input.title ?? null),
        body_preview: previewBody(body),
        body_length: body.length,
      },
      canonicalInput: input,
    };
  }

  // ----- UPDATE preview ----------------------------------------------
  if (input.scope) {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message:
          'scope cannot be changed on an existing note. Delete and recreate in the desired scope if you really need to move it.',
        field: 'scope',
      },
    };
  }

  const noteLookup = await loadNote(supabase, input.property_id, input.note_id);
  if (!noteLookup.ok) return { ok: false, error: noteLookup.error };
  const existing = noteLookup.note;

  const changes: Array<{ field: string; before: unknown; after: unknown }> = [];

  if ('title' in input) {
    const next = normalizeTitle(input.title ?? null);
    if (next !== existing.title) {
      changes.push({ field: 'title', before: existing.title, after: next });
    }
  }
  if (input.body !== undefined) {
    const next = normalizeBody(input.body);
    if (!next) {
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          message: 'body cannot be empty.',
          field: 'body',
        },
      };
    }
    if (next !== existing.body) {
      changes.push({ field: 'body', before: existing.body, after: next });
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

  return {
    ok: true,
    plan: {
      mode: 'update',
      property: { property_id: input.property_id, name: propertyName },
      scope: existing.scope,
      title_preview:
        'title' in input
          ? normalizeTitle(input.title ?? null)
          : existing.title,
      body_preview: previewBody(
        input.body !== undefined ? (normalizeBody(input.body) ?? existing.body) : existing.body,
      ),
      body_length: (input.body !== undefined
        ? (normalizeBody(input.body) ?? existing.body)
        : existing.body
      ).length,
      changes,
      note_id: existing.id,
    },
    canonicalInput: input,
  };
}
