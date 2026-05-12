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

export function summarizeAutomation(automation: Automation): string {
  const scopeEntity = scopeOf(automation.trigger);
  const triggerSentence = summarizeTrigger(automation.trigger);
  const conditionClause = summarizeRootConditions(automation.conditions, scopeEntity);
  const actionClause = summarizeActions(automation.actions, scopeEntity);

  const parts: string[] = [triggerSentence];
  if (conditionClause) parts.push(conditionClause);
  parts.push(actionClause);
  return capitalize(parts.join(', ')) + '.';
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

function summarizeRootConditions(
  group: ConditionGroup,
  scopeEntity: EntityKey | null,
): string {
  if (!group?.children || group.children.length === 0) return '';
  return `if ${summarizeGroup(group, scopeEntity)}`;
}

function summarizeGroup(
  group: ConditionGroup,
  scopeEntity: EntityKey | null,
  relatedEntity?: EntityKey,
): string {
  const parts = (group.children ?? [])
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
