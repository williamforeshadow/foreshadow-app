#!/usr/bin/env node
// End-to-end checks for task description handling, against a real database.
//
// The bug this exists for: description edits were compared against a truncated
// display preview, so any change past the cutoff reported "nothing would change"
// while the commit still wrote the new text. The same mistake appeared in three
// separate places. These scenarios assert the two things that actually matter —
// an edit is DETECTED, and what gets STORED has the structure it claims.
//
// Usage:
//   npm run dev                                  # in another terminal
//   node scripts/taskDescriptionEval.mjs
//   node scripts/taskDescriptionEval.mjs purge

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const ORG_NAME = 'Task Desc Eval Org';
const BASE_URL = process.env.TASK_DESC_BASE_URL || 'http://localhost:3000';
const ENDPOINT = `${BASE_URL}/api/dev/task-desc`;

function loadEnv() {
  const envPath = path.join(repoRoot, '.env.local');
  if (!fs.existsSync(envPath)) throw new Error('.env.local not found');
  const env = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[t.slice(0, eq).trim()] = v;
  }
  return env;
}

const env = loadEnv();
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let pass = 0;
let fail = 0;
const ok = (label, cond, detail) => {
  if (cond) {
    pass += 1;
    console.log(`    ok   ${label}`);
  } else {
    fail += 1;
    console.log(`    FAIL ${label}`);
    if (detail !== undefined) {
      console.log(`         ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    }
  }
};

async function call(mode, payload) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode, ...payload }),
  });
  if (!res.ok) throw new Error(`${mode} HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.threw) throw new Error(`service threw: ${json.error}\n${json.stack ?? ''}`);
  return json;
}

async function getOrg() {
  const { data } = await db.from('organizations').select('id').eq('name', ORG_NAME).maybeSingle();
  return data?.id ?? null;
}

async function ensureFixtures() {
  let orgId = await getOrg();
  if (!orgId) {
    const { data, error } = await db
      .from('organizations')
      .insert({ name: ORG_NAME, slug: 'task-desc-eval' })
      .select('id')
      .single();
    if (error) throw new Error(`could not create org: ${error.message}`);
    orgId = data.id;
  }
  let { data: prop } = await db
    .from('properties')
    .select('id, name')
    .eq('org_id', orgId)
    .maybeSingle();
  if (!prop) {
    const { data, error } = await db
      .from('properties')
      .insert({ org_id: orgId, name: 'Task Desc Eval Property', is_active: true })
      .select('id, name')
      .single();
    if (error) throw new Error(`could not create property: ${error.message}`);
    prop = data;
  }
  return { orgId, property: prop };
}

async function purge() {
  const orgId = await getOrg();
  if (!orgId) return console.log('Nothing to purge.');
  const { data: props } = await db.from('properties').select('id').eq('org_id', orgId);
  const ids = (props ?? []).map((p) => p.id);
  if (ids.length > 0) {
    await db.from('turnover_tasks').delete().in('property_id', ids);
    await db.from('properties').delete().in('id', ids);
  }
  await db.from('organizations').delete().eq('id', orgId);
  console.log('Purged.');
}

/** Node types in a stored description, top level only. */
function blockTypes(desc) {
  return (desc?.content ?? []).map((n) => n.type);
}

async function main() {
  if (process.argv[2] === 'purge') return purge();

  try {
    await fetch(BASE_URL, { method: 'HEAD' });
  } catch {
    console.error(`Cannot reach ${BASE_URL}. Start the dev server first: npm run dev`);
    process.exit(1);
  }

  const { orgId, property } = await ensureFixtures();
  const base = { property_id: property.id, property_name: property.name };

  // The exact description from the reported conversation, as a real list.
  const original = [
    '- hot tub lights not going on might need technician',
    '- blinds quote',
    '- AC port under the unit through the wall',
  ].join('\n');

  console.log('\n  markdown becomes real rich text');
  const created = await call('create', {
    orgId,
    input: { ...base, title: 'Homeowner issue report (eval)', description: original },
  });
  ok('task created', created.ok, created.error);
  const taskId = created.task?.task_id ?? created.task?.id;

  const readBack = await call('read', { taskId });
  const storedDesc = readBack.task?.description ?? readBack.description;
  ok('stored as a real bulletList, not paragraphs', blockTypes(storedDesc)[0] === 'bulletList', blockTypes(storedDesc));
  ok('three list items', (storedDesc?.content?.[0]?.content ?? []).length === 3);
  ok(
    'leading "- " stripped from item text',
    storedDesc?.content?.[0]?.content?.[0]?.content?.[0]?.content?.[0]?.text ===
      'hot tub lights not going on might need technician',
    storedDesc?.content?.[0]?.content?.[0],
  );

  console.log('\n  the reported bug: appending past character 77');
  const appended = [
    original,
    '- new games (basketball machine)',
    '- pool table refelting',
    '- touch up paint on door handles (chipping/flaking finish)',
  ].join('\n');
  const preview = await call('preview_update', {
    orgId,
    input: { task_id: taskId, description: appended },
  });
  ok('preview ok', preview.ok, preview.error);
  const descChange = (preview.plan?.changes ?? []).find((c) => c.field === 'description');
  ok('the append IS detected as a change', !!descChange, preview.plan?.changes);
  ok(
    'plan shows the full new text, not a 77-char teaser',
    typeof descChange?.after === 'string' && descChange.after.includes('touch up paint'),
    descChange?.after,
  );

  const committed = await call('commit_update', {
    orgId,
    input: { task_id: taskId, description: appended },
  });
  ok('commit ok', committed.ok, committed.error);
  const after = await call('read', { taskId });
  const afterDesc = after.task?.description ?? after.description;
  ok('all six items stored', (afterDesc?.content?.[0]?.content ?? []).length === 6, blockTypes(afterDesc));

  console.log('\n  a genuine no-op is still a no-op');
  const noop = await call('preview_update', {
    orgId,
    input: { task_id: taskId, description: appended },
  });
  ok(
    'resending identical text reports no description change',
    !(noop.plan?.changes ?? []).some((c) => c.field === 'description'),
    noop.plan?.changes,
  );

  console.log('\n  checkboxes and headings');
  const checklist = ['## Punch list', '[ ] replace filter', '[x] tighten handle'].join('\n');
  await call('commit_update', { orgId, input: { task_id: taskId, description: checklist } });
  const cl = await call('read', { taskId });
  const clDesc = cl.task?.description ?? cl.description;
  ok('heading + taskList stored', JSON.stringify(blockTypes(clDesc)) === '["heading","taskList"]', blockTypes(clDesc));
  ok('checked state preserved', clDesc?.content?.[1]?.content?.[1]?.attrs?.checked === true, clDesc?.content?.[1]);

  console.log('\n  reformatting a legacy run-on description');
  // Write the shape the OLD converter produced: one paragraph, embedded newlines.
  await db
    .from('turnover_tasks')
    .update({
      description: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '- a\n- b' }] }],
      },
    })
    .eq('id', taskId);
  const reformat = await call('preview_update', {
    orgId,
    input: { task_id: taskId, description: '- a\n- b' },
  });
  ok(
    'turning a fake list into a real one is seen as a change',
    (reformat.plan?.changes ?? []).some((c) => c.field === 'description'),
    reformat.plan?.changes,
  );

  await db.from('turnover_tasks').delete().eq('id', taskId);
  console.log(`\n${pass}/${pass + fail} checks passed.`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
