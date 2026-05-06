import { getSupabaseServer } from '@/lib/supabaseServer';

// Activity ledger for property knowledge writes.
//
// Companion to lib/logProjectActivity.ts (which is project-scoped, not
// property-scoped). Every successful create/update/delete on a property
// knowledge table writes one row here so a future ledger UI can render
// the full timeline. The helper is best-effort — a logger failure must
// NEVER fail the underlying write — and gracefully tolerates a null
// actor (web chat without auth, system writes, etc.).
//
// Schema (see migrations executed May 2026):
//   property_knowledge_activity_log (
//     id uuid PK,
//     property_id uuid NOT NULL,
//     user_id text NULL,                  -- nullable: unattributed
//     resource_type text NOT NULL,        -- 'note' | 'contact' | 'room' | 'card' | 'access' | 'connectivity' | 'tech_account' | 'document'
//     resource_id uuid NULL,              -- nullable on hard-delete
//     action text NOT NULL,               -- 'create' | 'update' | 'delete'
//     changes jsonb NULL,
//     subject_label text NULL,            -- snapshot of the row's human-readable name for the ledger UI
//     source text NULL,                   -- 'web' | 'agent_slack' | 'agent_web' | etc.
//     created_at timestamptz default now()
//   )

export type KnowledgeResourceType =
  | 'note'
  | 'contact'
  | 'room'
  | 'card'
  | 'access'
  | 'connectivity'
  | 'tech_account'
  | 'document';

export type KnowledgeAction = 'create' | 'update' | 'delete';

/**
 * The shape we put into the `changes` jsonb column. Discriminated by
 * `kind` so the future ledger UI can render each case differently
 * without parsing strings:
 *   - 'snapshot' — used for create/delete; carries the full row state
 *     (or as much of it as is human-meaningful — we strip ids and FKs
 *     since those are already on the ledger row).
 *   - 'diff'     — used for update; an array of {field, before, after}
 *     entries we already compute in the upsert services.
 */
export type KnowledgeChanges =
  | { kind: 'snapshot'; row: Record<string, unknown> }
  | {
      kind: 'diff';
      entries: Array<{ field: string; before: unknown; after: unknown }>;
    };

/**
 * Source surface, for debugging. Callers pass one of:
 *   - 'web'         → manual edit from the property knowledge UI
 *   - 'agent_slack' → agent run originating from Slack (verified actor)
 *   - 'agent_web'   → agent run from in-app web chat (actor may be null today)
 */
export type KnowledgeSource = 'web' | 'agent_slack' | 'agent_web' | 'system';

export interface LogPropertyKnowledgeActivityInput {
  property_id: string;
  user_id: string | null;
  resource_type: KnowledgeResourceType;
  resource_id: string | null;
  action: KnowledgeAction;
  changes: KnowledgeChanges | null;
  subject_label: string | null;
  source: KnowledgeSource;
}

/**
 * Best-effort insert into property_knowledge_activity_log. Never throws;
 * a logging failure logs to console and the caller proceeds normally.
 *
 * IMPORTANT: callers MUST invoke this AFTER the underlying write
 * succeeds. Logging a write that didn't happen would corrupt the
 * ledger.
 */
export async function logPropertyKnowledgeActivity(
  input: LogPropertyKnowledgeActivityInput,
): Promise<void> {
  try {
    const { error } = await getSupabaseServer()
      .from('property_knowledge_activity_log')
      .insert({
        property_id: input.property_id,
        user_id: input.user_id,
        resource_type: input.resource_type,
        resource_id: input.resource_id,
        action: input.action,
        changes: input.changes,
        subject_label: input.subject_label,
        source: input.source,
      });
    if (error) {
      console.error(
        '[property_knowledge_activity_log] insert failed:',
        error.message,
        { ...input, changes: undefined }, // omit potentially-large changes from the log
      );
    }
  } catch (err) {
    console.error('[property_knowledge_activity_log] threw:', err);
  }
}
