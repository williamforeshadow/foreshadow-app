'use client';

import { useEffect, useState } from 'react';
import {
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
      { type, native_enabled: true, slack_enabled: false },
    ]),
  ) as PreferenceMap;
}

export function NotificationPreferencesPanel() {
  const [preferences, setPreferences] = useState<PreferenceMap>(defaults);
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
    field: 'native_enabled' | 'slack_enabled',
    value: boolean,
  ) => {
    const next = {
      ...preferences[type],
      [field]: value,
    };
    setPreferences((current) => ({ ...current, [type]: next }));
    setSaving(type);
    try {
      const res = await fetch('/api/notification-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        setPreferences((current) => ({
          ...current,
          [type]: preferences[type],
        }));
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
              <div className="flex items-center gap-5">
                <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                  <input
                    type="checkbox"
                    checked={pref.native_enabled}
                    disabled={loading || saving === type}
                    onChange={(event) =>
                      updatePreference(type, 'native_enabled', event.target.checked)
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
                      updatePreference(type, 'slack_enabled', event.target.checked)
                    }
                    className="h-4 w-4 rounded border-neutral-300"
                  />
                  Slack
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
