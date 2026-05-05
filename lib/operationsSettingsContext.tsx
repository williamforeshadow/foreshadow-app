'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  ReactNode,
} from 'react';

import { DEFAULT_TIMEZONE } from '@/src/lib/dates';

// OperationsSettings — org-wide defaults loaded once at app boot.
//
// Times are wall-clock 'HH:MM' strings. The app deliberately avoids Date /
// Intl.DateTimeFormat for these because each property may live in its own
// timezone and we treat the user-entered value as universal across the app.
//
// `default_timezone` is the org-wide IANA timezone fallback (e.g.
// "America/Los_Angeles"). Properties without an explicit timezone inherit this.

export interface OperationsSettings {
  default_check_in_time: string; // 'HH:MM'
  default_check_out_time: string; // 'HH:MM'
  default_timezone: string; // IANA tz, e.g. 'America/Los_Angeles'
  updated_at: string | null;
}

interface OperationsSettingsContextType {
  settings: OperationsSettings;
  loading: boolean;
  error: string | null;
  /** True when the operations_settings table is missing in Supabase (migration not applied yet). */
  migrationPending: boolean;
  refresh: () => Promise<void>;
  save: (next: {
    default_check_in_time: string;
    default_check_out_time: string;
    default_timezone: string;
  }) => Promise<{ ok: true } | { ok: false; error: string; migrationPending?: boolean }>;
}

// Defaults match the SQL seed. Kept in sync intentionally so the UI has a
// sane render even on a cold cache or a failed fetch.
const DEFAULT_SETTINGS: OperationsSettings = {
  default_check_in_time: '15:00',
  default_check_out_time: '11:00',
  default_timezone: DEFAULT_TIMEZONE,
  updated_at: null,
};

const OperationsSettingsContext = createContext<OperationsSettingsContextType | null>(null);

export function OperationsSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<OperationsSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [migrationPending, setMigrationPending] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch('/api/operations-settings', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to load operations settings');
      }
      // The API soft-degrades to defaults + migration_pending when the table
      // is missing. Treat that as an info state, not an error, so consumers
      // (e.g. ReservationDetailPanel) keep rendering with defaults.
      setMigrationPending(Boolean(data?.migration_pending));
      if (data?.settings) {
        setSettings({
          default_check_in_time: data.settings.default_check_in_time || DEFAULT_SETTINGS.default_check_in_time,
          default_check_out_time: data.settings.default_check_out_time || DEFAULT_SETTINGS.default_check_out_time,
          default_timezone: data.settings.default_timezone || DEFAULT_SETTINGS.default_timezone,
          updated_at: data.settings.updated_at ?? null,
        });
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load operations settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const save = useCallback<OperationsSettingsContextType['save']>(
    async (next) => {
      try {
        const res = await fetch('/api/operations-settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(next),
        });
        const data = await res.json();
        if (!res.ok) {
          if (data?.migration_pending) {
            setMigrationPending(true);
          }
          return {
            ok: false,
            error: data?.error || 'Failed to save settings',
            migrationPending: Boolean(data?.migration_pending),
          };
        }
        setMigrationPending(false);
        if (data?.settings) {
          setSettings({
            default_check_in_time: data.settings.default_check_in_time || next.default_check_in_time,
            default_check_out_time: data.settings.default_check_out_time || next.default_check_out_time,
            default_timezone: data.settings.default_timezone || next.default_timezone,
            updated_at: data.settings.updated_at ?? null,
          });
        } else {
          setSettings((prev) => ({
            ...prev,
            ...next,
            updated_at: new Date().toISOString(),
          }));
        }
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err?.message || 'Failed to save settings' };
      }
    },
    []
  );

  const value = useMemo<OperationsSettingsContextType>(
    () => ({ settings, loading, error, migrationPending, refresh: fetchSettings, save }),
    [settings, loading, error, migrationPending, fetchSettings, save]
  );

  return (
    <OperationsSettingsContext.Provider value={value}>
      {children}
    </OperationsSettingsContext.Provider>
  );
}

export function useOperationsSettings() {
  const ctx = useContext(OperationsSettingsContext);
  if (!ctx) {
    throw new Error('useOperationsSettings must be used within an OperationsSettingsProvider');
  }
  return ctx;
}
