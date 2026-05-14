'use client';

import { useEffect, useState } from 'react';
import {
  DEFAULT_DUE_TODAY_TIME,
  NOTIFICATION_TYPE_DESCRIPTIONS,
  NOTIFICATION_TYPE_LABELS,
  NOTIFICATION_TYPES,
  type NotificationPreference,
  type NotificationType,
} from '@/lib/notifications';

type PreferenceMap = Record<NotificationType, NotificationPreference>;

function defaults(): PreferenceMap {
  return Object.fromEntries(
    NOTIFICATION_TYPES.map((type) => [
      type,
      {
        type,
        native_enabled: true,
        slack_enabled: false,
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
          return (
            <div
              key={type}
              className="grid gap-3 py-4 sm:grid-cols-[1fr_auto]"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-neutral-900 dark:text-white">
                  {NOTIFICATION_TYPE_LABELS[type]}
                </p>
                <p className="mt-1 text-sm leading-5 text-neutral-500 dark:text-neutral-400">
                  {NOTIFICATION_TYPE_DESCRIPTIONS[type]}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="flex items-center gap-5">
                  <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                    <input
                      type="checkbox"
                      checked={pref.native_enabled}
                      disabled={loading || saving === type}
                      onChange={(event) =>
                        updatePreference(type, {
                          native_enabled: event.target.checked,
                        })
                      }
                      className="h-4 w-4 rounded border-neutral-300"
                    />
                    Native
                  </label>
                  <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                    <input
                      type="checkbox"
                      checked={pref.slack_enabled}
                      disabled={loading || saving === type}
                      onChange={(event) =>
                        updatePreference(type, {
                          slack_enabled: event.target.checked,
                        })
                      }
                      className="h-4 w-4 rounded border-neutral-300"
                    />
                    Slack
                  </label>
                </div>
                {type === 'task_due_today' ? (
                  <div className="flex flex-col items-end gap-1">
                    <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                      <span>Send at</span>
                      <select
                        value={pref.due_today_time ?? DEFAULT_DUE_TODAY_TIME}
                        disabled={loading || saving === type}
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
                    {orgTimezone ? (
                      <p className="text-xs text-neutral-500 dark:text-neutral-400">
                        Times are in your org timezone ({orgTimezone}).
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
