'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { SlackAutomation, SlackAutomationRecipient } from '@/lib/types';
import {
  SLACK_DYNAMIC_RECIPIENT_LABELS,
  SLACK_TRIGGER_LABELS,
  getSlackAutomationDispatchTrigger,
  normalizeSlackAutomationConfig,
} from '@/lib/slackAutomationConfig';

interface Property {
  id: string;
  name: string;
}

interface SlackChannel {
  id: string;
  name: string;
}

export default function SlackAutomationsView() {
  const router = useRouter();
  const [automations, setAutomations] = useState<SlackAutomation[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [loading, setLoading] = useState(true);

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
      if (channelsData.channels) setChannels(channelsData.channels);
    } catch (err) {
      console.error('Error fetching slack automations:', err);
    } finally {
      setLoading(false);
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
      alert(data.fired ? 'Test message sent.' : 'Test did not fire.');
    } catch (err) {
      console.error('Test failed:', err);
      alert('Test failed. Check console for details.');
    }
  };

  const getPropertyDisplay = (automation: SlackAutomation): string => {
    const config = normalizeSlackAutomationConfig(automation.config, {
      trigger: automation.trigger,
      property_ids: automation.property_ids ?? [],
    });
    const scope = config.conditions?.property_scope ?? 'all';
    if (scope === 'all') return 'All properties';
    if (scope === 'none') return 'No property';
    const ids = config.conditions?.property_ids ?? [];
    const names = ids
      .map((id) => properties.find((p) => p.id === id)?.name)
      .filter(Boolean);
    if (names.length === 0) return 'Selected properties';
    if (names.length <= 2) return names.join(', ');
    return `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
  };

  const getRecipientDisplay = (recipients: SlackAutomationRecipient[]): string => {
    if (recipients.length === 0) return 'No recipients';
    const labels = recipients.map((recipient) => {
      if (recipient.type === 'channel') {
        const channelName =
          recipient.channel_name ||
          channels.find((channel) => channel.id === recipient.channel_id)?.name ||
          'Channel';
        return channelName === 'Channel' ? channelName : `#${channelName}`;
      }
      if (recipient.type === 'user') {
        return recipient.user_name || recipient.user_email || 'User DM';
      }
      return SLACK_DYNAMIC_RECIPIENT_LABELS[recipient.source];
    });
    if (labels.length <= 2) return labels.join(', ');
    return `${labels.slice(0, 2).join(', ')} +${labels.length - 2} more`;
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
            Build Slack workflows from Foreshadow events, conditions, and message actions.
          </p>
        </div>
        <Button onClick={() => router.push('/automations/slack/new')}>
          + New Slack Automation
        </Button>
      </div>

      {automations.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-neutral-200 dark:border-neutral-700 rounded-lg">
          <p className="text-neutral-500 font-medium">No Slack automations configured</p>
          <p className="text-sm text-neutral-400 mt-1">
            Create a workflow to send Slack messages when Foreshadow events happen.
          </p>
          <Button onClick={() => router.push('/automations/slack/new')} className="mt-4">
            Create Your First Automation
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {automations.map((automation) => {
            const config = normalizeSlackAutomationConfig(automation.config, {
              trigger: automation.trigger,
              property_ids: automation.property_ids ?? [],
            });
            const dispatchTrigger = getSlackAutomationDispatchTrigger(config);
            const recipients = config.action?.recipients ?? [];
            const recipientLabel = getRecipientDisplay(recipients);

            return (
              <Card
                key={automation.id}
                className={`cursor-pointer hover:border-neutral-400 dark:hover:border-neutral-500 transition-colors ${
                  !automation.enabled ? 'opacity-60' : ''
                }`}
                onClick={() => router.push(`/automations/slack/${automation.id}`)}
              >
                <CardHeader>
                  <div className="flex items-center justify-between gap-4">
                    <CardTitle className="text-base flex flex-wrap items-center gap-2">
                      {automation.name}
                      <Badge variant="secondary">
                        {SLACK_TRIGGER_LABELS[dispatchTrigger]}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {recipientLabel}
                      </Badge>
                      {!automation.enabled && (
                        <Badge variant="outline" className="text-xs text-neutral-400">
                          Disabled
                        </Badge>
                      )}
                    </CardTitle>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-neutral-500">
                        {getPropertyDisplay(automation)}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTest(automation.id);
                        }}
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
                  {config.action?.message?.template && (
                    <p className="text-sm text-neutral-500 mt-1 line-clamp-1">
                      {config.action.message.template}
                    </p>
                  )}
                </CardHeader>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
