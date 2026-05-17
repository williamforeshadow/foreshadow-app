// Condition evaluator — runtime side of `lib/automations/types.ts`.
//
// Scope of this commit (intentional MVP cut):
//   - Groups (match=all | any) with `rule` leaves.
//   - Operators in OPERATORS below.
//   - Left expression must be a variable path; right is a literal or
//     today/now expression.
//
// What's deferred (logs a warning, evaluates to false rather than crashing,
// so the editor stays usable and bad data never silently passes):
//   - `exists` / `not_exists` clauses
//   - `related.*`, `actor.*`, `added.*`, `removed.*` variable namespaces
//   - Operators not listed in OPERATORS
//
// Why fail-closed: an automation that quietly fires under unintended
// conditions is far worse than one that doesn't fire — the user notices the
// missing message, not the extra one.

import type {
  ConditionGroup,
  ConditionNode,
  ConditionRule,
  Expression,
  Operator,
} from '@/lib/automations/types';
import { SUPPORTED_OPERATORS } from '@/lib/automations/engineCapabilities';

type AnyValue = unknown;

const SUPPORTED_OPS: readonly Operator[] = SUPPORTED_OPERATORS;

export interface EvalContext {
  /** The "this" row + one-level joined relations. */
  this: Record<string, AnyValue> | null;
  /** ISO date string for `today` resolution. */
  today: string;
  /** ISO datetime string for `now` resolution. */
  now: string;
}

export function evaluateConditions(group: ConditionGroup, ctx: EvalContext): boolean {
  return evaluateGroup(group, ctx);
}

function evaluateGroup(group: ConditionGroup, ctx: EvalContext): boolean {
  const children = group.children ?? [];
  if (children.length === 0) return true; // empty = no filter

  if (group.match === 'any') {
    return children.some((c) => evaluateNode(c, ctx));
  }
  return children.every((c) => evaluateNode(c, ctx));
}

function evaluateNode(node: ConditionNode, ctx: EvalContext): boolean {
  if (node.kind === 'group') return evaluateGroup(node, ctx);
  if (node.kind === 'rule') return evaluateRule(node, ctx);
  console.warn(
    `[automations] condition node kind "${node.kind}" not implemented yet — treating as false`,
  );
  return false;
}

function evaluateRule(rule: ConditionRule, ctx: EvalContext): boolean {
  if (!SUPPORTED_OPS.includes(rule.op)) {
    console.warn(`[automations] operator "${rule.op}" not implemented yet — treating as false`);
    return false;
  }

  const left = resolveExpression(rule.left, ctx);
  const right =
    rule.right === undefined ? undefined : resolveExpression(rule.right, ctx);

  return applyOperator(rule.op, left, right);
}

function resolveExpression(expr: Expression, ctx: EvalContext): AnyValue {
  if (expr.kind === 'variable') return resolveVariablePath(expr.path, ctx);
  if (expr.kind === 'literal') return expr.value;
  if (expr.kind === 'today') return ctx.today;
  if (expr.kind === 'now') return ctx.now;
  if (expr.kind === 'today_offset') {
    return offsetDate(ctx.today, expr.days, 'days');
  }
  if (expr.kind === 'now_offset') {
    const totalMinutes = (expr.hours ?? 0) * 60 + (expr.minutes ?? 0);
    return offsetDate(ctx.now, totalMinutes, 'minutes');
  }
  return undefined;
}

function resolveVariablePath(path: string, ctx: EvalContext): AnyValue {
  if (path === 'today') return ctx.today;
  if (path === 'now') return ctx.now;

  const [namespace, ...rest] = path.split('.');
  if (namespace !== 'this') {
    console.warn(
      `[automations] variable namespace "${namespace}" not implemented yet — treating as undefined`,
    );
    return undefined;
  }
  if (!ctx.this) return undefined;

  let cursor: AnyValue = ctx.this;
  for (const segment of rest) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, AnyValue>)[segment];
  }
  return cursor;
}

function applyOperator(op: Operator, left: AnyValue, right: AnyValue): boolean {
  switch (op) {
    case 'equals':
      return looseEquals(left, right);
    case 'not_equals':
      return !looseEquals(left, right);

    case 'contains':
      return toText(left).toLowerCase().includes(toText(right).toLowerCase());
    case 'not_contains':
      return !toText(left).toLowerCase().includes(toText(right).toLowerCase());

    case 'in': {
      const arr = asArray(right);
      return arr.some((v) => looseEquals(left, v));
    }
    case 'not_in': {
      const arr = asArray(right);
      return !arr.some((v) => looseEquals(left, v));
    }

    case 'gt':
      return compareNumeric(left, right) > 0;
    case 'gte':
      return compareNumeric(left, right) >= 0;
    case 'lt':
      return compareNumeric(left, right) < 0;
    case 'lte':
      return compareNumeric(left, right) <= 0;

    case 'before':
      return compareDate(left, right) < 0;
    case 'after':
      return compareDate(left, right) > 0;
    case 'on_or_before':
      return compareDate(left, right) <= 0;
    case 'on_or_after':
      return compareDate(left, right) >= 0;

    case 'is_empty':
      return isEmpty(left);
    case 'is_not_empty':
      return !isEmpty(left);

    default:
      return false;
  }
}

function looseEquals(a: AnyValue, b: AnyValue): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  // Coerce strings/numbers — `property_id` is a uuid string, literals from
  // the editor are strings, so direct equality is the normal path.
  return String(a) === String(b);
}

function compareNumeric(a: AnyValue, b: AnyValue): number {
  const x = typeof a === 'number' ? a : Number(a);
  const y = typeof b === 'number' ? b : Number(b);
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  return x - y;
}

function compareDate(a: AnyValue, b: AnyValue): number {
  const x = parseDateLike(a);
  const y = parseDateLike(b);
  if (x === null || y === null) return NaN;
  return x - y;
}

function parseDateLike(value: AnyValue): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const s = String(value);
  // YYYY-MM-DD wall-clock dates: parse as local components so we don't
  // UTC-shift across timezone boundaries when comparing dates.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function asArray(value: AnyValue): AnyValue[] {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function isEmpty(value: AnyValue): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

function toText(value: AnyValue): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function offsetDate(base: string, amount: number, unit: 'days' | 'minutes'): string {
  const ms =
    unit === 'days' ? amount * 86_400_000 : amount * 60_000;
  // YYYY-MM-DD → keep date-only output. ISO datetime → keep datetime output.
  if (/^\d{4}-\d{2}-\d{2}$/.test(base)) {
    const [y, m, d] = base.split('-').map(Number);
    const date = new Date(new Date(y, m - 1, d).getTime() + ms);
    return formatYmd(date);
  }
  return new Date(new Date(base).getTime() + ms).toISOString();
}

function formatYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
