#!/usr/bin/env node
// Lightweight DB inspection CLI for the rebuilt automations work.
//
// Uses the existing @supabase/supabase-js client + the NEXT_PUBLIC_SUPABASE_URL
// and SUPABASE_SERVICE_ROLE_KEY values from .env.local. Does NOT print the
// key to the console — only the resolved URL host.
//
// Usage:
//   node scripts/db.mjs ping
//   node scripts/db.mjs columns <table>
//   node scripts/db.mjs count <table>
//   node scripts/db.mjs select <table> [limit] [-- col1,col2,...]
//   node scripts/db.mjs sample <table>
//   node scripts/db.mjs tables             # describes the known automation entities
//   node scripts/db.mjs delete <table> <id>  # delete one row by id (no batch deletes)
//
// Arbitrary SQL / DDL (CREATE TABLE etc.) is NOT possible through this script —
// PostgREST only exposes table operations. Apply migrations via the Supabase
// dashboard SQL editor (or supabase CLI) instead.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

// ─── env loading ──────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(repoRoot, '.env.local');
  if (!fs.existsSync(envPath)) {
    throw new Error('.env.local not found');
  }
  const raw = fs.readFileSync(envPath, 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
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

const client = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

// ─── known entities (from lib/automations/entities.ts) ─────────────────
const KNOWN_TABLES = [
  'reservations',
  'turnover_tasks',
  'properties',
  'users',
  'departments',
  'task_assignments',
  'automations',
  'automation_deliveries',
  'operations_settings',
];

// ─── helpers ──────────────────────────────────────────────────────────
function inferType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return value.length === 0 ? 'array' : `array<${inferType(value[0])}>`;
  }
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date';
    if (/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return 'time';
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return 'datetime';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(value)) return 'uuid';
    return 'string';
  }
  return typeof value;
}

async function cmdPing() {
  try {
    const u = new URL(url);
    console.log(`Supabase host: ${u.host}`);
  } catch {
    console.log(`Supabase URL configured (host hidden)`);
  }
  const { error } = await client.from('properties').select('id').limit(1);
  if (error) {
    console.error('Ping failed:', error.message);
    process.exit(1);
  }
  console.log('OK — service_role can reach PostgREST.');
}

async function cmdColumns(table) {
  if (!table) {
    console.error('Usage: node scripts/db.mjs columns <table>');
    process.exit(1);
  }
  const { data, error } = await client.from(table).select('*').limit(1);
  if (error) {
    console.error(`Error reading ${table}:`, error.message);
    process.exit(1);
  }
  if (!data || data.length === 0) {
    console.log(`Table ${table} is empty — cannot infer columns from a row.`);
    return;
  }
  const row = data[0];
  const keys = Object.keys(row).sort();
  console.log(`Columns of ${table} (inferred from one row):`);
  for (const key of keys) {
    console.log(`  ${key.padEnd(28)} ${inferType(row[key])}`);
  }
}

async function cmdCount(table) {
  if (!table) {
    console.error('Usage: node scripts/db.mjs count <table>');
    process.exit(1);
  }
  const { count, error } = await client
    .from(table)
    .select('*', { count: 'exact', head: true });
  if (error) {
    console.error(`Error counting ${table}:`, error.message);
    process.exit(1);
  }
  console.log(`${table}: ${count} rows`);
}

async function cmdSelect(table, limitStr, ...rest) {
  if (!table) {
    console.error('Usage: node scripts/db.mjs select <table> [limit] [-- col1,col2]');
    process.exit(1);
  }
  const limit = Math.max(1, Math.min(100, Number(limitStr) || 5));
  let select = '*';
  const dashIdx = rest.indexOf('--');
  if (dashIdx !== -1 && rest[dashIdx + 1]) select = rest[dashIdx + 1];
  const { data, error } = await client.from(table).select(select).limit(limit);
  if (error) {
    console.error(`Error selecting from ${table}:`, error.message);
    process.exit(1);
  }
  console.log(JSON.stringify(data, null, 2));
}

async function cmdSample(table) {
  return cmdSelect(table, '1');
}

async function cmdTables() {
  console.log('Probing known tables…');
  for (const table of KNOWN_TABLES) {
    // Two-step probe: a regular select(1) to verify existence (HEAD with
    // count='exact' returns null without erroring on missing tables, which
    // gave a false-positive earlier), then a count if it exists.
    const probe = await client.from(table).select('*').limit(1);
    if (probe.error) {
      console.log(`  ${table.padEnd(28)} MISSING  (${probe.error.message})`);
      continue;
    }
    const { count, error } = await client
      .from(table)
      .select('*', { count: 'exact', head: true });
    if (error) {
      console.log(`  ${table.padEnd(28)} ok       (count failed: ${error.message})`);
    } else {
      console.log(`  ${table.padEnd(28)} ok       (${count} rows)`);
    }
  }
}

async function cmdDelete(table, id) {
  if (!table || !id) {
    console.error('Usage: node scripts/db.mjs delete <table> <id>');
    process.exit(1);
  }
  // Look at the row first so the operator can see what's being removed.
  const lookup = await client.from(table).select('*').eq('id', id).maybeSingle();
  if (lookup.error) {
    console.error(`Lookup failed: ${lookup.error.message}`);
    process.exit(1);
  }
  if (!lookup.data) {
    console.log(`No row in ${table} with id=${id}.`);
    return;
  }
  console.log('Deleting:');
  console.log(JSON.stringify(lookup.data, null, 2));
  const { error } = await client.from(table).delete().eq('id', id);
  if (error) {
    console.error(`Delete failed: ${error.message}`);
    process.exit(1);
  }
  console.log(`Deleted ${table}/${id}.`);
}

// ─── dispatch ─────────────────────────────────────────────────────────
const [, , cmd, ...args] = process.argv;
const dispatch = {
  ping: cmdPing,
  tables: cmdTables,
  columns: cmdColumns,
  count: cmdCount,
  select: cmdSelect,
  sample: cmdSample,
  delete: cmdDelete,
};
const fn = dispatch[cmd];
if (!fn) {
  console.error('Subcommands: ping | tables | columns <t> | count <t> | select <t> [n] | sample <t>');
  process.exit(1);
}
await fn(...args);
