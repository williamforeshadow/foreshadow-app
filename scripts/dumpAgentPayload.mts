/**
 * Temp introspection script: render the exact fixed payload the ops agent
 * receives — system prompt + serialized tool catalog — with no editorializing.
 *
 * Run: npx tsx scripts/_dumpAgentPayload.mts <outfile>
 */
import { writeFileSync } from 'node:fs';
import { buildSystemPrompt } from '@/src/agent/prompt/core';
import { toAnthropicTools } from '@/src/agent/tools';

const out = process.argv[2] ?? 'agent-payload.md';

const ACTOR = {
  appUserId: '00000000-0000-4000-8000-000000000001',
  name: 'Billy Hale',
  role: 'superadmin' as const,
};

// Rough token estimate: chars / 3.6 is close enough for BPE English + JSON.
const tok = (s: string) => Math.round(s.length / 3.6);

const webPrompt = buildSystemPrompt('America/Los_Angeles', 'web', ACTOR);
const slackPrompt = buildSystemPrompt('America/Los_Angeles', 'slack', ACTOR);
// Web surface by default (what the chat panel's model sees). Pass a second
// arg of "slack" to render the Slack toolset instead.
const surface = (process.argv[3] === 'slack' ? 'slack' : 'web') as
  | 'web'
  | 'slack';
const tools = toAnthropicTools(surface);

const toolsJson = JSON.stringify(tools);

const lines: string[] = [];
const w = (s = '') => lines.push(s);

w('# The agent payload, verbatim');
w();
w(
  'Everything below is emitted by the real builders (`buildSystemPrompt`, `toAnthropicTools`), not transcribed by hand.',
);
w();
w('## Size');
w();
w('```');
w(`system prompt (web)    ${webPrompt.length} chars   ~${tok(webPrompt)} tokens`);
w(
  `system prompt (slack)  ${slackPrompt.length} chars   ~${tok(slackPrompt)} tokens`,
);
w(`tool catalog           ${toolsJson.length} chars   ~${tok(toolsJson)} tokens   ${tools.length} tools`);
w(
  `FIXED PREFIX (web)     ${webPrompt.length + toolsJson.length} chars   ~${tok(webPrompt) + tok(toolsJson)} tokens`,
);
w('```');
w();
w('Per-tool cost, largest first:');
w();
w('```');
const sized = tools
  .map((t) => {
    const whole = JSON.stringify(t);
    return {
      name: t.name,
      desc: t.description.length,
      schema: JSON.stringify(t.input_schema).length,
      total: whole.length,
    };
  })
  .sort((a, b) => b.total - a.total);
w(
  `${'tool'.padEnd(38)}${'desc'.padStart(8)}${'schema'.padStart(9)}${'total'.padStart(9)}${'~tok'.padStart(8)}`,
);
for (const s of sized) {
  w(
    `${s.name.padEnd(38)}${String(s.desc).padStart(8)}${String(s.schema).padStart(9)}${String(s.total).padStart(9)}${String(Math.round(s.total / 3.6)).padStart(8)}`,
  );
}
w(
  `${'TOTAL'.padEnd(38)}${String(sized.reduce((n, s) => n + s.desc, 0)).padStart(8)}${String(sized.reduce((n, s) => n + s.schema, 0)).padStart(9)}${String(sized.reduce((n, s) => n + s.total, 0)).padStart(9)}${String(Math.round(sized.reduce((n, s) => n + s.total, 0) / 3.6)).padStart(8)}`,
);
w('```');
w();
w('---');
w();
w('# 1. System prompt — web surface');
w();
w('```text');
w(webPrompt);
w('```');
w();
w('---');
w();
w('# 2. System prompt — slack surface');
w();
w('```text');
w(slackPrompt);
w('```');
w();
w('---');
w();
w(`# 3. Tool catalog — ${tools.length} tools, in registry order`);
w();
w(
  'This is the `tools` array as sent. Each entry: the name the model calls, the description it reads, and the input schema it must satisfy.',
);
w();
for (const [i, t] of tools.entries()) {
  w(`## ${i + 1}. \`${t.name}\``);
  w();
  w('**Description as the model sees it:**');
  w();
  w('```text');
  w(t.description);
  w('```');
  w();
  w('**Input schema:**');
  w();
  w('```json');
  w(JSON.stringify(t.input_schema, null, 2));
  w('```');
  w();
}

writeFileSync(out, lines.join('\n'), 'utf8');
console.log(`wrote ${out}`);
console.log(
  `system(web) ~${tok(webPrompt)} tok | tools ~${tok(toolsJson)} tok | ${tools.length} tools`,
);
