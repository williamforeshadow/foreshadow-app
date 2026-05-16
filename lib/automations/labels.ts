// Plain-language labels for the automation editor.
//
// The engine speaks in dotted paths and operator names like `equals`. The
// editor never shows those to the operator — every label they see comes from
// this file. The path/op identifiers stay in the saved JSON.

import type { EntityKey, Operator, RowChangeKind } from './types';
import { ENTITY_SCHEMAS, getField, getRelation } from './entities';

export interface VariableContext {
  /** The "this" entity — current row for row_change, iteration row for schedule. */
  scopeEntity: EntityKey | null;
  /** When inside an exists clause, `related.*` resolves to this entity. */
  relatedEntity?: EntityKey;
  /**
   * Present on row_change triggers. Enables `actor.*` always, plus
   * `added.<rel>` / `removed.<rel>` on 'updated'.
   */
  rowChangeKind?: RowChangeKind;
}

export const OPERATOR_LABELS: Record<Operator, string> = {
  equals: 'is',
  not_equals: 'is not',
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
  ends_with: 'ends with',
  matches_regex: 'matches pattern',
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  between: 'is between',
  before: 'is before',
  after: 'is after',
  on_or_before: 'is on or before',
  on_or_after: 'is on or after',
  within_next: 'is within the next',
  within_last: 'was within the last',
  in: 'is one of',
  not_in: 'is not one of',
  is_empty: 'is empty',
  is_not_empty: 'is filled in',
  collection_contains: 'includes',
  collection_not_contains: 'does not include',
};

// Operators grouped by the field type they make sense for. Used to filter
// the operator dropdown so date fields don't suggest "starts with" and
// strings don't suggest "before".
export const OPERATORS_BY_FIELD_TYPE: Record<string, Operator[]> = {
  string: ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty'],
  enum: ['equals', 'not_equals', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  id: ['equals', 'not_equals', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  number: ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'is_not_empty'],
  boolean: ['equals', 'not_equals'],
  date: ['equals', 'not_equals', 'before', 'after', 'on_or_before', 'on_or_after', 'within_next', 'within_last', 'is_empty', 'is_not_empty'],
  time: ['equals', 'not_equals', 'before', 'after', 'is_empty', 'is_not_empty'],
  datetime: ['equals', 'not_equals', 'before', 'after', 'within_next', 'within_last', 'is_empty', 'is_not_empty'],
  string_array: ['collection_contains', 'collection_not_contains', 'is_empty', 'is_not_empty'],
  id_array: ['collection_contains', 'collection_not_contains', 'is_empty', 'is_not_empty'],
};

export const ROW_CHANGE_LABELS: Record<RowChangeKind, string> = {
  created: 'created',
  updated: 'updated',
  deleted: 'deleted',
};

// ─── Variable picker ──────────────────────────────────────────────────

export interface VariableOption {
  path: string;
  label: string;
  group: string;
  fieldType?: string;
}

/**
 * Build the grouped variable list shown to the operator. The picker shows
 * `group → label`; the underlying `path` is what's saved to the engine.
 *
 * Old call shape (scopeEntity, relatedEntity?) is still supported so existing
 * callers don't break, but new code should pass a VariableContext.
 */
export function buildVariableOptions(
  arg1: VariableContext | EntityKey | null,
  arg2?: EntityKey,
): VariableOption[] {
  const ctx: VariableContext =
    arg1 && typeof arg1 === 'object'
      ? arg1
      : { scopeEntity: (arg1 ?? null) as EntityKey | null, relatedEntity: arg2 };

  const out: VariableOption[] = [];

  out.push({ path: 'today', label: 'Date (trigger date)', group: 'Time' });
  out.push({ path: 'now', label: 'Time (trigger time)', group: 'Time' });

  if (ctx.scopeEntity) {
    pushEntityFields(
      out,
      ctx.scopeEntity,
      'this',
      `This ${ENTITY_SCHEMAS[ctx.scopeEntity].label.toLowerCase()}`,
    );
    // Hand-picked relation shortcuts. We stopped auto-flattening one-to-one
    // relations into a sub-group — most fields under those relations are
    // noise (timezone, internal id, etc). For the few that matter, surface
    // a single entry that resolves via the runtime's relation hydration.
    if (ctx.scopeEntity === 'reservation') {
      out.push({
        path: 'this.property.name',
        label: 'Property',
        group: 'This reservation',
        fieldType: 'string',
      });
    }
  }

  // Updated-row relation deltas — only meaningful if the trigger covers
  // 'updated' events. Doesn't include the actor namespace; that section
  // was pulled in the v2.0.2 strip-back.
  if (ctx.rowChangeKind === 'updated' && ctx.scopeEntity) {
    pushManyRelations(out, ctx.scopeEntity, 'added', 'Newly added');
    pushManyRelations(out, ctx.scopeEntity, 'removed', 'Just removed');
  }

  if (ctx.relatedEntity) {
    pushEntityFields(
      out,
      ctx.relatedEntity,
      'related',
      `Another ${ENTITY_SCHEMAS[ctx.relatedEntity].label.toLowerCase()}`,
    );
  }
  return out;
}

function pushManyRelations(
  out: VariableOption[],
  scopeEntity: EntityKey,
  namespace: 'added' | 'removed',
  groupPrefix: string,
): void {
  const schema = ENTITY_SCHEMAS[scopeEntity];
  for (const relation of schema.relations) {
    if (relation.cardinality !== 'many') continue;
    const target = ENTITY_SCHEMAS[relation.target];
    // Collection root only. Field-level access inside a collection has
    // ambiguous semantics ("some/all/any element matches?") so we don't
    // expose it here — for those cases the user can compose an
    // `exists <entity> where related.X …` clause instead.
    out.push({
      path: `${namespace}.${relation.key}`,
      label: `Each ${target.label.toLowerCase()} on the list`,
      group: `${groupPrefix} ${relation.label.toLowerCase()}`,
      fieldType: 'id_array',
    });
  }
}

function pushEntityFields(
  out: VariableOption[],
  entity: EntityKey,
  pathPrefix: string,
  groupPrefix: string,
): void {
  const schema = ENTITY_SCHEMAS[entity];
  for (const field of schema.fields) {
    if (field.internal) continue;
    out.push({
      path: `${pathPrefix}.${field.key}`,
      label: field.label,
      group: groupPrefix,
      fieldType: field.type,
    });
  }
  // One-to-one relations are no longer auto-flattened into a sub-group.
  // Most of the joined fields (timezone, internal ids) are noise. The
  // shortcuts that matter (e.g. "Property" → property.name) are hardcoded
  // in `buildVariableOptions` next to the scope branch.
}

/**
 * Resolve the displayed label for a variable path (for read-only contexts
 * like the live summary). Falls back to the raw path on unknown shapes.
 */
export function describeVariablePath(
  path: string,
  scopeEntity: EntityKey | null,
  relatedEntity?: EntityKey,
): string {
  if (path === 'today') return 'today';
  if (path === 'now') return 'right now';

  const [namespace, ...rest] = path.split('.');

  if (namespace === 'actor') {
    if (rest.length === 0) return 'the user who triggered this';
    const field = getField('user', rest[0]);
    if (!field) return path;
    return `the user who triggered this — ${field.label.toLowerCase()}`;
  }

  if (namespace === 'added' || namespace === 'removed') {
    if (!scopeEntity || rest.length === 0) return path;
    const relation = getRelation(scopeEntity, rest[0]);
    if (!relation || relation.cardinality !== 'many') return path;
    const verb = namespace === 'added' ? 'newly added' : 'just removed';
    if (rest.length === 1) {
      return `the ${verb} ${relation.label.toLowerCase()}`;
    }
    const field = getField(relation.target, rest[1]);
    if (!field) return path;
    return `the ${verb} ${relation.label.toLowerCase()}'s ${field.label.toLowerCase()}`;
  }

  const rootEntity =
    namespace === 'this' ? scopeEntity : namespace === 'related' ? relatedEntity : null;
  if (!rootEntity || rest.length === 0) return path;

  let entity: EntityKey = rootEntity;
  const segments: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const seg = rest[i];
    const isLast = i === rest.length - 1;
    const field = getField(entity, seg);
    if (field && isLast) {
      segments.push(field.label.toLowerCase());
      break;
    }
    const relation = getRelation(entity, seg);
    if (relation && relation.cardinality === 'one') {
      segments.push(relation.label.toLowerCase());
      entity = relation.target;
      continue;
    }
    return path;
  }
  const prefix = namespace === 'this' ? 'the' : 'another';
  return `${prefix} ${ENTITY_SCHEMAS[rootEntity].label.toLowerCase()}'s ${segments.join(' ')}`;
}

/** Resolve the field type at a given variable path (for operator filtering). */
export function fieldTypeAtPath(
  path: string,
  scopeEntity: EntityKey | null,
  relatedEntity?: EntityKey,
): string | undefined {
  if (path === 'today') return 'date';
  if (path === 'now') return 'datetime';
  const [namespace, ...rest] = path.split('.');

  if (namespace === 'actor') {
    return rest.length === 0 ? 'id' : getField('user', rest[0])?.type;
  }
  if (namespace === 'added' || namespace === 'removed') {
    if (!scopeEntity || rest.length === 0) return undefined;
    const relation = getRelation(scopeEntity, rest[0]);
    if (!relation || relation.cardinality !== 'many') return undefined;
    if (rest.length === 1) return 'id_array';
    return getField(relation.target, rest[1])?.type;
  }

  const rootEntity =
    namespace === 'this' ? scopeEntity : namespace === 'related' ? relatedEntity : null;
  if (!rootEntity || rest.length === 0) return undefined;

  let entity: EntityKey = rootEntity;
  for (let i = 0; i < rest.length; i += 1) {
    const seg = rest[i];
    const isLast = i === rest.length - 1;
    const field = getField(entity, seg);
    if (field && isLast) return field.type;
    const relation = getRelation(entity, seg);
    if (relation && relation.cardinality === 'one' && !isLast) {
      entity = relation.target;
      continue;
    }
    return undefined;
  }
  return undefined;
}
