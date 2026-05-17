'use client';

// Editor for the rebuilt automations engine.
//
// v2.0.1 strip-back: only exposes what the runtime supports. Trigger is
// row_change on reservation (with created/changed/deleted checkboxes) or a
// schedule (not yet wired to fire). No conditions UI — the property chips at
// the top of the page are the only filter for the MVP. One channel recipient
// per action. The underlying engine schema is unchanged; we just stopped
// surfacing the bits the user wasn't using.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Info } from 'lucide-react';
import {
  Tooltip,
  TooltipTrigger,
  TooltipPortal,
  TooltipPositioner,
  TooltipPopup,
  TooltipProvider,
} from '@/components/ui/tooltip/tooltip';
import type {
  Automation,
  AutomationAction,
  AutomationAttachment,
  AutomationTrigger,
  ConditionGroup,
  ConditionNode,
  ConditionRule,
  EntityKey,
  Expression,
  Operator,
  RowChangeKind,
  SlackMessageAction,
  SlackRecipient,
} from '@/lib/automations/types';
import { emptyConditionGroup } from '@/lib/automations/types';
import {
  buildVariableOptions,
  type VariableOption,
} from '@/lib/automations/labels';
import { summarizeAutomation } from '@/lib/automations/summarize';

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultTrigger(): AutomationTrigger {
  return {
    kind: 'row_change',
    entity: 'reservation',
    on: ['created'],
  };
}

function baseSchedule() {
  return {
    frequency: 'day' as const,
    time: '08:00',
    weekdays: [] as number[],
    month_days: [] as number[],
    interval: 1,
    timezone: 'company' as const,
  };
}

// "By reservation → when it's created or changes" (event-driven).
function byReservationEvent(): AutomationTrigger {
  return { kind: 'row_change', entity: 'reservation', on: ['created'] };
}

// "By reservation → on a daily check" (scans reservations every day,
// fires for those matching the conditions). schedule + for_each reservation.
function byReservationDaily(): AutomationTrigger {
  return {
    kind: 'schedule',
    schedule: baseSchedule(),
    for_each: { entity: 'reservation' },
  };
}

// "Recurring" — calendar cadence, no reservation context. No for_each.
function recurringTrigger(): AutomationTrigger {
  return { kind: 'schedule', schedule: baseSchedule() };
}

function defaultScheduleTrigger(): AutomationTrigger {
  return byReservationDaily();
}

function defaultAction(): SlackMessageAction {
  return {
    id: uid(),
    kind: 'slack_message',
    recipients: [
      {
        id: uid(),
        kind: 'channel',
        channel_id: '',
        channel_name: '',
      },
    ],
    message_template: '',
  };
}

interface PropertyOption {
  id: string;
  name: string;
}

interface SlackChannelOption {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
}

export default function AutomationEditor({
  automationId,
}: {
  automationId?: string;
}) {
  const router = useRouter();
  const isEditing = !!automationId;
  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [name, setName] = useState('Untitled Automation');
  const [enabled, setEnabled] = useState(true);
  const [trigger, setTrigger] = useState<AutomationTrigger>(defaultTrigger());
  const [conditions, setConditions] = useState<ConditionGroup>(emptyConditionGroup());
  const [actions, setActions] = useState<AutomationAction[]>([defaultAction()]);
  const [propertyIds, setPropertyIds] = useState<string[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [channels, setChannels] = useState<SlackChannelOption[]>([]);

  // Load the property list + channel list once. Both are shared across the
  // entire editor (scope picker uses properties; every action's channel
  // picker uses the same channel list).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [propsRes, channelsRes] = await Promise.all([
          fetch('/api/properties'),
          fetch('/api/slack/channels'),
        ]);
        if (cancelled) return;
        if (propsRes.ok) {
          const data = await propsRes.json();
          setProperties(
            ((data.properties ?? []) as PropertyOption[]).map((p) => ({
              id: p.id,
              name: p.name,
            })),
          );
        }
        if (channelsRes.ok) {
          const data = await channelsRes.json();
          setChannels((data.channels ?? []) as SlackChannelOption[]);
        }
      } catch {
        // Pickers can render empty — user can still save without picking.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Hydrate from the API when editing an existing automation.
  useEffect(() => {
    if (!automationId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/automations/${automationId}`);
        if (!res.ok) throw new Error(`load failed: ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const a = data.automation as Automation;
        setName(a.name);
        setEnabled(a.enabled);
        setTrigger(a.trigger);
        const loaded = a.conditions ?? emptyConditionGroup();
        // Heal an existing automation that has an orphaned timing rule from a
        // since-changed trigger: timing only applies to the daily-scan path.
        setConditions(
          a.trigger.kind === 'row_change'
            ? buildConditions([], parseFilters(loaded))
            : loaded,
        );
        setActions(a.actions ?? []);
        setPropertyIds(a.property_ids ?? []);
      } catch (err) {
        if (!cancelled) {
          setSaveError(err instanceof Error ? err.message : 'load failed');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [automationId]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        name,
        enabled,
        trigger,
        conditions,
        actions,
        property_ids: propertyIds,
      };
      const res = await fetch(
        automationId ? `/api/automations/${automationId}` : '/api/automations',
        {
          method: automationId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.errors
            ? data.errors.map((e: { message: string }) => e.message).join('; ')
            : data.error ?? `save failed: ${res.status}`,
        );
      }
      if (!automationId && data.automation?.id) {
        router.replace(`/automations/new-engine/${data.automation.id}`);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }, [automationId, name, enabled, trigger, conditions, actions, propertyIds, router]);

  // Reservation-oriented = row_change OR schedule+for_each. Recurring is a
  // schedule with no for_each — it has no reservation, so property scope and
  // conditions are meaningless there.
  const isReservationScoped =
    trigger.kind === 'row_change' ||
    (trigger.kind === 'schedule' && !!trigger.for_each);

  // All trigger edits route through here so switching *into* Recurring also
  // clears now-meaningless config (conditions, property scope). Prevents
  // building — or persisting — gibberish across a context switch.
  const handleTriggerChange = useCallback((next: AutomationTrigger) => {
    setTrigger(next);
    const nextIsRecurring = next.kind === 'schedule' && !next.for_each;
    const nextIsDailyCheck =
      next.kind === 'schedule' && next.for_each?.entity === 'reservation';
    if (nextIsRecurring) {
      setConditions(emptyConditionGroup());
      setPropertyIds([]);
    } else if (next.kind === 'row_change') {
      // Event triggers have no Timing concept. Drop any timing rule seeded
      // by a previous daily-check selection so it doesn't linger orphaned
      // (mis-summarized as "fire …" and silently gating the automation).
      setConditions((prev) => buildConditions([], parseFilters(prev)));
    } else if (nextIsDailyCheck) {
      // Nudge correct use (and make the Timing UX/summary visible): a fresh
      // daily-check defaults to a concrete Timing rather than "Any". Only
      // seed when there's no timing rule yet, preserving any existing one
      // and attribute filters.
      setConditions((prev) =>
        parseTimings(prev).length > 0
          ? prev
          : buildConditions(
              [{ anchor: 'check_in', relation: 'before', days: 1 }],
              parseFilters(prev),
            ),
      );
    }
  }, []);

  // Resolve the "this" entity for variable paths.
  const scopeEntity: EntityKey | null = useMemo(() => {
    if (trigger.kind === 'schedule') return trigger.for_each?.entity ?? null;
    return trigger.entity;
  }, [trigger]);

  // Row-change kind drives the extra namespaces (actor/added/removed).
  // We expose them whenever the trigger covers any row-change kind; the
  // engine will validate at runtime that `added`/`removed` are only filled
  // for 'updated' events.
  const rowChangeKind = useMemo(() => {
    if (trigger.kind !== 'row_change') return undefined;
    if (trigger.on.includes('updated')) return 'updated' as const;
    return trigger.on[0];
  }, [trigger]);

  const automation: Automation = useMemo(
    () => ({
      id: 'preview',
      name,
      enabled,
      trigger,
      conditions,
      actions,
      property_ids: propertyIds,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
    [name, enabled, trigger, conditions, actions, propertyIds],
  );

  const propertyNameMap = useMemo(
    () => new Map(properties.map((p) => [p.id, p.name])),
    [properties],
  );

  // Build the numbered pipeline steps. Order/contents unchanged from before;
  // only the chrome (rail + cards) is new.
  const steps: {
    title: string;
    hint?: string;
    onRemove?: () => void;
    node: React.ReactNode;
    aside?: React.ReactNode;
  }[] = [];
  steps.push({
    title: 'Trigger By',
    hint: 'What kind of event starts this automation.',
    node: <TriggerBlock trigger={trigger} onChange={handleTriggerChange} />,
  });
  if (trigger.kind === 'schedule' && !!trigger.for_each) {
    steps.push({
      title: 'Automation timing',
      hint: "When, relative to the reservation, it should fire.",
      node: (
        <TimingControl
          value={parseTimings(conditions)}
          onChange={(timings) =>
            setConditions(buildConditions(timings, parseFilters(conditions)))
          }
        />
      ),
    });
    steps.push({
      title: 'Conditions',
      hint: 'Optional extra filters on the reservation itself.',
      node: (
        <ScheduleConditionsEditor
          conditions={{
            kind: 'group',
            match: 'all',
            children: parseFilters(conditions),
          }}
          onChange={(filterGroup) =>
            setConditions(
              buildConditions(
                parseTimings(conditions),
                (filterGroup.children ?? []).filter(
                  (c): c is ConditionRule => c.kind === 'rule',
                ),
              ),
            )
          }
          scopeEntity={scopeEntity}
        />
      ),
    });
  }
  actions.forEach((action, index) => {
    steps.push({
      title: `Message${actions.length > 1 ? ` (${index + 1} of ${actions.length})` : ''}`,
      hint: 'The action taken when everything above matches.',
      onRemove:
        actions.length > 1
          ? () => setActions((list) => list.filter((a) => a.id !== action.id))
          : undefined,
      node: (
        <ActionBlock
          action={action}
          channels={channels}
          onChange={(next) =>
            setActions((list) =>
              list.map((a) => (a.id === action.id ? next : a)),
            )
          }
        />
      ),
      aside: (
        <VariablesCard
          variableOptions={buildVariableOptions({ scopeEntity, rowChangeKind })}
          onInsert={(path) =>
            setActions((list) =>
              list.map((a) =>
                a.id === action.id
                  ? { ...a, message_template: `${a.message_template}{{${path}}}` }
                  : a,
              ),
            )
          }
        />
      ),
    });
  });

  return (
    <TooltipProvider>
    <div className="flex h-full flex-col overflow-hidden bg-white dark:bg-card">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 flex shrink-0 items-center justify-between gap-4 border-b bg-white/80 px-6 py-3 backdrop-blur dark:bg-card/80">
        <div className="flex min-w-0 items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/automations/new-engine')}
            className="shrink-0 px-2 text-muted-foreground"
          >
            ← All automations
          </Button>
          <Badge variant={enabled ? 'default' : 'outline'}>
            {enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Enabled
          </label>
          <Button
            variant="outline"
            size="sm"
            disabled={!automationId || testing || saving || loading}
            title={
              !automationId
                ? 'Save the automation first, then you can fire a test'
                : 'Post a [TEST] message using the most recent reservation as a sample'
            }
            onClick={async () => {
              if (!automationId) return;
              setTesting(true);
              setTestResult(null);
              try {
                const res = await fetch(`/api/automations/${automationId}/test`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: '{}',
                });
                const data = await res.json();
                if (!res.ok) {
                  setTestResult(data.error ?? `test failed: ${res.status}`);
                } else {
                  const delivered = data.result?.delivered_to ?? [];
                  setTestResult(
                    delivered.length === 0
                      ? 'Fired, but no channels received it — check recipients and message template.'
                      : `Sent to ${delivered.join(', ')}.`,
                  );
                }
              } catch (err) {
                setTestResult(err instanceof Error ? err.message : 'test failed');
              } finally {
                setTesting(false);
              }
            }}
          >
            {testing ? 'Testing…' : 'Test'}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
      {saveError && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-6 py-2 text-sm text-destructive">
          {saveError}
        </div>
      )}
      {testResult && (
        <div className="border-b border-[var(--turnover-purple-border)] bg-[var(--turnover-purple-bg)] px-6 py-2 text-sm text-foreground">
          {testResult}
        </div>
      )}
      {loading && (
        <div className="border-b bg-muted px-6 py-2 text-sm text-muted-foreground">
          Loading automation…
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-6 py-8">
          {/* Editable automation title */}
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Untitled automation"
            className="mb-7 h-auto w-full rounded-none border-0 border-b border-dashed border-transparent bg-transparent px-0 py-1 text-2xl font-semibold shadow-none hover:border-border focus:border-border focus-visible:ring-0"
          />

          {/* Numbered pipeline */}
          <div>
            {steps.map((step, i) => (
              <RailStep
                key={`${step.title}-${i}`}
                index={i}
                total={steps.length + 1}
                title={step.title}
                hint={step.hint}
                onRemove={step.onRemove}
                aside={step.aside}
              >
                {step.node}
              </RailStep>
            ))}
            {/* The rail continues into a "+" node — click to add a message */}
            <div className="relative pb-6 pl-14">
              <button
                type="button"
                onClick={() => setActions((list) => [...list, defaultAction()])}
                aria-label="Add a message"
                className="absolute left-0 top-1 grid h-10 w-10 place-items-center rounded-xl border border-dashed border-[var(--turnover-purple-border)] bg-[var(--turnover-purple-bg)] text-lg leading-none text-foreground shadow-sm transition hover:brightness-110"
              >
                +
              </button>
              <div className="flex h-10 items-center text-sm text-muted-foreground">
                Add a message
              </div>
            </div>
          </div>

          {/* Applies-to — flush with the cards; muted on recurring */}
          <div className="pl-14">
            <PropertyScopePicker
              properties={properties}
              value={propertyIds}
              onChange={setPropertyIds}
              disabled={!isReservationScoped}
            />
          </div>

          {/* Live natural-language summary — flush, trails everything */}
          <div className="pl-14 pt-5">
            <div className="rounded-xl border border-l-2 border-l-[#a78bfa] bg-white p-7 shadow-md dark:border-neutral-700 dark:bg-neutral-800">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#a78bfa]">
                Automation in natural language
              </p>
              <p className="mt-3 text-lg leading-relaxed text-foreground">
                {summarizeAutomation(automation, propertyNameMap)}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
    </TooltipProvider>
  );
}

// ─── Flow box chrome ───────────────────────────────────────────────────

// One step in the numbered vertical pipeline: a node badge + connecting
// rail + an app-styled card. Pure chrome.
function RailStep({
  index,
  total,
  title,
  hint,
  onRemove,
  aside,
  children,
}: {
  index: number;
  total: number;
  title: string;
  hint?: string;
  onRemove?: () => void;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const isLast = index === total - 1;
  const num = String(index + 1).padStart(2, '0');
  return (
    <div className="relative pb-6 pl-14 last:pb-0">
      {!isLast && (
        <span
          className="absolute bottom-0 left-[19px] top-11 w-px bg-border"
          aria-hidden
        />
      )}
      <div className="absolute left-0 top-1 grid h-10 w-10 place-items-center rounded-xl border border-[var(--turnover-purple-border)] bg-[var(--turnover-purple-bg)] font-mono text-[13px] text-foreground shadow-sm">
        {num}
      </div>
      <div className="flex gap-4">
      <div className="min-w-0 flex-1 rounded-xl border bg-white p-5 shadow-md dark:border-neutral-700 dark:bg-neutral-800">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            {hint && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={`About ${title}`}
                      className="text-muted-foreground transition-colors hover:text-foreground"
                    />
                  }
                >
                  <Info className="h-3.5 w-3.5" />
                </TooltipTrigger>
                <TooltipPortal>
                  <TooltipPositioner sideOffset={6}>
                    <TooltipPopup className="max-w-[260px] text-xs leading-snug">
                      {hint}
                    </TooltipPopup>
                  </TooltipPositioner>
                </TooltipPortal>
              </Tooltip>
            )}
          </div>
          {onRemove && (
            <Button size="sm" variant="ghost" onClick={onRemove}>
              Remove
            </Button>
          )}
        </div>
        {children}
      </div>
      {aside && <div className="w-60 shrink-0">{aside}</div>}
      </div>
    </div>
  );
}

// ─── Trigger block ─────────────────────────────────────────────────────

function TriggerBlock({
  trigger,
  onChange,
}: {
  trigger: AutomationTrigger;
  onChange: (next: AutomationTrigger) => void;
}) {
  // Derive the two-level selector state from the trigger primitive.
  // By reservation = row_change (event) OR schedule+for_each (daily scan).
  // Recurring = schedule with no for_each.
  const isReservation =
    trigger.kind === 'row_change' ||
    (trigger.kind === 'schedule' && !!trigger.for_each);
  const reservationMode: 'event' | 'daily' =
    trigger.kind === 'row_change' ? 'event' : 'daily';

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border bg-secondary p-1">
        <button
          type="button"
          onClick={() => onChange(byReservationEvent())}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
            isReservation
              ? 'bg-[var(--turnover-purple-bg)] text-foreground border border-[var(--turnover-purple-border)] shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Reservation
        </button>
        <button
          type="button"
          onClick={() => onChange(recurringTrigger())}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
            !isReservation
              ? 'bg-[var(--turnover-purple-bg)] text-foreground border border-[var(--turnover-purple-border)] shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Recurring
        </button>
      </div>

      {isReservation ? (
        <div className="space-y-3">
          <LabeledField label="Run">
            <Select
              value={reservationMode === 'event' ? 'created' : 'schedule'}
              onValueChange={(value) =>
                onChange(
                  value === 'created'
                    ? byReservationEvent()
                    : byReservationDaily(),
                )
              }
            >
              <SelectTrigger className={`w-full max-w-md ${RAISED_FIELD}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="created">
                  On creation, change, or deletion of a reservation
                </SelectItem>
                <SelectItem value="schedule">
                  Relative to the timing of a reservation
                </SelectItem>
              </SelectContent>
            </Select>
          </LabeledField>
          {reservationMode === 'event' ? (
            <RowChangeTriggerEditor
              trigger={trigger as Extract<AutomationTrigger, { kind: 'row_change' }>}
              onChange={onChange}
            />
          ) : (
            <ScheduleTriggerEditor
              trigger={trigger as Extract<AutomationTrigger, { kind: 'schedule' }>}
              onChange={onChange}
              mode="daily_scan"
            />
          )}
        </div>
      ) : (
        <ScheduleTriggerEditor
          trigger={trigger as Extract<AutomationTrigger, { kind: 'schedule' }>}
          onChange={onChange}
          mode="recurring"
        />
      )}
    </div>
  );
}

function ScheduleTriggerEditor({
  trigger,
  onChange,
  mode,
}: {
  trigger: Extract<AutomationTrigger, { kind: 'schedule' }>;
  onChange: (next: AutomationTrigger) => void;
  mode: 'daily_scan' | 'recurring';
}) {
  const { schedule } = trigger;
  const isDailyScan = mode === 'daily_scan';

  return (
    <div className="space-y-3">
      <div
        className={
          isDailyScan
            ? 'grid grid-cols-[140px_1fr] gap-2'
            : 'grid grid-cols-[160px_140px_1fr] gap-2'
        }
      >
        {!isDailyScan && (
          <LabeledField label="Frequency">
            <Select
              value={schedule.frequency}
              onValueChange={(value) => {
                const frequency = value as typeof schedule.frequency;
                // Never leave a week/month schedule with no day selected —
                // that's a never-fires state. Seed a sensible default.
                const weekdays =
                  frequency === 'week' && (schedule.weekdays ?? []).length === 0
                    ? [1]
                    : schedule.weekdays;
                const month_days =
                  frequency === 'month' && (schedule.month_days ?? []).length === 0
                    ? [1]
                    : schedule.month_days;
                onChange({
                  ...trigger,
                  schedule: { ...schedule, frequency, weekdays, month_days },
                });
              }}
            >
              <SelectTrigger className={RAISED_FIELD}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hour">Hourly</SelectItem>
                <SelectItem value="day">Daily</SelectItem>
                <SelectItem value="week">Weekly</SelectItem>
                <SelectItem value="month">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </LabeledField>
        )}
        <LabeledField label="Time">
          <Input
            type="time"
            value={schedule.time}
            onChange={(e) =>
              onChange({
                ...trigger,
                schedule: { ...schedule, time: e.target.value },
              })
            }
            disabled={!isDailyScan && schedule.frequency === 'hour'}
            className={RAISED_FIELD}
          />
        </LabeledField>
        <LabeledField label="Timezone">
          <Select
            value={schedule.timezone}
            onValueChange={(value) =>
              onChange({
                ...trigger,
                schedule: { ...schedule, timezone: value as typeof schedule.timezone },
              })
            }
          >
            <SelectTrigger className={RAISED_FIELD}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="company">Company timezone</SelectItem>
              <SelectItem value="property">Property timezone</SelectItem>
            </SelectContent>
          </Select>
        </LabeledField>
      </div>

      {!isDailyScan && schedule.frequency === 'week' && (
        <LabeledField label="On these days">
          <WeekdayPicker
            value={schedule.weekdays ?? []}
            onChange={(weekdays) =>
              onChange({ ...trigger, schedule: { ...schedule, weekdays } })
            }
          />
        </LabeledField>
      )}

      {!isDailyScan && schedule.frequency === 'month' && (
        <LabeledField label="On these days of the month">
          <MonthDayPicker
            value={schedule.month_days ?? []}
            onChange={(month_days) =>
              onChange({ ...trigger, schedule: { ...schedule, month_days } })
            }
          />
        </LabeledField>
      )}
    </div>
  );
}

function WeekdayPicker({
  value,
  onChange,
}: {
  value: number[];
  onChange: (next: number[]) => void;
}) {
  const labels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const toggle = (d: number) => {
    if (value.includes(d)) {
      // Don't allow removing the last day — a week/month schedule with no
      // day never fires.
      if (value.length <= 1) return;
      onChange(value.filter((x) => x !== d));
    } else {
      onChange([...value, d]);
    }
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {labels.map((label, d) => {
        const on = value.includes(d);
        return (
          <button
            key={d}
            type="button"
            onClick={() => toggle(d)}
            className={`h-8 w-8 rounded-full border text-xs font-medium transition-colors ${
              on
                ? 'border-[var(--turnover-purple-border)] bg-[var(--turnover-purple-bg)] text-foreground'
                : 'border-input bg-transparent text-muted-foreground hover:border-[var(--turnover-purple-border)] hover:text-foreground'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function MonthDayPicker({
  value,
  onChange,
}: {
  value: number[];
  onChange: (next: number[]) => void;
}) {
  const toggle = (d: number) => {
    if (value.includes(d)) {
      // Don't allow removing the last day — a week/month schedule with no
      // day never fires.
      if (value.length <= 1) return;
      onChange(value.filter((x) => x !== d));
    } else {
      onChange([...value, d]);
    }
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => {
        const on = value.includes(d);
        return (
          <button
            key={d}
            type="button"
            onClick={() => toggle(d)}
            className={`h-8 w-8 rounded-md border text-xs font-medium transition-colors ${
              on
                ? 'border-[var(--turnover-purple-border)] bg-[var(--turnover-purple-bg)] text-foreground'
                : 'border-input bg-transparent text-muted-foreground hover:border-[var(--turnover-purple-border)] hover:text-foreground'
            }`}
          >
            {d}
          </button>
        );
      })}
    </div>
  );
}

function RowChangeTriggerEditor({
  trigger,
  onChange,
}: {
  trigger: Extract<AutomationTrigger, { kind: 'row_change' }>;
  onChange: (next: AutomationTrigger) => void;
}) {
  // v2.0.1: hard-coded to 'reservation'. Other entities re-introduce when the
  // runtime supports them; until then exposing the dropdown advertises
  // capability that doesn't exist.
  const kinds: RowChangeKind[] = ['created', 'updated', 'deleted'];
  const reservationTrigger =
    trigger.entity === 'reservation' ? trigger : { ...trigger, entity: 'reservation' as EntityKey };
  return (
    <div className="space-y-3">
      <div className="text-sm text-neutral-700 dark:text-neutral-300">
        When a <span className="font-semibold">reservation</span> is…
      </div>
      <div className="flex flex-wrap gap-4 pl-1">
        {kinds.map((kind) => {
          // Runtime only fires `created` today (changed/deleted have no app
          // hook — reservation edits happen via DB triggers). Disable the
          // unsupported ones so you can't build an automation that silently
          // never fires.
          const supported = kind === 'created';
          return (
            <label
              key={kind}
              className={`flex items-center gap-1.5 text-sm ${
                supported ? '' : 'text-neutral-400'
              }`}
              title={
                supported
                  ? undefined
                  : 'Not available yet — only "created" fires in this version'
              }
            >
              <input
                type="checkbox"
                disabled={!supported}
                checked={supported && reservationTrigger.on.includes(kind)}
                onChange={(e) =>
                  onChange({
                    ...reservationTrigger,
                    on: e.target.checked
                      ? Array.from(new Set([...reservationTrigger.on, kind]))
                      : reservationTrigger.on.filter((k) => k !== kind),
                  })
                }
              />
              {kind === 'created'
                ? 'created'
                : kind === 'updated'
                ? 'changed (soon)'
                : 'deleted (soon)'}
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ─── Schedule conditions (flat, schedule-only) ────────────────────────
//
// v2.1: scheduled automations need filtering to express things like the
// same-day flip ("for reservations where check_out = today AND
// next_check_in = today"). Row_change still has no conditions UI — its
// property chips do its filtering. So this editor only renders inside the
// schedule-trigger branch. The shape is intentionally flat: list of rule
// rows, ANDed implicitly. No groups, no exists clauses, no left-side
// expression-kind dropdown.

// ─── Timing control (reservation-relative; daily-check only) ──────────
//
// Timing is editor sugar over one recognizable condition rule:
//   N before <anchor>  →  this.days_until_<anchor> equals  N
//   on <anchor>        →  this.days_until_<anchor> equals  0
//   N after <anchor>   →  this.days_until_<anchor> equals -N
// The engine/runtime are unchanged — it just evaluates that numeric rule.

type TimingAnchor = 'check_in' | 'check_out' | 'next_check_in';
type TimingRelation = 'before' | 'on' | 'after';
interface TimingValue {
  anchor: TimingAnchor;
  relation: TimingRelation;
  days: number;
}

const TIMING_ANCHOR_PATH: Record<TimingAnchor, string> = {
  check_in: 'this.days_until_check_in',
  check_out: 'this.days_until_check_out',
  next_check_in: 'this.days_until_next_check_in',
};
const TIMING_ANCHOR_LABEL: Record<TimingAnchor, string> = {
  check_in: 'check-in',
  check_out: 'check-out',
  next_check_in: 'next check-in',
};
const PATH_TO_ANCHOR: Record<string, TimingAnchor> = {
  'this.days_until_check_in': 'check_in',
  'this.days_until_check_out': 'check_out',
  'this.days_until_next_check_in': 'next_check_in',
};

function isTimingRule(node: ConditionNode): node is ConditionRule {
  return (
    node.kind === 'rule' &&
    node.left?.kind === 'variable' &&
    node.left.path in PATH_TO_ANCHOR &&
    node.op === 'equals' &&
    node.right?.kind === 'literal' &&
    typeof node.right.value === 'number'
  );
}

function ruleToTiming(rule: ConditionRule): TimingValue | null {
  if (rule.left.kind !== 'variable' || rule.right?.kind !== 'literal') {
    return null;
  }
  const anchor = PATH_TO_ANCHOR[rule.left.path];
  const v = Number(rule.right.value);
  if (v > 0) return { anchor, relation: 'before', days: v };
  if (v < 0) return { anchor, relation: 'after', days: -v };
  return { anchor, relation: 'on', days: 0 };
}

function parseTimings(group: ConditionGroup): TimingValue[] {
  return (group.children ?? [])
    .filter(isTimingRule)
    .map((r) => ruleToTiming(r as ConditionRule))
    .filter((t): t is TimingValue => t !== null);
}

function parseFilters(group: ConditionGroup): ConditionRule[] {
  return (group.children ?? []).filter(
    (c): c is ConditionRule => c.kind === 'rule' && !isTimingRule(c),
  );
}

function timingToRule(t: TimingValue): ConditionRule {
  const value =
    t.relation === 'on' ? 0 : t.relation === 'before' ? t.days : -t.days;
  return {
    kind: 'rule',
    left: { kind: 'variable', path: TIMING_ANCHOR_PATH[t.anchor] },
    op: 'equals',
    right: { kind: 'literal', value },
  };
}

function buildConditions(
  timings: TimingValue[],
  filters: ConditionRule[],
): ConditionGroup {
  const children: ConditionNode[] = [
    ...timings.map(timingToRule),
    ...filters,
  ];
  return { kind: 'group', match: 'all', children };
}

// Borderless "editable word" styling for the prose-style pickers so they
// read as a sentence, not a row of boxes.
const INLINE_TRIGGER =
  'h-auto w-auto gap-1 border-0 bg-transparent px-1 py-0.5 shadow-none underline decoration-dotted decoration-[var(--turnover-purple-border)] underline-offset-4 hover:decoration-solid focus-visible:ring-0';
const INLINE_INPUT =
  'h-auto w-16 border-0 bg-transparent px-1 py-0.5 text-center shadow-none underline decoration-dotted decoration-[var(--turnover-purple-border)] underline-offset-4 focus-visible:ring-0';

// Boxed grid fields sit *raised* above the card: in dark, one step lighter
// than the card (#262626) with a clearer border. Light keeps shadcn's
// neutral-100 + border (already legible on white).
const RAISED_FIELD = 'dark:bg-neutral-700 dark:border-neutral-600';

const DEFAULT_TIMING: TimingValue = {
  anchor: 'check_in',
  relation: 'before',
  days: 1,
};

function TimingRow({
  v,
  onChange,
  showLabel,
}: {
  v: TimingValue;
  onChange: (next: TimingValue) => void;
  showLabel: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {showLabel && (
        <span className="text-neutral-600 dark:text-neutral-300">Fire</span>
      )}
      {v.relation !== 'on' && (
        <Input
          type="number"
          min={0}
          value={v.days}
          onChange={(e) =>
            onChange({ ...v, days: Math.max(0, Number(e.target.value) || 0) })
          }
          className={INLINE_INPUT}
        />
      )}
      {v.relation !== 'on' && (
        <span className="text-neutral-600 dark:text-neutral-300">days</span>
      )}
      <Select
        value={v.relation}
        onValueChange={(value) => {
          const relation = value as TimingRelation;
          // "on" compiles to `equals 0`. If we switch to before/after while
          // days is still 0 it also compiles to 0 and parseTimings reads it
          // back as "on" — appearing stuck. Bump to 1 so it sticks.
          const days = relation === 'on' ? 0 : v.days > 0 ? v.days : 1;
          onChange({ ...v, relation, days });
        }}
      >
        <SelectTrigger className={INLINE_TRIGGER}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="before">before</SelectItem>
          <SelectItem value="on">on</SelectItem>
          <SelectItem value="after">after</SelectItem>
        </SelectContent>
      </Select>
      <span className="text-neutral-600 dark:text-neutral-300">
        reservation&apos;s
      </span>
      <Select
        value={v.anchor}
        onValueChange={(value) =>
          onChange({ ...v, anchor: value as TimingAnchor })
        }
      >
        <SelectTrigger className={INLINE_TRIGGER}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="check_in">check-in</SelectItem>
          <SelectItem value="check_out">check-out</SelectItem>
          <SelectItem value="next_check_in">next check-in</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function TimingControl({
  value,
  onChange,
}: {
  value: TimingValue[];
  onChange: (next: TimingValue[]) => void;
}) {
  // Picking "Run → On a schedule" *is* the choice to time relative to a
  // reservation. If we render with no timing rule yet (older saved
  // automation), seed one default so the card/summary stay consistent.
  useEffect(() => {
    if (value.length === 0) onChange([DEFAULT_TIMING]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.length === 0]);

  const rows = value.length > 0 ? value : [DEFAULT_TIMING];

  const updateAt = (i: number, next: TimingValue) =>
    onChange(rows.map((r, idx) => (idx === i ? next : r)));
  const removeAt = (i: number) =>
    onChange(rows.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      {rows.map((v, i) => (
        <div key={i}>
          {i > 0 && (
            <div className="my-1.5 flex items-center gap-2">
              <span className="h-px flex-1 bg-border" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                and
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
          )}
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <TimingRow
                v={v}
                onChange={(next) => updateAt(i, next)}
                showLabel={i === 0}
              />
            </div>
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => removeAt(i)}
                aria-label="Remove timing"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rows, DEFAULT_TIMING])}
        className={`mt-1 rounded-md border border-input bg-transparent px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground ${RAISED_FIELD}`}
      >
        + AND
      </button>
    </div>
  );
}

// Attribute-filter operators only. Date/relative-timing moved to the
// Timing control, so the date operators (before/after/on_or_*) are gone.
const SCHEDULE_OPERATORS: { value: Operator; label: string }[] = [
  { value: 'equals', label: 'is' },
  { value: 'not_equals', label: 'is not' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'gte', label: 'is at least' },
  { value: 'lte', label: 'is at most' },
];

function ScheduleConditionsEditor({
  conditions,
  onChange,
  scopeEntity,
}: {
  conditions: ConditionGroup;
  onChange: (next: ConditionGroup) => void;
  scopeEntity: EntityKey | null;
}) {
  // Conditions are attribute filters only — Timing owns all date logic.
  // Drop the Time group (today/now) and any date/time-typed field so
  // nonsense like "next check-in contains salad" is unbuildable.
  const variableOptions = useMemo(
    () =>
      buildVariableOptions({ scopeEntity }).filter(
        (o) =>
          o.group !== 'Time' &&
          !['date', 'datetime', 'time'].includes(o.fieldType ?? ''),
      ),
    [scopeEntity],
  );
  // We only render `kind: 'rule'` children. Anything else from the schema
  // (groups, exists clauses) is preserved on save but not editable here.
  const rules = (conditions.children ?? []).filter(
    (c): c is ConditionRule => c.kind === 'rule',
  );

  const updateAt = (index: number, next: ConditionRule | null) => {
    let i = -1;
    const newChildren: ConditionNode[] = [];
    for (const child of conditions.children ?? []) {
      if (child.kind !== 'rule') {
        newChildren.push(child);
        continue;
      }
      i += 1;
      if (i === index) {
        if (next) newChildren.push(next);
        // else: drop it
      } else {
        newChildren.push(child);
      }
    }
    onChange({ ...conditions, match: 'all', children: newChildren });
  };

  const addRule = () => {
    const firstVar =
      variableOptions.find((o) => o.path.startsWith('this.')) ?? variableOptions[0];
    const rule: ConditionRule = {
      kind: 'rule',
      left: { kind: 'variable', path: firstVar?.path ?? 'this.guest_name' },
      op: 'contains',
      right: { kind: 'literal', value: '' },
    };
    onChange({
      ...conditions,
      match: 'all',
      children: [...(conditions.children ?? []), rule],
    });
  };

  return (
    <div className="space-y-2">
      {rules.map((rule, index) => (
        <div key={index}>
          {index > 0 && (
            <div className="my-1.5 flex items-center gap-2">
              <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                and
              </span>
              <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
            </div>
          )}
          <ScheduleConditionRow
            rule={rule}
            variableOptions={variableOptions}
            onChange={(next) => updateAt(index, next)}
          />
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        onClick={addRule}
        className={RAISED_FIELD}
      >
        + Add condition
      </Button>
    </div>
  );
}

function ScheduleConditionRow({
  rule,
  variableOptions,
  onChange,
}: {
  rule: ConditionRule;
  variableOptions: VariableOption[];
  onChange: (next: ConditionRule | null) => void;
}) {
  const grouped = groupVariableOptions(variableOptions);
  const leftPath = rule.left.kind === 'variable' ? rule.left.path : '';
  const needsRight = !['is_empty', 'is_not_empty'].includes(rule.op);

  // Operators that make sense for the selected field's type. Kills nonsense
  // like "guest name is at most" or numeric "contains".
  const leftType =
    variableOptions.find((o) => o.path === leftPath)?.fieldType ?? '';
  const allowedOps: Operator[] =
    leftType === 'number'
      ? ['equals', 'not_equals', 'gte', 'lte']
      : ['string', 'id', 'enum'].includes(leftType)
      ? ['equals', 'not_equals', 'contains', 'not_contains']
      : ['equals', 'not_equals'];
  const operators = SCHEDULE_OPERATORS.filter((o) => allowedOps.includes(o.value));

  const setLeft = (path: string) => {
    const nextType =
      variableOptions.find((o) => o.path === path)?.fieldType ?? '';
    const nextAllowed: Operator[] =
      nextType === 'number'
        ? ['equals', 'not_equals', 'gte', 'lte']
        : ['string', 'id', 'enum'].includes(nextType)
        ? ['equals', 'not_equals', 'contains', 'not_contains']
        : ['equals', 'not_equals'];
    onChange({
      ...rule,
      left: { kind: 'variable', path },
      op: nextAllowed.includes(rule.op) ? rule.op : 'equals',
    });
  };

  const setRight = (next: Expression | undefined) => {
    onChange({ ...rule, right: next });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {/* Left: variable picker */}
      <Select value={leftPath} onValueChange={setLeft}>
        <SelectTrigger className={INLINE_TRIGGER}>
          <SelectValue placeholder="Pick a field…" />
        </SelectTrigger>
        <SelectContent>
          {grouped.map(({ group, options }) => (
            <SelectGroup key={group}>
              <SelectLabel>{group}</SelectLabel>
              {options.map((opt) => (
                <SelectItem key={opt.path} value={opt.path}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>

      {/* Operator */}
      <Select
        value={rule.op}
        onValueChange={(value) => onChange({ ...rule, op: value as Operator })}
      >
        <SelectTrigger className={INLINE_TRIGGER}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map((op) => (
            <SelectItem key={op.value} value={op.value}>
              {op.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Right: a literal value (date/relative timing lives in Timing). */}
      {needsRight ? (
        <Input
          value={
            rule.right?.kind === 'literal' ? String(rule.right.value ?? '') : ''
          }
          onChange={(e) => setRight({ kind: 'literal', value: e.target.value })}
          placeholder="value"
          className={`${INLINE_INPUT} w-32 text-left`}
        />
      ) : (
        <span className="text-muted-foreground">—</span>
      )}

      <button
        type="button"
        onClick={() => onChange(null)}
        aria-label="Remove condition"
        className="ml-auto text-muted-foreground transition-colors hover:text-foreground"
      >
        ✕
      </button>
    </div>
  );
}

// Variable picker helpers live in `lib/automations/labels.ts` so the engine
// and the editor share one definition of what's selectable.

interface GroupedVariableOptions {
  group: string;
  options: VariableOption[];
}

function groupVariableOptions(options: VariableOption[]): GroupedVariableOptions[] {
  const order: string[] = [];
  const map = new Map<string, VariableOption[]>();
  for (const option of options) {
    if (!map.has(option.group)) {
      map.set(option.group, []);
      order.push(option.group);
    }
    map.get(option.group)!.push(option);
  }
  return order.map((group) => ({ group, options: map.get(group)! }));
}

// ─── Variables side card ───────────────────────────────────────────────
//
// Sits to the right of a Message card. Clicking a variable appends
// `{{path}}` to that message's text — identical to the old in-card
// "Insert data" dropdown, just relocated.
function VariablesCard({
  variableOptions,
  onInsert,
}: {
  variableOptions: VariableOption[];
  onInsert: (path: string) => void;
}) {
  const grouped = groupVariableOptions(variableOptions);
  return (
    <div className="rounded-xl border bg-white p-4 shadow-md dark:border-neutral-700 dark:bg-neutral-800">
      <h3 className="mb-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        Variables
      </h3>
      <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
        {grouped.map(({ group, options }) => (
          <div key={group}>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {group}
            </p>
            <div className="flex flex-col">
              {options.map((opt) => (
                <button
                  key={opt.path}
                  type="button"
                  onClick={() => onInsert(opt.path)}
                  className="rounded px-2 py-1 text-left text-sm text-foreground transition-colors hover:bg-accent/50"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Action block ──────────────────────────────────────────────────────

function ActionBlock({
  action,
  channels,
  onChange,
}: {
  action: AutomationAction;
  channels: SlackChannelOption[];
  onChange: (next: AutomationAction) => void;
}) {
  if (action.kind !== 'slack_message') return null;

  // v2.0.1: single channel recipient per action. We ensure the recipient list
  // contains exactly one channel slot; if storage somehow has more or none we
  // coerce on read so the UI always renders a single field.
  const channelRecipient =
    (action.recipients?.find((r) => r.kind === 'channel') as
      | Extract<SlackRecipient, { kind: 'channel' }>
      | undefined) ?? {
      id: uid(),
      kind: 'channel' as const,
      channel_id: '',
      channel_name: '',
    };
  const pickedChannel = channels.find((c) => c.id === channelRecipient.channel_id);
  // Private channel the bot isn't in — Slack will reject the post. Public
  // channels are fine even when is_member=false (bot can post via chat:write.public).
  const needsBotInvite = pickedChannel?.is_private && !pickedChannel.is_member;

  const updateChannel = (channel_id: string) => {
    const channel = channels.find((c) => c.id === channel_id);
    onChange({
      ...action,
      recipients: [
        {
          ...channelRecipient,
          channel_id,
          channel_name: channel?.name ?? '',
        },
      ],
    });
  };

  const updateAttachments = (attachments: AutomationAttachment[]) => {
    onChange({ ...action, attachments });
  };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Slack channel
        </h4>
        <Select
          value={channelRecipient.channel_id || undefined}
          onValueChange={updateChannel}
        >
          <SelectTrigger className={`w-full ${RAISED_FIELD}`}>
            <SelectValue placeholder="Pick a channel…" />
          </SelectTrigger>
          <SelectContent>
            {channels.length === 0 ? (
              <div className="px-2 py-2 text-xs text-neutral-500">
                No channels loaded — check that the bot has channels:read /
                groups:read scopes.
              </div>
            ) : (
              channels.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.is_private ? '🔒 ' : '# '}
                  {c.name}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        {needsBotInvite && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
            The bot isn't a member of this private channel yet — invite it before
            this automation can post.
          </p>
        )}
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Text
        </h4>
        <Textarea
          rows={5}
          value={action.message_template}
          onChange={(e) =>
            onChange({ ...action, message_template: e.target.value })
          }
          placeholder="Same-day flip at {{this.property.name}} — {{this.guest_name}} out today."
          className={`font-mono text-sm ${RAISED_FIELD}`}
        />
      </div>

      <AttachmentsBlock
        attachments={action.attachments ?? []}
        onChange={updateAttachments}
      />
    </div>
  );
}

// ─── Attachments block ─────────────────────────────────────────────────

function AttachmentsBlock({
  attachments,
  onChange,
}: {
  attachments: AutomationAttachment[];
  onChange: (next: AutomationAttachment[]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/automations/attachments', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      onChange([
        ...attachments,
        {
          id: data.attachment.id,
          name: data.attachment.name,
          storage_path: data.attachment.storage_path,
          mime_type: data.attachment.mime_type,
          size_bytes: data.attachment.size_bytes,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const remove = (attachment: AutomationAttachment) => {
    onChange(attachments.filter((a) => a.id !== attachment.id));
    // Best-effort cleanup — if it fails the orphaned blob just sits in the
    // bucket. Not worth blocking the UI on.
    fetch(`/api/automations/attachments/${attachment.id}`, {
      method: 'DELETE',
    }).catch(() => {});
  };

  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
        Attachments
      </h4>
      {attachments.length > 0 && (
        <ul className="mb-2 space-y-1">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-700"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{a.name}</p>
                <p className="text-xs text-neutral-500">
                  {formatBytes(a.size_bytes)}
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => remove(a)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={uploading}
        onClick={() => fileInputRef.current?.click()}
      >
        {uploading ? 'Uploading…' : '+ Add a file'}
      </Button>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ─── Misc helpers ──────────────────────────────────────────────────────

function LabeledField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

// ─── Property scope picker ─────────────────────────────────────────────

// Collapsible, searchable scope selector. Same selection model as before:
// `value=[]` means ALL properties; a non-empty list scopes to those ids.
// Purely a presentational reorg of the old chip wall.
function PropertyScopePicker({
  properties,
  value,
  onChange,
  disabled,
}: {
  properties: PropertyOption[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpenRaw] = useState(false);
  const [query, setQuery] = useState('');
  const setOpen = disabled ? () => {} : setOpenRaw;

  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  };

  const summary =
    value.length === 0
      ? 'All properties'
      : value.length === 1
      ? properties.find((p) => p.id === value[0])?.name ?? '1 property'
      : `${value.length} properties`;

  const q = query.trim().toLowerCase();
  const filtered = q
    ? properties.filter((p) => p.name.toLowerCase().includes(q))
    : properties;

  return (
    <div
      className={`overflow-hidden rounded-xl border bg-white shadow-md dark:border-neutral-700 dark:bg-neutral-800 ${
        disabled ? 'pointer-events-none opacity-50' : ''
      }`}
      aria-disabled={disabled || undefined}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-3.5 text-left transition-colors hover:bg-accent/40"
      >
        <span className="flex items-center gap-3">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Applies to
          </span>
          <span className="text-sm font-medium text-foreground">
            {disabled ? 'Not applicable for recurring automations' : summary}
          </span>
          {!disabled && (
            <span className="rounded-full border border-[var(--turnover-purple-border)] bg-[var(--turnover-purple-bg)] px-2 py-0.5 text-xs text-foreground">
              {value.length === 0 ? properties.length : value.length}
            </span>
          )}
        </span>
        <span
          className={`text-xs text-muted-foreground transition-transform ${open && !disabled ? 'rotate-180' : ''}`}
          aria-hidden
        >
          ▾
        </span>
      </button>
      {open && !disabled && (
        <div className="border-t px-5 pb-5 pt-4">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search properties…"
            className={`mb-3 ${RAISED_FIELD}`}
          />
          <div className="mb-3 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onChange(properties.map((p) => p.id))}
            >
              Select all
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={value.length === 0}
              onClick={() => onChange([])}
            >
              Clear
            </Button>
          </div>
          <div className="max-h-60 overflow-y-auto pr-1">
            {filtered.map((p) => {
              const selected = value.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle(p.id)}
                  className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent/50"
                >
                  <span
                    className={`grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] ${
                      selected
                        ? 'border-[var(--turnover-purple-border)] bg-[var(--turnover-purple-bg)] text-foreground'
                        : 'border-input'
                    }`}
                  >
                    {selected ? '✓' : ''}
                  </span>
                  <span
                    className={selected ? 'text-foreground' : 'text-muted-foreground'}
                  >
                    {p.name}
                  </span>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="px-2.5 py-2 text-sm text-muted-foreground">
                No properties match “{query}”.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
