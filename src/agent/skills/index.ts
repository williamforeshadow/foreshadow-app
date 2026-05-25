import { readFileSync } from 'fs';
import { join } from 'path';

// Skills loader — reads the sibling .md files at module-load time and
// concatenates them into a single string the system-prompt builder
// appends under an "Operational instincts" section. This trades a tiny
// once-per-process disk hit for the editability of per-concern markdown
// files (vs. burying behavior rules in TypeScript string literals).
//
// Path resolution: `process.cwd()` is the project root in Next.js dev
// and the deployment root on Vercel. Using `__dirname` doesn't work
// because Turbopack/Webpack virtualize it (e.g. "C:\ROOT\src\...") at
// bundle time, which then doesn't resolve on the real filesystem.
//
// Production bundling: Next.js's file tracer only includes files
// referenced via static imports by default. The .md files here are
// referenced via runtime fs.readFileSync, so they must be explicitly
// included via `outputFileTracingIncludes` in next.config — see the
// `/api/agent/**` entry there. Forget to update that and the prod
// deployment will 500 with ENOENT (dev still works fine).
//
// Adding a skill:
//   1. Drop `your-skill.md` in this folder (short, imperative prose).
//   2. Add `'your-skill.md'` to SKILL_FILES below.
//   3. Done — it's loaded on every agent request.
//
// Future iteration: gate loading by prompt signal (e.g. only inject
// `aggregating-questions.md` when the prompt looks like a counting
// question). Always-loaded is the cheapest starting shape.

const SKILL_FILES = [
  'no-emojis.md',
  'no-markdown-tables.md',
  'aggregating-questions.md',
  'visual-handoff.md',
  'conversation-recall.md',
] as const;

const SKILLS_DIR = join(process.cwd(), 'src', 'agent', 'skills');

export const SKILLS_BLOCK: string = SKILL_FILES.map((name) =>
  readFileSync(join(SKILLS_DIR, name), 'utf-8').trim(),
).join('\n\n');
