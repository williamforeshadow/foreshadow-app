// Shape validation for incoming automation payloads.
//
// Permissive on purpose — the editor saves in-progress configs all the time,
// so we only reject things that would actively crash the engine. Deeper
// semantic checks (e.g. "operator X requires a right side of type Y") run
// later at execution / preview time.

import type {
  Automation,
  AutomationAction,
  AutomationAttachment,
  AutomationTrigger,
  ConditionGroup,
  ConditionNode,
  EntityKey,
  RowChangeKind,
  ScheduleConfig,
  SlackMessageAction,
} from './types';

const ENTITY_KEYS: EntityKey[] = ['reservation', 'task', 'property', 'user', 'department'];
const ROW_CHANGE_KINDS: RowChangeKind[] = ['created', 'updated', 'deleted'];

export interface ValidationError {
  path: string;
  message: string;
}

export interface ParsedAutomationInput {
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  conditions: ConditionGroup;
  actions: AutomationAction[];
  property_ids: string[];
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseAutomationInput(
  body: unknown,
): { ok: true; value: ParsedAutomationInput } | { ok: false; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  if (!body || typeof body !== 'object') {
    return { ok: false, errors: [{ path: '', message: 'body must be an object' }] };
  }
  const raw = body as Record<string, unknown>;

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) errors.push({ path: 'name', message: 'name is required' });

  const enabled = raw.enabled === undefined ? true : !!raw.enabled;

  const trigger = parseTrigger(raw.trigger, errors);
  const conditions = parseConditionGroup(raw.conditions, 'conditions', errors);
  const actions = parseActions(raw.actions, errors);
  const property_ids = parsePropertyIds(raw.property_ids, errors);

  if (errors.length > 0 || !trigger || !conditions || !actions) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: { name, enabled, trigger, conditions, actions, property_ids },
  };
}

function parseAttachments(
  raw: unknown,
  path: string,
  errors: ValidationError[],
): AutomationAttachment[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    errors.push({ path, message: 'attachments must be an array' });
    return undefined;
  }
  const out: AutomationAttachment[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const a = raw[i] as Partial<AutomationAttachment> | null;
    if (!a || typeof a !== 'object') continue;
    if (typeof a.id !== 'string' || typeof a.name !== 'string' || typeof a.storage_path !== 'string') {
      errors.push({ path: `${path}[${i}]`, message: 'id, name, storage_path required' });
      continue;
    }
    out.push({
      id: a.id,
      name: a.name,
      storage_path: a.storage_path,
      mime_type: typeof a.mime_type === 'string' ? a.mime_type : null,
      size_bytes: typeof a.size_bytes === 'number' ? a.size_bytes : 0,
    });
  }
  return out;
}

function parsePropertyIds(raw: unknown, errors: ValidationError[]): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.push({ path: 'property_ids', message: 'property_ids must be an array' });
    return [];
  }
  const out: string[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const v = raw[i];
    if (typeof v !== 'string' || !UUID_RE.test(v)) {
      errors.push({ path: `property_ids[${i}]`, message: 'must be a uuid' });
      continue;
    }
    out.push(v);
  }
  return out;
}

function parseTrigger(
  raw: unknown,
  errors: ValidationError[],
): AutomationTrigger | null {
  if (!raw || typeof raw !== 'object') {
    errors.push({ path: 'trigger', message: 'trigger is required' });
    return null;
  }
  const trigger = raw as Record<string, unknown>;
  if (trigger.kind === 'schedule') {
    const schedule = parseSchedule(trigger.schedule, errors);
    if (!schedule) return null;
    let forEach: { entity: EntityKey } | undefined;
    if (trigger.for_each !== undefined && trigger.for_each !== null) {
      const fe = trigger.for_each as Record<string, unknown>;
      if (!ENTITY_KEYS.includes(fe.entity as EntityKey)) {
        errors.push({ path: 'trigger.for_each.entity', message: 'unknown entity' });
        return null;
      }
      forEach = { entity: fe.entity as EntityKey };
    }
    return { kind: 'schedule', schedule, for_each: forEach };
  }
  if (trigger.kind === 'row_change') {
    if (!ENTITY_KEYS.includes(trigger.entity as EntityKey)) {
      errors.push({ path: 'trigger.entity', message: 'unknown entity' });
      return null;
    }
    const on = Array.isArray(trigger.on)
      ? (trigger.on.filter((k) => ROW_CHANGE_KINDS.includes(k as RowChangeKind)) as RowChangeKind[])
      : [];
    if (on.length === 0) {
      errors.push({
        path: 'trigger.on',
        message: 'pick at least one of created / updated / deleted',
      });
      return null;
    }
    return { kind: 'row_change', entity: trigger.entity as EntityKey, on };
  }
  errors.push({ path: 'trigger.kind', message: 'trigger.kind must be schedule or row_change' });
  return null;
}

function parseSchedule(raw: unknown, errors: ValidationError[]): ScheduleConfig | null {
  if (!raw || typeof raw !== 'object') {
    errors.push({ path: 'trigger.schedule', message: 'schedule is required' });
    return null;
  }
  const schedule = raw as Record<string, unknown>;
  const frequency = schedule.frequency as ScheduleConfig['frequency'];
  if (!['hour', 'day', 'week', 'month'].includes(frequency)) {
    errors.push({ path: 'trigger.schedule.frequency', message: 'invalid frequency' });
    return null;
  }
  const time =
    typeof schedule.time === 'string' && /^\d{2}:\d{2}$/.test(schedule.time)
      ? schedule.time
      : '07:00';
  const weekdays = Array.isArray(schedule.weekdays)
    ? schedule.weekdays.filter((d): d is number => typeof d === 'number' && d >= 0 && d <= 6)
    : [];
  const month_days = Array.isArray(schedule.month_days)
    ? schedule.month_days.filter((d): d is number => typeof d === 'number' && d >= 1 && d <= 31)
    : [];
  const interval = Math.max(1, Number(schedule.interval) || 1);
  const timezone = schedule.timezone === 'company' ? 'company' : 'property';
  return { frequency, time, weekdays, month_days, interval, timezone };
}

function parseConditionGroup(
  raw: unknown,
  path: string,
  errors: ValidationError[],
): ConditionGroup | null {
  if (!raw || typeof raw !== 'object') {
    errors.push({ path, message: 'conditions must be a group' });
    return null;
  }
  const group = raw as Record<string, unknown>;
  if (group.kind !== 'group') {
    errors.push({ path: `${path}.kind`, message: 'root conditions must be a group' });
    return null;
  }
  const match = group.match === 'any' ? 'any' : 'all';
  const children = Array.isArray(group.children) ? (group.children as ConditionNode[]) : [];
  // Trust child shapes — they'll be evaluated at execution time and
  // rejected if malformed. Rejecting partial trees here would block the
  // editor's autosave.
  return { kind: 'group', match, children };
}

function parseActions(raw: unknown, errors: ValidationError[]): AutomationAction[] | null {
  if (!Array.isArray(raw)) {
    errors.push({ path: 'actions', message: 'actions must be an array' });
    return null;
  }
  const out: AutomationAction[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const action = raw[i] as Partial<SlackMessageAction>;
    if (action?.kind !== 'slack_message') {
      errors.push({ path: `actions[${i}].kind`, message: 'only slack_message actions are supported' });
      continue;
    }
    out.push({
      id: typeof action.id === 'string' ? action.id : `${Date.now()}-${i}`,
      kind: 'slack_message',
      recipients: Array.isArray(action.recipients) ? action.recipients : [],
      message_template: typeof action.message_template === 'string' ? action.message_template : '',
      attachments: parseAttachments(action.attachments, `actions[${i}].attachments`, errors),
      condition: action.condition,
    });
  }
  return out;
}

export function summarizeAutomationFromRow(row: {
  id: string;
  name: string;
  enabled: boolean;
  trigger: unknown;
  conditions: unknown;
  actions: unknown;
  property_ids?: unknown;
  created_at: string;
  updated_at: string;
}): Automation {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    trigger: row.trigger as AutomationTrigger,
    conditions: row.conditions as ConditionGroup,
    actions: (row.actions as AutomationAction[]) ?? [],
    property_ids: Array.isArray(row.property_ids)
      ? (row.property_ids as string[])
      : [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
