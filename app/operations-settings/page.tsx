'use client';

import { useEffect, useMemo, useState } from 'react';
import DesktopSidebarShell from '@/components/DesktopSidebarShell';
import { AdaptivePicker } from '@/components/tasks/detail/primitives/AdaptivePicker';
import { TaskOptionRow } from '@/components/tasks/detail/primitives/TaskSheet';
import { FieldRow, SectionLabel, TokenDateTime } from '@/components/ui/panel/PanelForm';
import { useOperationsSettings } from '@/lib/operationsSettingsContext';
import { TIMEZONE_OPTIONS, TIMEZONE_GROUPS } from '@/src/lib/timezones';

// Operations Settings page
//
// Currently exposes only the org-wide default check-in / check-out times,
// which the Reservation detail panel uses to compose time-precise turnover
// window boundaries (so same-day turnovers correctly split tasks between the
// outgoing and incoming reservation).
//
// Times are wall-clock 'HH:MM' strings — see operations_settings table.

/** Matched to the other pages in this section so they line up. */
const DETAIL_COL = 'mx-auto w-full max-w-[46rem]';

const ICONS = {
  clock: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" />
    </svg>
  ),
  globe: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5a13 13 0 010 17 13 13 0 010-17z" />
    </svg>
  ),
  alert: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
      <path d="M12 4l9 16H3l9-16z" /><path d="M12 10v4M12 17.5v.5" />
    </svg>
  ),
};

/** A labelled row whose control sits on the right — the shape ToggleRow uses,
 *  with the switch swapped for whatever control the setting needs. */
function SettingRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b" style={{ borderColor: 'var(--task-line-soft)' }}>
      <div className="flex items-center justify-between gap-3 px-[18px] py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0" style={{ color: 'var(--task-ink-3)' }}>
            {icon}
          </span>
          <span
            className="truncate text-[length:var(--task-fs-option)]"
            style={{ color: 'var(--task-ink-1)' }}
          >
            {label}
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function OperationsSettingsPage() {
  const { settings, loading, error, migrationPending, save } = useOperationsSettings();

  const [checkInTime, setCheckInTime] = useState(settings.default_check_in_time);
  const [checkOutTime, setCheckOutTime] = useState(settings.default_check_out_time);
  const [defaultTimezone, setDefaultTimezone] = useState(settings.default_timezone);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [tzOpen, setTzOpen] = useState(false);

  // Re-sync local form state whenever the persisted settings change (initial
  // load, refresh after save, etc.). Local edits stay in sync without trapping
  // us in a stale form.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setCheckInTime(settings.default_check_in_time);
      setCheckOutTime(settings.default_check_out_time);
      setDefaultTimezone(settings.default_timezone);
    });
    return () => cancelAnimationFrame(id);
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

  const tzLabel = useMemo(
    () => TIMEZONE_OPTIONS.find((o) => o.value === defaultTimezone)?.label ?? defaultTimezone,
    [defaultTimezone],
  );

  const disabled = loading || saving;

  return (
    <DesktopSidebarShell>
      <div
        className="panel-form flex flex-1 flex-col overflow-hidden"
        style={{ background: 'var(--task-surface-0)' }}
      >
        <div className="flex-1 overflow-y-auto">
          <div className={DETAIL_COL}>
            {migrationPending && (
              <div
                className="mx-[18px] mt-3 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[length:var(--task-fs-body-sm)]"
                style={{
                  borderColor: 'var(--task-amber)',
                  background: 'var(--task-amber-soft)',
                  color: 'var(--task-amber)',
                }}
              >
                {ICONS.alert}
                <div>
                  <p className="font-medium">Database migration pending</p>
                  <p className="mt-0.5" style={{ color: 'var(--task-ink-2)' }}>
                    The <code className="font-mono">operations_settings</code> table doesn&apos;t
                    exist yet. Run the migration in Supabase Studio, then refresh this page. Until
                    then the app will use the default times shown below.
                  </p>
                </div>
              </div>
            )}

            {error && !migrationPending && (
              <div
                className="mx-[18px] mt-3 rounded-lg border px-3 py-2.5 text-[length:var(--task-fs-body-sm)]"
                style={{
                  borderColor: 'var(--task-amber)',
                  background: 'var(--task-amber-soft)',
                  color: 'var(--task-amber)',
                }}
              >
                {error}
              </div>
            )}

            <SectionLabel>Turnover times</SectionLabel>

            <SettingRow icon={ICONS.clock} label="Default check-in time">
              <TokenDateTime
                type="time"
                value={checkInTime}
                onChange={setCheckInTime}
                ariaLabel="Default check-in time"
                disabled={disabled}
              />
            </SettingRow>

            <SettingRow icon={ICONS.clock} label="Default check-out time">
              <TokenDateTime
                type="time"
                value={checkOutTime}
                onChange={setCheckOutTime}
                ariaLabel="Default check-out time"
                disabled={disabled}
              />
            </SettingRow>

            <SectionLabel>Timezone</SectionLabel>

            <div
              className="border-b px-[18px] pb-3 text-[length:var(--task-fs-body-sm)]"
              style={{ borderColor: 'var(--task-line-soft)', color: 'var(--task-ink-3)' }}
            >
              The fallback timezone for properties that don&apos;t have one set explicitly. Used for
              daily notifications and resolving &ldquo;today&rdquo; for scheduled tasks.
            </div>

            <AdaptivePicker
              open={tzOpen}
              onOpenChange={setTzOpen}
              title="Default timezone"
              disabled={disabled}
              trigger={<FieldRow icon={ICONS.globe} value={tzLabel} placeholder="Select timezone…" />}
            >
              {TIMEZONE_GROUPS.map((group) => {
                const options = TIMEZONE_OPTIONS.filter((o) => o.group === group);
                if (options.length === 0) return null;
                return (
                  <div key={group}>
                    {/* Group heading — the native <optgroup> this replaced. */}
                    <div
                      className="px-2.5 pb-1 pt-2 font-mono text-[length:var(--task-fs-label)] uppercase tracking-[0.14em]"
                      style={{ color: 'var(--task-ink-3)' }}
                    >
                      {group}
                    </div>
                    {options.map((o) => (
                      <TaskOptionRow
                        key={o.value}
                        selected={o.value === defaultTimezone}
                        onSelect={() => {
                          setDefaultTimezone(o.value);
                          setTzOpen(false);
                        }}
                      >
                        {o.label}
                      </TaskOptionRow>
                    ))}
                  </div>
                );
              })}
            </AdaptivePicker>
          </div>
        </div>

        {/* Action bar */}
        <div
          className="w-full shrink-0 border-t"
          style={{ borderColor: 'var(--task-line-soft)', background: 'var(--task-surface-1)' }}
        >
          <div className={`${DETAIL_COL} flex items-center gap-3 px-[18px] py-3`}>
            <div className="min-w-0 flex-1 font-mono text-[length:var(--task-fs-label)] uppercase tracking-[0.14em]">
              {saveError ? (
                <span style={{ color: 'var(--task-amber)' }}>{saveError}</span>
              ) : savedAt ? (
                <span style={{ color: 'var(--task-ink-3)' }}>Saved</span>
              ) : null}
            </div>
            <button
              type="button"
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
              className="h-[46px] shrink-0 rounded-xl px-6 font-mono text-[length:var(--task-fs-cta)] uppercase tracking-[0.1em] transition-all active:scale-[0.98] disabled:opacity-50"
              style={{ background: 'var(--task-accent)', color: '#fff' }}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </DesktopSidebarShell>
  );
}
