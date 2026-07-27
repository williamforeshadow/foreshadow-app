'use client';

import * as React from 'react';
import { useState } from 'react';
import { AdaptivePicker } from '@/components/tasks/detail/primitives/AdaptivePicker';
import { TaskOptionRow } from '@/components/tasks/detail/primitives/TaskSheet';
import {
  FieldRow,
  PersonRow,
  SectionLabel,
  SegmentedRow,
  SentenceRow,
  SentenceText,
  TokenDateTime,
  TokenNumber,
  TokenSelect,
  ToggleRow,
  personTone,
} from '@/components/ui/panel/PanelForm';
import {
  type AutomationConfig,
  type AutomationTriggerType,
  type AutomationScheduleType,
  type AutomationScheduleRelativeTo,
  type AutomationPreset,
  type User,
  type OccupancyDurationOperator,
  type RecurringIntervalUnit,
} from '@/lib/types';
import ContingentTasksConfig from './ContingentTasksConfig';
import InfoTooltip from './InfoTooltip';

// ============================================================================
// Props
// ============================================================================

interface AutomationConfigFormProps {
  config: AutomationConfig;
  onChange: (config: AutomationConfig) => void;
  users: User[];
  presets: AutomationPreset[];
  isNew: boolean;
  onSavePreset?: () => void;
}

// ============================================================================
// Option tables — wording preserved verbatim from the original selects.
// ============================================================================

const TRIGGER_OPTIONS: { value: AutomationTriggerType; label: string }[] = [
  { value: 'turnover', label: 'Turnover' },
  { value: 'occupancy', label: 'Occupancy' },
  { value: 'vacancy', label: 'Vacancy' },
  { value: 'recurring', label: 'Recurring' },
];

const SCHEDULE_TYPE_OPTIONS: { value: AutomationScheduleType; label: string }[] = [
  { value: 'on', label: 'On' },
  { value: 'before', label: 'Before' },
  { value: 'after', label: 'After' },
];

const RELATIVE_TO_OPTIONS: { value: AutomationScheduleRelativeTo; label: string }[] = [
  { value: 'check_out', label: 'Check-out' },
  { value: 'next_check_in', label: 'Next Check-in' },
];

const OPERATOR_OPTIONS: { value: OccupancyDurationOperator; label: string }[] = [
  { value: 'gte', label: 'greater than or equal to' },
  { value: 'eq', label: 'equal to' },
  { value: 'gt', label: 'greater than' },
  { value: 'lt', label: 'less than' },
  { value: 'lte', label: 'less than or equal to' },
  { value: 'between', label: 'between' },
];

const INTERVAL_UNIT_OPTIONS: { value: RecurringIntervalUnit; label: string }[] = [
  { value: 'days', label: 'day(s)' },
  { value: 'weeks', label: 'week(s)' },
  { value: 'months', label: 'month(s)' },
  { value: 'years', label: 'year(s)' },
];

const ICONS = {
  bookmark: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4h12v16l-6-4-6 4z" />
    </svg>
  ),
  stack: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" />
    </svg>
  ),
};

// ============================================================================
// A choice inside a sentence: chip trigger, picker list with the full labels.
// ============================================================================

function SelectToken<T extends string>({
  value,
  options,
  onChange,
  title,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <AdaptivePicker
      open={open}
      onOpenChange={setOpen}
      title={title}
      trigger={<TokenSelect aria-label={title}>{current?.label ?? value}</TokenSelect>}
    >
      {options.map((o) => (
        <TaskOptionRow
          key={o.value}
          selected={o.value === value}
          onSelect={() => {
            onChange(o.value);
            setOpen(false);
          }}
        >
          {o.label}
        </TaskOptionRow>
      ))}
    </AdaptivePicker>
  );
}

// ============================================================================
// Duration Condition UI (shared between occupancy and vacancy)
// ============================================================================

function DurationConditionUI({
  label,
  condition,
  onUpdate,
}: {
  label: string;
  condition: { operator: OccupancyDurationOperator; days: number; days_end?: number };
  onUpdate: (field: string, value: unknown) => void;
}) {
  return (
    <SentenceRow>
      <SentenceText>If {label} is</SentenceText>
      <SelectToken
        title="Condition"
        value={condition.operator}
        options={OPERATOR_OPTIONS}
        onChange={(value) => onUpdate('operator', value)}
      />
      <TokenNumber
        ariaLabel={`${label} days`}
        min={1}
        value={condition.days}
        onChange={(next) => onUpdate('days', next || 1)}
      />
      {condition.operator === 'between' && (
        <>
          <SentenceText>and</SentenceText>
          <TokenNumber
            ariaLabel={`${label} days end`}
            min={1}
            value={condition.days_end || condition.days + 1}
            onChange={(next) => onUpdate('days_end', next || 1)}
          />
        </>
      )}
      <SentenceText>days</SentenceText>
    </SentenceRow>
  );
}

// ============================================================================
// Period Schedule UI (shared between occupancy and vacancy)
// ============================================================================

function PeriodScheduleUI({
  label,
  schedule,
  onUpdateField,
  onUpdateRepeat,
}: {
  label: string; // "occupancy" or "vacancy"
  schedule: {
    day_of_period: number;
    time: string;
    repeat: { enabled: boolean; interval_days: number };
  };
  onUpdateField: (field: string, value: unknown) => void;
  onUpdateRepeat: (field: string, value: unknown) => void;
}) {
  // Auto-Scheduling is implicit — the wrapping toggle was removed because
  // every auto-generated task must carry a scheduled date for the panel to
  // associate it with a reservation's turnover window.
  return (
    <>
      <SectionLabel>
        <span className="inline-flex items-center gap-1.5">
          Schedule
          <InfoTooltip text={`When tasks are scheduled during the ${label} period`} />
        </span>
      </SectionLabel>

      <SentenceRow>
        <SentenceText>Schedule task on day</SentenceText>
        <TokenNumber
          ariaLabel={`Day of ${label}`}
          min={1}
          value={schedule.day_of_period}
          onChange={(next) => onUpdateField('day_of_period', next || 1)}
        />
        <SentenceText>of {label} at</SentenceText>
        <TokenDateTime
          type="time"
          ariaLabel={`${label} schedule time`}
          value={schedule.time || '10:00'}
          onChange={(next) => onUpdateField('time', next)}
        />
      </SentenceRow>

      <ToggleRow
        label="Repeat Scheduling"
        hint={<InfoTooltip text={`Create recurring tasks during the ${label}`} />}
        checked={schedule.repeat.enabled}
        onChange={() => onUpdateRepeat('enabled', !schedule.repeat.enabled)}
      />

      {schedule.repeat.enabled && (
        <SentenceRow>
          <SentenceText>Repeats every</SentenceText>
          <TokenNumber
            ariaLabel="Repeat interval days"
            min={1}
            value={schedule.repeat.interval_days}
            onChange={(next) => onUpdateRepeat('interval_days', next || 1)}
          />
          <SentenceText>day(s)</SentenceText>
        </SentenceRow>
      )}
    </>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function AutomationConfigForm({
  config,
  onChange,
  users,
  presets,
  isNew,
  onSavePreset,
}: AutomationConfigFormProps) {
  const [loadPresetOpen, setLoadPresetOpen] = useState(false);

  // ---- Generic update helpers ----
  const updateConfig = <K extends keyof AutomationConfig>(key: K, value: AutomationConfig[K]) => {
    onChange({ ...config, [key]: value });
  };

  const updateSchedule = (field: string, value: unknown) => {
    onChange({ ...config, schedule: { ...config.schedule, [field]: value } });
  };

  const updateSameDaySchedule = (field: string, value: unknown) => {
    onChange({
      ...config,
      same_day_override: {
        ...config.same_day_override,
        schedule: { ...config.same_day_override.schedule, [field]: value },
      },
    });
  };

  const updateAutoAssign = (field: string, value: unknown) => {
    onChange({ ...config, auto_assign: { ...config.auto_assign, [field]: value } });
  };

  // ---- Occupancy helpers ----
  const updateOccupancyCondition = (field: string, value: unknown) => {
    onChange({ ...config, occupancy_condition: { ...config.occupancy_condition!, [field]: value } });
  };

  const updateOccupancySchedule = (field: string, value: unknown) => {
    onChange({ ...config, occupancy_schedule: { ...config.occupancy_schedule!, [field]: value } });
  };

  const updateOccupancyRepeat = (field: string, value: unknown) => {
    if (!config.occupancy_schedule) return;
    onChange({
      ...config,
      occupancy_schedule: {
        ...config.occupancy_schedule,
        repeat: { ...config.occupancy_schedule.repeat, [field]: value },
      },
    });
  };

  // ---- Recurring helpers ----
  const updateRecurringSchedule = (field: string, value: unknown) => {
    onChange({ ...config, recurring_schedule: { ...config.recurring_schedule!, [field]: value } });
  };

  // ---- Vacancy helpers ----
  const updateVacancyCondition = (field: string, value: unknown) => {
    onChange({ ...config, vacancy_condition: { ...config.vacancy_condition!, [field]: value } });
  };

  const updateVacancySchedule = (field: string, value: unknown) => {
    onChange({ ...config, vacancy_schedule: { ...config.vacancy_schedule!, [field]: value } });
  };

  const updateVacancyRepeat = (field: string, value: unknown) => {
    if (!config.vacancy_schedule) return;
    onChange({
      ...config,
      vacancy_schedule: {
        ...config.vacancy_schedule,
        repeat: { ...config.vacancy_schedule.repeat, [field]: value },
      },
    });
  };

  // ---- Preset loading ----
  const handleLoadPreset = (preset: AutomationPreset) => {
    onChange({
      ...config,
      trigger_type: preset.trigger_type,
      schedule: preset.config.schedule,
      same_day_override: preset.config.same_day_override,
      auto_assign: preset.config.auto_assign,
      preset_id: preset.id,
    });
  };

  // ---- User toggle ----
  const toggleUserAssignment = (userId: string) => {
    const currentIds = config.auto_assign.user_ids;
    const newIds = currentIds.includes(userId)
      ? currentIds.filter(id => id !== userId)
      : [...currentIds, userId];
    updateAutoAssign('user_ids', newIds);
  };

  const presetPicker = (
    <AdaptivePicker
      open={loadPresetOpen}
      onOpenChange={setLoadPresetOpen}
      title="Load preset"
      align="end"
      trigger={<FieldRow icon={ICONS.stack} placeholder="Load preset…" />}
    >
      {presets.map((preset) => (
        <TaskOptionRow
          key={preset.id}
          selected={preset.id === config.preset_id}
          onSelect={() => {
            handleLoadPreset(preset);
            setLoadPresetOpen(false);
          }}
        >
          {preset.name}
        </TaskOptionRow>
      ))}
    </AdaptivePicker>
  );

  return (
    <div className="flex flex-col">
      {/* ================================================================
          Trigger Type
          ================================================================ */}
      <SectionLabel>Trigger</SectionLabel>
      <SegmentedRow
        options={TRIGGER_OPTIONS}
        value={config.trigger_type}
        onChange={(value) => updateConfig('trigger_type', value)}
      />

      {/* ================================================================
          Enable Auto-generation — all trigger types. Occupancy and vacancy
          additionally gate on a duration condition.
          ================================================================ */}
      <SectionLabel>Activation</SectionLabel>
      <ToggleRow
        label="Enable Auto-generation"
        checked={config.enabled}
        onChange={() => updateConfig('enabled', !config.enabled)}
      />

      {config.trigger_type === 'occupancy' && config.enabled && config.occupancy_condition && (
        <DurationConditionUI
          label="occupancy period"
          condition={config.occupancy_condition}
          onUpdate={updateOccupancyCondition}
        />
      )}

      {config.trigger_type === 'vacancy' && config.enabled && config.vacancy_condition && (
        <DurationConditionUI
          label="vacancy period"
          condition={config.vacancy_condition}
          onUpdate={updateVacancyCondition}
        />
      )}

      {/* ================================================================
          Trigger-specific Schedule Sections (only when enabled)
          ================================================================ */}
      {config.enabled && (
        <>
          {/* TURNOVER: Schedule Configuration
              Auto-Scheduling is implicit now — every auto-generated task
              must have a date so it can render under a reservation's
              "Associated tasks" section (which filters purely by
              scheduled_date in the turnover window). The toggle that
              previously gated this block was removed. */}
          {config.trigger_type === 'turnover' && (
            <>
              <SectionLabel>
                <span className="inline-flex items-center gap-1.5">
                  Schedule
                  <InfoTooltip text="When auto-generated tasks are scheduled relative to the reservation" />
                </span>
              </SectionLabel>

              <SentenceRow>
                <SentenceText>Schedule task</SentenceText>
                <SelectToken
                  title="Schedule"
                  value={config.schedule.type}
                  options={SCHEDULE_TYPE_OPTIONS}
                  onChange={(value) => updateSchedule('type', value)}
                />

                {config.schedule.type !== 'on' && (
                  <>
                    <TokenNumber
                      ariaLabel="Days offset"
                      min={0}
                      value={config.schedule.days_offset}
                      onChange={(next) => updateSchedule('days_offset', next || 0)}
                    />
                    <SentenceText>day(s)</SentenceText>
                  </>
                )}

                <SelectToken
                  title="Relative to"
                  value={config.schedule.relative_to}
                  options={RELATIVE_TO_OPTIONS}
                  onChange={(value) => updateSchedule('relative_to', value)}
                />

                <SentenceText>at</SentenceText>
                <TokenDateTime
                  type="time"
                  ariaLabel="Schedule time"
                  value={config.schedule.time}
                  onChange={(next) => updateSchedule('time', next)}
                />
              </SentenceRow>

              {/* Same-day override */}
              <ToggleRow
                label="Same-Day Turnover Override"
                hint={<InfoTooltip text="Different schedule when checkout & next check-in are same day" />}
                checked={config.same_day_override.enabled}
                onChange={() => updateConfig('same_day_override', {
                  ...config.same_day_override,
                  enabled: !config.same_day_override.enabled,
                })}
              />

              {config.same_day_override.enabled && (
                <SentenceRow>
                  <SentenceText>Schedule task</SentenceText>
                  <SelectToken
                    title="Schedule"
                    value={config.same_day_override.schedule.type}
                    options={SCHEDULE_TYPE_OPTIONS}
                    onChange={(value) => updateSameDaySchedule('type', value)}
                  />

                  {config.same_day_override.schedule.type !== 'on' && (
                    <>
                      <TokenNumber
                        ariaLabel="Same-day days offset"
                        min={0}
                        value={config.same_day_override.schedule.days_offset}
                        onChange={(next) => updateSameDaySchedule('days_offset', next || 0)}
                      />
                      <SentenceText>day(s)</SentenceText>
                    </>
                  )}

                  <SelectToken
                    title="Relative to"
                    value={config.same_day_override.schedule.relative_to}
                    options={RELATIVE_TO_OPTIONS}
                    onChange={(value) => updateSameDaySchedule('relative_to', value)}
                  />

                  <SentenceText>at</SentenceText>
                  <TokenDateTime
                    type="time"
                    ariaLabel="Same-day schedule time"
                    value={config.same_day_override.schedule.time}
                    onChange={(next) => updateSameDaySchedule('time', next)}
                  />
                </SentenceRow>
              )}
            </>
          )}

          {/* OCCUPANCY: Schedule Configuration */}
          {config.trigger_type === 'occupancy' && config.occupancy_schedule && (
            <PeriodScheduleUI
              label="occupancy"
              schedule={{
                day_of_period: config.occupancy_schedule.day_of_occupancy,
                time: config.occupancy_schedule.time,
                repeat: config.occupancy_schedule.repeat,
              }}
              onUpdateField={(field, value) => {
                const mappedField = field === 'day_of_period' ? 'day_of_occupancy' : field;
                updateOccupancySchedule(mappedField, value);
              }}
              onUpdateRepeat={updateOccupancyRepeat}
            />
          )}

          {/* VACANCY: Schedule Configuration. Task Generation Limit is
              always shown now (it used to be hidden behind the Auto-Scheduling
              toggle). */}
          {config.trigger_type === 'vacancy' && config.vacancy_schedule && (
            <>
              <PeriodScheduleUI
                label="vacancy"
                schedule={{
                  day_of_period: config.vacancy_schedule.day_of_vacancy,
                  time: config.vacancy_schedule.time,
                  repeat: config.vacancy_schedule.repeat,
                }}
                onUpdateField={(field, value) => {
                  const mappedField = field === 'day_of_period' ? 'day_of_vacancy' : field;
                  updateVacancySchedule(mappedField, value);
                }}
                onUpdateRepeat={updateVacancyRepeat}
              />

              <SectionLabel>
                <span className="inline-flex items-center gap-1.5">
                  Task Generation Limit
                  <InfoTooltip text="When there is no upcoming booking, limit how far ahead tasks are generated" />
                </span>
              </SectionLabel>
              <SentenceRow>
                <SentenceText>Generate tasks up to</SentenceText>
                <TokenNumber
                  ariaLabel="Max days ahead"
                  min={7}
                  value={config.vacancy_schedule.max_days_ahead}
                  onChange={(next) => updateVacancySchedule('max_days_ahead', next || 90)}
                />
                <SentenceText>days ahead when no next booking exists</SentenceText>
              </SentenceRow>
            </>
          )}

          {/* RECURRING: Schedule Configuration */}
          {config.trigger_type === 'recurring' && config.recurring_schedule && (
            <>
              <SectionLabel>
                <span className="inline-flex items-center gap-1.5">
                  Recurring Schedule
                  <InfoTooltip text="Configure when this task starts and how often it repeats" />
                </span>
              </SectionLabel>

              <SentenceRow>
                <SentenceText>Starting on</SentenceText>
                <TokenDateTime
                  type="date"
                  ariaLabel="Start date"
                  value={config.recurring_schedule.start_date}
                  onChange={(next) => updateRecurringSchedule('start_date', next)}
                />
                <SentenceText>at</SentenceText>
                <TokenDateTime
                  type="time"
                  ariaLabel="Start time"
                  value={config.recurring_schedule.time}
                  onChange={(next) => updateRecurringSchedule('time', next)}
                />
              </SentenceRow>

              <SentenceRow>
                <SentenceText>Repeats every</SentenceText>
                <TokenNumber
                  ariaLabel="Repeat interval"
                  min={1}
                  value={config.recurring_schedule.interval_value}
                  onChange={(next) => updateRecurringSchedule('interval_value', next || 1)}
                />
                <SelectToken
                  title="Interval"
                  value={config.recurring_schedule.interval_unit}
                  options={INTERVAL_UNIT_OPTIONS}
                  onChange={(value) => updateRecurringSchedule('interval_unit', value)}
                />
              </SentenceRow>
            </>
          )}

          {/* ================================================================
              Contingent Tasks (shared for all trigger types)
              ================================================================ */}
          {config.contingent && (
            <ContingentTasksConfig
              config={config.contingent}
              onChange={(contingent) => updateConfig('contingent', contingent)}
            />
          )}

          {/* ================================================================
              Auto-Assign (shared for all trigger types)
              ================================================================ */}
          <SectionLabel>Assignment</SectionLabel>
          <ToggleRow
            label="Auto-Assign Users"
            hint={<InfoTooltip text="Automatically assign users to generated tasks" />}
            checked={config.auto_assign.enabled}
            onChange={() => updateAutoAssign('enabled', !config.auto_assign.enabled)}
          />

          {config.auto_assign.enabled && (
            users.length > 0 ? (
              users.map((user, i) => (
                <PersonRow
                  key={user.id}
                  name={user.name}
                  role={user.role}
                  avatarUrl={user.avatar}
                  tone={personTone(i)}
                  selected={config.auto_assign.user_ids.includes(user.id)}
                  onToggle={() => toggleUserAssignment(user.id)}
                />
              ))
            ) : (
              <div
                className="border-b px-[18px] py-3 text-[length:var(--task-fs-body-sm)]"
                style={{ borderColor: 'var(--task-line-soft)', color: 'var(--task-ink-3)' }}
              >
                No users available.
              </div>
            )
          )}

          {/* ================================================================
              Preset Actions
              ================================================================ */}
          {!isNew && onSavePreset && (
            <>
              <SectionLabel>Presets</SectionLabel>
              <FieldRow
                icon={ICONS.bookmark}
                placeholder="Save as preset"
                chevron={false}
                onClick={onSavePreset}
              />
              {presets.length > 0 && presetPicker}
            </>
          )}

          {isNew && presets.length > 0 && (
            <>
              <SectionLabel>Presets</SectionLabel>
              {presetPicker}
            </>
          )}
        </>
      )}
    </div>
  );
}
