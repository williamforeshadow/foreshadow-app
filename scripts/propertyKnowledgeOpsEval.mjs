#!/usr/bin/env node
// End-to-end scenarios for compound Property Knowledge operations.
//
// There is no test runner in this repo (see scripts/searchEval.mjs), and a plain
// .mjs cannot import the TypeScript services. So this drives them through the
// dev-only route at /api/dev/pk-ops while the dev server is running, then reads
// the resulting rows back with a service-role client and asserts on them.
//
// Everything is created inside a dedicated throwaway org, and `purge` removes
// it. Nothing here touches real data.
//
// Usage:
//   npm run dev                                   # in another terminal
//   node scripts/propertyKnowledgeOpsEval.mjs seed
//   node scripts/propertyKnowledgeOpsEval.mjs all
//   node scripts/propertyKnowledgeOpsEval.mjs case 5
//   node scripts/propertyKnowledgeOpsEval.mjs purge

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const ORG_NAME = 'PK Ops Eval Org';
const BASE_URL = process.env.PK_OPS_BASE_URL || 'http://localhost:3000';
const ENDPOINT = `${BASE_URL}/api/dev/pk-ops`;

// ─── env loading (same shape as scripts/db.mjs) ───────────────────────
function loadEnv() {
  const envPath = path.join(repoRoot, '.env.local');
  if (!fs.existsSync(envPath)) throw new Error('.env.local not found');
  const env = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

// ─── assertion helpers ────────────────────────────────────────────────
let failures = 0;
let checks = 0;

function check(label, condition, detail) {
  checks += 1;
  if (condition) {
    console.log(`    ok   ${label}`);
  } else {
    failures += 1;
    console.log(`    FAIL ${label}`);
    if (detail !== undefined) {
      console.log(`         ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    }
  }
}

function eq(label, actual, expected) {
  check(`${label} = ${JSON.stringify(expected)}`, actual === expected, `got ${JSON.stringify(actual)}`);
}

async function call(mode, kind, input) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode, kind, input }),
  });
  if (!res.ok) {
    throw new Error(`${mode}/${kind} HTTP ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  if (json.threw) throw new Error(`service threw: ${json.error}\n${json.stack ?? ''}`);
  return json;
}

// ─── fixture management ───────────────────────────────────────────────
async function getOrg() {
  const { data } = await db.from('organizations').select('id').eq('name', ORG_NAME).maybeSingle();
  return data?.id ?? null;
}

async function properties(orgId) {
  const { data } = await db
    .from('properties')
    .select('id, name')
    .eq('org_id', orgId)
    .order('name');
  return data ?? [];
}

/** Wipe the knowledge rows under the eval properties without dropping them. */
async function resetKnowledge(orgId) {
  const props = await properties(orgId);
  const ids = props.map((p) => p.id);
  if (ids.length === 0) return props;
  await db.from('property_attributes').delete().in('property_id', ids);
  await db.from('property_rooms').delete().in('property_id', ids);
  await db.from('property_access_items').delete().in('property_id', ids);
  await db.from('property_policies').delete().in('property_id', ids);
  await db.from('property_connectivity').delete().in('property_id', ids);
  await db.from('property_knowledge_activity_log').delete().in('property_id', ids);
  return props;
}

async function seedInboundImage(orgId, name) {
  // A 1x1 PNG is enough: the services only care that the row looks like an
  // image and that bytes come back from storage.
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const storagePath = `pk-ops-eval/${name}-${Date.now()}.png`;
  await db.storage.from('slack-inbound-files').upload(storagePath, pngBytes, {
    contentType: 'image/png',
    upsert: true,
  });
  const { data, error } = await db
    .from('slack_inbound_files')
    .insert({
      org_id: orgId,
      source: 'web',
      name: `${name}.png`,
      file_type: 'image',
      mime_type: 'image/png',
      size_bytes: pngBytes.length,
      storage_bucket: 'slack-inbound-files',
      storage_path: storagePath,
    })
    .select('id')
    .single();
  if (error) throw new Error(`could not seed inbound file: ${error.message}`);
  return data.id;
}

async function cmdSeed() {
  let orgId = await getOrg();
  if (!orgId) {
    const { data, error } = await db
      .from('organizations')
      .insert({ name: ORG_NAME, slug: 'pk-ops-eval' })
      .select('id')
      .single();
    if (error) throw new Error(`could not create org: ${error.message}`);
    orgId = data.id;
    console.log(`Created org ${orgId}`);
  } else {
    console.log(`Reusing org ${orgId}`);
  }

  const existing = await properties(orgId);
  // Six properties: three carry the scenarios, the spares exist only so the
  // operations x properties cap (100) can actually be exceeded in case 9.
  const want = [
    'PK Eval Alpha',
    'PK Eval Bravo',
    'PK Eval Charlie',
    'PK Eval Delta',
    'PK Eval Echo',
    'PK Eval Foxtrot',
  ];
  for (const name of want) {
    if (existing.some((p) => p.name === name)) continue;
    const { error } = await db.from('properties').insert({ org_id: orgId, name, is_active: true });
    if (error) throw new Error(`could not create ${name}: ${error.message}`);
    console.log(`Created property ${name}`);
  }

  // Charlie carries a pre-existing Gate room so batch cases can prove they
  // update in place rather than duplicating.
  await resetKnowledge(orgId);
  const props = await properties(orgId);
  const charlie = props.find((p) => p.name === 'PK Eval Charlie');
  await db
    .from('property_rooms')
    .insert({ property_id: charlie.id, org_id: orgId, scope: 'exterior', title: 'Gate', sort_order: 0 });
  console.log('Seeded PK Eval Charlie with an existing exterior "Gate" room.');
  console.log('Done. Run: node scripts/propertyKnowledgeOpsEval.mjs all');
}

async function cmdPurge() {
  const orgId = await getOrg();
  if (!orgId) return console.log('Nothing to purge.');
  const props = await properties(orgId);
  const ids = props.map((p) => p.id);
  if (ids.length > 0) {
    await db.from('property_attributes').delete().in('property_id', ids);
    await db.from('property_rooms').delete().in('property_id', ids);
    await db.from('property_access_items').delete().in('property_id', ids);
    await db.from('property_policies').delete().in('property_id', ids);
    await db.from('property_connectivity').delete().in('property_id', ids);
    await db.from('property_knowledge_activity_log').delete().in('property_id', ids);
    await db.from('properties').delete().in('id', ids);
  }
  await db.from('slack_inbound_files').delete().eq('org_id', orgId);
  await db.from('organizations').delete().eq('id', orgId);
  console.log('Purged.');
}

// ─── scenarios ────────────────────────────────────────────────────────
const CASES = {
  // 1. The headline capability: a room and two attributes in one plan.
  async 1(ctx) {
    const p = ctx.alpha;
    const input = {
      property_id: p.id,
      operations: [
        { op: 'upsert_room', room: { title: 'Gate', scope: 'exterior' } },
        {
          op: 'upsert_attribute',
          room: { title: 'Gate', scope: 'exterior' },
          fields: { title: 'Gate code', body: '3252', tags: ['access'] },
        },
        {
          op: 'upsert_attribute',
          room: { title: 'Gate', scope: 'exterior' },
          fields: { title: 'Latch is finicky', body: 'Lift while turning.', tags: ['quirk'] },
        },
      ],
    };

    const preview = await call('preview', 'single', input);
    check('preview ok', preview.ok, preview.error);
    eq('operations planned', preview.plan.operations.length, 3);
    eq('rooms_to_create', preview.plan.rooms_to_create.length, 1);
    eq('op0 mode', preview.plan.operations[0].mode, 'create');
    eq('op1 mode', preview.plan.operations[1].mode, 'create');
    check(
      'op1 room marked will_be_created by op0',
      preview.plan.operations[1].room?.will_be_created === true &&
        preview.plan.operations[1].depends_on === 0,
      preview.plan.operations[1].room,
    );

    const committed = await call('commit', 'single', input);
    check('commit ok', committed.ok && committed.result.ok, committed.result?.failures);

    const { data: rooms } = await db
      .from('property_rooms')
      .select('id, title, scope')
      .eq('property_id', p.id);
    eq('rooms in db', rooms.length, 1);
    eq('room scope', rooms[0].scope, 'exterior');

    const { data: attrs } = await db
      .from('property_attributes')
      .select('id, title, room_id')
      .eq('property_id', p.id);
    eq('attributes in db', attrs.length, 2);
    check(
      'both attributes point at the new room',
      attrs.every((a) => a.room_id === rooms[0].id),
      attrs,
    );

    const { data: log } = await db
      .from('property_knowledge_activity_log')
      .select('id')
      .eq('property_id', p.id);
    check('activity rows >= 3', log.length >= 3, `got ${log.length}`);
    return input;
  },

  // 2. Idempotency — the same plan twice must not duplicate.
  async 2(ctx) {
    const input = await CASES[1](ctx);
    console.log('    -- re-running the identical plan --');
    const preview = await call('preview', 'single', input);
    eq('op0 mode on rerun', preview.plan.operations[0].mode, 'noop');
    eq('rooms_to_create on rerun', preview.plan.rooms_to_create.length, 0);
    check(
      'attribute ops are noop or update',
      preview.plan.operations.slice(1).every((o) => o.mode === 'noop' || o.mode === 'update'),
      preview.plan.operations.map((o) => o.mode),
    );

    await call('commit', 'single', input);
    const { data: rooms } = await db.from('property_rooms').select('id').eq('property_id', ctx.alpha.id);
    const { data: attrs } = await db
      .from('property_attributes')
      .select('id')
      .eq('property_id', ctx.alpha.id);
    eq('still 1 room', rooms.length, 1);
    eq('still 2 attributes', attrs.length, 2);
  },

  // 3. A photo riding on the attribute operation that creates its target.
  async 3(ctx) {
    const fileId = await seedInboundImage(ctx.orgId, 'attr-photo');
    const input = {
      property_id: ctx.alpha.id,
      operations: [
        {
          op: 'upsert_attribute',
          room: { title: 'Utility', scope: 'interior' },
          fields: { title: 'Water shutoff', body: 'Behind the dryer.', tags: ['utility'] },
          photos: { inbound_file_ids: [fileId], caption: 'Shutoff valve' },
        },
      ],
    };

    const preview = await call('preview', 'single', input);
    check('preview ok', preview.ok, preview.error);
    eq('photos_to_attach', preview.plan.photos_to_attach, 1);
    check('photo validated ok', preview.plan.operations[0].photos.files[0].ok, preview.plan.operations[0].photos);

    const committed = await call('commit', 'single', input);
    check('commit ok', committed.result.ok, committed.result.failures);

    const { data: attrs } = await db
      .from('property_attributes')
      .select('id')
      .eq('property_id', ctx.alpha.id)
      .eq('title', 'Water shutoff');
    eq('attribute created', attrs.length, 1);
    const { data: photos } = await db
      .from('property_attribute_photos')
      .select('id, storage_path, caption')
      .eq('attribute_id', attrs[0].id);
    eq('attribute photos', photos.length, 1);
    eq('caption', photos[0].caption, 'Shutoff valve');

    const { data: file } = await db
      .from('slack_inbound_files')
      .select('consumed_at')
      .eq('id', fileId)
      .single();
    check('inbound file marked consumed', !!file.consumed_at, file);
  },

  // 4. Two photos, two different targets, one plan. The old flat
  //    attachment_inbound_file_ids could not express this at all.
  async 4(ctx) {
    const roomFile = await seedInboundImage(ctx.orgId, 'room-photo');
    const attrFile = await seedInboundImage(ctx.orgId, 'attr-photo-2');
    const input = {
      property_id: ctx.bravo.id,
      operations: [
        {
          op: 'upsert_room',
          room: { title: 'Garage', scope: 'exterior' },
          photos: { inbound_file_ids: [roomFile], caption: 'Garage exterior' },
        },
        {
          op: 'upsert_attribute',
          room: { title: 'Garage', scope: 'exterior' },
          fields: { title: 'Opener code', body: '9931', tags: ['access'] },
          photos: { inbound_file_ids: [attrFile], caption: 'Keypad' },
        },
      ],
    };

    const committed = await call('commit', 'single', input);
    check('commit ok', committed.result.ok, committed.result.failures);

    const { data: rooms } = await db
      .from('property_rooms')
      .select('id')
      .eq('property_id', ctx.bravo.id)
      .eq('title', 'Garage');
    eq('garage room created', rooms.length, 1);
    const { data: roomPhotos } = await db
      .from('property_room_photos')
      .select('id, caption')
      .eq('room_id', rooms[0].id);
    eq('room photos', roomPhotos.length, 1);
    eq('room photo caption', roomPhotos[0].caption, 'Garage exterior');

    const { data: attrs } = await db
      .from('property_attributes')
      .select('id')
      .eq('property_id', ctx.bravo.id)
      .eq('title', 'Opener code');
    const { data: attrPhotos } = await db
      .from('property_attribute_photos')
      .select('id, caption')
      .eq('attribute_id', attrs[0].id);
    eq('attribute photos', attrPhotos.length, 1);
    eq('attribute photo caption', attrPhotos[0].caption, 'Keypad');
    check(
      'the two photos went to different targets',
      roomPhotos[0].id !== attrPhotos[0].id,
      { roomPhotos, attrPhotos },
    );
  },

  // 5. Ordered failure: dependents skip, independents still run.
  async 5(ctx) {
    const input = {
      property_id: ctx.bravo.id,
      operations: [
        { op: 'upsert_room', room: { title: 'Basement', scope: 'interior' } },
        {
          op: 'upsert_attribute',
          room: { title: 'Basement', scope: 'interior' },
          fields: { title: '   ', body: 'this one is invalid' },
        },
        { op: 'upsert_access_item', fields: { type: 'gate_code', value: '4417' } },
      ],
    };

    const committed = await call('commit', 'single', input);
    check('commit returned a result', committed.ok, committed.error);
    const byIndex = Object.fromEntries(committed.result.results.map((r) => [r.index, r]));
    check('op0 (room) landed', byIndex[0]?.ok === true, byIndex[0]);
    check('op1 (bad attribute) failed', byIndex[1]?.ok === false, byIndex[1]);
    check('op2 (independent access item) STILL RAN', byIndex[2]?.ok === true, byIndex[2]);
    check('overall marked not-ok', committed.result.ok === false, committed.result.summary);
    check('reported as partial', committed.result.partial === true, committed.result);

    const { data: rooms } = await db
      .from('property_rooms')
      .select('id')
      .eq('property_id', ctx.bravo.id)
      .eq('title', 'Basement');
    eq('basement room exists', rooms.length, 1);
    const { data: access } = await db
      .from('property_access_items')
      .select('id, value')
      .eq('property_id', ctx.bravo.id)
      .eq('type', 'gate_code');
    eq('access item written', access.length, 1);
    eq('access value', access[0].value, '4417');
  },

  // 6. Drift: the room appears between preview and commit.
  async 6(ctx) {
    const input = {
      property_id: ctx.alpha.id,
      operations: [
        {
          op: 'upsert_attribute',
          room: { title: 'Roof', scope: 'exterior' },
          fields: { title: 'Hatch location', body: 'Hall closet ceiling.' },
        },
      ],
    };

    const preview = await call('preview', 'single', input);
    eq('previewed as create', preview.plan.operations[0].mode, 'create');
    eq('previewed rooms_to_create', preview.plan.rooms_to_create.length, 1);

    // Someone else creates the room in between.
    await db
      .from('property_rooms')
      .insert({ property_id: ctx.alpha.id, org_id: ctx.orgId, scope: 'exterior', title: 'Roof', sort_order: 0 });
    console.log('    -- created the "Roof" room out of band --');

    const committed = await call('commit', 'single', input);
    check('commit ok', committed.result.ok, committed.result.failures);
    const { data: rooms } = await db
      .from('property_rooms')
      .select('id')
      .eq('property_id', ctx.alpha.id)
      .eq('title', 'Roof');
    eq('did NOT duplicate the room', rooms.length, 1);
    const { data: attrs } = await db
      .from('property_attributes')
      .select('id, room_id')
      .eq('property_id', ctx.alpha.id)
      .eq('title', 'Hatch location');
    eq('attribute written once', attrs.length, 1);
    eq('attribute landed in the out-of-band room', attrs[0].room_id, rooms[0].id);
  },

  // 7. Batch: 3 operations x 3 properties, one already has the room.
  async 7(ctx) {
    const input = {
      property_ids: [ctx.alpha.id, ctx.bravo.id, ctx.charlie.id],
      operations: [
        { op: 'upsert_room', room: { title: 'Gate', scope: 'exterior' } },
        {
          op: 'upsert_attribute',
          room: { title: 'Gate', scope: 'exterior' },
          fields: { title: 'Gate code', body: '8080', tags: ['access'] },
        },
        { op: 'upsert_connectivity', fields: { wifi_ssid: 'EvalNet' } },
      ],
    };

    const preview = await call('preview', 'batch', input);
    check('preview ok', preview.ok, preview.error);
    eq('properties planned', preview.plan.properties.length, 3);
    eq('shared_operations described once', preview.plan.shared_operations.length, 3);
    check('failures empty', preview.plan.failures.length === 0, preview.plan.failures);

    const committed = await call('commit', 'batch', input);
    check('commit ok', committed.ok, committed.error);
    check('no property failed', committed.failures.length === 0, committed.failures);

    for (const p of [ctx.alpha, ctx.bravo, ctx.charlie]) {
      const { data: rooms } = await db
        .from('property_rooms')
        .select('id')
        .eq('property_id', p.id)
        .eq('title', 'Gate')
        .eq('scope', 'exterior');
      eq(`${p.name}: exactly one Gate room`, rooms.length, 1);
      const { data: attrs } = await db
        .from('property_attributes')
        .select('id, body')
        .eq('property_id', p.id)
        .eq('title', 'Gate code');
      eq(`${p.name}: gate code attribute`, attrs.length, 1);
      eq(`${p.name}: gate code value`, attrs[0].body, '8080');
      const { data: conn } = await db
        .from('property_connectivity')
        .select('wifi_ssid')
        .eq('property_id', p.id);
      eq(`${p.name}: wifi ssid`, conn[0]?.wifi_ssid, 'EvalNet');
    }
  },

  // 8. Batch photo fan-out: one file, three properties, three copies.
  async 8(ctx) {
    const fileId = await seedInboundImage(ctx.orgId, 'fanout');
    const input = {
      property_ids: [ctx.alpha.id, ctx.bravo.id, ctx.charlie.id],
      operations: [
        {
          op: 'upsert_attribute',
          room: { title: 'Entry', scope: 'interior' },
          fields: { title: 'Lockbox', body: 'Left of the door.', tags: ['access'] },
          photos: { inbound_file_ids: [fileId], caption: 'Lockbox' },
        },
      ],
    };

    const preview = await call('preview', 'batch', input);
    check('preview ok', preview.ok, preview.error);
    check('photos_fanout reported', !!preview.plan.photos_fanout, preview.plan);
    eq('fanout copies', preview.plan.photos_fanout.copies, 3);
    eq('fanout file_count', preview.plan.photos_fanout.file_count, 1);

    const committed = await call('commit', 'batch', input);
    check('commit ok', committed.ok && committed.failures.length === 0, committed.failures);

    let totalPhotos = 0;
    const paths = new Set();
    for (const p of [ctx.alpha, ctx.bravo, ctx.charlie]) {
      const { data: attrs } = await db
        .from('property_attributes')
        .select('id')
        .eq('property_id', p.id)
        .eq('title', 'Lockbox');
      eq(`${p.name}: lockbox attribute`, attrs.length, 1);
      const { data: photos } = await db
        .from('property_attribute_photos')
        .select('id, storage_path')
        .eq('attribute_id', attrs[0].id);
      totalPhotos += photos.length;
      photos.forEach((ph) => paths.add(ph.storage_path));
    }
    eq('photo rows across the batch', totalPhotos, 3);
    eq('distinct storage objects', paths.size, 3);
  },

  // 9. Batch rejects the shapes that cannot mean the same thing everywhere.
  async 9(ctx) {
    const byId = await call('preview', 'batch', {
      property_ids: [ctx.alpha.id, ctx.bravo.id],
      operations: [
        {
          op: 'upsert_attribute',
          room: { room_id: '00000000-0000-0000-0000-000000000000' },
          fields: { title: 'Nope' },
        },
      ],
    });
    check('room-by-id rejected in a batch', byId.ok === false, byId);

    const doc = await call('preview', 'batch', {
      property_ids: [ctx.alpha.id, ctx.bravo.id],
      operations: [
        { op: 'delete_document', document_id: '00000000-0000-0000-0000-000000000000' },
      ],
    });
    check('document op rejected in a batch', doc.ok === false, doc);

    // 20 operations x 6 properties = 120, over the 100 cap.
    const tooWide = await call('preview', 'batch', {
      property_ids: ctx.all.map((p) => p.id),
      operations: Array.from({ length: 20 }, (_, i) => ({
        op: 'upsert_access_item',
        fields: { type: 'other', label: `Item ${i}`, value: String(i) },
      })),
    });
    check('operations x properties cap enforced', tooWide.ok === false, tooWide.plan?.totals);

    // The same shape just under the cap must still be allowed — a cap that also
    // blocks legitimate work is a worse bug than no cap.
    const justUnder = await call('preview', 'batch', {
      property_ids: [ctx.alpha.id, ctx.bravo.id, ctx.charlie.id],
      operations: Array.from({ length: 20 }, (_, i) => ({
        op: 'upsert_access_item',
        fields: { type: 'other', label: `Item ${i}`, value: String(i) },
      })),
    });
    check('60 writes still allowed', justUnder.ok === true, justUnder.error);
    check('wide plan trims per-property detail', justUnder.plan.truncated === true, justUnder.plan.truncated);
    check('wide plan still marked uniform', justUnder.plan.uniform === true, justUnder.plan.uniform);

    // 10 files x 3 properties = 30 copies, over the 20 cap.
    const fileId = await seedInboundImage(ctx.orgId, 'cap');
    const tooManyPhotos = await call('preview', 'batch', {
      property_ids: [ctx.alpha.id, ctx.bravo.id, ctx.charlie.id],
      operations: [
        {
          op: 'upsert_attribute',
          room: { title: 'Entry', scope: 'interior' },
          fields: { title: 'Lockbox' },
          photos: { inbound_file_ids: Array.from({ length: 10 }, () => fileId) },
        },
      ],
    });
    check('photo fan-out cap enforced', tooManyPhotos.ok === false, tooManyPhotos);
  },

  // 10. Deletes are noops when the target is already gone.
  async 10(ctx) {
    const input = {
      property_id: ctx.charlie.id,
      operations: [
        { op: 'delete_attribute', room: { title: 'Nowhere', scope: 'interior' }, title: 'Ghost' },
        { op: 'delete_access_item', fields: { type: 'alarm_code' } },
      ],
    };
    const preview = await call('preview', 'single', input);
    check('preview ok', preview.ok, preview.error);
    eq('noop_count', preview.plan.noop_count, 2);

    const committed = await call('commit', 'single', input);
    check('commit ok', committed.result.ok, committed.result.failures);
    check(
      'both reported as noop',
      committed.result.results.every((r) => r.mode === 'noop'),
      committed.result.results.map((r) => r.mode),
    );
  },

  // 11. Policies & Instructions — roomless rows matched by title, so the same
  // operation creates then updates, and a delete for an absent title is a noop.
  async 11(ctx) {
    const p = ctx.bravo;
    const create = {
      property_id: p.id,
      operations: [
        { op: 'upsert_policy', fields: { title: 'Checkout', body: '11am. Start the dishwasher.' } },
        { op: 'upsert_policy', fields: { title: 'No parties', body: 'HOA enforces. No events of any size.' } },
      ],
    };

    const preview = await call('preview', 'single', create);
    check('preview ok', preview.ok, preview.error);
    eq('operations planned', preview.plan.operations.length, 2);
    eq('op0 mode', preview.plan.operations[0].mode, 'create');
    check('policies need no room', preview.plan.operations[0].room === null, preview.plan.operations[0].room);

    const committed = await call('commit', 'single', create);
    check('commit ok', committed.result.ok, committed.result.failures);

    const { data: rows } = await db
      .from('property_policies')
      .select('id, title, body')
      .eq('property_id', p.id)
      .order('title');
    eq('policies in db', rows.length, 2);
    eq('first title', rows[0].title, 'Checkout');

    // Re-running with a changed body must UPDATE the same row, matched on the
    // title — case-insensitively, which is the whole point of name resolution.
    const update = {
      property_id: p.id,
      operations: [{ op: 'upsert_policy', fields: { title: 'checkout', body: '4pm now.' } }],
    };
    const updatePreview = await call('preview', 'single', update);
    eq('rematched by title', updatePreview.plan.operations[0].mode, 'update');
    await call('commit', 'single', update);

    const { data: after } = await db
      .from('property_policies')
      .select('id, title, body')
      .eq('property_id', p.id);
    eq('still 2 policies', after.length, 2);
    const checkout = after.find((r) => r.title.toLowerCase() === 'checkout');
    eq('body updated', checkout.body, '4pm now.');

    // Delete by title, plus a delete for something that was never there.
    const del = {
      property_id: p.id,
      operations: [
        { op: 'delete_policy', title: 'No parties' },
        { op: 'delete_policy', title: 'Never existed' },
      ],
    };
    const delPreview = await call('preview', 'single', del);
    eq('absent policy is a noop', delPreview.plan.noop_count, 1);
    const delCommitted = await call('commit', 'single', del);
    check('delete commit ok', delCommitted.result.ok, delCommitted.result.failures);

    const { data: left } = await db.from('property_policies').select('id').eq('property_id', p.id);
    eq('one policy left', left.length, 1);

    // The same list across many properties — policies are batchable.
    const batchInput = {
      property_ids: [ctx.alpha.id, ctx.charlie.id],
      operations: [{ op: 'upsert_policy', fields: { title: 'Quiet hours', body: '10pm to 8am.' } }],
    };
    const batch = await call('preview', 'batch', batchInput);
    check('batch preview ok', batch.ok, batch.error);
    check('batch marked uniform', batch.plan.uniform === true, batch.plan.uniform);
    const batchCommitted = await call('commit', 'batch', batchInput);
    check(
      'batch commit ok',
      batchCommitted.ok && batchCommitted.failures.length === 0,
      batchCommitted.failures,
    );
    const { data: fanned } = await db
      .from('property_policies')
      .select('property_id')
      .in('property_id', [ctx.alpha.id, ctx.charlie.id]);
    eq('one policy per property', fanned.length, 2);
  },
};

// ─── runner ───────────────────────────────────────────────────────────
async function buildContext() {
  const orgId = await getOrg();
  if (!orgId) {
    console.error('No eval org. Run: node scripts/propertyKnowledgeOpsEval.mjs seed');
    process.exit(1);
  }
  const props = await properties(orgId);
  const find = (name) => props.find((p) => p.name === name);
  return {
    orgId,
    all: props,
    alpha: find('PK Eval Alpha'),
    bravo: find('PK Eval Bravo'),
    charlie: find('PK Eval Charlie'),
  };
}

/** Each case starts from the seeded state so ordering never matters. */
async function freshContext() {
  const orgId = await getOrg();
  await resetKnowledge(orgId);
  const ctx = await buildContext();
  await db
    .from('property_rooms')
    .insert({ property_id: ctx.charlie.id, org_id: orgId, scope: 'exterior', title: 'Gate', sort_order: 0 });
  return ctx;
}

async function runCase(n) {
  console.log(`\n  case ${n}`);
  const ctx = await freshContext();
  try {
    await CASES[n](ctx);
  } catch (err) {
    failures += 1;
    console.log(`    FAIL threw: ${err.message}`);
  }
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'seed') return cmdSeed();
  if (cmd === 'purge') return cmdPurge();

  // Fail fast with a clear message rather than a confusing fetch error.
  try {
    await fetch(BASE_URL, { method: 'HEAD' });
  } catch {
    console.error(`Cannot reach ${BASE_URL}. Start the dev server first: npm run dev`);
    process.exit(1);
  }

  if (cmd === 'case') {
    if (!CASES[arg]) {
      console.error(`No case ${arg}. Available: ${Object.keys(CASES).join(', ')}`);
      process.exit(1);
    }
    await runCase(arg);
  } else if (cmd === 'all' || !cmd) {
    for (const n of Object.keys(CASES)) await runCase(n);
  } else {
    console.error('Usage: seed | all | case <n> | purge');
    process.exit(1);
  }

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
