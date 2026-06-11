'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { MultiSelect, type FilterOption } from '@/components/tasks/TaskFilterBar';

type PreferenceMap = Record<NotificationType, NotificationPreference>;

function defaults(): PreferenceMap {
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

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => {
  const value = `${String(hour).padStart(2, '0')}:00`;
  const period = hour >= 12 ? 'PM' : 'AM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return { value, label: `${display}:00 ${period}` };
});

export function NotificationPreferencesPanel() {
  const [preferences, setPreferences] = useState<PreferenceMap>(defaults);
  const [orgTimezone, setOrgTimezone] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<NotificationType | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const res = await fetch('/api/notification-preferences', {
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        if (!cancelled) {
          const next = defaults();
          for (const pref of data.preferences ?? []) {
            if (NOTIFICATION_TYPES.includes(pref.type)) {
              next[pref.type as NotificationType] = pref;
            }
          }
          setPreferences(next);
          if (typeof data.org_timezone === 'string') {
            setOrgTimezone(data.org_timezone);
          }
        }
      }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const updatePreference = async (
    type: NotificationType,
    patch: Partial<NotificationPreference>,
  ) => {
    const previous = preferences[type];
    const next = { ...previous, ...patch };
    setPreferences((current) => ({ ...current, [type]: next }));
    setSaving(type);
    try {
      const res = await fetch('/api/notification-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        setPreferences((current) => ({ ...current, [type]: previous }));
      }
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-6">
    <section className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">
          Notifications
        </h2>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Choose where task notifications show up.
        </p>
      </div>
      <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
        {NOTIFICATION_TYPES.map((type) => {
          const pref = preferences[type];
          const enabled = pref.native_enabled;
          const switchDisabled = loading || saving === type;
          return (
            <div key={type} className="py-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-neutral-900 dark:text-white">
                    {NOTIFICATION_TYPE_LABELS[type]}
                  </p>
                  <p className="mt-1 text-sm leading-5 text-neutral-500 dark:text-neutral-400">
                    {NOTIFICATION_TYPE_DESCRIPTIONS[type]}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  {type === 'task_due_today' && enabled ? (
                    <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                      <span>Send at</span>
                      <select
                        value={pref.due_today_time ?? DEFAULT_DUE_TODAY_TIME}
                        disabled={switchDisabled}
                        onChange={(event) =>
                          updatePreference(type, {
                            due_today_time: event.target.value,
                          })
                        }
                        className="h-8 rounded-md border border-neutral-300 bg-white px-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
                      >
                        {HOUR_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={`Toggle ${NOTIFICATION_TYPE_LABELS[type]}`}
                    disabled={switchDisabled}
                    onClick={() =>
                      updatePreference(type, { native_enabled: !enabled })
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      enabled
                        ? 'bg-[var(--accent-3)]'
                        : 'bg-neutral-200 dark:bg-neutral-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              </div>
              {enabled ? (
                <div className="mt-3 flex flex-col gap-2 pl-0 sm:pl-4">
                  <label
                    className={`inline-flex items-center gap-2 text-sm ${
                      switchDisabled
                        ? 'text-neutral-400 dark:text-neutral-600'
                        : 'text-neutral-700 dark:text-neutral-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={pref.slack_enabled}
                      disabled={switchDisabled}
                      onChange={(event) =>
                        updatePreference(type, {
                          slack_enabled: event.target.checked,
                        })
                      }
                      className="h-4 w-4 rounded border-neutral-300 accent-[var(--accent-3)]"
                    />
                    Also notify in Slack
                  </label>
                  <label
                    className={`inline-flex items-center gap-2 text-sm ${
                      switchDisabled
                        ? 'text-neutral-400 dark:text-neutral-600'
                        : 'text-neutral-700 dark:text-neutral-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={pref.push_enabled}
                      disabled={switchDisabled}
                      onChange={(event) =>
                        updatePreference(type, {
                          push_enabled: event.target.checked,
                        })
                      }
                      className="h-4 w-4 rounded border-neutral-300 accent-[var(--accent-3)]"
                    />
                    Also send a push to my phone
                  </label>
                </div>
              ) : null}
              {type === 'task_due_today' && enabled && orgTimezone ? (
                <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                  Times are in your org timezone ({orgTimezone}).
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
    <ProposalNotificationPreferences />
    </div>
  );
}

interface PropertyPrefRow {
  property_id: string;
  type: PropertyNotificationType;
  native_enabled: boolean;
  slack_enabled: boolean;
  push_enabled: boolean;
}

/**
 * Per-property opt-in for the two conversation-scoped proposal notifications.
 * Opt-in: a property is "on" for a type when a row exists. Selecting a property
 * creates the row (native on); deselecting deletes it. The Slack/push toggles
 * apply to every currently-selected property for that type.
 */
function ProposalNotificationPreferences() {
  const [properties, setProperties] = useState<{ id: string; name: string }[]>([]);
  const [rows, setRows] = useState<PropertyPrefRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [propsRes, prefsRes] = await Promise.all([
        fetch('/api/properties').then((r) => r.json()).catch(() => ({})),
        fetch('/api/notification-property-preferences', { cache: 'no-store' })
          .then((r) => r.json())
          .catch(() => ({})),
      ]);
      if (cancelled) return;
      setProperties(
        Array.isArray(propsRes?.properties)
          ? propsRes.properties.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name }))
          : [],
      );
      setRows(Array.isArray(prefsRes?.preferences) ? prefsRes.preferences : []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const propertyOptions = useMemo<FilterOption[]>(
    () => properties.map((p) => ({ value: p.id, label: p.name })),
    [properties],
  );

  const rowFor = (type: PropertyNotificationType, propertyId: string) =>
    rows.find((r) => r.type === type && r.property_id === propertyId) ?? null;

  const selectedFor = (type: PropertyNotificationType) =>
    new Set(rows.filter((r) => r.type === type).map((r) => r.property_id));

  // Type-level channel intent: a channel is "on" for a type when ANY opted-in
  // property has it on (or, when nothing is selected yet, the sensible default).
  const channelOn = (type: PropertyNotificationType, channel: 'slack' | 'push') => {
    const typeRows = rows.filter((r) => r.type === type);
    if (typeRows.length === 0) return channel === 'push';
    return typeRows.some((r) =>
      channel === 'slack' ? r.slack_enabled : r.push_enabled,
    );
  };

  const patch = async (body: {
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
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data?.preferences)) setRows(data.preferences);
    }
  };

  const handleSelectionChange = async (
    type: PropertyNotificationType,
    next: Set<string>,
  ) => {
    const prev = selectedFor(type);
    const added = [...next].filter((id) => !prev.has(id));
    const removed = [...prev].filter((id) => !next.has(id));
    setBusy(true);
    try {
      for (const id of added) {
        await patch({
          property_id: id,
          type,
          native_enabled: true,
          slack_enabled: channelOn(type, 'slack'),
          push_enabled: channelOn(type, 'push'),
        });
      }
      for (const id of removed) {
        // All channels false → the API deletes the row (opt out).
        await patch({
          property_id: id,
          type,
          native_enabled: false,
          slack_enabled: false,
          push_enabled: false,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleChannelToggle = async (
    type: PropertyNotificationType,
    channel: 'slack' | 'push',
    value: boolean,
  ) => {
    const selected = [...selectedFor(type)];
    if (selected.length === 0) return;
    setBusy(true);
    try {
      for (const id of selected) {
        const existing = rowFor(type, id);
        await patch({
          property_id: id,
          type,
          native_enabled: existing?.native_enabled ?? true,
          slack_enabled: channel === 'slack' ? value : existing?.slack_enabled ?? false,
          push_enabled: channel === 'push' ? value : existing?.push_enabled ?? true,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">
          Proposal notifications
        </h2>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Get notified when the concierge drafts something for review. Choose which
          properties you want these for.
        </p>
      </div>

      <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
        {PROPERTY_NOTIFICATION_TYPES.map((type) => {
          const selected = selectedFor(type);
          const anySelected = selected.size > 0;
          return (
            <div key={type} className="py-4">
              <p className="text-sm font-medium text-neutral-900 dark:text-white">
                {PROPERTY_NOTIFICATION_TYPE_LABELS[type]}
              </p>
              <p className="mt-1 text-sm leading-5 text-neutral-500 dark:text-neutral-400">
                {PROPERTY_NOTIFICATION_TYPE_DESCRIPTIONS[type]}
              </p>
              <div className="mt-3 max-w-sm">
                <MultiSelect
                  label="Properties"
                  options={propertyOptions}
                  selected={selected}
                  onChange={(next) => handleSelectionChange(type, next)}
                  searchable
                />
                {loading ? (
                  <p className="mt-1.5 text-xs text-neutral-400">Loading…</p>
                ) : !anySelected ? (
                  <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                    Off everywhere. Pick a property to start receiving these.
                  </p>
                ) : null}
              </div>
              {anySelected ? (
                <div className="mt-3 flex flex-col gap-2 sm:pl-1">
                  <label className="inline-flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                    <input
                      type="checkbox"
                      checked={channelOn(type, 'slack')}
                      disabled={busy}
                      onChange={(e) => handleChannelToggle(type, 'slack', e.target.checked)}
                      className="h-4 w-4 rounded border-neutral-300 accent-[var(--accent-3)]"
                    />
                    Also notify in Slack
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                    <input
                      type="checkbox"
                      checked={channelOn(type, 'push')}
                      disabled={busy}
                      onChange={(e) => handleChannelToggle(type, 'push', e.target.checked)}
                      className="h-4 w-4 rounded border-neutral-300 accent-[var(--accent-3)]"
                    />
                    Also send a push to my phone
                  </label>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
