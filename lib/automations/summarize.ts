// Turn an Automation into the one-paragraph English sentence that lives at
// the top of the editor and reads as "this is what your automation does."
//
// Goals:
//   - Read like prose, not bullet points.
//   - Degrade gracefully when fields are missing (a half-built automation
//     should still produce something legible, not a JSON-shaped sentence).
//   - Match the labels used in the editor's pickers — no engine jargon.

import type {
  Automation,
  AutomationAction,
  AutomationTrigger,
  ConditionExists,
  ConditionGroup,
  ConditionNode,
  ConditionRule,
  EntityKey,
  Expression,
  Operator,
  ScheduleConfig,
  SlackMessageAction,
  SlackRecipient,
} from './types';
import { describeVariablePath, OPERATOR_LABELS, ROW_CHANGE_LABELS } from './labels';
import { ENTITY_SCHEMAS } from './entities';

export function summarizeAutomation(
  automation: Automation,
  propertyNames?: Map<string, string>,
): string {
  const { trigger } = automation;
  const scopeEntity = scopeOf(trigger);
  const actionClause = summarizeActions(automation.actions, scopeEntity);
  const scopeClause = summarizePropertyScope(
    automation,
    scopeEntity,
    propertyNames,
  );

  // Reservation daily-check WITH a Timing rule: lead with the timing as an
  // imperative ("Fire 2 days before check-in, …") and drop the redundant
  // cadence / "for each reservation" / "when a reservation is" wrapper.
  const isResDailyCheck =
    trigger.kind === 'schedule' && trigger.for_each?.entity === 'reservation';
  if (isResDailyCheck) {
    const children = automation.conditions?.children ?? [];
    const timingPhrases = children.map(timingPhrase).filter(Boolean) as string[];
  const timing = timingPhrases.length ? timingPhrases.join(' and ') : null;
    if (timing) {
      const filterChildren = children.filter((c) => timingPhrase(c) === null);
      const filtersInner =
        filterChildren.length > 0
          ? summarizeGroup(
              { ...automation.conditions, children: filterChildren },
              scopeEntity,
            )
          : '';
      const hasFilters = filtersInner && filtersInner !== '(no conditions yet)';
      const parts = [`fire ${timing}`];
      if (scopeClause) parts.push(scopeClause);
      if (hasFilters) parts.push(`if ${filtersInner}`);
      parts.push(actionClause);
      return capitalize(parts.join(', ')) + '.';
    }
  }

  const triggerSentence = summarizeTrigger(trigger);
  const conditionClause = summarizeRootConditions(automation.conditions, scopeEntity);
  const parts: string[] = [triggerSentence];
  if (scopeClause) parts.push(scopeClause);
  if (conditionClause) parts.push(conditionClause);
  parts.push(actionClause);
  return capitalize(parts.join(', ')) + '.';
}

// Property scope. `property_ids` is a first-class filter (empty = all). Only
// meaningful when the automation is reservation-scoped — Recurring has no
// property concept (picker disabled, ids cleared), so emit nothing there.
function summarizePropertyScope(
  automation: Automation,
  scopeEntity: EntityKey | null,
  propertyNames?: Map<string, string>,
): string {
  if (!scopeEntity) return '';
  const ids = automation.property_ids ?? [];
  if (ids.length === 0) return 'for all properties';

  const names = ids
    .map((id) => propertyNames?.get(id))
    .filter((n): n is string => Boolean(n));

  if (names.length === 0) {
    return ids.length === 1
      ? 'for 1 selected property'
      : `for ${ids.length} selected properties`;
  }
  return names.length === 1
    ? `for property ${names[0]}`
    : `for properties ${listJoin(names, 'and')}`;
}

export function scopeOf(trigger: AutomationTrigger): EntityKey | null {
  if (trigger.kind === 'schedule') return trigger.for_each?.entity ?? null;
  return trigger.entity;
}

// ─── Trigger ───────────────────────────────────────────────────────────

function summarizeTrigger(trigger: AutomationTrigger): string {
  if (trigger.kind === 'schedule') {
    const { schedule, for_each } = trigger;
    const cadence = describeCadence(schedule);
    const tz =
      schedule.timezone === 'property'
        ? "in each property's local time"
        : "in your company's time";
    const iteration = for_each
      ? `, for each ${entityLabel(for_each.entity).toLowerCase()}`
      : '';
    return `${cadence} ${tz}${iteration}`;
  }
  // row_change
  const ent = entityLabel(trigger.entity).toLowerCase();
  const verbs = trigger.on
    .map((kind) => ROW_CHANGE_LABELS[kind])
    .filter(Boolean);
  if (verbs.length === 0) return `When a ${ent} changes`;
  const verbList = listJoin(verbs, 'or');
  return `When a ${ent} is ${verbList}`;
}

function describeCadence(schedule: ScheduleConfig): string {
  const interval = schedule.interval ?? 1;
  const time = schedule.time || '07:00';
  const prettyTime = prettyTimeOfDay(time);
  if (schedule.frequency === 'hour') {
    return interval === 1 ? 'Every hour' : `Every ${interval} hours`;
  }
  if (schedule.frequency === 'day') {
    return interval === 1
      ? `Every day at ${prettyTime}`
      : `Every ${interval} days at ${prettyTime}`;
  }
  if (schedule.frequency === 'week') {
    const days = (schedule.weekdays ?? []).map(weekdayLabel).filter(Boolean);
    const which = days.length === 0 ? 'every week' : `on ${listJoin(days, 'and')}`;
    return interval === 1
      ? `${capitalize(which)} at ${prettyTime}`
      : `Every ${interval} weeks ${which} at ${prettyTime}`;
  }
  if (schedule.frequency === 'month') {
    const days = (schedule.month_days ?? []).map((d) => ordinal(d));
    const which =
      days.length === 0 ? 'every month' : `on the ${listJoin(days, 'and')} of the month`;
    return interval === 1
      ? `${capitalize(which)} at ${prettyTime}`
      : `Every ${interval} months ${which} at ${prettyTime}`;
  }
  return 'On a schedule';
}

// ─── Conditions ────────────────────────────────────────────────────────

// Timing rules (editor sugar: `this.days_until_<anchor> equals <int>`) are
// phrased relatively — "2 days before check-in" — not as a raw condition.
const TIMING_ANCHOR_LABEL: Record<string, string> = {
  'this.days_until_check_in': 'check-in',
  'this.days_until_check_out': 'check-out',
  'this.days_until_next_check_in': 'next check-in',
};

function timingPhrase(node: ConditionNode): string | null {
  if (
    node.kind !== 'rule' ||
    node.left?.kind !== 'variable' ||
    !(node.left.path in TIMING_ANCHOR_LABEL) ||
    node.op !== 'equals' ||
    node.right?.kind !== 'literal' ||
    typeof node.right.value !== 'number'
  ) {
    return null;
  }
  const anchor = TIMING_ANCHOR_LABEL[node.left.path];
  const v = node.right.value as number;
  if (v === 0) return `on reservation's ${anchor}`;
  const n = Math.abs(v);
  const unit = n === 1 ? 'day' : 'days';
  return v > 0
    ? `${n} ${unit} before reservation's ${anchor}`
    : `${n} ${unit} after reservation's ${anchor}`;
}

function summarizeRootConditions(
  group: ConditionGroup,
  scopeEntity: EntityKey | null,
): string {
  // No entity in scope (Recurring) → conditions are meaningless; never
  // emit a clause. This is what kept the summary printing nonsense like
  // "if today is today and right now is today".
  if (!scopeEntity) return '';
  if (!group?.children || group.children.length === 0) return '';

  // This path is only reached for non-daily-check triggers (the daily-scan
  // case is handled by the isResDailyCheck block in summarizeAutomation).
  // Timing rules are daily-scan-only sugar; if one is orphaned here from a
  // since-changed trigger, drop it rather than phrasing it as "fire …".
  const children = group.children ?? [];
  const filterChildren = children.filter((c) => timingPhrase(c) === null);
  const filtersInner =
    filterChildren.length > 0
      ? summarizeGroup({ ...group, children: filterChildren }, scopeEntity)
      : '';
  const hasFilters = filtersInner && filtersInner !== '(no conditions yet)';

  if (hasFilters) return `if ${filtersInner}`;
  return '';
}

// A rule whose two sides resolve to the same text is a tautology
// ("today is today"). Drop it from the summary so a half-built or
// degenerate condition never reads as gibberish.
function isDegenerateRule(
  rule: ConditionRule,
  scopeEntity: EntityKey | null,
  relatedEntity?: EntityKey,
): boolean {
  if (!operatorNeedsRight(rule.op)) return false;
  if (!rule.right) return false;
  const left = expressionText(rule.left, scopeEntity, relatedEntity);
  const right = expressionText(rule.right, scopeEntity, relatedEntity);
  return left === right;
}

function summarizeGroup(
  group: ConditionGroup,
  scopeEntity: EntityKey | null,
  relatedEntity?: EntityKey,
): string {
  const parts = (group.children ?? [])
    .filter(
      (child) =>
        !(child.kind === 'rule' && isDegenerateRule(child, scopeEntity, relatedEntity)),
    )
    .map((child) => summarizeNode(child, scopeEntity, relatedEntity))
    .filter(Boolean);
  if (parts.length === 0) return '(no conditions yet)';
  const conjunction = group.match === 'any' ? 'or' : 'and';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} ${conjunction} ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, ${conjunction} ${parts[parts.length - 1]}`;
}

function summarizeNode(
  node: ConditionNode,
  scopeEntity: EntityKey | null,
  relatedEntity?: EntityKey,
): string {
  if (node.kind === 'group') {
    const inner = summarizeGroup(node, scopeEntity, relatedEntity);
    return node.children.length > 1 ? `(${inner})` : inner;
  }
  if (node.kind === 'rule') {
    return summarizeRule(node, scopeEntity, relatedEntity);
  }
  return summarizeExists(node, scopeEntity);
}

function summarizeRule(
  rule: ConditionRule,
  scopeEntity: EntityKey | null,
  relatedEntity?: EntityKey,
): string {
  const left = expressionText(rule.left, scopeEntity, relatedEntity);
  const op = OPERATOR_LABELS[rule.op] ?? rule.op;
  if (!operatorNeedsRight(rule.op)) {
    return `${left} ${op}`;
  }
  const right = rule.right
    ? expressionText(rule.right, scopeEntity, relatedEntity)
    : '(no value yet)';
  return `${left} ${op} ${right}`;
}

function summarizeExists(node: ConditionExists, scopeEntity: EntityKey | null): string {
  const ent = entityLabel(node.entity).toLowerCase();
  const verb = node.kind === 'exists' ? 'there is another' : 'there is no other';
  const inner =
    node.where && (node.where as ConditionGroup).children?.length > 0
      ? ` where ${summarizeGroup(node.where as ConditionGroup, scopeEntity, node.entity)}`
      : '';
  return `${verb} ${ent}${inner}`;
}

function expressionText(
  expr: Expression,
  scopeEntity: EntityKey | null,
  relatedEntity?: EntityKey,
): string {
  if (expr.kind === 'variable') {
    return describeVariablePath(expr.path, scopeEntity, relatedEntity);
  }
  if (expr.kind === 'literal') {
    const value = expr.value;
    if (Array.isArray(value)) return value.length === 0 ? 'nothing' : value.join(', ');
    if (value === null || value === undefined || value === '') return '(empty)';
    return `"${String(value)}"`;
  }
  if (expr.kind === 'today') return 'today';
  if (expr.kind === 'now') return 'right now';
  if (expr.kind === 'today_offset') {
    const d = expr.days;
    if (d === 0) return 'today';
    if (d > 0) return d === 1 ? 'tomorrow' : `in ${d} days`;
    const ago = -d;
    return ago === 1 ? 'yesterday' : `${ago} days ago`;
  }
  if (expr.kind === 'now_offset') {
    const m = expr.minutes ?? 0;
    const h = expr.hours ?? 0;
    if (h === 0 && m === 0) return 'right now';
    const parts: string[] = [];
    if (h !== 0) parts.push(`${Math.abs(h)} hours`);
    if (m !== 0) parts.push(`${Math.abs(m)} minutes`);
    const ahead = (h ?? 0) + (m ?? 0) >= 0;
    return ahead ? `in ${parts.join(' ')}` : `${parts.join(' ')} ago`;
  }
  return '';
}

function operatorNeedsRight(op: Operator): boolean {
  return !['is_empty', 'is_not_empty'].includes(op);
}

// ─── Actions ───────────────────────────────────────────────────────────

function summarizeActions(
  actions: AutomationAction[],
  scopeEntity: EntityKey | null,
): string {
  if (!actions || actions.length === 0) return 'do nothing (add an action)';
  if (actions.length === 1) return summarizeOneAction(actions[0], scopeEntity);
  return `do these: ${actions
    .map((a, i) => `(${i + 1}) ${summarizeOneAction(a, scopeEntity)}`)
    .join('; ')}`;
}

function summarizeOneAction(
  action: AutomationAction,
  scopeEntity: EntityKey | null,
): string {
  if (action.kind !== 'slack_message') return 'do something';
  return summarizeSlackMessage(action, scopeEntity);
}

function summarizeSlackMessage(
  action: SlackMessageAction,
  scopeEntity: EntityKey | null,
): string {
  const recipients = (action.recipients ?? [])
    .map((r) => recipientText(r, scopeEntity))
    .filter(Boolean);
  const audience =
    recipients.length === 0
      ? 'to (no recipients yet)'
      : `to ${listJoin(recipients, 'and')}`;
  const body =
    action.message_template?.trim().length > 0
      ? `saying "${truncate(action.message_template.trim(), 80)}"`
      : 'with no message yet';
  return `send a Slack message ${audience} ${body}`;
}

function recipientText(r: SlackRecipient, scopeEntity: EntityKey | null): string {
  if (r.kind === 'channel') return r.channel_name ? `#${r.channel_name}` : 'a channel (not picked)';
  if (r.kind === 'user') return r.user_name ? r.user_name : 'a user (not picked)';
  return describeVariablePath(r.path, scopeEntity);
}

// ─── Helpers ───────────────────────────────────────────────────────────

function entityLabel(key: EntityKey): string {
  return ENTITY_SCHEMAS[key].label;
}

function weekdayLabel(d: number): string {
  return ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][d] ?? '';
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function prettyTimeOfDay(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const mins = m[2];
  const hour12 = ((h + 11) % 12) + 1;
  const ampm = h < 12 ? 'AM' : 'PM';
  return mins === '00' ? `${hour12} ${ampm}` : `${hour12}:${mins} ${ampm}`;
}

function listJoin(items: string[], conj: 'and' | 'or'): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} ${conj} ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, ${conj} ${items[items.length - 1]}`;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
