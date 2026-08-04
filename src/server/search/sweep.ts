import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  EMBEDDING_BATCH_SIZE,
  EMBEDDING_MODEL,
  embedTexts,
  hasEmbeddingKey,
  toVectorLiteral,
} from './embeddingClient';

// The embedding sweep: bring search_embeddings into agreement with reality.
//
// There is no cursor and no watermark. next_embedding_batch() returns whatever
// is currently missing, drifted, or failed-and-due, and embedding a unit removes
// it from that result because its stored content_hash then matches the source
// row's generated one. Backfill and steady-state freshness are therefore the
// SAME mechanism — see the header of 20260804120000_search_embeddings.sql.
//
// Two consequences worth knowing before changing anything here:
//
//   1. The 60s Vercel route ceiling is not a correctness constraint. A tick that
//      runs out of budget mid-way simply leaves the rest queued; the next tick
//      picks up exactly where reality says to. Nothing needs saving.
//   2. Running two ticks concurrently is harmless. Both may embed the same unit
//      and the second upsert just overwrites with an identical vector. Wasteful,
//      not wrong — so no locking.

/** Leaves ~10s of the route's 60s for cold start, auth and the response. */
const DEFAULT_BUDGET_MS = 50_000;

/** Per-tick ceiling independent of the clock, so a fast DB can't run away. */
const MAX_UNITS_PER_TICK = 2000;

/** Fair share per org per tick — stops one backfill starving every other org. */
const PER_ORG_UNITS = 400;

/**
 * How far back the frequent tick looks. Sized to survive a long weekend of
 * failed deploys; being wrong is safe because the hourly exhaustive tick has no
 * window at all.
 */
const INCREMENTAL_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

/** Ceiling on the observability-only "how much is left" probe. */
const REMAINING_PROBE_CAP = 5000;

export type SweepMode = 'incremental' | 'full';

export interface SweepResult {
  mode: SweepMode;
  embedded: number;
  failed: number;
  batches: number;
  elapsed_ms: number;
  stopped_reason: 'queue_empty' | 'budget' | 'cap' | 'no_api_key';
  /** Only computed in 'full' mode: units still stale, capped for cost. */
  remaining?: number;
  /** True when `remaining` hit the probe cap, i.e. it is a floor not a total. */
  remaining_capped?: boolean;
}

interface QueueUnit {
  source_type: string;
  source_id: string;
  org_id: string;
  content_hash: string;
  content: string;
}

interface UpsertRow {
  org_id: string;
  source_type: string;
  source_id: string;
  model: string;
  content_hash: string;
  embedding: string | null;
  token_count: number | null;
  error: string | null;
}

export async function runEmbeddingSweep(opts: {
  mode: SweepMode;
  budgetMs?: number;
  maxUnits?: number;
}): Promise<SweepResult> {
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const maxUnits = opts.maxUnits ?? MAX_UNITS_PER_TICK;

  const base: SweepResult = {
    mode: opts.mode,
    embedded: 0,
    failed: 0,
    batches: 0,
    elapsed_ms: 0,
    stopped_reason: 'queue_empty',
  };

  if (!hasEmbeddingKey()) {
    return { ...base, stopped_reason: 'no_api_key', elapsed_ms: Date.now() - started };
  }

  const supabase = getSupabaseServer();
  const since =
    opts.mode === 'full'
      ? null
      : new Date(Date.now() - INCREMENTAL_WINDOW_MS).toISOString();

  let embedded = 0;
  let failed = 0;
  let batches = 0;
  let stopped: SweepResult['stopped_reason'] = 'queue_empty';

  while (true) {
    if (Date.now() - started > budgetMs) {
      stopped = 'budget';
      break;
    }
    if (embedded + failed >= maxUnits) {
      stopped = 'cap';
      break;
    }

    const { data, error } = await supabase.rpc('next_embedding_batch', {
      p_model: EMBEDDING_MODEL,
      p_limit: EMBEDDING_BATCH_SIZE,
      p_per_org: PER_ORG_UNITS,
      p_since: since,
    });
    if (error) throw new Error(`next_embedding_batch failed: ${error.message}`);

    const units = (data ?? []) as QueueUnit[];
    if (units.length === 0) {
      stopped = 'queue_empty';
      break;
    }

    batches += 1;
    let rows: UpsertRow[];

    try {
      const vectors = await embedTexts(units.map((u) => u.content));
      // Zip by the API's own index rather than assuming order.
      const byIndex = new Map(vectors.map((v) => [v.index, v.embedding]));
      rows = units.map((u, i) => {
        const vec = byIndex.get(i);
        return {
          org_id: u.org_id,
          source_type: u.source_type,
          source_id: u.source_id,
          model: EMBEDDING_MODEL,
          content_hash: u.content_hash,
          embedding: vec ? toVectorLiteral(vec) : null,
          token_count: null,
          error: vec ? null : 'provider returned no vector for this input',
        };
      });
    } catch (err) {
      // The whole request failed (bad input somewhere, or retries exhausted).
      // Record the failure ON the rows so their backoff advances and the next
      // tick moves past them instead of retrying the same batch forever.
      const message = err instanceof Error ? err.message : 'embedding request failed';
      rows = units.map((u) => ({
        org_id: u.org_id,
        source_type: u.source_type,
        source_id: u.source_id,
        model: EMBEDDING_MODEL,
        content_hash: u.content_hash,
        embedding: null,
        token_count: null,
        error: message.slice(0, 500),
      }));
      console.warn('[embedding sweep] batch failed', {
        units: units.length,
        error: message,
      });
    }

    const { error: writeErr } = await supabase.rpc('upsert_search_embeddings', {
      p_rows: rows,
    });
    if (writeErr) throw new Error(`upsert_search_embeddings failed: ${writeErr.message}`);

    embedded += rows.filter((r) => r.embedding !== null).length;
    failed += rows.filter((r) => r.embedding === null).length;
  }

  const result: SweepResult = {
    mode: opts.mode,
    embedded,
    failed,
    batches,
    elapsed_ms: Date.now() - started,
    stopped_reason: stopped,
  };

  // Only on the hourly tick, and deliberately CAPPED. This asks "what is still
  // stale?", which is next_embedding_batch's answer — not `count(*)` on the
  // queue view, which would report every eligible unit in the product whether
  // it needs work or not. Capped because an exact remaining-count on a large
  // tenant is the most expensive statement in this file and it is only ever
  // used for observability.
  if (opts.mode === 'full') {
    const { data: probe } = await supabase.rpc('next_embedding_batch', {
      p_model: EMBEDDING_MODEL,
      p_limit: REMAINING_PROBE_CAP,
      p_per_org: REMAINING_PROBE_CAP,
      p_since: null,
    });
    const n = (probe ?? []).length;
    result.remaining = n;
    result.remaining_capped = n >= REMAINING_PROBE_CAP;
  }

  return result;
}
