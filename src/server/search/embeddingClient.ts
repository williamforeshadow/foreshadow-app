import OpenAI from 'openai';

// Shared embeddings client + model constants.
//
// Modelled on src/agent/anthropic.ts: a lazily-memoized singleton with a
// self-explanatory error when the key is missing. Like that module, this one
// imports NOTHING from src/agent, so the cron sweep and the agent's search tools
// can both use it without a circular dependency.
//
// WHY OPENAI AND NOT ANTHROPIC: Anthropic ships no embeddings endpoint. The
// `openai` package was already in package.json (and imported nowhere) before
// this file existed, so this costs no new dependency.
//
// The model id is part of search_embeddings' unique key, which makes swapping
// providers or models a DATA change rather than a migration: point these
// constants somewhere new, and the sweep sees every unit as missing-for-that-
// model and re-embeds through the exact same mechanism. Old vectors stay put
// until garbage-collected, and the read path filters on model so vectors from
// two different models are never compared to each other (cosine distance across
// models is meaningless).

let client: OpenAI | null = null;

/** Model id. Also stored per-row, so changing this triggers a re-embed sweep. */
export const EMBEDDING_MODEL = 'text-embedding-3-small';

/** Must match the vector(N) column width in search_embeddings. */
export const EMBEDDING_DIM = 1536;

/** Inputs per API request. Well inside OpenAI's array and token ceilings. */
export const EMBEDDING_BATCH_SIZE = 96;

/**
 * Whether embeddings are configured at all.
 *
 * Callers use this to degrade gracefully rather than throw: the sweep skips
 * quietly, and search falls back to trigram-only — which is exactly the
 * behaviour that shipped before this feature existed.
 */
export function hasEmbeddingKey(): boolean {
  return !!(process.env.OPENAI_API_KEY || '').trim();
}

export function getOpenAI(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY || '';
    // Same trap, same wording as anthropic.ts: the usual local cause is an
    // EMPTY OPENAI_API_KEY already present in the process environment, which
    // dotenv will not override.
    if (!apiKey.trim()) {
      throw new Error(
        'OPENAI_API_KEY is empty or unset in this process. If it is set in .env.local, the dev server likely inherited an empty OPENAI_API_KEY that overrides it (dotenv does not override already-set env vars) — restart `npm run dev` from a clean terminal.',
      );
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}

export interface EmbeddingResult {
  /** Index into the input array this vector corresponds to. */
  index: number;
  embedding: number[];
}

interface RetryableError {
  status?: number;
  headers?: Record<string, string> | { get?: (k: string) => string | null };
}

/** Pull Retry-After (seconds) off whichever header shape the SDK hands back. */
function retryAfterMs(err: unknown): number | null {
  const h = (err as RetryableError)?.headers;
  if (!h) return null;
  const raw =
    typeof (h as { get?: (k: string) => string | null }).get === 'function'
      ? (h as { get: (k: string) => string | null }).get('retry-after')
      : (h as Record<string, string>)['retry-after'];
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

function isRetryable(err: unknown): boolean {
  const status = (err as RetryableError)?.status;
  return status === 429 || (typeof status === 'number' && status >= 500);
}

const MAX_ATTEMPTS = 3;

/**
 * Call the embeddings API with a bounded retry.
 *
 * Deliberately local rather than a shared helper: this repo has no HTTP wrapper,
 * no retry utility and no rate-limit helper, and one caller does not justify
 * inventing the abstraction. Promote it if a second caller ever needs it.
 *
 * Only 429 and 5xx are retried — a 400 (malformed input, too many tokens) will
 * never succeed on retry and should surface immediately so the row lands in the
 * failure state. Two layers of backoff at different timescales is intentional:
 * this one absorbs a rate-limit blip inside a single tick, and the sweep's
 * next_attempt_at absorbs a poisoned row across days.
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === MAX_ATTEMPTS) break;
      const backoff = retryAfterMs(err) ?? 2 ** attempt * 500;
      const jitter = Math.floor(backoff * 0.25 * Math.random());
      await new Promise((r) => setTimeout(r, backoff + jitter));
    }
  }
  throw lastErr;
}

/**
 * Embed a batch of texts. Order is restored from the API's `index` field rather
 * than assumed, so a caller can zip results back onto its inputs safely.
 */
export async function embedTexts(texts: string[]): Promise<EmbeddingResult[]> {
  if (texts.length === 0) return [];
  const res = await withRetry(() =>
    getOpenAI().embeddings.create({
      model: EMBEDDING_MODEL,
      input: texts,
    }),
  );
  return res.data.map((d) => ({ index: d.index, embedding: d.embedding }));
}

/**
 * Embed a single search query. Returns null instead of throwing when embeddings
 * are unconfigured, so the search path can fall back to trigram silently.
 */
export async function embedQuery(text: string): Promise<number[] | null> {
  const trimmed = text.trim();
  if (!trimmed || !hasEmbeddingKey()) return null;
  const [first] = await embedTexts([trimmed]);
  return first?.embedding ?? null;
}

/**
 * pgvector's text input format is exactly JSON-array syntax, so this is what
 * the RPCs and the batch writer expect. Passing a JSON string (rather than an
 * array) keeps PostgREST from having to coerce into an extension type, which it
 * does not do reliably.
 */
export function toVectorLiteral(embedding: number[]): string {
  return JSON.stringify(embedding);
}

// --- query embedding, for the search read path ------------------------------

const QUERY_CACHE_MAX = 500;
const queryCache = new Map<string, number[]>();

/** trim + lowercase + collapse whitespace, so trivially different phrasings of
 *  the same query share a cache entry (and an embedding). */
function normalizeQuery(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Embed a search query, with an in-process cache, and NEVER throw.
 *
 * This sits on the hot path: find_tasks(search) runs on most agent turns and
 * often several times per turn. Two consequences shape this function.
 *
 * The cache is per-instance (serverless), so the hit rate is modest — but it is
 * free, and it covers the common case of the agent retrying a search within one
 * turn, plus repeated searches inside a conversation on a warm instance.
 *
 * Returning null rather than throwing is the important part: a missing key, a
 * dead provider, or a rate limit must degrade search to exactly the trigram
 * behaviour that shipped before embeddings existed — not fail the tool call.
 * The caller passes null straight through to the RPC, which then skips the
 * vector CTE entirely.
 */
export async function embedQueryCached(text: string): Promise<number[] | null> {
  const key = normalizeQuery(text);
  if (!key || !hasEmbeddingKey()) return null;

  const hit = queryCache.get(key);
  if (hit) return hit;

  try {
    const [first] = await embedTexts([key]);
    const vec = first?.embedding;
    if (!vec) return null;
    // Cheap FIFO eviction — this is a hot-path cache, not a working set to tune.
    if (queryCache.size >= QUERY_CACHE_MAX) {
      const oldest = queryCache.keys().next().value;
      if (oldest !== undefined) queryCache.delete(oldest);
    }
    queryCache.set(key, vec);
    return vec;
  } catch (err) {
    console.warn('[search] query embedding failed; falling back to trigram only', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
