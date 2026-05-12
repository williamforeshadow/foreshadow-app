import type {
  SlackAutomation,
  SlackAutomationConfig,
  SlackAutomationConditionOperator,
  SlackAutomationConditionRule,
  SlackAutomationContextType,
  SlackAutomationDynamicRecipientSource,
  SlackAutomationDeliveryType,
  SlackAutomationEventTrigger,
  SlackAutomationPropertyScope,
  SlackAutomationRecipient,
  SlackAutomationSchedule,
  SlackAutomationScheduleFrequency,
  SlackAutomationTrigger,
  SlackAutomationV2Config,
} from './types';

export interface SlackAutomationVariableDefinition {
  key: string;
  label: string;
  description: string;
  events?: SlackAutomationTrigger[];
  contexts?: SlackAutomationContextType[];
}

export interface SlackAutomationVariableGroup {
  key: string;
  label: string;
  variables: SlackAutomationVariableDefinition[];
}

export const SLACK_TRIGGER_LABELS: Record<SlackAutomationTrigger, string> = {
  new_booking: 'New Booking',
  check_in: 'Check-in',
  check_out: 'Check-out',
  task_assigned: 'Task Assigned',
  scheduled: 'Scheduled',
};

export const SLACK_TRIGGER_DESCRIPTIONS: Record<SlackAutomationTrigger, string> = {
  new_booking: 'When a reservation is created for a property.',
  check_in: 'When a reservation reaches its check-in date.',
  check_out: 'When a reservation reaches its check-out date.',
  task_assigned: 'When a user is newly assigned to a task.',
  scheduled: 'Runs on a configurable schedule and evaluates the selected context.',
};

export const SLACK_RESERVATION_TRIGGERS: SlackAutomationTrigger[] = [
  'new_booking',
  'check_in',
  'check_out',
];

export const SLACK_TASK_TRIGGERS: SlackAutomationTrigger[] = ['task_assigned'];

export const SLACK_EVENT_TRIGGERS: SlackAutomationEventTrigger[] = [
  'new_booking',
  'check_in',
  'check_out',
  'task_assigned',
];

export const SLACK_CONTEXT_LABELS: Record<SlackAutomationContextType, string> = {
  reservation_turnover: 'Reservations / Turnovers',
  task: 'Tasks',
  property: 'Properties',
  none: 'No record context',
};

export const SLACK_SCHEDULE_FREQUENCY_LABELS: Record<
  SlackAutomationScheduleFrequency,
  string
> = {
  daily: 'Daily',
  every_x_days: 'Every X days',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

export const SLACK_DYNAMIC_RECIPIENT_LABELS: Record<
  SlackAutomationDynamicRecipientSource,
  string
> = {
  task_assignee: 'Task assignee',
  task_actor: 'Task actor',
};

export const SLACK_TASK_DYNAMIC_RECIPIENT_SOURCES: SlackAutomationDynamicRecipientSource[] = [
  'task_assignee',
  'task_actor',
];

export const SLACK_CONDITION_OPERATOR_LABELS: Record<
  SlackAutomationConditionOperator,
  string
> = {
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  equals: 'equals',
  not_equals: 'does not equal',
  contains: 'contains',
};

export const SLACK_AUTOMATION_VARIABLE_GROUPS: SlackAutomationVariableGroup[] = [
  {
    key: 'event',
    label: 'Event',
    variables: [
      { key: 'event_name', label: 'Event name', description: 'Human-readable event label' },
      { key: 'event_type', label: 'Event type', description: 'Internal event key' },
      { key: 'trigger_date', label: 'Trigger date', description: 'Date the automation fired' },
      { key: 'trigger_time', label: 'Trigger time', description: 'Local time the automation evaluated' },
    ],
  },
  {
    key: 'task',
    label: 'Task',
    variables: [
      { key: 'task_title', label: 'Task title', description: 'The task title', events: ['task_assigned'], contexts: ['task'] },
      { key: 'task_status', label: 'Task status', description: 'Current task status', events: ['task_assigned'], contexts: ['task'] },
      { key: 'task_priority', label: 'Task priority', description: 'Current task priority', events: ['task_assigned'], contexts: ['task'] },
      { key: 'scheduled_date', label: 'Scheduled date', description: 'Task scheduled date', events: ['task_assigned'], contexts: ['task'] },
      { key: 'scheduled_time', label: 'Scheduled time', description: 'Task scheduled time', events: ['task_assigned'], contexts: ['task'] },
      { key: 'department_name', label: 'Department', description: 'Task department', events: ['task_assigned'], contexts: ['task'] },
    ],
  },
  {
    key: 'reservation',
    label: 'Reservation',
    variables: [
      { key: 'guest_name', label: 'Guest name', description: 'Reservation guest name', events: ['new_booking', 'check_in', 'check_out'], contexts: ['reservation_turnover'] },
      { key: 'check_in', label: 'Check-in date', description: 'Pretty check-in date', events: ['new_booking', 'check_in', 'check_out'], contexts: ['reservation_turnover'] },
      { key: 'check_in_time', label: 'Check-in time', description: 'Default check-in time', events: ['new_booking', 'check_in', 'check_out'], contexts: ['reservation_turnover'] },
      { key: 'check_in_datetime', label: 'Check-in date & time', description: 'Combined check-in date and time', events: ['new_booking', 'check_in', 'check_out'], contexts: ['reservation_turnover'] },
      { key: 'check_in_iso', label: 'Check-in raw', description: 'YYYY-MM-DD check-in date', events: ['new_booking', 'check_in', 'check_out'], contexts: ['reservation_turnover'] },
      { key: 'check_out', label: 'Check-out date', description: 'Pretty check-out date', events: ['new_booking', 'check_in', 'check_out'], contexts: ['reservation_turnover'] },
      { key: 'check_out_time', label: 'Check-out time', description: 'Default check-out time', events: ['new_booking', 'check_in', 'check_out'], contexts: ['reservation_turnover'] },
      { key: 'check_out_datetime', label: 'Check-out date & time', description: 'Combined check-out date and time', events: ['new_booking', 'check_in', 'check_out'], contexts: ['reservation_turnover'] },
      { key: 'check_out_iso', label: 'Check-out raw', description: 'YYYY-MM-DD check-out date', events: ['new_booking', 'check_in', 'check_out'], contexts: ['reservation_turnover'] },
      { key: 'next_check_in', label: 'Next check-in date', description: 'Pretty next check-in date for the turnover', contexts: ['reservation_turnover'] },
      { key: 'next_check_in_iso', label: 'Next check-in raw', description: 'YYYY-MM-DD next check-in date', contexts: ['reservation_turnover'] },
      { key: 'nights', label: 'Nights', description: 'Number of reservation nights', events: ['new_booking', 'check_in', 'check_out'], contexts: ['reservation_turnover'] },
    ],
  },
  {
    key: 'property',
    label: 'Property',
    variables: [
      { key: 'property_name', label: 'Property name', description: 'Property attached to the event', contexts: ['reservation_turnover', 'task', 'property'] },
      { key: 'property_id', label: 'Property ID', description: 'Internal property id', contexts: ['reservation_turnover', 'task', 'property'] },
      { key: 'property_timezone', label: 'Property timezone', description: 'IANA timezone for the property', contexts: ['reservation_turnover', 'property'] },
    ],
  },
  {
    key: 'people',
    label: 'People',
    variables: [
      { key: 'actor_name', label: 'Actor name', description: 'User who caused the event', events: ['task_assigned'] },
      { key: 'actor_email', label: 'Actor email', description: 'Actor email', events: ['task_assigned'] },
      { key: 'assignee_name', label: 'Assignee name', description: 'Assigned user name', events: ['task_assigned'] },
      { key: 'assignee_email', label: 'Assignee email', description: 'Assigned user email', events: ['task_assigned'] },
    ],
  },
  {
    key: 'links',
    label: 'Links',
    variables: [
      { key: 'task_url', label: 'Task URL', description: 'Direct Foreshadow task URL', events: ['task_assigned'] },
      { key: 'task_link', label: 'Linked task title', description: 'Slack link using task title', events: ['task_assigned'] },
    ],
  },
];

export function getSlackAutomationVariableGroups(
  event: SlackAutomationTrigger,
  contextType?: SlackAutomationContextType,
): SlackAutomationVariableGroup[] {
  const context = contextType ?? inferSlackAutomationContext(event);
  return SLACK_AUTOMATION_VARIABLE_GROUPS.map((group) => ({
    ...group,
    variables: group.variables.filter(
      (variable) =>
        (!variable.events || variable.events.includes(event)) &&
        (!variable.contexts || variable.contexts.includes(context)),
    ),
  })).filter((group) => group.variables.length > 0);
}

export function getSlackAutomationVariables(
  event: SlackAutomationTrigger,
  contextType?: SlackAutomationContextType,
): SlackAutomationVariableDefinition[] {
  return getSlackAutomationVariableGroups(event, contextType).flatMap((group) => group.variables);
}

export function createDefaultSlackAutomationWorkflowConfig(
  event: SlackAutomationTrigger = 'new_booking',
): SlackAutomationConfig {
  const context = inferSlackAutomationContext(event);
  return normalizeSlackAutomationConfig(
    {
      delivery_type: event === 'task_assigned' ? 'task_assignee_dm' : 'channel',
      channel_id: '',
      channel_name: '',
      message_template:
        event === 'task_assigned'
          ? '{{actor_name}} assigned you {{task_link}}'
          : '',
      message_format: event === 'task_assigned' ? 'task_card' : 'text',
      custom_blocks_json: '',
      attachments: [],
    },
    { trigger: event, property_ids: [], context },
  );
}

export function normalizeSlackAutomationConfig(
  rawConfig: SlackAutomationConfig | null | undefined,
  fallback: {
    trigger?: SlackAutomationTrigger;
    property_ids?: string[];
    context?: SlackAutomationContextType;
  } = {},
): SlackAutomationConfig {
  const config = rawConfig ?? {
    channel_id: '',
    channel_name: '',
    message_template: '',
    attachments: [],
  };
  const rawWhen = config.when as
    | (SlackAutomationV2Config['when'] & { event?: SlackAutomationTrigger })
    | undefined;
  const whenType = rawWhen?.type ?? (fallback.trigger === 'scheduled' ? 'schedule' : 'event');
  const event: SlackAutomationEventTrigger =
    whenType === 'event'
      ? coerceEventTrigger(rawWhen?.event ?? fallback.trigger) ?? 'new_booking'
      : 'new_booking';
  const trigger: SlackAutomationTrigger = whenType === 'schedule' ? 'scheduled' : event;
  const contextType =
    config.context?.type ??
    fallback.context ??
    inferSlackAutomationContext(trigger);
  const schedule = normalizeSlackAutomationSchedule(rawWhen?.schedule, contextType);
  const deliveryType: SlackAutomationDeliveryType =
    config.action?.delivery?.type ??
    config.delivery_type ??
    (trigger === 'task_assigned' ? 'task_assignee_dm' : 'channel');
  const channelId = config.action?.delivery?.channel_id ?? config.channel_id ?? '';
  const channelName = config.action?.delivery?.channel_name ?? config.channel_name ?? '';
  const recipients = normalizeSlackAutomationRecipients({
    recipients: config.action?.recipients,
    deliveryType,
    channelId,
    channelName,
    event: trigger,
  });
  const attachments = config.action?.attachments ?? config.attachments ?? [];
  const propertyIds =
    config.conditions?.property_ids ??
    fallback.property_ids ??
    [];
  const propertyScope =
    config.conditions?.property_scope ??
    inferPropertyScope(propertyIds);
  const includeTaskCards =
    config.action?.message?.include_task_cards ??
    (config.message_format === 'task_card');
  const useCustomBlocks =
    config.action?.message?.use_custom_blocks ??
    (config.message_format === 'custom_blocks');
  const messageTemplate =
    config.action?.message?.template ??
    config.message_template ??
    '';
  const customBlocksJson =
    config.action?.message?.custom_blocks_json ??
    config.custom_blocks_json ??
    '';

  const normalizedV2: SlackAutomationV2Config = {
    version: 2,
    when:
      whenType === 'schedule'
        ? { type: 'schedule', schedule }
        : { type: 'event', event },
    context: {
      type: contextType,
    },
    conditions: {
      property_scope: propertyScope,
      property_ids: propertyScope === 'selected' ? propertyIds : [],
      rules: normalizeConditionRules(config.conditions?.rules ?? []),
    },
    action: {
      recipients,
      delivery: {
        type: deliveryType,
        channel_id: channelId,
        channel_name: channelName,
      },
      message: {
        template: messageTemplate,
        include_task_cards: includeTaskCards,
        use_custom_blocks: useCustomBlocks,
        custom_blocks_json: customBlocksJson,
      },
      attachments,
    },
  };

  return {
    ...config,
    ...normalizedV2,
    delivery_type: deliveryType,
    channel_id: channelId,
    channel_name: channelName,
    message_template: messageTemplate,
    message_format: useCustomBlocks
      ? 'custom_blocks'
      : includeTaskCards
        ? 'task_card'
        : 'text',
    custom_blocks_json: customBlocksJson,
    attachments,
  };
}

export function newSlackAutomationRecipientId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `recipient-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createDefaultSlackAutomationRecipients(
  event: SlackAutomationTrigger,
): SlackAutomationRecipient[] {
  if (event === 'task_assigned') {
    return [
      {
        id: newSlackAutomationRecipientId(),
        type: 'dynamic_user',
        source: 'task_assignee',
      },
    ];
  }
  return [
    {
      id: newSlackAutomationRecipientId(),
      type: 'channel',
      channel_id: '',
      channel_name: '',
    },
  ];
}

export function normalizeSlackAutomationRecipients(args: {
  recipients?: SlackAutomationRecipient[];
  deliveryType: SlackAutomationDeliveryType;
  channelId: string;
  channelName: string;
  event: SlackAutomationTrigger;
}): SlackAutomationRecipient[] {
  const existing = Array.isArray(args.recipients)
    ? args.recipients.filter(isSlackAutomationRecipient)
    : [];
  if (existing.length > 0) return existing;

  if (args.deliveryType === 'task_assignee_dm') {
    return [
      {
        id: newSlackAutomationRecipientId(),
        type: 'dynamic_user',
        source: 'task_assignee',
      },
    ];
  }

  if (args.deliveryType === 'channel' || args.channelId || args.channelName) {
    return [
      {
        id: newSlackAutomationRecipientId(),
        type: 'channel',
        channel_id: args.channelId,
        channel_name: args.channelName,
      },
    ];
  }

  return createDefaultSlackAutomationRecipients(args.event);
}

function isSlackAutomationRecipient(
  value: unknown,
): value is SlackAutomationRecipient {
  if (!value || typeof value !== 'object') return false;
  const recipient = value as Partial<SlackAutomationRecipient>;
  if (typeof recipient.id !== 'string' || typeof recipient.type !== 'string') {
    return false;
  }
  if (recipient.type === 'channel') {
    return typeof (recipient as { channel_id?: unknown }).channel_id === 'string';
  }
  if (recipient.type === 'user') {
    return typeof (recipient as { user_id?: unknown }).user_id === 'string';
  }
  if (recipient.type === 'dynamic_user') {
    return ['task_assignee', 'task_actor'].includes(
      (recipient as { source?: string }).source ?? '',
    );
  }
  return false;
}

export function inferSlackAutomationContext(
  trigger: SlackAutomationTrigger,
): SlackAutomationContextType {
  if (trigger === 'task_assigned') return 'task';
  if (trigger === 'scheduled') return 'reservation_turnover';
  return 'reservation_turnover';
}

export function normalizeSlackAutomationSchedule(
  rawSchedule: SlackAutomationSchedule | undefined,
  context: SlackAutomationContextType,
): SlackAutomationSchedule {
  const timezoneMode =
    rawSchedule?.timezone_mode ??
    (['reservation_turnover', 'property'].includes(context) ? 'property' : 'company');
  return {
    frequency: rawSchedule?.frequency ?? 'daily',
    interval: Math.max(1, Number(rawSchedule?.interval ?? 1) || 1),
    weekdays: Array.isArray(rawSchedule?.weekdays)
      ? rawSchedule.weekdays.filter((day) => day >= 0 && day <= 6)
      : [],
    month_days: Array.isArray(rawSchedule?.month_days)
      ? rawSchedule.month_days.filter((day) => day >= 1 && day <= 31)
      : [],
    time: normalizeScheduleTime(rawSchedule?.time),
    timezone_mode: timezoneMode,
  };
}

function normalizeConditionRules(
  rules: SlackAutomationConditionRule[],
): SlackAutomationConditionRule[] {
  return rules.map((rule) => ({
    ...rule,
    value: rule.value ?? rule.right?.value ?? '',
    right: rule.right ?? {
      type: 'literal',
      value: rule.value ?? '',
    },
  }));
}

function normalizeScheduleTime(value: string | undefined): string {
  if (typeof value === 'string' && /^\d{2}:\d{2}$/.test(value)) return value;
  return '07:00';
}

function coerceEventTrigger(
  value: SlackAutomationTrigger | undefined,
): SlackAutomationEventTrigger | null {
  if (!value || value === 'scheduled') return null;
  return value;
}

export function getSlackAutomationSavePropertyIds(
  config: SlackAutomationConfig,
): string[] {
  const normalized = normalizeSlackAutomationConfig(config);
  return normalized.conditions?.property_scope === 'selected'
    ? normalized.conditions.property_ids
    : [];
}

export function getSlackAutomationDispatchTrigger(
  config: SlackAutomationConfig,
): SlackAutomationTrigger {
  const normalized = normalizeSlackAutomationConfig(config);
  return normalized.when?.type === 'schedule'
    ? 'scheduled'
    : normalized.when?.event ?? 'new_booking';
}

export function slackAutomationMatchesContext(args: {
  automation: SlackAutomation;
  propertyId: string | null;
  variables: Record<string, string>;
}): boolean {
  const config = normalizeSlackAutomationConfig(args.automation.config, {
    trigger: args.automation.trigger,
    property_ids: args.automation.property_ids ?? [],
  });
  if (!matchesPropertyScope(config, args.propertyId)) return false;
  return (config.conditions?.rules ?? []).every((rule) =>
    evaluateConditionRule(rule, args.variables),
  );
}

export function matchesPropertyScope(
  config: SlackAutomationConfig,
  propertyId: string | null,
): boolean {
  const normalized = normalizeSlackAutomationConfig(config);
  const scope = normalized.conditions?.property_scope ?? 'all';
  if (scope === 'all') return true;
  if (scope === 'none') return !propertyId;
  if (!propertyId) return false;
  return (normalized.conditions?.property_ids ?? []).includes(propertyId);
}

function evaluateConditionRule(
  rule: SlackAutomationConditionRule,
  variables: Record<string, string>,
): boolean {
  const actual = (variables[rule.variable] ?? '').trim();
  const expected =
    rule.right?.type === 'variable'
      ? (variables[rule.right.variable ?? ''] ?? '').trim()
      : (rule.right?.value ?? rule.value ?? '').trim();
  switch (rule.operator) {
    case 'is_empty':
      return actual.length === 0;
    case 'is_not_empty':
      return actual.length > 0;
    case 'equals':
      return actual.toLowerCase() === expected.toLowerCase();
    case 'not_equals':
      return actual.toLowerCase() !== expected.toLowerCase();
    case 'contains':
      return actual.toLowerCase().includes(expected.toLowerCase());
    default:
      return true;
  }
}

function inferPropertyScope(
  propertyIds: string[],
): SlackAutomationPropertyScope {
  return propertyIds.length > 0 ? 'selected' : 'all';
}
