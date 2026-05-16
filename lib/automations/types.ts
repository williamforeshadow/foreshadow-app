// Core types for the automations engine.
//
// Two triggers, period:
//   - schedule:   cron-like tick, optionally iterating rows of one entity
//   - row_change: insert / update / delete on one entity's table
//
// Everything else (same-day flip, due_soon, overdue, reassignment) is
// composed by the user with conditions. Nothing is baked in.

export type EntityKey =
  | 'reservation'
  | 'task'
  | 'property'
  | 'user'
  | 'department';

// ─── Trigger ───────────────────────────────────────────────────────────

export type AutomationTrigger = ScheduleTrigger | RowChangeTrigger;

export interface ScheduleTrigger {
  kind: 'schedule';
  schedule: ScheduleConfig;
  /**
   * Optional iteration. When present, the engine runs the conditions +
   * actions once per row of `for_each.entity`. `this.*` variables refer to
   * the current row. When absent, the schedule fires once per tick and
   * `this` is unbound.
   */
  for_each?: ForEachConfig;
}

export interface ScheduleConfig {
  frequency: 'hour' | 'day' | 'week' | 'month';
  /** HH:MM in 24-hour, in the resolved timezone. Ignored for 'hour'. */
  time: string;
  /** 0–6 (Sun–Sat). Only meaningful for frequency='week'. */
  weekdays: number[];
  /** 1–31. Only meaningful for frequency='month'. */
  month_days: number[];
  /** Every N units. 1 = every period; 2 = every other period; etc. */
  interval: number;
  /**
   * 'company' uses operations_settings.default_timezone.
   * 'property' resolves per-property when the iteration entity carries
   * a timezone; falls back to company timezone otherwise.
   */
  timezone: 'company' | 'property';
}

export interface ForEachConfig {
  entity: EntityKey;
}

export interface RowChangeTrigger {
  kind: 'row_change';
  entity: EntityKey;
  on: RowChangeKind[];
}

export type RowChangeKind = 'created' | 'updated' | 'deleted';

// ─── Conditions ────────────────────────────────────────────────────────

export type ConditionNode =
  | ConditionGroup
  | ConditionRule
  | ConditionExists;

export interface ConditionGroup {
  kind: 'group';
  match: 'all' | 'any';
  children: ConditionNode[];
}

export interface ConditionRule {
  kind: 'rule';
  left: Expression;
  op: Operator;
  right?: Expression;
}

/**
 * Set-scoped condition: "there exists / does not exist a row in `entity`
 * where `where` is true." Inside `where`, the variable namespace `related.*`
 * refers to the candidate row, while `this.*` continues to refer to the
 * outer iteration row.
 *
 * This is what lets users express "same-day flip" without a built-in event:
 *   FOR EACH reservation where check_out = today
 *   WHERE   exists(reservation) where related.property_id = this.property_id
 *                                  and related.check_in = today
 */
export interface ConditionExists {
  kind: 'exists' | 'not_exists';
  entity: EntityKey;
  where?: ConditionNode;
}

// ─── Expressions ───────────────────────────────────────────────────────

export type Expression =
  | { kind: 'variable'; path: string }
  | { kind: 'literal'; value: LiteralValue }
  | { kind: 'today' }
  | { kind: 'now' }
  | { kind: 'today_offset'; days: number }
  | { kind: 'now_offset'; hours?: number; minutes?: number };

export type LiteralValue =
  | string
  | number
  | boolean
  | string[]
  | number[]
  | null;

export type Operator =
  // Equality
  | 'equals' | 'not_equals'
  // String
  | 'contains' | 'not_contains'
  | 'starts_with' | 'ends_with'
  | 'matches_regex'
  // Numeric / ordinal
  | 'gt' | 'gte' | 'lt' | 'lte' | 'between'
  // Date / time
  | 'before' | 'after' | 'on_or_before' | 'on_or_after'
  | 'within_next' | 'within_last'
  // Set membership
  | 'in' | 'not_in'
  // Presence
  | 'is_empty' | 'is_not_empty'
  // Collection-field membership (e.g. assignee_ids contains user X)
  | 'collection_contains' | 'collection_not_contains';

// ─── Actions ───────────────────────────────────────────────────────────

export type AutomationAction = SlackMessageAction;

export interface SlackMessageAction {
  id: string;
  kind: 'slack_message';
  recipients: SlackRecipient[];
  /** Liquid-ish: `{{variable.path}}` and `{{path | filter:arg}}`. */
  message_template: string;
  /**
   * Files to attach to the post. When non-empty the runtime uploads via
   * `files.uploadV2` with the rendered message as `initial_comment`; when
   * empty it uses `chat.postMessage`.
   */
  attachments?: AutomationAttachment[];
  /** Optional per-action gate so one automation can branch on a condition. */
  condition?: ConditionNode;
}

export interface AutomationAttachment {
  /** Storage token, also serves as the React key. */
  id: string;
  /** Original filename, used as the Slack title. */
  name: string;
  /** Path inside the `slack-automation-attachments` Supabase Storage bucket. */
  storage_path: string;
  mime_type: string | null;
  size_bytes: number;
}

export type SlackRecipient =
  | StaticChannelRecipient
  | StaticUserRecipient
  | VariableRecipient;

export interface StaticChannelRecipient {
  id: string;
  kind: 'channel';
  channel_id: string;
  channel_name: string;
}

export interface StaticUserRecipient {
  id: string;
  kind: 'user';
  /** Foreshadow user id (looked up to a Slack user by email at send time). */
  user_id: string;
  user_name: string;
  user_email: string | null;
}

/**
 * Resolve recipient at runtime from a variable path.
 *
 * The path must point at either:
 *   - a user (e.g. `this.assignee`, `before.actor`, `related.created_by`) →
 *     resolves to that user's Slack DM
 *   - a Slack channel id string (rare; advanced use)
 */
export interface VariableRecipient {
  id: string;
  kind: 'variable';
  path: string;
}

// ─── Automation ────────────────────────────────────────────────────────

export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  /** Root-level condition. Always a group; empty group means "no filter". */
  conditions: ConditionGroup;
  actions: AutomationAction[];
  /**
   * Property scope. Empty = applies to all properties. Non-empty = runtime
   * filters by row.property_id ∈ property_ids before evaluating conditions.
   * First-class field rather than a condition because "only for property X"
   * is the dominant use case.
   */
  property_ids: string[];
  created_at: string;
  updated_at: string;
}

export function emptyConditionGroup(): ConditionGroup {
  return { kind: 'group', match: 'all', children: [] };
}
