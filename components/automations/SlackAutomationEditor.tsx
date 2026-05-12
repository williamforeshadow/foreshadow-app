'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type {
  SlackAutomation,
  SlackAutomationAttachment,
  SlackAutomationConditionOperator,
  SlackAutomationContextType,
  SlackAutomationConfig,
  SlackAutomationDynamicRecipientSource,
  SlackAutomationEventTrigger,
  SlackAutomationPropertyScope,
  SlackAutomationRecipient,
  SlackAutomationSchedule,
  SlackAutomationScheduleFrequency,
  SlackAutomationTrigger,
  User,
} from '@/lib/types';
import {
  SLACK_CONDITION_OPERATOR_LABELS,
  SLACK_CONTEXT_LABELS,
  SLACK_DYNAMIC_RECIPIENT_LABELS,
  SLACK_RESERVATION_TRIGGERS,
  SLACK_SCHEDULE_FREQUENCY_LABELS,
  SLACK_TASK_DYNAMIC_RECIPIENT_SOURCES,
  SLACK_TASK_TRIGGERS,
  SLACK_TRIGGER_DESCRIPTIONS,
  SLACK_TRIGGER_LABELS,
  createDefaultSlackAutomationWorkflowConfig,
  createDefaultSlackAutomationRecipients,
  getSlackAutomationDispatchTrigger,
  getSlackAutomationSavePropertyIds,
  getSlackAutomationVariableGroups,
  getSlackAutomationVariables,
  inferSlackAutomationContext,
  normalizeSlackAutomationSchedule,
  newSlackAutomationRecipientId,
  normalizeSlackAutomationConfig,
} from '@/lib/slackAutomationConfig';

interface Property {
  id: string;
  name: string;
}

interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
}

interface PreviewResult {
  text: string;
  blocks: unknown[];
  errors: string[];
  recipient_warnings: string[];
}

interface SlackAutomationEditorProps {
  automationId?: string;
}

const DEFAULT_CUSTOM_BLOCKS =
  '[\n  {\n    "type": "section",\n    "text": {\n      "type": "mrkdwn",\n      "text": "{{event_name}}"\n    }\n  }\n]';

const WEEKDAYS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

const CONTEXT_OPTIONS: SlackAutomationContextType[] = [
  'reservation_turnover',
  'task',
  'property',
  'none',
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function newRuleId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function operatorNeedsValue(operator: SlackAutomationConditionOperator): boolean {
  return !['is_empty', 'is_not_empty'].includes(operator);
}

export default function SlackAutomationEditor({
  automationId,
}: SlackAutomationEditorProps) {
  const router = useRouter();
  const isEditing = !!automationId;
  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [trigger, setTrigger] = useState<SlackAutomationTrigger>('new_booking');
  const [config, setConfig] = useState<SlackAutomationConfig>(
    createDefaultSlackAutomationWorkflowConfig('new_booking'),
  );
  const [properties, setProperties] = useState<Property[]>([]);
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [propertySearch, setPropertySearch] = useState('');
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [variableGroupKey, setVariableGroupKey] = useState('event');
  const [variableKey, setVariableKey] = useState('event_name');

  const messageRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const normalized = useMemo(
    () => normalizeSlackAutomationConfig(config, { trigger }),
    [config, trigger],
  );
  const whenType = normalized.when?.type ?? 'event';
  const eventTrigger = normalized.when?.event ?? 'new_booking';
  const contextType =
    normalized.context?.type ?? inferSlackAutomationContext(trigger);
  const schedule = normalized.when?.schedule
    ?? normalizeSlackAutomationSchedule(undefined, contextType);
  const variableGroups = useMemo(
    () => getSlackAutomationVariableGroups(trigger, contextType),
    [trigger, contextType],
  );
  const allVariables = useMemo(
    () => getSlackAutomationVariables(trigger, contextType),
    [trigger, contextType],
  );
  const selectedGroup =
    variableGroups.find((group) => group.key === variableGroupKey) ??
    variableGroups[0];
  const selectedVariable =
    selectedGroup?.variables.find((variable) => variable.key === variableKey) ??
    selectedGroup?.variables[0];
  const propertyScope = normalized.conditions?.property_scope ?? 'all';
  const selectedPropertyIds = normalized.conditions?.property_ids ?? [];
  const recipients = normalized.action?.recipients ?? [];
  const message = normalized.action?.message;
  const attachments = normalized.action?.attachments ?? [];

  useEffect(() => {
    if (!selectedGroup) return;
    if (!selectedGroup.variables.some((variable) => variable.key === variableKey)) {
      setVariableGroupKey(selectedGroup.key);
      setVariableKey(selectedGroup.variables[0]?.key ?? 'event_name');
    }
  }, [selectedGroup, variableKey]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const requests: Promise<Response>[] = [
        fetch('/api/properties'),
        fetch('/api/slack/channels'),
        fetch('/api/users'),
      ];
      if (automationId) {
        requests.push(fetch(`/api/slack-automations/${automationId}`));
      }
      const responses = await Promise.all(requests);
      const [propertiesData, channelsData, usersData, automationData] = await Promise.all(
        responses.map((res) => res.json()),
      );

      if (propertiesData.properties) setProperties(propertiesData.properties);
      if (channelsData.channels) {
        setChannels(channelsData.channels);
        setChannelsError(null);
      } else if (channelsData.error) {
        setChannelsError(channelsData.error);
      }
      if (usersData.data) setUsers(usersData.data);

      if (automationId) {
        const automation = automationData.automation as SlackAutomation | undefined;
        if (!automation) throw new Error(automationData.error ?? 'Automation not found');
        setName(automation.name);
        setEnabled(automation.enabled);
        setTrigger(automation.trigger);
        setConfig(
          normalizeSlackAutomationConfig(automation.config, {
            trigger: automation.trigger,
            property_ids: automation.property_ids ?? [],
          }),
        );
      } else {
        setName('');
        setEnabled(true);
        setTrigger('new_booking');
        setConfig(createDefaultSlackAutomationWorkflowConfig('new_booking'));
      }
    } catch (err) {
      console.error('Error loading Slack automation editor:', err);
      alert(err instanceof Error ? err.message : 'Failed to load Slack automation');
      router.push('/automations');
    } finally {
      setLoading(false);
    }
  }, [automationId, router]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const commitConfig = (
    next: SlackAutomationConfig,
    fallbackTrigger: SlackAutomationTrigger = trigger,
  ) => {
    setPreviewResult(null);
    setPreviewError(null);
    setConfig(normalizeSlackAutomationConfig(next, { trigger: fallbackTrigger }));
  };

  const handleRunTypeChange = (value: string) => {
    const current = normalizeSlackAutomationConfig(config, { trigger });
    if (value === 'schedule') {
      const nextTrigger: SlackAutomationTrigger = 'scheduled';
      setTrigger(nextTrigger);
      const nextContext =
        current.context?.type === 'task' ? 'reservation_turnover' : current.context?.type ?? 'reservation_turnover';
      commitConfig({
        ...current,
        when: {
          type: 'schedule',
          schedule: normalizeSlackAutomationSchedule(current.when?.schedule, nextContext),
        },
        context: { type: nextContext },
        action: {
          ...current.action!,
          recipients: (current.action?.recipients ?? []).filter(
            (recipient) => recipient.type !== 'dynamic_user',
          ),
          message: {
            ...current.action!.message,
            include_task_cards: false,
          },
        },
      }, nextTrigger);
      return;
    }

    const nextTrigger: SlackAutomationTrigger =
      current.when?.event ?? (trigger === 'scheduled' ? 'new_booking' : trigger);
    setTrigger(nextTrigger);
    handleEventTriggerChange(nextTrigger);
  };

  const handleEventTriggerChange = (value: string) => {
    const nextTrigger = value as SlackAutomationEventTrigger;
    setTrigger(nextTrigger);
    const current = normalizeSlackAutomationConfig(config, { trigger: nextTrigger });
    const nextContext = inferSlackAutomationContext(nextTrigger);
    const currentRecipients = current.action?.recipients ?? [];
    const nextRecipients =
      nextTrigger === 'task_assigned'
        ? currentRecipients.length > 0
          ? currentRecipients
          : createDefaultSlackAutomationRecipients(nextTrigger)
        : currentRecipients.filter((recipient) => recipient.type !== 'dynamic_user');
    commitConfig({
      ...current,
      when: { type: 'event', event: nextTrigger },
      context: { type: nextContext },
      action: {
        ...current.action!,
        recipients:
          nextRecipients.length > 0
            ? nextRecipients
            : createDefaultSlackAutomationRecipients(nextTrigger),
        message: {
          ...current.action!.message,
          template:
            current.action?.message?.template ||
            (nextTrigger === 'task_assigned'
              ? '{{actor_name}} assigned you {{task_link}}'
              : ''),
          include_task_cards:
            nextTrigger === 'task_assigned'
              ? trigger === 'task_assigned'
                ? current.action?.message?.include_task_cards ?? true
                : true
              : false,
        },
      },
    }, nextTrigger);
  };

  const updateSchedule = (patch: Partial<SlackAutomationSchedule>) => {
    const current = normalizeSlackAutomationConfig(config, { trigger });
    const nextSchedule = normalizeSlackAutomationSchedule(
      { ...schedule, ...patch },
      contextType,
    );
    commitConfig({
      ...current,
      when: {
        type: 'schedule',
        schedule: nextSchedule,
      },
    }, 'scheduled');
  };

  const updateContext = (value: string) => {
    const nextContext = value as SlackAutomationContextType;
    const current = normalizeSlackAutomationConfig(config, { trigger });
    const filteredRecipients =
      nextContext === 'task' && trigger === 'task_assigned'
        ? current.action?.recipients ?? []
        : (current.action?.recipients ?? []).filter(
            (recipient) => recipient.type !== 'dynamic_user',
          );
    commitConfig({
      ...current,
      context: { type: nextContext },
      when:
        current.when?.type === 'schedule'
          ? {
              type: 'schedule',
              schedule: normalizeSlackAutomationSchedule(
                current.when.schedule,
                nextContext,
              ),
            }
          : current.when,
      action: {
        ...current.action!,
        recipients: filteredRecipients,
      },
    });
  };

  const updatePropertyScope = (scope: SlackAutomationPropertyScope) => {
    const current = normalizeSlackAutomationConfig(config, { trigger });
    commitConfig({
      ...current,
      conditions: {
        ...current.conditions!,
        property_scope: scope,
        property_ids:
          scope === 'selected' ? current.conditions?.property_ids ?? [] : [],
      },
    });
  };

  const setSelectedProperties = (ids: string[]) => {
    const current = normalizeSlackAutomationConfig(config, { trigger });
    commitConfig({
      ...current,
      conditions: {
        ...current.conditions!,
        property_scope: 'selected',
        property_ids: ids,
      },
    });
  };

  const toggleProperty = (id: string) => {
    const next = selectedPropertyIds.includes(id)
      ? selectedPropertyIds.filter((propertyId) => propertyId !== id)
      : [...selectedPropertyIds, id];
    setSelectedProperties(next);
  };

  const addCondition = () => {
    const current = normalizeSlackAutomationConfig(config, { trigger });
    const variable = allVariables[0]?.key ?? 'event_name';
    commitConfig({
      ...current,
      conditions: {
        ...current.conditions!,
        rules: [
          ...(current.conditions?.rules ?? []),
          {
            id: newRuleId(),
            variable,
            operator: 'is_not_empty',
            right: { type: 'literal', value: '' },
            value: '',
          },
        ],
      },
    });
  };

  const updateCondition = (
    id: string,
    patch: Partial<{
      variable: string;
      operator: SlackAutomationConditionOperator;
      value: string;
      right: {
        type: 'literal' | 'variable';
        value?: string;
        variable?: string;
      };
    }>,
  ) => {
    const current = normalizeSlackAutomationConfig(config, { trigger });
    commitConfig({
      ...current,
      conditions: {
        ...current.conditions!,
        rules: (current.conditions?.rules ?? []).map((rule) =>
          rule.id === id ? { ...rule, ...patch } : rule,
        ),
      },
    });
  };

  const removeCondition = (id: string) => {
    const current = normalizeSlackAutomationConfig(config, { trigger });
    commitConfig({
      ...current,
      conditions: {
        ...current.conditions!,
        rules: (current.conditions?.rules ?? []).filter((rule) => rule.id !== id),
      },
    });
  };

  const setRecipients = (nextRecipients: SlackAutomationRecipient[]) => {
    const current = normalizeSlackAutomationConfig(config, { trigger });
    commitConfig({
      ...current,
      action: {
        ...current.action!,
        recipients: nextRecipients,
      },
    });
  };

  const addRecipient = (type: SlackAutomationRecipient['type']) => {
    if (type === 'channel') {
      setRecipients([
        ...recipients,
        {
          id: newSlackAutomationRecipientId(),
          type: 'channel',
          channel_id: '',
          channel_name: '',
        },
      ]);
      return;
    }
    if (type === 'user') {
      setRecipients([
        ...recipients,
        {
          id: newSlackAutomationRecipientId(),
          type: 'user',
          user_id: '',
          user_name: '',
          user_email: null,
        },
      ]);
      return;
    }
    setRecipients([
      ...recipients,
      {
        id: newSlackAutomationRecipientId(),
        type: 'dynamic_user',
        source: 'task_assignee',
      },
    ]);
  };

  const updateRecipient = (
    id: string,
    patch: Partial<SlackAutomationRecipient>,
  ) => {
    setRecipients(
      recipients.map((recipient) =>
        recipient.id === id
          ? ({ ...recipient, ...patch } as SlackAutomationRecipient)
          : recipient,
      ),
    );
  };

  const removeRecipient = (id: string) => {
    setRecipients(recipients.filter((recipient) => recipient.id !== id));
  };

  const updateMessage = (patch: Partial<typeof message>) => {
    const current = normalizeSlackAutomationConfig(config, { trigger });
    commitConfig({
      ...current,
      action: {
        ...current.action!,
        message: {
          ...current.action!.message,
          ...patch,
        },
      },
    });
  };

  const updateAttachments = (nextAttachments: SlackAutomationAttachment[]) => {
    const current = normalizeSlackAutomationConfig(config, { trigger });
    commitConfig({
      ...current,
      action: {
        ...current.action!,
        attachments: nextAttachments,
      },
    });
  };

  const insertVariableByKey = (key: string) => {
    const placeholder = `{{${key}}}`;
    const ta = messageRef.current;
    if (!ta) {
      updateMessage({ template: `${message?.template ?? ''}${placeholder}` });
      return;
    }
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    const next =
      ta.value.slice(0, start) + placeholder + ta.value.slice(end);
    updateMessage({ template: next });
    requestAnimationFrame(() => {
      ta.focus();
      const cursorPos = start + placeholder.length;
      ta.setSelectionRange(cursorPos, cursorPos);
    });
  };

  const insertVariable = () => {
    if (!selectedVariable) return;
    insertVariableByKey(selectedVariable.key);
  };

  const handleChannelChange = (recipientId: string, channelId: string) => {
    const channel = channels.find((c) => c.id === channelId);
    updateRecipient(recipientId, {
      channel_id: channelId,
      channel_name: channel?.name ?? '',
    } as Partial<SlackAutomationRecipient>);
  };

  const handleUserChange = (recipientId: string, userId: string) => {
    const user = users.find((u) => u.id === userId);
    updateRecipient(recipientId, {
      user_id: userId,
      user_name: user?.name ?? '',
      user_email: user?.email ?? null,
    } as Partial<SlackAutomationRecipient>);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAttachment(true);
    setAttachmentError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/slack-automations/attachments', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      updateAttachments([...attachments, data.attachment]);
    } catch (err) {
      console.error('Attachment upload failed:', err);
      setAttachmentError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingAttachment(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (attachment: SlackAutomationAttachment) => {
    updateAttachments(attachments.filter((a) => a.id !== attachment.id));
    fetch(`/api/slack-automations/attachments/${attachment.id}`, {
      method: 'DELETE',
    }).catch((err) => console.warn('Attachment cleanup failed:', err));
  };

  const handlePreview = async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const saveConfig = normalizeSlackAutomationConfig(config, { trigger });
      const res = await fetch('/api/slack-automations/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trigger: getSlackAutomationDispatchTrigger(saveConfig),
          config: saveConfig,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Preview failed');
      setPreviewResult({
        text: data.text ?? '',
        blocks: Array.isArray(data.blocks) ? data.blocks : [],
        errors: Array.isArray(data.errors) ? data.errors : [],
        recipient_warnings: Array.isArray(data.recipient_warnings)
          ? data.recipient_warnings
          : [],
      });
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Preview failed');
      setPreviewResult(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleTest = async () => {
    if (!automationId) return;
    setTesting(true);
    try {
      const res = await fetch(`/api/slack-automations/${automationId}/test`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? data.result?.error ?? 'Test failed');
      alert(data.fired ? 'Test message sent.' : 'Test did not fire.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Test failed.');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    const saveConfig = normalizeSlackAutomationConfig(config, { trigger });
    const payload = {
      name: name.trim(),
      enabled,
      trigger: getSlackAutomationDispatchTrigger(saveConfig),
      property_ids: getSlackAutomationSavePropertyIds(saveConfig),
      config: saveConfig,
    };

    setSaving(true);
    try {
      const res = await fetch(
        automationId
          ? `/api/slack-automations/${automationId}`
          : '/api/slack-automations',
        {
          method: automationId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      const saved = data.automation as SlackAutomation;
      if (!automationId) {
        router.replace(`/automations/slack/${saved.id}`);
      } else {
        setConfig(
          normalizeSlackAutomationConfig(saved.config, {
            trigger: saved.trigger,
            property_ids: saved.property_ids ?? [],
          }),
        );
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save automation');
    } finally {
      setSaving(false);
    }
  };

  const filteredProperties = useMemo(() => {
    const q = propertySearch.trim().toLowerCase();
    if (!q) return properties;
    return properties.filter((property) => property.name.toLowerCase().includes(q));
  }, [properties, propertySearch]);

  const automationSummary = useMemo(() => {
    const run =
      whenType === 'schedule'
        ? `Run ${SLACK_SCHEDULE_FREQUENCY_LABELS[schedule.frequency].toLowerCase()} at ${schedule.time} in the ${schedule.timezone_mode} timezone`
        : `Run when ${SLACK_TRIGGER_LABELS[eventTrigger].toLowerCase()} happens`;
    const conditionCount = normalized.conditions?.rules.length ?? 0;
    const conditions =
      conditionCount > 0
        ? `${conditionCount} rule${conditionCount === 1 ? '' : 's'} must match`
        : 'no extra rules';
    return `${run}. Look at ${SLACK_CONTEXT_LABELS[contextType].toLowerCase()}, then send to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'} when ${conditions}.`;
  }, [
    contextType,
    eventTrigger,
    normalized.conditions?.rules.length,
    recipients.length,
    schedule.frequency,
    schedule.time,
    schedule.timezone_mode,
    whenType,
  ]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-500">
        Loading Slack automation...
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-neutral-50 dark:bg-background">
      <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-card">
        <div className="min-w-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/automations?tab=slack')}
            className="mb-2 px-0"
          >
            Back to automations
          </Button>
          <div className="flex items-center gap-3">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Untitled Slack automation"
              className="h-10 max-w-xl border-0 bg-transparent px-0 text-2xl font-semibold shadow-none focus-visible:ring-0"
            />
            <Badge variant={enabled ? 'secondary' : 'outline'}>
              {enabled ? 'Enabled' : 'Disabled'}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Enabled
          </label>
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={!automationId || testing}
          >
            {testing ? 'Testing...' : 'Test'}
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px] gap-6 overflow-auto p-6">
        <div className="space-y-6">
          <section className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-card">
            <div className="mb-4">
              <h2 className="text-lg font-semibold">Run</h2>
              <p className="text-sm text-neutral-500">Choose what wakes this workflow up.</p>
            </div>
            <div className="space-y-4">
              <Field>
                <FieldLabel>Trigger type</FieldLabel>
                <Select value={whenType} onValueChange={handleRunTypeChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="event">Event</SelectItem>
                    <SelectItem value="schedule">Schedule</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              {whenType === 'event' ? (
                <Field>
                  <FieldLabel>Event</FieldLabel>
                  <Select value={eventTrigger} onValueChange={handleEventTriggerChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <div className="px-2 py-1 text-xs text-neutral-500">Reservation</div>
                      {SLACK_RESERVATION_TRIGGERS.map((event) => (
                        <SelectItem key={event} value={event}>
                          {SLACK_TRIGGER_LABELS[event]}
                        </SelectItem>
                      ))}
                      <div className="px-2 py-1 text-xs text-neutral-500">Task</div>
                      {SLACK_TASK_TRIGGERS.map((event) => (
                        <SelectItem key={event} value={event}>
                          {SLACK_TRIGGER_LABELS[event]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>{SLACK_TRIGGER_DESCRIPTIONS[eventTrigger]}</FieldDescription>
                </Field>
              ) : (
                <div className="grid grid-cols-[1fr_120px_1fr] gap-3">
                  <Field>
                    <FieldLabel>Frequency</FieldLabel>
                    <Select
                      value={schedule.frequency}
                      onValueChange={(value) =>
                        updateSchedule({ frequency: value as SlackAutomationScheduleFrequency })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(SLACK_SCHEDULE_FREQUENCY_LABELS).map(([key, label]) => (
                          <SelectItem key={key} value={key}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel>Every</FieldLabel>
                    <Input
                      type="number"
                      min={1}
                      value={schedule.interval}
                      disabled={schedule.frequency === 'daily'}
                      onChange={(e) =>
                        updateSchedule({ interval: Math.max(1, Number(e.target.value) || 1) })
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Time</FieldLabel>
                    <Input
                      type="time"
                      value={schedule.time}
                      onChange={(e) => updateSchedule({ time: e.target.value })}
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Timezone</FieldLabel>
                    <Select
                      value={schedule.timezone_mode}
                      onValueChange={(value) =>
                        updateSchedule({ timezone_mode: value as SlackAutomationSchedule['timezone_mode'] })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="property">Property timezone</SelectItem>
                        <SelectItem value="company">Company timezone</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  {schedule.frequency === 'weekly' && (
                    <Field>
                      <FieldLabel>Weekdays</FieldLabel>
                      <div className="flex flex-wrap gap-2">
                        {WEEKDAYS.map((day) => (
                          <label key={day.value} className="flex items-center gap-1 text-sm">
                            <input
                              type="checkbox"
                              checked={schedule.weekdays.includes(day.value)}
                              onChange={(e) => {
                                const weekdays = e.target.checked
                                  ? [...schedule.weekdays, day.value]
                                  : schedule.weekdays.filter((value) => value !== day.value);
                                updateSchedule({ weekdays });
                              }}
                            />
                            {day.label}
                          </label>
                        ))}
                      </div>
                    </Field>
                  )}
                  {schedule.frequency === 'monthly' && (
                    <Field>
                      <FieldLabel>Month days</FieldLabel>
                      <Input
                        value={schedule.month_days.join(', ')}
                        onChange={(e) =>
                          updateSchedule({
                            month_days: e.target.value
                              .split(',')
                              .map((value) => Number(value.trim()))
                              .filter((value) => value >= 1 && value <= 31),
                          })
                        }
                        placeholder="1, 15, 31"
                      />
                    </Field>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-card">
            <div className="mb-4">
              <h2 className="text-lg font-semibold">Look At</h2>
              <p className="text-sm text-neutral-500">Choose which records provide variables for this workflow.</p>
            </div>
            <Field>
              <FieldLabel>Context</FieldLabel>
              <Select
                value={contextType}
                onValueChange={updateContext}
                disabled={whenType === 'event'}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTEXT_OPTIONS.map((context) => (
                    <SelectItem key={context} value={context}>
                      {SLACK_CONTEXT_LABELS[context]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {whenType === 'event' && (
                <FieldDescription>
                  Event automations use the context provided by the event.
                </FieldDescription>
              )}
            </Field>
          </section>

          <section className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-card">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">Only When</h2>
                <p className="text-sm text-neutral-500">Limit when this workflow is allowed to send.</p>
              </div>
              <Button variant="outline" size="sm" onClick={addCondition}>
                Add Condition
              </Button>
            </div>

            <div className="space-y-5">
              <Field>
                <FieldLabel>Property scope</FieldLabel>
                <Select value={propertyScope} onValueChange={(value) => updatePropertyScope(value as SlackAutomationPropertyScope)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All properties</SelectItem>
                    <SelectItem value="selected">Selected properties</SelectItem>
                    <SelectItem value="none">No property</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              {propertyScope === 'selected' && (
                <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                  <div className="mb-3 flex items-center gap-2">
                    <Input
                      value={propertySearch}
                      onChange={(e) => setPropertySearch(e.target.value)}
                      placeholder="Search properties..."
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedProperties(properties.map((property) => property.id))}
                    >
                      Select All
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedProperties([])}
                    >
                      Clear All
                    </Button>
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    {filteredProperties.map((property) => (
                      <label
                        key={property.id}
                        className="flex cursor-pointer items-center gap-3 rounded px-2 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                      >
                        <input
                          type="checkbox"
                          checked={selectedPropertyIds.includes(property.id)}
                          onChange={() => toggleProperty(property.id)}
                        />
                        <span className="text-sm">{property.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {(normalized.conditions?.rules ?? []).length > 0 && (
                <div className="space-y-3">
                  {(normalized.conditions?.rules ?? []).map((rule) => (
                    <div
                      key={rule.id}
                      className="grid grid-cols-[minmax(0,1.2fr)_160px_140px_minmax(0,1fr)_auto] gap-2"
                    >
                      <Select
                        value={rule.variable}
                        onValueChange={(value) => updateCondition(rule.id, { variable: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {allVariables.map((variable) => (
                            <SelectItem key={variable.key} value={variable.key}>
                              {variable.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={rule.operator}
                        onValueChange={(value) =>
                          updateCondition(rule.id, {
                            operator: value as SlackAutomationConditionOperator,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(SLACK_CONDITION_OPERATOR_LABELS).map(([key, label]) => (
                            <SelectItem key={key} value={key}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={rule.right?.type ?? 'literal'}
                        disabled={!operatorNeedsValue(rule.operator)}
                        onValueChange={(value) =>
                          updateCondition(rule.id, {
                            right:
                              value === 'variable'
                                ? {
                                    type: 'variable',
                                    variable: allVariables[0]?.key ?? 'event_name',
                                  }
                                : { type: 'literal', value: rule.value ?? '' },
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="literal">Value</SelectItem>
                          <SelectItem value="variable">Variable</SelectItem>
                        </SelectContent>
                      </Select>
                      {rule.right?.type === 'variable' ? (
                        <Select
                          value={rule.right.variable ?? allVariables[0]?.key ?? 'event_name'}
                          disabled={!operatorNeedsValue(rule.operator)}
                          onValueChange={(value) =>
                            updateCondition(rule.id, {
                              right: {
                                type: 'variable',
                                variable: value,
                              },
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {allVariables.map((variable) => (
                              <SelectItem key={variable.key} value={variable.key}>
                                {variable.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          value={rule.right?.value ?? rule.value}
                          disabled={!operatorNeedsValue(rule.operator)}
                          onChange={(e) =>
                            updateCondition(rule.id, {
                              value: e.target.value,
                              right: {
                                type: 'literal',
                                value: e.target.value,
                              },
                            })
                          }
                          placeholder={operatorNeedsValue(rule.operator) ? 'Value' : 'No value needed'}
                        />
                      )}
                      <Button variant="ghost" onClick={() => removeCondition(rule.id)}>
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-card">
            <div className="mb-4">
              <h2 className="text-lg font-semibold">Send</h2>
              <p className="text-sm text-neutral-500">Configure the Slack recipients and message.</p>
            </div>

            <div className="space-y-5">
              <Field>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <FieldLabel>Recipients</FieldLabel>
                    <FieldDescription>
                      Send to one or more Slack channels, specific users, or event users.
                    </FieldDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => addRecipient('channel')}
                    >
                      + Channel
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => addRecipient('user')}
                    >
                      + User
                    </Button>
                    {trigger === 'task_assigned' && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => addRecipient('dynamic_user')}
                      >
                        + Dynamic
                      </Button>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  {recipients.length === 0 && (
                    <div className="rounded-md border border-dashed border-neutral-300 p-3 text-sm text-neutral-500 dark:border-neutral-700">
                      Add at least one recipient. If none can be resolved at runtime, the automation will skip without sending.
                    </div>
                  )}

                  {recipients.map((recipient) => (
                    <div
                      key={recipient.id}
                      className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800"
                    >
                      <div className="grid grid-cols-[150px_minmax(0,1fr)_auto] items-start gap-2">
                        <Select value={recipient.type} disabled>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="channel">Channel</SelectItem>
                            <SelectItem value="user">User DM</SelectItem>
                            <SelectItem value="dynamic_user">Dynamic user</SelectItem>
                          </SelectContent>
                        </Select>

                        {recipient.type === 'channel' && (
                          <div>
                            {channelsError ? (
                              <p className="text-sm text-red-600">{channelsError}</p>
                            ) : (
                              <Select
                                value={recipient.channel_id}
                                onValueChange={(value) =>
                                  handleChannelChange(recipient.id, value)
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Choose a channel..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {channels.map((channel) => (
                                    <SelectItem key={channel.id} value={channel.id}>
                                      {channel.is_private ? 'Private' : '#'} {channel.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                            {channels.find((channel) => channel.id === recipient.channel_id) &&
                              !channels.find((channel) => channel.id === recipient.channel_id)
                                ?.is_member && (
                                <FieldDescription className="text-amber-600">
                                  The bot is not a member of this channel.
                                </FieldDescription>
                              )}
                          </div>
                        )}

                        {recipient.type === 'user' && (
                          <Select
                            value={recipient.user_id}
                            onValueChange={(value) => handleUserChange(recipient.id, value)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Choose a user..." />
                            </SelectTrigger>
                            <SelectContent>
                              {users.map((user) => (
                                <SelectItem key={user.id} value={user.id}>
                                  {user.name || user.email || user.id}
                                  {user.email ? ` (${user.email})` : ''}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}

                        {recipient.type === 'dynamic_user' && (
                          <Select
                            value={recipient.source}
                            onValueChange={(value) =>
                              updateRecipient(recipient.id, {
                                source: value as SlackAutomationDynamicRecipientSource,
                              } as Partial<SlackAutomationRecipient>)
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {SLACK_TASK_DYNAMIC_RECIPIENT_SOURCES.map((source) => (
                                <SelectItem key={source} value={source}>
                                  {SLACK_DYNAMIC_RECIPIENT_LABELS[source]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}

                        <Button
                          type="button"
                          variant="ghost"
                          className="text-red-600"
                          onClick={() => removeRecipient(recipient.id)}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </Field>

              <Field>
                <div className="mb-2 flex items-end gap-2">
                  <div className="flex-1">
                    <FieldLabel>Insert variable</FieldLabel>
                    <div className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2">
                      <Select value={variableGroupKey} onValueChange={setVariableGroupKey}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {variableGroups.map((group) => (
                            <SelectItem key={group.key} value={group.key}>
                              {group.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={selectedVariable?.key ?? ''}
                        onValueChange={setVariableKey}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(selectedGroup?.variables ?? []).map((variable) => (
                            <SelectItem key={variable.key} value={variable.key}>
                              {variable.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button type="button" variant="outline" onClick={insertVariable}>
                        Insert
                      </Button>
                    </div>
                  </div>
                </div>
                <Textarea
                  ref={messageRef}
                  value={message?.template ?? ''}
                  onChange={(e) => updateMessage({ template: e.target.value })}
                  placeholder={
                    trigger === 'task_assigned'
                      ? '{{actor_name}} assigned you {{task_link}}'
                      : 'New booking at {{property_name}}'
                  }
                  rows={7}
                  className="font-mono text-sm"
                />
              </Field>

              {trigger === 'task_assigned' && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!message?.include_task_cards}
                    onChange={(e) =>
                      updateMessage({ include_task_cards: e.target.checked })
                    }
                  />
                  Include task card when task context is available
                </label>
              )}

              <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={!!message?.use_custom_blocks}
                    onChange={(e) =>
                      updateMessage({
                        use_custom_blocks: e.target.checked,
                        custom_blocks_json:
                          message?.custom_blocks_json || DEFAULT_CUSTOM_BLOCKS,
                      })
                    }
                  />
                  Advanced Block Kit JSON
                </label>
                {message?.use_custom_blocks && (
                  <Textarea
                    value={message.custom_blocks_json}
                    onChange={(e) =>
                      updateMessage({ custom_blocks_json: e.target.value })
                    }
                    rows={9}
                    className="mt-3 font-mono text-xs"
                  />
                )}
              </div>

              <Field>
                <FieldLabel>Attachments</FieldLabel>
                {attachments.length > 0 && (
                  <div className="mb-3 space-y-2">
                    {attachments.map((attachment) => (
                      <div
                        key={attachment.id}
                        className="flex items-center justify-between rounded-md border border-neutral-200 p-2 dark:border-neutral-800"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{attachment.name}</p>
                          <p className="text-xs text-neutral-500">
                            {formatBytes(attachment.size_bytes)}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600"
                          onClick={() => removeAttachment(attachment)}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingAttachment}
                >
                  {uploadingAttachment ? 'Uploading...' : '+ Add Attachment'}
                </Button>
                {attachmentError && (
                  <p className="mt-2 text-sm text-red-600">{attachmentError}</p>
                )}
              </Field>
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-card">
            <h2 className="mb-2 font-semibold">Summary</h2>
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              {automationSummary}
            </p>
          </section>

          <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-card">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Preview</h2>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handlePreview}
                disabled={previewLoading}
              >
                {previewLoading ? 'Rendering...' : 'Render'}
              </Button>
            </div>
            {previewError && (
              <p className="mb-2 text-sm text-red-600">{previewError}</p>
            )}
            {previewResult ? (
              <div className="space-y-2">
                {previewResult.errors.length > 0 && (
                  <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
                    {previewResult.errors.join(' ')}
                  </div>
                )}
                {previewResult.recipient_warnings.length > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
                    {previewResult.recipient_warnings.join(' ')}
                  </div>
                )}
                <pre className="max-h-96 overflow-auto rounded-md bg-neutral-950 p-3 text-xs text-neutral-50">
                  {JSON.stringify(
                    {
                      text: previewResult.text,
                      blocks: previewResult.blocks,
                      recipient_warnings: previewResult.recipient_warnings,
                    },
                    null,
                    2,
                  )}
                </pre>
              </div>
            ) : (
              <p className="text-sm text-neutral-500">
                Render a sample event to check variables, blocks, and Slack link validation.
              </p>
            )}
          </section>

          <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-card">
            <h2 className="mb-3 font-semibold">Variables</h2>
            <div className="space-y-3">
              {variableGroups.map((group) => (
                <div key={group.key}>
                  <p className="mb-1 text-xs font-medium uppercase text-neutral-500">
                    {group.label}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {group.variables.map((variable) => (
                      <button
                        key={variable.key}
                        type="button"
                        className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
                        title={variable.description}
                        onClick={() => {
                          setVariableGroupKey(group.key);
                          setVariableKey(variable.key);
                          requestAnimationFrame(() => insertVariableByKey(variable.key));
                        }}
                      >
                        {`{{${variable.key}}}`}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
