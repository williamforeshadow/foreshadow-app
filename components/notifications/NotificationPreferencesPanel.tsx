'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, MessageSquare, Smartphone, ChevronDown, Search } from 'lucide-react';
import {
  DEFAULT_DUE_TODAY_TIME,
  NOTIFICATION_TYPE_DESCRIPTIONS,
  NOTIFICATION_TYPE_LABELS,
  NOTIFICATION_TYPES,
  PROPERTY_NOTIFICATION_TYPES,
  PROPERTY_NOTIFICATION_TYPE_DESCRIPTIONS,
  PROPERTY_NOTIFICATION_TYPE_LABELS,
  type NotificationPreference,
  type NotificationType,
  type PropertyNotificationType,
} from '@/lib/notifications';

// Notification preferences.
//
// Two surfaces, one consistent control vocabulary (the channel toggle):
//   1. Task notifications — a per-type × per-channel matrix (in-app / Slack /
//      push). The three channels are independent booleans in the data model
//      (notify.ts checks each), so they read as three peer toggles, not a
//      master + sub-options. task_due_today adds an org-timezone time picker.
//   2. Proposal notifications — per-property opt-in for the three concierge
//      proposal types, with Slack/push channels per type. In-app is implied by
//      opting a property in.
//
// Every mutation is OPTIMISTIC (local state flips instantly); the PATCH runs in
// the background and we resync from the server only if it fails. Bulk actions
// (select all / clear / a channel across all properties) fire in PARALLEL, so
// they're instant instead of N sequential round-trips.

type ChannelKey = 'native_enabled' | 'slack_enabled' | 'push_enabled';

const CHANNELS: { key: ChannelKey; label: string; Icon: typeof Bell }[] = [
  { key: 'native_enabled', label: 'In-app', Icon: Bell },
  { key: 'slack_enabled', label: 'Slack', Icon: MessageSquare },
  { key: 'push_enabled', label: 'Push', Icon: Smartphone },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => {
  const value = `${String(hour).padStart(2, '0')}:00`;
  const period = hour >= 12 ? 'PM' : 'AM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return { value, label: `${display}:00 ${period}` };
});

type PreferenceMap = Record<NotificationType, NotificationPreference>;

function defaultGlobal(): PreferenceMap {
  return Object.fromEntries(
    NOTIFICATION_TYPES.map((type) => [
      type,
      {
        type,
        native_enabled: true,
        slack_enabled: false,
        push_enabled: true,
        due_today_time: type === 'task_due_today' ? DEFAULT_DUE_TODAY_TIME : null,
      },
    ]),
  ) as PreferenceMap;
}

interface PropertyPrefRow {
  property_id: string;
  type: PropertyNotificationType;
  native_enabled: boolean;
  slack_enabled: boolean;
  push_enabled: boolean;
}

// --- shared control: one compact channel toggle -----------------------------

function ChannelToggle({
  active,
  onToggle,
  disabled,
  Icon,
  label,
}: {
  active: boolean;
  onToggle: () => void;
  disabled?: boolean;
  Icon: typeof Bell;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={label}
      title={`${label}: ${active ? 'on' : 'off'}`}
      disabled={disabled}
      onClick={onToggle}
      className={`inline-flex h-8 w-9 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'border-transparent bg-[var(--accent-3)] text-white'
          : 'border-neutral-200 bg-transparent text-neutral-400 hover:border-neutral-300 hover:text-neutral-600 dark:border-neutral-700 dark:text-neutral-500 dark:hover:border-neutral-600 dark:hover:text-neutral-300'
      }`}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );
}

function ColumnHeader() {
  return (
    <div className="hidden shrink-0 items-end gap-1 sm:flex">
      {CHANNELS.map((c) => (
        <span
          key={c.key}
          className="w-9 text-center text-[10px] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500"
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}

// --- main -------------------------------------------------------------------

export function NotificationPreferencesPanel() {
  const [global, setGlobal] = useState<PreferenceMap>(defaultGlobal);
  const [propRows, setPropRows] = useState<PropertyPrefRow[]>([]);
  const [properties, setProperties] = useState<{ id: string; name: string }[]>([]);
  const [orgTimezone, setOrgTimezone] = useState('');
  const [loading, setLoading] = useState(true);

  const refetchProps = useCallback(async () => {
    const res = await fetch('/api/notification-property-preferences', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setPropRows(Array.isArray(data.preferences) ? data.preferences : []);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [globalRes, propsRes, propPrefsRes] = await Promise.all([
        fetch('/api/notification-preferences', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
        fetch('/api/properties').then((r) => r.json()).catch(() => ({})),
        fetch('/api/notification-property-preferences', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
      ]);
      if (cancelled) return;
      const next = defaultGlobal();
      for (const pref of globalRes?.preferences ?? []) {
        if (NOTIFICATION_TYPES.includes(pref.type)) next[pref.type as NotificationType] = pref;
      }
      setGlobal(next);
      if (typeof globalRes?.org_timezone === 'string') setOrgTimezone(globalRes.org_timezone);
      setProperties(
        Array.isArray(propsRes?.properties)
          ? propsRes.properties.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name }))
          : [],
      );
      setPropRows(Array.isArray(propPrefsRes?.preferences) ? propPrefsRes.preferences : []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- global (task) mutations: optimistic, revert on failure --------------
  const updateGlobal = useCallback(
    async (type: NotificationType, patch: Partial<NotificationPreference>) => {
      let previous: NotificationPreference | undefined;
      setGlobal((cur) => {
        previous = cur[type];
        return { ...cur, [type]: { ...cur[type], ...patch } };
      });
      const body = { ...(previous as NotificationPreference), ...patch };
      const res = await fetch('/api/notification-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => null);
      if ((!res || !res.ok) && previous) {
        setGlobal((cur) => ({ ...cur, [type]: previous as NotificationPreference }));
      }
    },
    [],
  );

  // ---- property mutations: optimistic + parallel ---------------------------
  const patchProperty = useCallback(
    async (body: {
      property_id: string;
      type: PropertyNotificationType;
      native_enabled: boolean;
      slack_enabled: boolean;
      push_enabled: boolean;
    }) => {
      const res = await fetch('/api/notification-property-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => null);
      return Boolean(res && res.ok);
    },
    [],
  );

  /** Apply a set of desired rows for a type optimistically, then PATCH all in parallel. */
  const applyPropertyRows = useCallback(
    async (
      type: PropertyNotificationType,
      desired: Map<string, { native_enabled: boolean; slack_enabled: boolean; push_enabled: boolean }>,
    ) => {
      // Optimistic: replace this type's rows with the desired set (a row is
      // present only when at least one channel is on — matching server semantics).
      setPropRows((cur) => {
        const others = cur.filter((r) => r.type !== type);
        const next: PropertyPrefRow[] = [...others];
        for (const [property_id, ch] of desired) {
          if (ch.native_enabled || ch.slack_enabled || ch.push_enabled) {
            next.push({ property_id, type, ...ch });
          }
        }
        return next;
      });

      const results = await Promise.all(
        [...desired].map(([property_id, ch]) => patchProperty({ property_id, type, ...ch })),
      );
      if (results.some((ok) => !ok)) {
        await refetchProps(); // resync if any write failed
      }
    },
    [patchProperty, refetchProps],
  );

  if (loading) return <PanelSkeleton />;

  return (
    <div className="space-y-8">
      <TaskMatrix
        global={global}
        orgTimezone={orgTimezone}
        onUpdate={updateGlobal}
      />
      <ProposalSettings
        properties={properties}
        rows={propRows}
        onApply={applyPropertyRows}
      />
    </div>
  );
}

// --- section 1: task notification matrix ------------------------------------

function TaskMatrix({
  global,
  orgTimezone,
  onUpdate,
}: {
  global: PreferenceMap;
  orgTimezone: string;
  onUpdate: (type: NotificationType, patch: Partial<NotificationPreference>) => void;
}) {
  return (
    <section>
      <header className="mb-1 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 dark:text-white">
            Task notifications
          </h2>
          <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
            Where each task update reaches you.
          </p>
        </div>
        <ColumnHeader />
      </header>

      <div className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800/70">
          {NOTIFICATION_TYPES.map((type) => {
            const pref = global[type];
            return (
              <div key={type} className="px-4 py-2.5">
                <div className="flex items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">
                      {NOTIFICATION_TYPE_LABELS[type]}
                    </p>
                    <p className="mt-0.5 line-clamp-1 text-xs text-neutral-500 dark:text-neutral-400">
                      {NOTIFICATION_TYPE_DESCRIPTIONS[type]}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {CHANNELS.map((c) => (
                      <ChannelToggle
                        key={c.key}
                        Icon={c.Icon}
                        label={`${NOTIFICATION_TYPE_LABELS[type]} · ${c.label}`}
                        active={pref[c.key]}
                        onToggle={() => onUpdate(type, { [c.key]: !pref[c.key] })}
                      />
                    ))}
                  </div>
                </div>

                {type === 'task_due_today' && pref.native_enabled ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                    <span>Send at</span>
                    <select
                      value={pref.due_today_time ?? DEFAULT_DUE_TODAY_TIME}
                      onChange={(e) => onUpdate(type, { due_today_time: e.target.value })}
                      className="h-7 rounded-md border border-neutral-200 bg-transparent px-2 text-xs text-neutral-800 focus:border-[var(--accent-3)] focus:outline-none dark:border-neutral-700 dark:text-neutral-100"
                    >
                      {HOUR_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    {orgTimezone ? <span>· {orgTimezone}</span> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// --- section 2: per-property proposal notifications -------------------------

function ProposalSettings({
  properties,
  rows,
  onApply,
}: {
  properties: { id: string; name: string }[];
  rows: PropertyPrefRow[];
  onApply: (
    type: PropertyNotificationType,
    desired: Map<string, { native_enabled: boolean; slack_enabled: boolean; push_enabled: boolean }>,
  ) => void;
}) {
  return (
    <section>
      <header className="mb-2">
        <h2 className="text-[15px] font-semibold text-neutral-900 dark:text-white">
          Proposal notifications
        </h2>
        <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
          When the concierge drafts something for review. Off by default — pick the properties you want.
        </p>
      </header>

      <div className="space-y-3">
        {PROPERTY_NOTIFICATION_TYPES.map((type) => (
          <ProposalTypeRow
            key={type}
            type={type}
            properties={properties}
            rows={rows.filter((r) => r.type === type)}
            onApply={onApply}
          />
        ))}
      </div>
    </section>
  );
}

function ProposalTypeRow({
  type,
  properties,
  rows,
  onApply,
}: {
  type: PropertyNotificationType;
  properties: { id: string; name: string }[];
  rows: PropertyPrefRow[];
  onApply: (
    type: PropertyNotificationType,
    desired: Map<string, { native_enabled: boolean; slack_enabled: boolean; push_enabled: boolean }>,
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = useMemo(() => new Set(rows.map((r) => r.property_id)), [rows]);
  // Channels are type-level: on if any opted-in property has them on (default: push on).
  const slackOn = rows.length > 0 ? rows.some((r) => r.slack_enabled) : false;
  const pushOn = rows.length > 0 ? rows.some((r) => r.push_enabled) : true;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? properties.filter((p) => p.name.toLowerCase().includes(q)) : properties;
  }, [properties, query]);

  // Build the desired full row-set for this type from the current selection,
  // overriding one dimension. A row exists only for selected properties.
  const buildDesired = (
    nextSelected: Set<string>,
    channels: { slack: boolean; push: boolean },
  ) => {
    const desired = new Map<string, { native_enabled: boolean; slack_enabled: boolean; push_enabled: boolean }>();
    // Include deselected properties as all-false so the server deletes their rows.
    for (const p of properties) {
      const on = nextSelected.has(p.id);
      desired.set(p.id, {
        native_enabled: on,
        slack_enabled: on && channels.slack,
        push_enabled: on && channels.push,
      });
    }
    return desired;
  };

  const toggleProperty = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onApply(type, buildDesired(next, { slack: slackOn, push: pushOn }));
  };
  const selectAll = () => onApply(type, buildDesired(new Set(filtered.map((p) => p.id).concat([...selected])), { slack: slackOn, push: pushOn }));
  const clearAll = () => {
    const next = new Set(selected);
    filtered.forEach((p) => next.delete(p.id));
    onApply(type, buildDesired(next, { slack: slackOn, push: pushOn }));
  };
  const setChannel = (channel: 'slack' | 'push', value: boolean) => {
    onApply(type, buildDesired(selected, {
      slack: channel === 'slack' ? value : slackOn,
      push: channel === 'push' ? value : pushOn,
    }));
  };

  const count = selected.size;
  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.id));

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
            {PROPERTY_NOTIFICATION_TYPE_LABELS[type]}
          </p>
          <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            {PROPERTY_NOTIFICATION_TYPE_DESCRIPTIONS[type]}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          {count > 0 ? `${count} propert${count === 1 ? 'y' : 'ies'}` : 'Choose properties'}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      </div>

      {/* Channel toggles for the type, shown once a property is opted in. */}
      {count > 0 ? (
        <div className="flex items-center gap-2 border-t border-neutral-100 px-4 py-2 dark:border-neutral-800/70">
          <span className="mr-1 text-xs text-neutral-500 dark:text-neutral-400">Deliver via</span>
          <span className="inline-flex h-7 items-center gap-1.5 rounded-md bg-[var(--accent-bg-soft)] px-2 text-xs font-medium text-[var(--accent-3)]">
            <Bell className="h-3.5 w-3.5" aria-hidden /> In-app
          </span>
          <ChannelToggle Icon={MessageSquare} label={`${PROPERTY_NOTIFICATION_TYPE_LABELS[type]} · Slack`} active={slackOn} onToggle={() => setChannel('slack', !slackOn)} />
          <ChannelToggle Icon={Smartphone} label={`${PROPERTY_NOTIFICATION_TYPE_LABELS[type]} · Push`} active={pushOn} onToggle={() => setChannel('push', !pushOn)} />
        </div>
      ) : null}

      {open ? (
        <div className="border-t border-neutral-100 dark:border-neutral-800/70">
          {properties.length === 0 ? (
            <p className="px-4 py-4 text-xs text-neutral-500 dark:text-neutral-400">No properties available.</p>
          ) : (
            <>
              <div className="flex items-center gap-2 px-3 py-2">
                {properties.length > 8 ? (
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" aria-hidden />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search properties"
                      className="h-8 w-full rounded-md border border-neutral-200 bg-transparent pl-7 pr-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-[var(--accent-3)] focus:outline-none dark:border-neutral-700 dark:text-neutral-100"
                    />
                  </div>
                ) : (
                  <span className="flex-1" />
                )}
                <button
                  type="button"
                  onClick={selectAll}
                  disabled={allFilteredSelected || filtered.length === 0}
                  className="rounded-md px-2 py-1 text-xs font-medium text-[var(--accent-3)] hover:underline disabled:text-neutral-300 disabled:no-underline dark:disabled:text-neutral-600"
                >
                  Select all{query ? ' shown' : ''}
                </button>
                <button
                  type="button"
                  onClick={clearAll}
                  disabled={!filtered.some((p) => selected.has(p.id))}
                  className="rounded-md px-2 py-1 text-xs font-medium text-neutral-500 hover:underline disabled:text-neutral-300 disabled:no-underline dark:text-neutral-400 dark:disabled:text-neutral-600"
                >
                  Clear{query ? ' shown' : ''}
                </button>
              </div>
              <div className="max-h-60 overflow-auto px-1 pb-2">
                {filtered.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-neutral-500 dark:text-neutral-400">No matches.</p>
                ) : (
                  filtered.map((p) => {
                    const on = selected.has(p.id);
                    return (
                      <label
                        key={p.id}
                        className="flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-1.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) => toggleProperty(p.id, e.target.checked)}
                          className="h-4 w-4 rounded border-neutral-300 accent-[var(--accent-3)]"
                        />
                        <span className="truncate text-neutral-700 dark:text-neutral-200">{p.name}</span>
                      </label>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-8" aria-hidden>
      {[0, 1].map((s) => (
        <div key={s} className="space-y-3">
          <div className="h-5 w-44 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
          <div className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
            {[0, 1, 2, 3].map((r) => (
              <div key={r} className="flex items-center justify-between px-4 py-3">
                <div className="h-4 w-48 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/70" />
                <div className="h-7 w-28 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/70" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
