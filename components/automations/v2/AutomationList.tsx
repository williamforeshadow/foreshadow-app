'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Automation } from '@/lib/automations/types';

export default function AutomationList() {
  const router = useRouter();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [propertyNames, setPropertyNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAutomations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [aRes, pRes] = await Promise.all([
        fetch('/api/automations'),
        fetch('/api/properties'),
      ]);
      if (!aRes.ok) throw new Error(`load failed: ${aRes.status}`);
      const aData = await aRes.json();
      setAutomations((aData.automations ?? []) as Automation[]);
      if (pRes.ok) {
        const pData = await pRes.json();
        const map: Record<string, string> = {};
        for (const p of (pData.properties ?? []) as Array<{ id: string; name: string }>) {
          map[p.id] = p.name;
        }
        setPropertyNames(map);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAutomations();
  }, [fetchAutomations]);

  const toggle = async (automation: Automation) => {
    await fetch(`/api/automations/${automation.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...automation, enabled: !automation.enabled }),
    });
    fetchAutomations();
  };

  const remove = async (automation: Automation) => {
    if (!confirm(`Delete "${automation.name}"?`)) return;
    await fetch(`/api/automations/${automation.id}`, { method: 'DELETE' });
    fetchAutomations();
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Automations</h1>
          <p className="text-sm text-neutral-500">
            Compose Slack workflows from real DB events, conditions, and actions.
          </p>
        </div>
        <Button onClick={() => router.push('/automations/new-engine/new')}>
          + New Automation
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
          {error}
          {error.toLowerCase().includes('does not exist') && (
            <p className="mt-2 text-xs">
              The <code>automations</code> table doesn't exist yet — apply
              the migration at{' '}
              <code>supabase/migrations/20260512120000_automations_rebuild.sql</code>
              {' '}before the new engine can save anything.
            </p>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-neutral-500">Loading…</p>
      ) : automations.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-neutral-200 p-12 text-center dark:border-neutral-700">
          <p className="font-medium text-neutral-500">No automations yet</p>
          <Button
            className="mt-4"
            onClick={() => router.push('/automations/new-engine/new')}
          >
            Create your first automation
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {automations.map((automation) => (
            <Card
              key={automation.id}
              className={`cursor-pointer transition-colors hover:border-neutral-400 dark:hover:border-neutral-500 ${
                !automation.enabled ? 'opacity-60' : ''
              }`}
              onClick={() => router.push(`/automations/new-engine/${automation.id}`)}
            >
              <CardHeader>
                <div className="flex items-center justify-between gap-4">
                  <CardTitle className="text-base flex flex-wrap items-center gap-2">
                    {automation.name}
                    <Badge variant="secondary">
                      {automation.trigger.kind === 'schedule'
                        ? `Schedule · ${automation.trigger.schedule.frequency}`
                        : `Row change · ${automation.trigger.entity}`}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {automation.actions.length} action
                      {automation.actions.length === 1 ? '' : 's'}
                    </Badge>
                    {(automation.property_ids?.length ?? 0) === 0 ? (
                      <Badge variant="outline" className="text-xs text-neutral-500">
                        All properties
                      </Badge>
                    ) : (
                      automation.property_ids.slice(0, 3).map((id) => (
                        <Badge
                          key={id}
                          variant="outline"
                          className="border-indigo-300 bg-indigo-50 text-xs text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-300"
                        >
                          {propertyNames[id] ?? id.slice(0, 8)}
                        </Badge>
                      ))
                    )}
                    {automation.property_ids?.length > 3 && (
                      <Badge variant="outline" className="text-xs text-neutral-500">
                        +{automation.property_ids.length - 3} more
                      </Badge>
                    )}
                    {!automation.enabled && (
                      <Badge variant="outline" className="text-xs text-neutral-400">
                        Disabled
                      </Badge>
                    )}
                  </CardTitle>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(automation);
                      }}
                    >
                      {automation.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-900/20"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(automation);
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
