'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChipButton,
  MetaChip,
  RowIconButton,
  SectionLabel,
  ToggleSwitch,
} from '@/components/ui/panel/PanelForm';
import { TriggerGlyph } from '@/components/automations/v2/TriggerGlyph';
import { summarizeTriggerShort } from '@/lib/automations/summarize';
import type { Automation } from '@/lib/automations/types';

const ICONS = {
  trash: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l.9 12.1A2 2 0 008.9 21h6.2a2 2 0 002-1.9L18 7" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  ),
  chevron: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  ),
};

/** Matched to AutomationsView's detail column so the two tabs line up. */
const DETAIL_COL = 'mx-auto w-full max-w-[46rem]';

/** The property scope as a chip-length phrase. The full name list belongs in
 *  the editor — a row of per-property badges was the old list's worst crowding. */
function scopeLabel(automation: Automation, propertyNames: Record<string, string>): string {
  const ids = automation.property_ids ?? [];
  if (ids.length === 0) return 'All properties';
  if (ids.length === 1) return propertyNames[ids[0]] ?? '1 property';
  return `${ids.length} properties`;
}

export default function AutomationList() {
  const router = useRouter();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [propertyNames, setPropertyNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // `silent` keeps a post-mutation refetch from flashing the list back to its
  // loading state — the row controls mutate in place.
  const fetchAutomations = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
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
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAutomations();
  }, [fetchAutomations]);

  // Optimistic: the switch is the state, so it has to move on the click and
  // roll back only if the write actually fails.
  const toggle = async (automation: Automation) => {
    const next = !automation.enabled;
    const apply = (enabled: boolean) =>
      setAutomations((prev) =>
        prev.map((a) => (a.id === automation.id ? { ...a, enabled } : a)),
      );
    apply(next);
    try {
      const res = await fetch(`/api/automations/${automation.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...automation, enabled: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      apply(!next);
      setError(`Could not ${next ? 'enable' : 'disable'} "${automation.name}".`);
    }
  };

  const remove = async (automation: Automation) => {
    if (!confirm(`Delete "${automation.name}"?`)) return;
    try {
      const res = await fetch(`/api/automations/${automation.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      fetchAutomations(true);
    } catch {
      setError(`Could not delete "${automation.name}".`);
    }
  };

  const missingTable = useMemo(
    () => !!error && error.toLowerCase().includes('does not exist'),
    [error],
  );

  return (
    <div className="panel-form flex h-full flex-col" style={{ background: 'var(--task-surface-0)' }}>
      <div className="flex-1 overflow-y-auto">
        <div className={DETAIL_COL}>
          <div
            className="flex items-center justify-between gap-3 border-b px-[18px] py-3"
            style={{ borderColor: 'var(--task-line-soft)' }}
          >
            <SectionLabel className="!px-0 !pb-0 !pt-0">
              {loading ? 'Automations' : `${automations.length} automations`}
            </SectionLabel>
            <ChipButton set onClick={() => router.push('/automations/new-engine/new')}>
              + New automation
            </ChipButton>
          </div>

          {error && (
            <div
              className="mx-[18px] mt-3 rounded-lg border px-3 py-2.5 text-[length:var(--task-fs-body-sm)]"
              style={{
                borderColor: 'var(--task-amber)',
                background: 'var(--task-amber-soft)',
                color: 'var(--task-amber)',
              }}
            >
              {error}
              {missingTable && (
                <p className="mt-1.5" style={{ color: 'var(--task-ink-2)' }}>
                  The <code>automations</code> table doesn&apos;t exist yet — apply the migration at{' '}
                  <code>supabase/migrations/20260512120000_automations_rebuild.sql</code> before the
                  new engine can save anything.
                </p>
              )}
            </div>
          )}

          {loading ? (
            <div className="px-[18px] py-12 text-center">
              <p
                className="font-mono text-[length:var(--task-fs-label)] uppercase tracking-[0.14em]"
                style={{ color: 'var(--task-ink-3)' }}
              >
                Loading automations…
              </p>
            </div>
          ) : automations.length === 0 ? (
            <div className="px-[18px] py-12 text-center">
              <p className="text-[length:var(--task-fs-option)]" style={{ color: 'var(--task-ink-2)' }}>
                No Slack automations yet.
              </p>
              <p
                className="mt-1.5 text-[length:var(--task-fs-body-sm)]"
                style={{ color: 'var(--task-ink-3)' }}
              >
                Compose one from a trigger, conditions, and a Slack message.
              </p>
              <div className="mt-4 flex justify-center">
                <ChipButton set onClick={() => router.push('/automations/new-engine/new')}>
                  + New automation
                </ChipButton>
              </div>
            </div>
          ) : (
            <>
              <SectionLabel>Slack automations</SectionLabel>
              {automations.map((automation) => {
                const actionCount = automation.actions?.length ?? 0;
                const live = automation.enabled;

                return (
                  <div
                    key={automation.id}
                    className="group flex items-center gap-2.5 border-b px-[18px] py-2.5 transition-colors hover:bg-[var(--task-surface-1)]"
                    style={{ borderColor: 'var(--task-line-soft)' }}
                  >
                    {/* The row itself opens the editor; the switch and the
                        delete affordance are siblings, not nested buttons. */}
                    <button
                      type="button"
                      onClick={() => router.push(`/automations/new-engine/${automation.id}`)}
                      aria-label={`Edit ${automation.name || 'untitled automation'}`}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    >
                      <span className="shrink-0">
                        <TriggerGlyph kind={automation.trigger?.kind ?? 'schedule'} muted={!live} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className="block truncate text-[length:var(--task-fs-option)]"
                          style={{ color: live ? 'var(--task-ink-1)' : 'var(--task-ink-2)' }}
                        >
                          {automation.name || 'Untitled automation'}
                        </span>
                        <span
                          className="block truncate font-mono text-[length:var(--task-fs-label)] uppercase tracking-[0.1em]"
                          style={{ color: 'var(--task-ink-3)' }}
                        >
                          {summarizeTriggerShort(automation.trigger)}
                        </span>
                      </span>
                      <MetaChip>{scopeLabel(automation, propertyNames)}</MetaChip>
                      <MetaChip tone={actionCount > 0 ? 'neutral' : 'warn'}>
                        {actionCount === 0 ? 'No actions' : `${actionCount} action${actionCount === 1 ? '' : 's'}`}
                      </MetaChip>
                    </button>

                    <ToggleSwitch
                      checked={live}
                      onChange={() => toggle(automation)}
                      label={`${live ? 'Disable' : 'Enable'} ${automation.name}`}
                    />
                    <RowIconButton
                      danger
                      label="Delete automation"
                      onClick={() => remove(automation)}
                    >
                      {ICONS.trash}
                    </RowIconButton>
                    <span className="shrink-0" style={{ color: 'var(--task-ink-3)' }}>
                      {ICONS.chevron}
                    </span>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
