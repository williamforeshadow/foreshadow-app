// Single source of truth for what the runtime engine can actually evaluate.
//
// The editor is deliberately constrained and the engine fails closed on
// anything it doesn't implement (silent non-fire). That gap is invisible:
// a saved automation looks fine but never runs. validate.ts uses these sets
// to reject unevaluable config at save time, and conditions.ts imports
// SUPPORTED_OPERATORS so the engine and the contract can never drift apart.

import type { Operator } from './types';

export const SUPPORTED_OPERATORS: readonly Operator[] = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'in',
  'not_in',
  'gt',
  'gte',
  'lt',
  'lte',
  'before',
  'after',
  'on_or_before',
  'on_or_after',
  'is_empty',
  'is_not_empty',
] as const;

/** Variable-path namespaces the engine can resolve (first dotted segment). */
export const SUPPORTED_NAMESPACES: readonly string[] = ['this'] as const;

/** Bare pseudo-variable paths the engine resolves without a namespace. */
export const BUILTIN_PATHS: readonly string[] = ['today', 'now'] as const;

export const SUPPORTED_RECIPIENT_KINDS: readonly string[] = ['channel'] as const;

export const SUPPORTED_NODE_KINDS: readonly string[] = ['group', 'rule'] as const;

/** A variable path the engine can resolve (`this.*`, `today`, or `now`). */
export function isSupportedPath(path: string): boolean {
  if (BUILTIN_PATHS.includes(path)) return true;
  return SUPPORTED_NAMESPACES.includes(path.split('.')[0]);
}
