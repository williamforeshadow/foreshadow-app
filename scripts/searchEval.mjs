#!/usr/bin/env node
// Search evaluation harness.
//
//   node scripts/searchEval.mjs seed --scale 20000
//   node scripts/searchEval.mjs embed
//   node scripts/searchEval.mjs measure
//   node scripts/searchEval.mjs sweep-threshold --from 0.30 --to 0.60 --step 0.02
//   node scripts/searchEval.mjs purge
//
// WHY THIS EXISTS
//
// 20260731120000_task_trigram_search.sql chose trigram over full-text search by
// measuring three approaches against real rows and writing the table into the
// migration. This repo therefore already has a standard: retrieval decisions are
// made with numbers, not intuition. Adding embeddings without doing the same
// would be a step down.
//
// It also answers a question the live data cannot. There are ~4.6k real units
// here, which is far too few to say anything about how this behaves for a client
// with a large corpus — and one specific failure (a small tenant's rows getting
// filtered out of an HNSW result set that is dominated by a bigger tenant) is
// invisible until a big neighbour exists. `seed` creates that neighbour.
//
// SAFETY: every write goes into a dedicated organization (slug below). The real
// orgs are never touched. `purge` removes exactly that org.
//
// Follows scripts/db.mjs conventions: plain .mjs, hand-rolled .env.local parser,
// service-role client, no test runner (there is none in this repo).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import {
  CONCEPTS, NONSENSE_QUERIES, PROPERTY_NAMES, PEOPLE, VENDORS,
} from './evalConcepts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(HERE, '.eval', 'manifest.json');

const EVAL_SLUG = 'eval-synthetic';
const EVAL_NAME = '[eval] synthetic search corpus';
const MODEL = 'text-embedding-3-small';
const KNN_K = 200;

// ---------------------------------------------------------------------------
// env + clients (same shape as scripts/db.mjs)
// ---------------------------------------------------------------------------
function loadEnv() {
  const path = join(HERE, '..', '.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, k, raw] = m;
    if (process.env[k]) continue;
    process.env[k] = raw.replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

let _openai = null;
function openai() {
  if (!_openai) {
    const key = (process.env.OPENAI_API_KEY || '').trim();
    if (!key) { console.error('OPENAI_API_KEY is not set'); process.exit(1); }
    _openai = new OpenAI({ apiKey: key });
  }
  return _openai;
}

// ---------------------------------------------------------------------------
// tiny arg parser
// ---------------------------------------------------------------------------
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const num = (name, fallback) => Number(arg(name, fallback));

// deterministic PRNG so a re-seed at the same scale produces the same corpus
let _seed = 1337;
function rnd() {
  _seed = (_seed * 1664525 + 1013904223) % 4294967296;
  return _seed / 4294967296;
}
const pick = (a) => a[Math.floor(rnd() * a.length)];

// ---------------------------------------------------------------------------
// seed
// ---------------------------------------------------------------------------
async function getOrCreateEvalOrg() {
  const { data: found } = await db.from('organizations')
    .select('id').eq('slug', EVAL_SLUG).maybeSingle();
  if (found) return found.id;
  const { data, error } = await db.from('organizations')
    .insert({ slug: EVAL_SLUG, name: EVAL_NAME }).select('id').single();
  if (error) throw new Error(`create eval org: ${error.message}`);
  return data.id;
}

/** Wrap a plain sentence in the TipTap shape turnover_tasks.description holds. */
function tiptap(text) {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

async function seed() {
  const scale = num('scale', 20000);
  const orgId = await getOrCreateEvalOrg();
  console.log(`eval org: ${orgId}`);

  const { count: existing } = await db.from('turnover_tasks')
    .select('id', { count: 'exact', head: true }).eq('org_id', orgId);
  if (existing) {
    console.log(`purging ${existing} existing eval tasks first...`);
    await purgeTasks(orgId);
  }

  // properties
  const props = PROPERTY_NAMES.map((n, i) => ({
    name: `[eval] ${n} #${i + 1}`, org_id: orgId, is_active: true,
  }));
  const { data: propRows, error: pErr } = await db.from('properties')
    .insert(props).select('id, name');
  if (pErr) throw new Error(`properties: ${pErr.message}`);

  // Ground-truth rows come first so every concept is represented, then filler
  // is generated up to --scale so the index has realistic bulk around them.
  const manifest = { org_id: orgId, scale, model: MODEL, concepts: {}, created_at: new Date().toISOString() };
  const rows = [];

  for (const c of CONCEPTS) {
    manifest.concepts[c.id] = { channel: c.channel, queries: c.queries, relevant: [], distractors: [] };
    for (const d of c.docs) {
      const p = pick(propRows);
      rows.push({
        _concept: c.id, _role: 'relevant',
        title: d.length > 60 ? d.slice(0, 57) + '...' : d,
        description: tiptap(`${d}. Reported by ${pick(PEOPLE)}. Vendor: ${pick(VENDORS)}.`),
        org_id: orgId, property_id: p.id, property_name: p.name,
      });
    }
    for (const d of c.distractors) {
      const p = pick(propRows);
      rows.push({
        _concept: c.id, _role: 'distractor',
        title: d,
        description: tiptap(`${d}. Logged by ${pick(PEOPLE)}.`),
        org_id: orgId, property_id: p.id, property_name: p.name,
      });
    }
  }

  // Filler: recombined domain sentences that belong to no concept. These are the
  // haystack — without them precision@k is meaningless because every row in the
  // corpus is an answer to something.
  const FILLER = [
    'Routine walkthrough completed, nothing to report',
    'Owner requested an update on the maintenance schedule',
    'Adjusted the thermostat schedule for the shoulder season',
    'Replaced the batteries in the entry keypad',
    'Confirmed the cleaner arrival time for the weekend',
    'Photographed the damage for the claim file',
    'Updated the house manual with the new gate instructions',
    'Coordinated with the neighbour about the shared driveway',
  ];
  let filler = 0;
  while (rows.length < scale) {
    const p = pick(propRows);
    const base = pick(FILLER);
    rows.push({
      _concept: null, _role: 'filler',
      title: `${base} — ${p.name}`,
      description: tiptap(`${base}. Handled by ${pick(PEOPLE)} on site. Reference ${Math.floor(rnd() * 99999)}.`),
      org_id: orgId, property_id: p.id, property_name: p.name,
    });
    filler++;
  }

  console.log(`inserting ${rows.length} tasks (${rows.length - filler} ground truth, ${filler} filler)...`);
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const payload = slice.map(({ _concept, _role, ...r }) => r);
    const { data, error } = await db.from('turnover_tasks').insert(payload).select('id');
    if (error) throw new Error(`tasks insert at ${i}: ${error.message}`);
    slice.forEach((r, j) => {
      if (!r._concept) return;
      manifest.concepts[r._concept][r._role === 'relevant' ? 'relevant' : 'distractors'].push(data[j].id);
    });
    process.stdout.write(`\r  ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
  }
  process.stdout.write('\n');

  mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`manifest -> ${MANIFEST_PATH}`);
  console.log('\nNext: node scripts/searchEval.mjs embed');
}

async function purgeTasks(orgId) {
  // Deleting tasks fires the GC trigger, which removes their embeddings too.
  for (;;) {
    const { data } = await db.from('turnover_tasks')
      .select('id').eq('org_id', orgId).limit(1000);
    if (!data?.length) break;
    const { error } = await db.from('turnover_tasks')
      .delete().in('id', data.map((r) => r.id));
    if (error) throw new Error(`purge tasks: ${error.message}`);
    process.stdout.write(`\r  deleted ${data.length}...`);
  }
  process.stdout.write('\n');
}

async function purge() {
  const { data: org } = await db.from('organizations')
    .select('id').eq('slug', EVAL_SLUG).maybeSingle();
  if (!org) { console.log('no eval org, nothing to purge'); return; }
  await purgeTasks(org.id);
  await db.from('properties').delete().eq('org_id', org.id);
  await db.from('search_embeddings').delete().eq('org_id', org.id);
  await db.from('organizations').delete().eq('id', org.id);
  console.log('purged eval org');
}

// ---------------------------------------------------------------------------
// embed — drain the eval org's queue
// ---------------------------------------------------------------------------
async function embedCorpus() {
  const m = manifest();
  const started = Date.now();
  let total = 0;
  for (;;) {
    const { data, error } = await db.rpc('next_embedding_batch', {
      p_model: MODEL, p_limit: 96, p_per_org: 96, p_since: null,
    });
    if (error) throw new Error(`next_embedding_batch: ${error.message}`);
    const units = (data ?? []).filter((u) => u.org_id === m.org_id);
    if (!units.length) break;

    const res = await openai().embeddings.create({
      model: MODEL, input: units.map((u) => u.content),
    });
    const byIdx = new Map(res.data.map((d) => [d.index, d.embedding]));
    const rows = units.map((u, i) => ({
      org_id: u.org_id, source_type: u.source_type, source_id: u.source_id,
      model: MODEL, content_hash: u.content_hash,
      embedding: JSON.stringify(byIdx.get(i)), token_count: null, error: null,
    }));
    const { error: wErr } = await db.rpc('upsert_search_embeddings', { p_rows: rows });
    if (wErr) throw new Error(`upsert: ${wErr.message}`);
    total += rows.length;
    process.stdout.write(`\r  embedded ${total} (${Math.round((Date.now() - started) / 1000)}s)`);
  }
  process.stdout.write('\n');
  console.log(`done: ${total} units`);
}

// ---------------------------------------------------------------------------
// retrieval modes
// ---------------------------------------------------------------------------
function manifest() {
  if (!existsSync(MANIFEST_PATH)) {
    console.error('No manifest. Run `seed` first.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}

const qCache = new Map();
async function embedQuery(q) {
  if (qCache.has(q)) return qCache.get(q);
  const res = await openai().embeddings.create({ model: MODEL, input: [q] });
  const v = res.data[0].embedding;
  qCache.set(q, v);
  return v;
}

async function trigramRank(orgId, q) {
  const { data, error } = await db.rpc('search_tasks', {
    p_org: orgId, p_query: q, p_limit: 50, p_apply_recency: false,
  });
  if (error) throw new Error(`search_tasks: ${error.message}`);
  return (data ?? []).map((r) => ({ id: r.task_id, score: r.score }));
}

/** Vector hits rolled up to task ids. Comments/messages map to their parent. */
async function vectorRank(orgId, q, threshold) {
  const vec = await embedQuery(q);
  const { data, error } = await db.rpc('search_embeddings_knn', {
    p_org: orgId, p_query_embedding: JSON.stringify(vec),
    p_model: MODEL, p_limit: KNN_K, p_source_types: ['task'],
  });
  if (error) throw new Error(`knn: ${error.message}`);
  const best = new Map();
  for (const r of data ?? []) {
    if (r.cos < threshold) continue;
    const prev = best.get(r.source_id);
    if (prev === undefined || r.cos > prev) best.set(r.source_id, r.cos);
  }
  return [...best.entries()]
    .map(([id, cos]) => ({ id, score: rescale(cos, threshold) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * The SAME rescale the fused RPC will apply in SQL. word_similarity is [0,1]
 * with a hard floor; raw cosine for a short query against a longer document
 * sits in a compressed band where a good match is ~0.45-0.58. Mapping the floor
 * to 0 puts the two channels on comparable footing; the weight caps a perfect
 * paraphrase just below a perfect lexical hit.
 *
 * If this diverges from the SQL, the harness measures something that does not
 * ship. Keep them in step.
 */
const VECTOR_WEIGHT = 0.9;
// Must mirror the SQL exactly. The ceiling exists because real cosine for a
// short query against a longer document tops out near 0.6, never 1.0 — dividing
// by (1 - threshold) squashed the whole vector channel into [0, 0.14] and it
// could not outrank even a partial trigram hit. See the migration header.
const VECTOR_CEILING = 0.62;
function rescale(cos, threshold) {
  const t = Math.min(1, (cos - threshold) / Math.max(VECTOR_CEILING - threshold, 1e-6));
  return t * VECTOR_WEIGHT;
}

function fuse(a, b) {
  const best = new Map();
  for (const r of [...a, ...b]) {
    const prev = best.get(r.id);
    if (prev === undefined || r.score > prev) best.set(r.id, r.score);
  }
  return [...best.entries()].map(([id, score]) => ({ id, score }))
    .sort((x, y) => y.score - x.score);
}

/**
 * The fusion as it actually ships: one call into search_tasks with the query
 * embedding attached. `hybrid` above reimplements the same maths in JS so the
 * design could be measured before the SQL existed — this mode is what proves
 * the two agree. If they diverge, every number in the migration header is
 * describing something other than the product.
 */
async function sqlRank(orgId, q, threshold) {
  const vec = await embedQuery(q);
  const { data, error } = await db.rpc('search_tasks', {
    p_org: orgId, p_query: q, p_limit: 50, p_apply_recency: false,
    p_query_embedding: JSON.stringify(vec),
    p_vector_threshold: threshold,
    p_vector_weight: VECTOR_WEIGHT,
    p_vector_ceiling: VECTOR_CEILING,
  });
  if (error) throw new Error(`search_tasks(hybrid): ${error.message}`);
  return (data ?? []).map((r) => ({ id: r.task_id, score: r.score }));
}

const CASCADE_FALLBACK = 0.62;
async function rank(mode, orgId, q, threshold) {
  if (mode === 'trigram') return trigramRank(orgId, q);
  if (mode === 'vector') return vectorRank(orgId, q, threshold);
  if (mode === 'hybrid') {
    const [t, v] = await Promise.all([trigramRank(orgId, q), vectorRank(orgId, q, threshold)]);
    return fuse(t, v);
  }
  if (mode === 'sql') return sqlRank(orgId, q, threshold);
  if (mode === 'cascade') {
    const t = await trigramRank(orgId, q);
    if (t.length && t[0].score >= CASCADE_FALLBACK) return t;
    return fuse(t, await vectorRank(orgId, q, threshold));
  }
  throw new Error(`unknown mode ${mode}`);
}

// ---------------------------------------------------------------------------
// measure
// ---------------------------------------------------------------------------
function metrics(ranked, relevant, distractors, ks = [5, 10, 25]) {
  const rel = new Set(relevant);
  const dis = new Set(distractors);
  const out = {};
  for (const k of ks) {
    const top = ranked.slice(0, k).map((r) => r.id);
    out[`hit@${k}`] = top.some((id) => rel.has(id)) ? 1 : 0;
    out[`recall@${k}`] = rel.size ? top.filter((id) => rel.has(id)).length / rel.size : 0;
  }
  const first = ranked.findIndex((r) => rel.has(r.id));
  out.rr = first === -1 ? 0 : 1 / (first + 1);
  const top5 = ranked.slice(0, 5).map((r) => r.id);
  out['precision@5'] = top5.length ? top5.filter((id) => rel.has(id)).length / top5.length : 0;
  out.distractors_at_5 = top5.filter((id) => dis.has(id)).length;
  return out;
}

async function measure(opts = {}) {
  const m = manifest();
  const threshold = opts.threshold ?? num('threshold', 0.42);
  const modes = (opts.modes ?? arg('modes', 'trigram,vector,hybrid,cascade')).split(',');
  const quiet = !!opts.quiet;

  const agg = {};
  for (const mode of modes) {
    agg[mode] = {
      n: 0, byChannel: {},
      'hit@5': 0, 'hit@10': 0, 'recall@10': 0, mrr: 0, 'precision@5': 0,
      distractors_at_5: 0, falsePositives: 0, latency: [],
    };
  }

  for (const [cid, c] of Object.entries(m.concepts)) {
    if (!c.relevant.length) continue;
    for (const q of c.queries) {
      for (const mode of modes) {
        const t0 = Date.now();
        const ranked = await rank(mode, m.org_id, q, threshold);
        const ms = Date.now() - t0;
        const r = metrics(ranked, c.relevant, c.distractors);
        const a = agg[mode];
        a.n++;
        a['hit@5'] += r['hit@5'];
        a['hit@10'] += r['hit@10'];
        a['recall@10'] += r['recall@10'];
        a.mrr += r.rr;
        a['precision@5'] += r['precision@5'];
        a.distractors_at_5 += r.distractors_at_5;
        a.latency.push(ms);
        a.byChannel[c.channel] ??= { n: 0, hit: 0 };
        a.byChannel[c.channel].n++;
        a.byChannel[c.channel].hit += r['hit@10'];
      }
    }
  }

  // The gate: nonsense must return nothing.
  for (const q of NONSENSE_QUERIES) {
    for (const mode of modes) {
      const ranked = await rank(mode, m.org_id, q, threshold);
      if (ranked.length > 0) agg[mode].falsePositives++;
    }
  }

  if (!quiet) {
    console.log(`\nthreshold=${threshold}  queries=${agg[modes[0]].n}  corpus=${m.scale}\n`);
    const pct = (x, n) => `${((x / n) * 100).toFixed(1)}%`;
    const p = (arr, q) => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length * q)] ?? 0;
    console.log(
      '| mode    | hit@5 | hit@10 | recall@10 |  MRR  | prec@5 | distractors@5 | nonsense hits | p50 ms | p95 ms |',
    );
    console.log(
      '|---------|-------|--------|-----------|-------|--------|---------------|---------------|--------|--------|',
    );
    for (const mode of modes) {
      const a = agg[mode];
      console.log(
        `| ${mode.padEnd(7)} | ${pct(a['hit@5'], a.n).padStart(5)} | ${pct(a['hit@10'], a.n).padStart(6)} | ` +
        `${pct(a['recall@10'], a.n).padStart(9)} | ${(a.mrr / a.n).toFixed(3)} | ` +
        `${pct(a['precision@5'], a.n).padStart(6)} | ${String(a.distractors_at_5).padStart(13)} | ` +
        `${String(a.falsePositives + '/' + NONSENSE_QUERIES.length).padStart(13)} | ` +
        `${String(p(a.latency, 0.5)).padStart(6)} | ${String(p(a.latency, 0.95)).padStart(6)} |`,
      );
    }
    console.log('\nhit@10 by channel (what SHOULD find each concept):');
    for (const mode of modes) {
      const parts = Object.entries(agg[mode].byChannel)
        .map(([ch, v]) => `${ch} ${((v.hit / v.n) * 100).toFixed(0)}%`).join('  ');
      console.log(`  ${mode.padEnd(8)} ${parts}`);
    }
  }
  return agg;
}

// ---------------------------------------------------------------------------
// sweep-threshold
// ---------------------------------------------------------------------------
async function sweepThreshold() {
  const from = num('from', 0.30), to = num('to', 0.60), step = num('step', 0.02);
  console.log('\n| threshold | hybrid hit@10 | hybrid prec@5 | nonsense hits |');
  console.log('|-----------|---------------|---------------|---------------|');
  let best = null;
  const rows = [];
  for (let t = from; t <= to + 1e-9; t += step) {
    const th = Math.round(t * 100) / 100;
    const agg = await measure({ threshold: th, modes: 'hybrid', quiet: true });
    const a = agg.hybrid;
    const hit = (a['hit@10'] / a.n) * 100;
    const prec = (a['precision@5'] / a.n) * 100;
    console.log(
      `| ${th.toFixed(2).padStart(9)} | ${hit.toFixed(1).padStart(13)} | ${prec.toFixed(1).padStart(13)} | ` +
      `${String(a.falsePositives + '/' + NONSENSE_QUERIES.length).padStart(13)} |`,
    );
    rows.push({ th, hit, prec, fp: a.falsePositives });
    if (a.falsePositives === 0 && (!best || hit > best.hit)) best = { th, hit, prec };
  }

  // Deliberately NOT a single "recommended" number.
  //
  // The first version of this picked the highest hit rate that admitted zero
  // nonsense, and on the first real run that returned 0.46 — a value that
  // destroys 60 points of recall to win a column. There is usually no threshold
  // that is best on both axes here, and printing one implies otherwise.
  //
  // The reason is structural: recall and precision both IMPROVE as the floor
  // drops (more true matches enter the top-k and outrank the distractors), so
  // the floor's only real job is rejecting queries with no answer at all. That
  // makes this a product judgement — how much worse is inventing an answer than
  // missing one — not a number a script can compute.
  const zeroFp = rows.filter((r) => r.fp === 0);
  const recall90 = rows.filter((r) => r.hit >= 90);
  console.log('\nThis is a trade-off curve, not an optimum. Read it, then choose:');
  console.log(
    `  strictest floor with zero nonsense hits : ${zeroFp.length ? `${zeroFp[0].th.toFixed(2)} (hit@10 ${zeroFp[0].hit.toFixed(1)}%)` : 'none in range'}`,
  );
  console.log(
    `  most permissive floor at >=90% hit@10   : ${recall90.length ? `${recall90[recall90.length - 1].th.toFixed(2)} (nonsense ${recall90[recall90.length - 1].fp}/${NONSENSE_QUERIES.length})` : 'none in range'}`,
  );
  if (best) {
    console.log(`  best hit@10 among zero-nonsense rows    : ${best.th.toFixed(2)} (${best.hit.toFixed(1)}%)`);
  }
  console.log(
    '\nAlso inspect WHICH nonsense queries pass: a near-miss that lands on genuinely\n' +
    'related content is not the same failure as one that lands on something random.',
  );
}

// ---------------------------------------------------------------------------
const CMD = process.argv[2];
const run = {
  seed, embed: embedCorpus, measure, 'sweep-threshold': sweepThreshold, purge,
}[CMD];
if (!run) {
  console.log('usage: searchEval.mjs <seed|embed|measure|sweep-threshold|purge> [flags]');
  process.exit(1);
}
run().catch((e) => { console.error('\nFAILED:', e?.message ?? e); process.exit(1); });
