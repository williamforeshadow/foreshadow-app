import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  logPropertyKnowledgeActivity,
  type KnowledgeSource,
} from '@/lib/logPropertyKnowledgeActivity';

// Service: hard-delete a property note.
//
// Mirrors deleteTask in shape but simpler — no cascading, no comment
// counts. The HTTP DELETE route does no FK cleanup either; one row in,
// one row out.

const inputSchema = z.object({
  property_id: z.string().uuid(),
  note_id: z.string().uuid(),
  // Bookkeeping for the activity ledger. See upsertPropertyNote.ts.
  actor_user_id: z.string().nullable().optional(),
  source: z
    .enum(['web', 'agent_slack', 'agent_web', 'system'])
    .optional()
    .default('web'),
});

export type DeleteNoteInput = z.infer<typeof inputSchema>;

export type DeleteNoteErrorCode = 'invalid_input' | 'not_found' | 'db_error';

export interface DeleteNoteError {
  code: DeleteNoteErrorCode;
  message: string;
  field?: string;
}

export interface DeletedNoteSnapshot {
  note_id: string;
  property_id: string;
  scope: string;
  title: string | null;
  body: string;
}

export type DeleteNoteResult =
  | { ok: true; snapshot: DeletedNoteSnapshot }
  | { ok: false; error: DeleteNoteError };

export async function deletePropertyNote(
  rawInput: unknown,
): Promise<DeleteNoteResult> {
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
    .from('property_notes')
    .select('id, property_id, scope, title, body')
    .eq('id', input.note_id)
    .eq('property_id', input.property_id)
    .maybeSingle();
  if (loadErr) {
    return {
      ok: false,
      error: { code: 'db_error', message: loadErr.message, field: 'note_id' },
    };
  }
  if (!existing) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: `No note found with id ${input.note_id} on property ${input.property_id}.`,
        field: 'note_id',
      },
    };
  }

  const { error: delErr } = await supabase
    .from('property_notes')
    .delete()
    .eq('id', input.note_id)
    .eq('property_id', input.property_id);
  if (delErr) {
    return { ok: false, error: { code: 'db_error', message: delErr.message } };
  }

  const row = existing as {
    id: string;
    property_id: string;
    scope: string;
    title: string | null;
    body: string;
  };

  await logPropertyKnowledgeActivity({
    property_id: row.property_id,
    user_id: input.actor_user_id ?? null,
    resource_type: 'note',
    // Hard-delete so the FK is gone — leave resource_id null and rely
    // on subject_label + the snapshot in `changes` for ledger display.
    resource_id: null,
    action: 'delete',
    changes: {
      kind: 'snapshot',
      row: { scope: row.scope, title: row.title, body: row.body },
    },
    subject_label:
      row.title && row.title.trim() !== ''
        ? row.title
        : row.scope === 'owner_preferences'
          ? 'Owner preferences note'
          : row.scope === 'known_issues'
            ? 'Known issues note'
            : `${row.scope} note`,
    source: (input.source ?? 'web') as KnowledgeSource,
  });

  return {
    ok: true,
    snapshot: {
      note_id: row.id,
      property_id: row.property_id,
      scope: row.scope,
      title: row.title,
      body: row.body,
    },
  };
}

// ---------- preview (no-write) ----------------------------------------------

export interface DeleteNotePlan {
  property: { property_id: string; name: string };
  note: {
    note_id: string;
    scope: string;
    title: string | null;
    body_preview: string;
  };
}

export type PreviewDeleteNoteResult =
  | { ok: true; plan: DeleteNotePlan; canonicalInput: DeleteNoteInput }
  | { ok: false; error: DeleteNoteError };

export async function previewDeletePropertyNote(
  rawInput: unknown,
): Promise<PreviewDeleteNoteResult> {
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

  const [propRes, noteRes] = await Promise.all([
    supabase
      .from('properties')
      .select('id, name')
      .eq('id', input.property_id)
      .maybeSingle(),
    supabase
      .from('property_notes')
      .select('id, scope, title, body, property_id')
      .eq('id', input.note_id)
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
  if (noteRes.error) {
    return {
      ok: false,
      error: { code: 'db_error', message: noteRes.error.message, field: 'note_id' },
    };
  }
  if (!noteRes.data) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: `No note found with id ${input.note_id} on property ${input.property_id}.`,
        field: 'note_id',
      },
    };
  }

  const note = noteRes.data as {
    id: string;
    scope: string;
    title: string | null;
    body: string;
  };
  const prop = propRes.data as { id: string; name: string };

  return {
    ok: true,
    plan: {
      property: { property_id: prop.id, name: prop.name },
      note: {
        note_id: note.id,
        scope: note.scope,
        title: note.title,
        body_preview:
          note.body.length <= 200 ? note.body : note.body.slice(0, 197) + '...',
      },
    },
    canonicalInput: input,
  };
}
