'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  type SlackAutomation,
  type SlackAutomationTrigger,
  type SlackAutomationConfig,
  type SlackAutomationAttachment,
  type SlackAutomationDeliveryType,
  type SlackAutomationMessageFormat,
  createDefaultSlackAutomationConfig,
  SLACK_RESERVATION_AUTOMATION_VARIABLES,
  SLACK_TASK_ASSIGNMENT_AUTOMATION_VARIABLES,
} from '@/lib/types';

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

const TRIGGER_LABELS: Record<SlackAutomationTrigger, string> = {
  new_booking: 'New Booking',
  check_in: 'Check-in',
  check_out: 'Check-out',
  task_assigned: 'Task Assigned',
};

const TRIGGER_DESCRIPTIONS: Record<SlackAutomationTrigger, string> = {
  new_booking: 'Fires when a new reservation is created for the property',
  check_in: 'Fires on the check-in date for a reservation',
  check_out: 'Fires on the check-out date for a reservation',
  task_assigned: 'Fires when a user is newly assigned to a task',
};

const RESERVATION_TRIGGERS: SlackAutomationTrigger[] = [
  'new_booking',
  'check_in',
  'check_out',
];
const TASK_TRIGGERS: SlackAutomationTrigger[] = ['task_assigned'];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function createConfigForTrigger(
  trigger: SlackAutomationTrigger,
): SlackAutomationConfig {
  return {
    ...createDefaultSlackAutomationConfig(),
    delivery_type: trigger === 'task_assigned' ? 'task_assignee_dm' : 'channel',
    message_format: 'text',
    custom_blocks_json: '',
    message_template:
      trigger === 'task_assigned'
        ? '{{actor_name}} assigned you {{task_link}}'
        : '',
  };
}

export default function SlackAutomationsView() {
  const [automations, setAutomations] = useState<SlackAutomation[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Create/Edit dialog state
  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState<SlackAutomationTrigger>('new_booking');
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>([]);
  const [config, setConfig] = useState<SlackAutomationConfig>(createDefaultSlackAutomationConfig());
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<{
    text: string;
    blocks: unknown[];
    errors: string[];
  } | null>(null);

  const messageRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [automationsRes, propertiesRes, channelsRes] = await Promise.all([
        fetch('/api/slack-automations'),
        fetch('/api/properties'),
        fetch('/api/slack/channels'),
      ]);
      const [automationsData, propertiesData, channelsData] = await Promise.all([
        automationsRes.json(),
        propertiesRes.json(),
        channelsRes.json(),
      ]);
      if (automationsData.automations) setAutomations(automationsData.automations);
      if (propertiesData.properties) setProperties(propertiesData.properties);
      if (channelsData.channels) {
        setChannels(channelsData.channels);
        setChannelsError(null);
      } else if (channelsData.error) {
        setChannelsError(channelsData.error);
      }
    } catch (err) {
      console.error('Error fetching slack automations:', err);
    } finally {
      setLoading(false);
    }
  };

  const openCreateDialog = () => {
    setEditingId(null);
    setName('');
    setTrigger('new_booking');
    setSelectedPropertyIds([]);
    setConfig(createConfigForTrigger('new_booking'));
    setAttachmentError(null);
    setPreviewError(null);
    setPreviewResult(null);
    setShowDialog(true);
  };

  const openEditDialog = (automation: SlackAutomation) => {
    setEditingId(automation.id);
    setName(automation.name);
    setTrigger(automation.trigger);
    setSelectedPropertyIds(automation.property_ids ?? []);
    setConfig({
      ...createConfigForTrigger(automation.trigger),
      ...(automation.config ?? {}),
    });
    setAttachmentError(null);
    setPreviewError(null);
    setPreviewResult(null);
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        trigger,
        property_ids: selectedPropertyIds,
        config,
        enabled: true,
      };

      const url = editingId
        ? `/api/slack-automations/${editingId}`
        : '/api/slack-automations';
      const method = editingId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to save');
      }

      await fetchData();
      setShowDialog(false);
    } catch (err) {
      console.error('Error saving slack automation:', err);
      alert(err instanceof Error ? err.message : 'Failed to save automation');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (automation: SlackAutomation) => {
    try {
      const res = await fetch(`/api/slack-automations/${automation.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !automation.enabled }),
      });
      if (!res.ok) throw new Error('Failed to toggle');
      await fetchData();
    } catch (err) {
      console.error('Error toggling automation:', err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this Slack automation?')) return;
    try {
      const res = await fetch(`/api/slack-automations/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      await fetchData();
    } catch (err) {
      console.error('Error deleting automation:', err);
    }
  };

  const handleTest = async (id: string) => {
    try {
      const res = await fetch(`/api/slack-automations/${id}/test`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`Test failed: ${data.error ?? data.result?.error ?? 'Unknown error'}`);
        return;
      }
      if (data.fired) {
        if (data.used_task) {
          alert(
            `Test message sent!\n\nUsed task:\n  ${data.used_task.title ?? '(untitled)'}\nRecipient: ${data.used_recipient?.name ?? data.used_recipient?.email ?? '(sample user)'}`,
          );
        } else {
          const sample = data.used_reservation;
          alert(
            `Test message sent!\n\nUsed reservation:\n  ${sample?.property_name ?? '(none)'} \u2014 ${sample?.guest_name ?? '(none)'}\n  ${sample?.check_in ?? ''} \u2192 ${sample?.check_out ?? ''}`,
          );
        }
      } else {
        const errorMsg = data.result?.error ?? data.result?.skipped_reason ?? 'Unknown reason';
        alert(`Test did not fire: ${errorMsg}`);
      }
    } catch (err) {
      console.error('Test failed:', err);
      alert('Test failed. Check console for details.');
    }
  };

  const toggleProperty = (propertyId: string) => {
    setSelectedPropertyIds((prev) =>
      prev.includes(propertyId)
        ? prev.filter((id) => id !== propertyId)
        : [...prev, propertyId],
    );
  };

  // Insert a {{variable}} at the current cursor position in the message textarea.
  const insertVariable = (key: string) => {
    const placeholder = `{{${key}}}`;
    const ta = messageRef.current;
    if (!ta) {
      setConfig((prev) => ({
        ...prev,
        message_template: prev.message_template + placeholder,
      }));
      return;
    }
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    const next =
      ta.value.slice(0, start) + placeholder + ta.value.slice(end);
    setConfig((prev) => ({ ...prev, message_template: next }));
    requestAnimationFrame(() => {
      ta.focus();
      const cursorPos = start + placeholder.length;
      ta.setSelectionRange(cursorPos, cursorPos);
    });
  };

  const handleChannelChange = (channelId: string) => {
    const channel = channels.find((c) => c.id === channelId);
    setConfig((prev) => ({
      ...prev,
      channel_id: channelId,
      channel_name: channel?.name ?? '',
    }));
  };

  const handleTriggerChange = (value: string) => {
    const nextTrigger = value as SlackAutomationTrigger;
    const wasTaskTrigger = trigger === 'task_assigned';
    setTrigger(nextTrigger);
    setPreviewError(null);
    setPreviewResult(null);
    setConfig((prev) => ({
      ...prev,
      delivery_type:
        nextTrigger === 'task_assigned'
          ? wasTaskTrigger
            ? prev.delivery_type ?? 'task_assignee_dm'
            : 'task_assignee_dm'
          : 'channel',
      message_format:
        nextTrigger === 'task_assigned'
          ? prev.message_format ?? 'text'
          : prev.message_format === 'task_card'
            ? 'text'
            : prev.message_format ?? 'text',
      message_template:
        prev.message_template ||
        createConfigForTrigger(nextTrigger).message_template,
    }));
  };

  const handleDeliveryTypeChange = (value: string) => {
    setConfig((prev) => ({
      ...prev,
      delivery_type: value as SlackAutomationDeliveryType,
    }));
  };

  const handleMessageFormatChange = (value: string) => {
    const messageFormat = value as SlackAutomationMessageFormat;
    setPreviewError(null);
    setPreviewResult(null);
    setConfig((prev) => ({
      ...prev,
      message_format: messageFormat,
      custom_blocks_json:
        messageFormat === 'custom_blocks' && !prev.custom_blocks_json
          ? '[\n  {\n    "type": "section",\n    "text": {\n      "type": "mrkdwn",\n      "text": "{{task_link}}"\n    }\n  }\n]'
          : prev.custom_blocks_json ?? '',
    }));
  };

  const handlePreview = async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await fetch('/api/slack-automations/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger, config }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Preview failed');
      }
      setPreviewResult({
        text: data.text ?? '',
        blocks: Array.isArray(data.blocks) ? data.blocks : [],
        errors: Array.isArray(data.errors) ? data.errors : [],
      });
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Preview failed');
      setPreviewResult(null);
    } finally {
      setPreviewLoading(false);
    }
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
      const attachment: SlackAutomationAttachment = data.attachment;
      setConfig((prev) => ({
        ...prev,
        attachments: [...(prev.attachments ?? []), attachment],
      }));
    } catch (err) {
      console.error('Attachment upload failed:', err);
      setAttachmentError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingAttachment(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeAttachment = async (attachment: SlackAutomationAttachment) => {
    setConfig((prev) => ({
      ...prev,
      attachments: (prev.attachments ?? []).filter((a) => a.id !== attachment.id),
    }));
    // Best-effort cleanup of the storage object. We don't block on this —
    // if it fails, the attachment becomes orphaned but the user's UX is
    // unaffected. A future janitor could sweep these up.
    fetch(`/api/slack-automations/attachments/${attachment.id}`, {
      method: 'DELETE',
    }).catch((err) => console.warn('Attachment cleanup failed:', err));
  };

  const getPropertyNames = (ids: string[]): string => {
    if (!ids || ids.length === 0) return 'All properties';
    const names = ids
      .map((id) => properties.find((p) => p.id === id)?.name)
      .filter(Boolean);
    if (names.length <= 2) return names.join(', ');
    return `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
  };

  const selectedChannel = useMemo(
    () => channels.find((c) => c.id === config.channel_id),
    [channels, config.channel_id],
  );
  const deliveryType = config.delivery_type ?? 'channel';
  const usesChannel = deliveryType === 'channel';
  const messageFormat = config.message_format ?? 'text';
  const attachments = config.attachments ?? [];

  if (loading) {
    return (
      <div className="text-center py-12 text-neutral-500">
        Loading Slack automations...
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <p className="text-sm text-neutral-500 mt-1">
            Send Slack notifications when reservation or task events occur.
          </p>
        </div>
        <Button onClick={openCreateDialog}>+ New Slack Automation</Button>
      </div>

      {automations.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-neutral-200 dark:border-neutral-700 rounded-lg">
          <div className="mb-3">
            <svg className="w-10 h-10 mx-auto text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <p className="text-neutral-500 font-medium">No Slack automations configured</p>
          <p className="text-sm text-neutral-400 mt-1">
            Create one to send notifications to Slack when reservations are booked, check in, or check out.
          </p>
          <Button onClick={openCreateDialog} className="mt-4">
            Create Your First Automation
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {automations.map((automation) => {
            const channel = channels.find((c) => c.id === automation.config?.channel_id);
            const channelDisplay = channel?.name ?? automation.config?.channel_name ?? '';
            return (
              <Card
                key={automation.id}
                className={`cursor-pointer hover:border-neutral-400 dark:hover:border-neutral-500 transition-colors ${
                  !automation.enabled ? 'opacity-60' : ''
                }`}
                onClick={() => openEditDialog(automation)}
              >
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2 truncate">
                      {automation.name}
                      <Badge
                        variant="secondary"
                        className="bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border-neutral-300 dark:border-neutral-600"
                      >
                        {TRIGGER_LABELS[automation.trigger] ?? automation.trigger}
                      </Badge>
                      {channelDisplay && (
                        <Badge variant="outline" className="text-xs">
                          #{channelDisplay}
                        </Badge>
                      )}
                      {!automation.enabled && (
                        <Badge variant="outline" className="text-xs text-neutral-400">
                          Disabled
                        </Badge>
                      )}
                    </CardTitle>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-neutral-500">
                        {getPropertyNames(automation.property_ids)}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTest(automation.id);
                        }}
                        disabled={
                          ((automation.config?.delivery_type ?? 'channel') === 'channel' &&
                            !automation.config?.channel_id)
                        }
                        title={
                          (automation.config?.delivery_type ?? 'channel') === 'channel' &&
                                !automation.config?.channel_id
                            ? 'Configure a channel first'
                            : 'Send a test message to Slack now'
                        }
                      >
                        Test
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggle(automation);
                        }}
                      >
                        {automation.enabled ? 'Disable' : 'Enable'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(automation.id);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                  {automation.config?.message_template && (
                    <p className="text-sm text-neutral-500 mt-1 line-clamp-1">
                      {automation.config.message_template}
                    </p>
                  )}
                  {(automation.config?.attachments?.length ?? 0) > 0 && (
                    <p className="text-xs text-neutral-400 mt-1">
                      {automation.config.attachments.length} attachment
                      {automation.config.attachments.length !== 1 ? 's' : ''}
                    </p>
                  )}
                </CardHeader>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent
          className="max-w-2xl max-h-[85vh] overflow-y-auto"
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>
              {editingId ? 'Edit Slack Automation' : 'New Slack Automation'}
            </DialogTitle>
            <DialogDescription>
              Configure a Slack notification that fires on reservation events.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Name */}
            <Field>
              <FieldLabel>Automation Name</FieldLabel>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. HOA Forms Notification"
              />
            </Field>

            {/* Trigger */}
            <Field>
              <FieldLabel>Trigger Event</FieldLabel>
              <Select value={trigger} onValueChange={handleTriggerChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <div className="px-2 py-1 text-xs text-neutral-500">Reservation</div>
                  {RESERVATION_TRIGGERS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TRIGGER_LABELS[t]}
                    </SelectItem>
                  ))}
                  <div className="px-2 py-1 text-xs text-neutral-500">Task</div>
                  {TASK_TRIGGERS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TRIGGER_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>{TRIGGER_DESCRIPTIONS[trigger]}</FieldDescription>
            </Field>

            {/* Properties */}
            <Field>
              <FieldLabel>Properties</FieldLabel>
              <FieldDescription className="mb-2">
                Select which properties this automation applies to. Leave empty for all properties.
              </FieldDescription>
              <div className="border border-neutral-200 dark:border-neutral-700 rounded-lg max-h-48 overflow-y-auto">
                {properties.length === 0 ? (
                  <p className="p-3 text-sm text-neutral-500">No properties found.</p>
                ) : (
                  properties.map((property) => (
                    <label
                      key={property.id}
                      className="flex items-center gap-3 px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedPropertyIds.includes(property.id)}
                        onChange={() => toggleProperty(property.id)}
                        className="w-4 h-4 rounded border-neutral-300"
                      />
                      <span className="text-sm">{property.name}</span>
                    </label>
                  ))
                )}
              </div>
              {selectedPropertyIds.length > 0 && (
                <p className="text-xs text-neutral-500 mt-1">
                  {selectedPropertyIds.length} propert{selectedPropertyIds.length === 1 ? 'y' : 'ies'} selected
                </p>
              )}
            </Field>

            {/* Slack Channel — picker from conversations.list */}
            <Field>
              <FieldLabel>Delivery</FieldLabel>
              {trigger === 'task_assigned' ? (
                <>
                  <Select value={deliveryType} onValueChange={handleDeliveryTypeChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="task_assignee_dm">
                        DM newly assigned user
                      </SelectItem>
                      <SelectItem value="channel">Post to channel</SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    Task assignment automations can DM the assigned person through
                    their Slack identity or post to a shared channel.
                  </FieldDescription>
                </>
              ) : (
                <>
                  <Select value="channel" disabled>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="channel">Post to channel</SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    DM delivery is available for Task Assigned automations.
                  </FieldDescription>
                </>
              )}
            </Field>

            {usesChannel && (
            <Field>
              <FieldLabel>Slack Channel</FieldLabel>
              {channelsError ? (
                <div className="text-sm text-red-600 dark:text-red-400">
                  Could not load channels: {channelsError}
                </div>
              ) : (
                <>
                  <Select value={config.channel_id} onValueChange={handleChannelChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a channel..." />
                    </SelectTrigger>
                    <SelectContent>
                      {channels.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="flex items-center gap-2">
                            <span>
                              {c.is_private ? '\uD83D\uDD12' : '#'} {c.name}
                            </span>
                            {!c.is_member && !c.is_private && (
                              <Badge variant="outline" className="text-[10px] py-0">
                                bot not in channel
                              </Badge>
                            )}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedChannel && !selectedChannel.is_member && (
                    <FieldDescription className="text-amber-600">
                      The bot is not a member of this channel. Either invite the bot
                      ({selectedChannel.is_private
                        ? 'required for private channels'
                        : 'or rely on chat:write.public scope'}
                      ) or pick a channel it has joined.
                    </FieldDescription>
                  )}
                </>
              )}
            </Field>
            )}

            {/* Message Template — with variable inserter */}
            <Field>
              <FieldLabel>Message Format</FieldLabel>
              <Select value={messageFormat} onValueChange={handleMessageFormatChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Text</SelectItem>
                  {trigger === 'task_assigned' && (
                    <SelectItem value="task_card">Task card</SelectItem>
                  )}
                  <SelectItem value="custom_blocks">Custom blocks</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>
                Text keeps the current simple Slack message. Task card and
                custom blocks use Block Kit with the message as fallback text.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel>Message</FieldLabel>
              <FieldDescription className="mb-2">
                Use the variables below to insert event data. Slack
                formatting (*bold*, _italic_) is supported.
              </FieldDescription>

              {/* Variable picker bar */}
              <div className="space-y-2 mb-2">
                <div className="flex flex-wrap gap-1">
                  <span className="text-xs text-neutral-500 self-center mr-1">
                    Reservation:
                  </span>
                  {SLACK_RESERVATION_AUTOMATION_VARIABLES.map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      onClick={() => insertVariable(v.key)}
                      title={v.description}
                      className="text-xs px-2 py-1 rounded border border-neutral-300 dark:border-neutral-600 bg-neutral-50 dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
                    >
                      {`{{${v.key}}}`}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1">
                  <span className="text-xs text-neutral-500 self-center mr-1">
                    Task:
                  </span>
                  {SLACK_TASK_ASSIGNMENT_AUTOMATION_VARIABLES.map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      onClick={() => insertVariable(v.key)}
                      title={v.description}
                      className="text-xs px-2 py-1 rounded border border-neutral-300 dark:border-neutral-600 bg-neutral-50 dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
                    >
                      {`{{${v.key}}}`}
                    </button>
                  ))}
                </div>
              </div>

              <Textarea
                ref={messageRef}
                value={config.message_template}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, message_template: e.target.value }))
                }
                placeholder={
                  trigger === 'task_assigned'
                    ? `e.g. {{actor_name}} assigned you {{task_link}}`
                    : `e.g. New booking at {{property_name}}\nGuest: {{guest_name}}\nDates: {{check_in}} -> {{check_out}}`
                }
                rows={5}
                className="font-mono text-sm"
              />
            </Field>

            {/* Attachments */}
            {messageFormat === 'custom_blocks' && (
              <Field>
                <FieldLabel>Custom Blocks JSON</FieldLabel>
                <FieldDescription className="mb-2">
                  Paste a Slack blocks array. String values can use the same
                  variables as the message field.
                </FieldDescription>
                <Textarea
                  value={config.custom_blocks_json ?? ''}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      custom_blocks_json: e.target.value,
                    }))
                  }
                  rows={10}
                  className="font-mono text-xs"
                />
              </Field>
            )}

            <Field>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <FieldLabel>Preview</FieldLabel>
                  <FieldDescription>
                    Renders against a sample reservation or task before you save.
                  </FieldDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handlePreview}
                  disabled={previewLoading}
                >
                  {previewLoading ? 'Rendering...' : 'Render Preview'}
                </Button>
              </div>
              {previewError && (
                <p className="text-sm text-red-600 dark:text-red-400 mt-2">
                  {previewError}
                </p>
              )}
              {previewResult && (
                <div className="mt-3 space-y-2">
                  {previewResult.errors.length > 0 && (
                    <div className="rounded-md border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20 p-3 text-sm text-red-700 dark:text-red-300">
                      {previewResult.errors.join(' ')}
                    </div>
                  )}
                  <pre className="max-h-64 overflow-auto rounded-md border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 p-3 text-xs">
                    {JSON.stringify(
                      {
                        text: previewResult.text,
                        blocks: previewResult.blocks,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </div>
              )}
            </Field>

            <Field>
              <FieldLabel>Attachments</FieldLabel>
              <FieldDescription className="mb-2">
                Files to attach when this automation fires (PDFs, images, docs — up to 25MB each).
              </FieldDescription>

              {attachments.length > 0 && (
                <div className="space-y-2 mb-3">
                  {attachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="flex items-center justify-between p-2 border border-neutral-200 dark:border-neutral-700 rounded-lg"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <svg
                          className="w-5 h-5 text-neutral-400 shrink-0"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                          />
                        </svg>
                        <div className="min-w-0">
                          <a
                            href={attachment.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium truncate hover:underline block"
                          >
                            {attachment.name}
                          </a>
                          <p className="text-xs text-neutral-500">
                            {formatBytes(attachment.size_bytes)}
                            {attachment.mime_type ? ` \u00b7 ${attachment.mime_type}` : ''}
                          </p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
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
                <p className="text-sm text-red-600 dark:text-red-400 mt-2">
                  {attachmentError}
                </p>
              )}
            </Field>
          </div>

          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !name.trim() || (usesChannel && !config.channel_id)}
            >
              {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Automation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
