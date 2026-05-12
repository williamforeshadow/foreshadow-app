// Authoritative schema for what variables exist and what types they have.
//
// The variable picker in the editor reads this and shows the user the real
// shape of their data. The condition engine reads this to know which
// operators are legal for which fields. The execution engine reads this to
// know which columns to select from Postgres.
//
// Adding a column = one entry here. Adding a relation = one entry under
// `relations`. No other code change needed.

import type { EntityKey } from './types';

export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'        // 'YYYY-MM-DD'
  | 'time'        // 'HH:MM'
  | 'datetime'    // ISO 8601
  | 'enum'
  | 'id'
  | 'string_array'
  | 'id_array';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  /** Enum members when type='enum'. */
  options?: string[];
  /** Hidden from the variable picker (still queryable for joins / conditions). */
  internal?: boolean;
}

export interface RelationDef {
  key: string;
  label: string;
  /** What it points at. */
  target: EntityKey;
  /** Cardinality. 'one' renders as `{{entity.relation.field}}`. */
  cardinality: 'one' | 'many';
  /** Local column holding the FK. */
  local_field: string;
  /** Foreign column the FK points at. Almost always 'id'. */
  foreign_field?: string;
  /** For many-to-many: the join table. */
  join?: { table: string; local: string; foreign: string };
}

export interface EntitySchema {
  key: EntityKey;
  label: string;
  /** Postgres table name. */
  table: string;
  fields: FieldDef[];
  relations: RelationDef[];
}

// ─── Schemas ───────────────────────────────────────────────────────────
//
// These mirror real columns in the Foreshadow database. Pretty/iso/datetime
// variants from the legacy module are intentionally absent — formatters
// handle that at render time.

export const ENTITY_SCHEMAS: Record<EntityKey, EntitySchema> = {
  reservation: {
    key: 'reservation',
    label: 'Reservation',
    table: 'reservations',
    fields: [
      { key: 'id', label: 'ID', type: 'id', internal: true },
      { key: 'property_id', label: 'Property ID', type: 'id' },
      { key: 'property_name', label: 'Property name', type: 'string' },
      { key: 'guest_name', label: 'Guest name', type: 'string' },
      { key: 'check_in', label: 'Check-in date', type: 'date' },
      { key: 'check_out', label: 'Check-out date', type: 'date' },
      { key: 'next_check_in', label: 'Next check-in date', type: 'date' },
    ],
    relations: [
      {
        key: 'property',
        label: 'Property',
        target: 'property',
        cardinality: 'one',
        local_field: 'property_id',
      },
    ],
  },

  task: {
    key: 'task',
    label: 'Task',
    table: 'turnover_tasks',
    fields: [
      { key: 'id', label: 'ID', type: 'id', internal: true },
      { key: 'title', label: 'Title', type: 'string' },
      {
        key: 'status',
        label: 'Status',
        type: 'enum',
        options: ['contingent', 'not_started', 'in_progress', 'paused', 'complete'],
      },
      {
        key: 'priority',
        label: 'Priority',
        type: 'enum',
        options: ['low', 'medium', 'high', 'urgent'],
      },
      { key: 'scheduled_date', label: 'Scheduled date', type: 'date' },
      { key: 'scheduled_time', label: 'Scheduled time', type: 'time' },
      { key: 'property_id', label: 'Property ID', type: 'id' },
      { key: 'property_name', label: 'Property name', type: 'string' },
      { key: 'department_id', label: 'Department ID', type: 'id' },
      { key: 'reservation_id', label: 'Reservation ID', type: 'id' },
      { key: 'is_binned', label: 'In bin', type: 'boolean' },
      { key: 'bin_id', label: 'Bin ID', type: 'id' },
      { key: 'created_at', label: 'Created at', type: 'datetime' },
      { key: 'completed_at', label: 'Completed at', type: 'datetime' },
    ],
    relations: [
      {
        key: 'property',
        label: 'Property',
        target: 'property',
        cardinality: 'one',
        local_field: 'property_id',
      },
      {
        key: 'department',
        label: 'Department',
        target: 'department',
        cardinality: 'one',
        local_field: 'department_id',
      },
      {
        key: 'reservation',
        label: 'Reservation',
        target: 'reservation',
        cardinality: 'one',
        local_field: 'reservation_id',
      },
      {
        key: 'assignees',
        label: 'Assignees',
        target: 'user',
        cardinality: 'many',
        local_field: 'id',
        join: { table: 'task_assignments', local: 'task_id', foreign: 'user_id' },
      },
    ],
  },

  property: {
    key: 'property',
    label: 'Property',
    table: 'properties',
    fields: [
      { key: 'id', label: 'ID', type: 'id', internal: true },
      { key: 'name', label: 'Name', type: 'string' },
      { key: 'timezone', label: 'Timezone', type: 'string' },
    ],
    relations: [],
  },

  user: {
    key: 'user',
    label: 'User',
    table: 'users',
    fields: [
      { key: 'id', label: 'ID', type: 'id', internal: true },
      { key: 'name', label: 'Name', type: 'string' },
      { key: 'email', label: 'Email', type: 'string' },
    ],
    relations: [],
  },

  department: {
    key: 'department',
    label: 'Department',
    table: 'departments',
    fields: [
      { key: 'id', label: 'ID', type: 'id', internal: true },
      { key: 'name', label: 'Name', type: 'string' },
    ],
    relations: [],
  },
};

// ─── Helpers ───────────────────────────────────────────────────────────

export function getEntitySchema(key: EntityKey): EntitySchema {
  return ENTITY_SCHEMAS[key];
}

export function getField(
  entity: EntityKey,
  fieldKey: string,
): FieldDef | undefined {
  return ENTITY_SCHEMAS[entity].fields.find((f) => f.key === fieldKey);
}

export function getRelation(
  entity: EntityKey,
  relationKey: string,
): RelationDef | undefined {
  return ENTITY_SCHEMAS[entity].relations.find((r) => r.key === relationKey);
}

/**
 * Resolve a dotted path like `reservation.property.timezone` into a field
 * type, walking relations. Returns undefined if any segment is invalid.
 * The first segment is the *namespace* (`this`, `related`, `before`, `after`,
 * or an entity key) — callers pass the resolved root entity.
 */
export function resolveFieldType(
  rootEntity: EntityKey,
  pathSegments: string[],
): FieldType | undefined {
  let entity: EntityKey = rootEntity;
  for (let i = 0; i < pathSegments.length; i += 1) {
    const segment = pathSegments[i];
    const isLast = i === pathSegments.length - 1;

    if (isLast) {
      const field = getField(entity, segment);
      if (field) return field.type;
      const relation = getRelation(entity, segment);
      // A relation is not a leaf — invalid as a final segment.
      return relation ? undefined : undefined;
    }

    const relation = getRelation(entity, segment);
    if (!relation || relation.cardinality !== 'one') return undefined;
    entity = relation.target;
  }
  return undefined;
}

/** Built-in pseudo-variables the engine resolves at execution time. */
export const BUILTIN_VARIABLES = [
  { path: 'today', label: 'Today (in resolved timezone)', type: 'date' as const },
  { path: 'now', label: 'Now (in resolved timezone)', type: 'datetime' as const },
] as const;
