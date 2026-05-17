// Variable substitution for automation message templates.
//
// Templates look like:
//   "New booking at {{this.property.name}} from {{this.check_in | date:"MMM d"}}"
//
// Path resolution walks dotted segments off the supplied root context. The
// context for an automation firing today is `{ this: <row>, this.property: <fk row>, ... }`.
// Unknown paths render as `{{path}}` so messages stay inspectable in Slack
// rather than silently dropping the placeholder.
//
// Formatters: `| date:"MMM d"` and `| money`. Anything else is ignored and
// the raw value renders untransformed — this stays additive so adding a new
// formatter is one entry below.
//
// Why not Liquid / Handlebars: those drag in 30–80kb of runtime for a single
// `{{x.y | filter}}` syntax. The editor only writes the two formatters above,
// so a 50-line interpreter is sufficient and stays easy to audit.

import { format as formatDate } from 'date-fns';

const PLACEHOLDER_RE = /\{\{\s*([^}|]+?)(?:\s*\|\s*([^}]+?))?\s*\}\}/g;

export interface RenderContext {
  /** The "this" row plus its one-level joined relations. */
  this: Record<string, unknown> | null;
  /** `today` / `now` and any other ambient values. */
  builtins?: { today?: string; now?: string };
}

export function renderTemplate(template: string, ctx: RenderContext): string {
  if (!template) return '';
  return template.replace(PLACEHOLDER_RE, (whole, rawPath: string, rawFilter?: string) => {
    const path = rawPath.trim();
    const value = resolvePath(path, ctx);
    if (value === undefined) return whole;
    return applyFilter(value, rawFilter?.trim());
  });
}

function resolvePath(path: string, ctx: RenderContext): unknown {
  if (path === 'today') return ctx.builtins?.today;
  if (path === 'now') return ctx.builtins?.now;

  const [head, ...rest] = path.split('.');
  if (head !== 'this' || !ctx.this) return undefined;

  let cursor: unknown = ctx.this;
  for (const segment of rest) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

// A bare YYYY-MM-DD, or an ISO datetime whose date portion is what matters
// (reservation dates come back as `2027-02-03T00:00:00-08:00`). Match the
// leading calendar date so default rendering never UTC-shifts the day.
const DATEISH_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}|$)/;

function applyFilter(value: unknown, filter: string | undefined): string {
  if (!filter) {
    // No explicit formatter: a date-shaped value still reads better as
    // "February 3, 2027" than as a raw ISO string.
    if (typeof value === 'string') {
      const m = DATEISH_RE.exec(value);
      if (m) {
        const [, y, mo, d] = m;
        return formatDate(new Date(Number(y), Number(mo) - 1, Number(d)), 'PPP');
      }
    }
    return stringify(value);
  }
  const text = stringify(value);

  // `name:"arg"` or `name:arg` or just `name`.
  const match = /^([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*:\s*(.*))?$/.exec(filter);
  if (!match) return text;
  const name = match[1];
  const arg = stripQuotes(match[2]?.trim() ?? '');

  if (name === 'date') return formatDateValue(value, arg || 'PPP');
  if (name === 'money') return formatMoney(value);
  return text;
}

function formatDateValue(value: unknown, pattern: string): string {
  if (value === null || value === undefined || value === '') return '';
  // Reservations carry YYYY-MM-DD wall-clock dates. Parse with components so
  // the formatter doesn't UTC-shift the day. Datetimes (ISO strings) go
  // through Date() directly.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return formatDate(new Date(y, m - 1, d), pattern);
  }
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return stringify(value);
  return formatDate(date, pattern);
}

function formatMoney(value: unknown): string {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return stringify(value);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(num);
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(stringify).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}
