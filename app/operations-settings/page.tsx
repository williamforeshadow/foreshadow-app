'use client';

import { useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import { SidebarToggleButton } from '@/components/SidebarToggleButton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useOperationsSettings } from '@/lib/operationsSettingsContext';
import { Clock, Globe, Save, AlertTriangle } from 'lucide-react';
import { TIMEZONE_OPTIONS, TIMEZONE_GROUPS } from '@/src/lib/timezones';

// Operations Settings page
//
// Currently exposes only the org-wide default check-in / check-out times,
// which the Reservation detail panel uses to compose time-precise turnover
// window boundaries (so same-day turnovers correctly split tasks between the
// outgoing and incoming reservation).
//
// Times are wall-clock 'HH:MM' strings — see operations_settings table.

export default function OperationsSettingsPage() {
  const { settings, loading, error, migrationPending, save } = useOperationsSettings();

  const [checkInTime, setCheckInTime] = useState(settings.default_check_in_time);
  const [checkOutTime, setCheckOutTime] = useState(settings.default_check_out_time);
  const [defaultTimezone, setDefaultTimezone] = useState(settings.default_timezone);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Re-sync local form state whenever the persisted settings change (initial
  // load, refresh after save, etc.). Local edits stay in sync without trapping
  // us in a stale form.
  useEffect(() => {
    setCheckInTime(settings.default_check_in_time);
    setCheckOutTime(settings.default_check_out_time);
    setDefaultTimezone(settings.default_timezone);
  }, [settings.default_check_in_time, settings.default_check_out_time, settings.default_timezone]);

  const isDirty =
    checkInTime !== settings.default_check_in_time ||
    checkOutTime !== settings.default_check_out_time ||
    defaultTimezone !== settings.default_timezone;

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    const result = await save({
      default_check_in_time: checkInTime,
      default_check_out_time: checkOutTime,
      default_timezone: defaultTimezone,
    });
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    setSavedAt(Date.now());
  };

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-card">
      {/* Top bar — sidebar toggle + page title in a single full-width row
          above the sidebar. */}
      <div className="flex-shrink-0 px-3 py-2 bg-white dark:bg-card border-b border-neutral-200 dark:border-neutral-800 flex items-center gap-2">
        <SidebarToggleButton />
        <h1 className="text-base font-semibold text-neutral-900 dark:text-white truncate">
          Operations Settings
        </h1>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-auto p-6">
            <div className="max-w-2xl space-y-6">
            {migrationPending && (
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-800 dark:text-amber-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Database migration pending</p>
                  <p className="mt-0.5 text-amber-700 dark:text-amber-300">
                    The <code className="font-mono text-[12px]">operations_settings</code> table doesn&apos;t exist yet. Run the migration in Supabase Studio, then refresh this page. Until then the app will use the default times shown below.
                  </p>
                </div>
              </div>
            )}

            {error && !migrationPending && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
                {error}
              </div>
            )}

            <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-card">
              <header className="px-5 pt-5 pb-3 border-b border-neutral-200 dark:border-neutral-800">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-neutral-500" />
                  <h2 className="text-base font-semibold text-neutral-900 dark:text-white">
                    Default check-in &amp; check-out times
                  </h2>
                </div>
              </header>

              <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <label
                    htmlFor="default-check-in"
                    className="text-sm font-medium text-neutral-700 dark:text-neutral-300"
                  >
                    Default check-in time
                  </label>
                  <Input
                    id="default-check-in"
                    type="time"
                    value={checkInTime}
                    onChange={(e) => setCheckInTime(e.target.value)}
                    disabled={loading || saving}
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="default-check-out"
                    className="text-sm font-medium text-neutral-700 dark:text-neutral-300"
                  >
                    Default check-out time
                  </label>
                  <Input
                    id="default-check-out"
                    type="time"
                    value={checkOutTime}
                    onChange={(e) => setCheckOutTime(e.target.value)}
                    disabled={loading || saving}
                  />
                </div>
              </div>

              <footer className="px-5 py-4 border-t border-neutral-200 dark:border-neutral-800" />
            </section>

            <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-card">
              <header className="px-5 pt-5 pb-3 border-b border-neutral-200 dark:border-neutral-800">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-neutral-500" />
                  <h2 className="text-base font-semibold text-neutral-900 dark:text-white">
                    Default timezone
                  </h2>
                </div>
                <p className="mt-1.5 text-sm text-neutral-500 dark:text-neutral-400">
                  The fallback timezone for properties that don&apos;t have one set explicitly.
                  Used for daily notifications and resolving &ldquo;today&rdquo; for scheduled tasks.
                </p>
              </header>

              <div className="p-5">
                <div className="space-y-1.5 max-w-xs">
                  <label
                    htmlFor="default-timezone"
                    className="text-sm font-medium text-neutral-700 dark:text-neutral-300"
                  >
                    Timezone
                  </label>
                  <select
                    id="default-timezone"
                    value={defaultTimezone}
                    onChange={(e) => setDefaultTimezone(e.target.value)}
                    disabled={loading || saving}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 border border-neutral-200 dark:border-neutral-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                  >
                    {TIMEZONE_GROUPS.map((group) => (
                      <optgroup key={group} label={group}>
                        {TIMEZONE_OPTIONS.filter((o) => o.group === group).map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              </div>

              <footer className="px-5 py-4 border-t border-neutral-200 dark:border-neutral-800" />
            </section>

            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                {saveError ? (
                  <span className="text-red-600 dark:text-red-400">{saveError}</span>
                ) : savedAt ? (
                  <span className="text-emerald-600 dark:text-emerald-400">Saved</span>
                ) : null}
              </div>
              <Button
                onClick={handleSave}
                disabled={
                  !isDirty ||
                  saving ||
                  loading ||
                  migrationPending ||
                  !checkInTime ||
                  !checkOutTime
                }
                title={migrationPending ? 'Run the database migration before saving' : undefined}
              >
                <Save className="w-4 h-4 mr-2" />
                {saving ? 'Saving...' : 'Save changes'}
              </Button>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
