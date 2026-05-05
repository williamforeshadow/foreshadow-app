'use client';

import { useState, useEffect } from 'react';
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
  createDefaultSlackAutomationConfig,
} from '@/lib/types';

interface Property {
  id: string;
  name: string;
}

const TRIGGER_LABELS: Record<SlackAutomationTrigger, string> = {
  new_booking: 'New Booking',
  check_in: 'Check-in',
  check_out: 'Check-out',
};

const TRIGGER_DESCRIPTIONS: Record<SlackAutomationTrigger, string> = {
  new_booking: 'Fires when a new reservation is created for the property',
  check_in: 'Fires on the check-in date for a reservation',
  check_out: 'Fires on the check-out date for a reservation',
};

export default function SlackAutomationsView() {
  const [automations, setAutomations] = useState<SlackAutomation[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Create/Edit dialog state
  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState<SlackAutomationTrigger>('new_booking');
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>([]);
  const [config, setConfig] = useState<SlackAutomationConfig>(createDefaultSlackAutomationConfig());

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [automationsRes, propertiesRes] = await Promise.all([
        fetch('/api/slack-automations'),
        fetch('/api/properties'),
      ]);
      const [automationsData, propertiesData] = await Promise.all([
        automationsRes.json(),
        propertiesRes.json(),
      ]);
      if (automationsData.automations) setAutomations(automationsData.automations);
      if (propertiesData.properties) setProperties(propertiesData.properties);
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
    setConfig(createDefaultSlackAutomationConfig());
    setShowDialog(true);
  };

  const openEditDialog = (automation: SlackAutomation) => {
    setEditingId(automation.id);
    setName(automation.name);
    setTrigger(automation.trigger);
    setSelectedPropertyIds(automation.property_ids ?? []);
    setConfig(automation.config ?? createDefaultSlackAutomationConfig());
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

  const toggleProperty = (propertyId: string) => {
    setSelectedPropertyIds((prev) =>
      prev.includes(propertyId)
        ? prev.filter((id) => id !== propertyId)
        : [...prev, propertyId],
    );
  };

  const getPropertyNames = (ids: string[]): string => {
    if (!ids || ids.length === 0) return 'All properties';
    const names = ids
      .map((id) => properties.find((p) => p.id === id)?.name)
      .filter(Boolean);
    if (names.length <= 2) return names.join(', ');
    return `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
  };

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
            Send Slack notifications when reservation events occur at your properties.
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
          {automations.map((automation) => (
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
                {automation.config?.message && (
                  <p className="text-sm text-neutral-500 mt-1 line-clamp-1">
                    {automation.config.message}
                  </p>
                )}
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
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
              <Select value={trigger} onValueChange={(v) => setTrigger(v as SlackAutomationTrigger)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TRIGGER_LABELS) as SlackAutomationTrigger[]).map((t) => (
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

            {/* Slack Channel */}
            <Field>
              <FieldLabel>Slack Channel Name</FieldLabel>
              <Input
                value={config.channel_name}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, channel_name: e.target.value }))
                }
                placeholder="e.g. #operations"
              />
              <FieldDescription>
                The Slack channel where the notification will be posted.
              </FieldDescription>
            </Field>

            {/* Message */}
            <Field>
              <FieldLabel>Message</FieldLabel>
              <Textarea
                value={config.message}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, message: e.target.value }))
                }
                placeholder="e.g. HOA registration forms are required for this property. Please ensure the guest completes the attached form."
                rows={3}
              />
              <FieldDescription>
                The message to send. Property name, guest name, and dates will be included automatically based on the toggles below.
              </FieldDescription>
            </Field>

            {/* Include toggles */}
            <div className="space-y-3">
              <p className="text-sm font-medium leading-none">Include in Message</p>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.include_property_name}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, include_property_name: e.target.checked }))
                  }
                  className="w-4 h-4 rounded border-neutral-300"
                />
                <span className="text-sm">Property name</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.include_guest_name}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, include_guest_name: e.target.checked }))
                  }
                  className="w-4 h-4 rounded border-neutral-300"
                />
                <span className="text-sm">Guest name</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.include_dates}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, include_dates: e.target.checked }))
                  }
                  className="w-4 h-4 rounded border-neutral-300"
                />
                <span className="text-sm">Check-in / check-out dates</span>
              </label>
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !name.trim()}>
              {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Automation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
