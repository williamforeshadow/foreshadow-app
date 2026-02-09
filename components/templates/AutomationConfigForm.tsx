'use client';

import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldLabel,
} from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
// Reusable Toggle Component
// ============================================================================

function Toggle({ checked, onChange, color = 'purple' }: { checked: boolean; onChange: () => void; color?: string }) {
  const bgColor = checked
    ? color === 'purple' ? 'bg-purple-600' : 'bg-blue-600'
    : 'bg-neutral-300 dark:bg-neutral-600';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${bgColor}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
        checked ? 'translate-x-6' : 'translate-x-1'
      }`} />
    </button>
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
    <div className="flex items-center gap-2 flex-wrap pt-2">
      <span className="text-sm text-neutral-600 dark:text-neutral-400">If {label} is</span>
      <Select
        value={condition.operator}
        onValueChange={(value) => onUpdate('operator', value as OccupancyDurationOperator)}
      >
        <SelectTrigger className="w-44 h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="gte">greater than or equal to</SelectItem>
          <SelectItem value="eq">equal to</SelectItem>
          <SelectItem value="gt">greater than</SelectItem>
          <SelectItem value="lt">less than</SelectItem>
          <SelectItem value="lte">less than or equal to</SelectItem>
          <SelectItem value="between">between</SelectItem>
        </SelectContent>
      </Select>
      <Input
        type="number"
        min={1}
        value={condition.days}
        onChange={(e) => onUpdate('days', parseInt(e.target.value) || 1)}
        className="w-20 h-9"
      />
      {condition.operator === 'between' && (
        <>
          <span className="text-sm text-neutral-600 dark:text-neutral-400">and</span>
          <Input
            type="number"
            min={1}
            value={condition.days_end || condition.days + 1}
            onChange={(e) => onUpdate('days_end', parseInt(e.target.value) || 1)}
            className="w-20 h-9"
          />
        </>
      )}
      <span className="text-sm text-neutral-600 dark:text-neutral-400">days</span>
    </div>
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
    enabled: boolean;
    day_of_period: number;
    time: string;
    repeat: { enabled: boolean; interval_days: number };
  };
  onUpdateField: (field: string, value: unknown) => void;
  onUpdateRepeat: (field: string, value: unknown) => void;
}) {
  return (
    <div className="border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium text-sm">Auto-Scheduling</div>
          <div className="text-xs text-neutral-500">Schedule task during {label} period</div>
        </div>
        <Toggle checked={schedule.enabled} onChange={() => onUpdateField('enabled', !schedule.enabled)} />
      </div>

      {schedule.enabled && (
        <div className="space-y-4 pt-2">
          {/* Day of period */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-neutral-600 dark:text-neutral-400">Schedule task on day</span>
            <Input
              type="number"
              min={1}
              value={schedule.day_of_period}
              onChange={(e) => onUpdateField('day_of_period', parseInt(e.target.value) || 1)}
              className="w-20 h-9"
            />
            <span className="text-sm text-neutral-600 dark:text-neutral-400">of {label} at</span>
            <Input
              type="time"
              value={schedule.time || '10:00'}
              onChange={(e) => onUpdateField('time', e.target.value)}
              className="w-32 h-9"
            />
          </div>

          {/* Repeat scheduling */}
          <div className="border-t pt-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">Repeat Scheduling</div>
                <div className="text-xs text-neutral-500">Create recurring tasks during the {label}</div>
              </div>
              <Toggle checked={schedule.repeat.enabled} onChange={() => onUpdateRepeat('enabled', !schedule.repeat.enabled)} />
            </div>

            {schedule.repeat.enabled && (
              <div className="flex items-center gap-2 flex-wrap pt-3">
                <span className="text-sm text-neutral-600 dark:text-neutral-400">Repeats every</span>
                <Input
                  type="number"
                  min={1}
                  value={schedule.repeat.interval_days}
                  onChange={(e) => onUpdateRepeat('interval_days', parseInt(e.target.value) || 1)}
                  className="w-20 h-9"
                />
                <span className="text-sm text-neutral-600 dark:text-neutral-400">day(s)</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
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

  return (
    <div className="space-y-6">
      {/* ================================================================
          Trigger Type
          ================================================================ */}
      <Field>
        <FieldLabel>Trigger Type</FieldLabel>
        <Select
          value={config.trigger_type}
          onValueChange={(value) => updateConfig('trigger_type', value as AutomationTriggerType)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="turnover">Turnover Association</SelectItem>
            <SelectItem value="occupancy">Occupancy Period</SelectItem>
            <SelectItem value="vacancy">Vacancy Period</SelectItem>
            <SelectItem value="recurring">Recurring</SelectItem>
          </SelectContent>
        </Select>
        <FieldDescription>When should this task be generated?</FieldDescription>
      </Field>

      {/* ================================================================
          Enable Auto-generation — Turnover
          ================================================================ */}
      {config.trigger_type === 'turnover' && (
        <div className="flex items-center justify-between p-4 bg-neutral-50 dark:bg-neutral-800 rounded-lg">
          <div>
            <div className="font-medium">Enable Auto-generation</div>
          </div>
          <Toggle checked={config.enabled} onChange={() => updateConfig('enabled', !config.enabled)} />
        </div>
      )}

      {/* ================================================================
          Enable Auto-generation — Occupancy (with condition)
          ================================================================ */}
      {config.trigger_type === 'occupancy' && (
        <div className="border rounded-lg p-4 space-y-4 bg-neutral-50 dark:bg-neutral-800">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Enable Auto-generation</div>
            </div>
            <Toggle checked={config.enabled} onChange={() => updateConfig('enabled', !config.enabled)} />
          </div>

          {config.enabled && config.occupancy_condition && (
            <DurationConditionUI
              label="occupancy period"
              condition={config.occupancy_condition}
              onUpdate={updateOccupancyCondition}
            />
          )}
        </div>
      )}

      {/* ================================================================
          Enable Auto-generation — Vacancy (with condition)
          ================================================================ */}
      {config.trigger_type === 'vacancy' && (
        <div className="border rounded-lg p-4 space-y-4 bg-neutral-50 dark:bg-neutral-800">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Enable Auto-generation</div>
            </div>
            <Toggle checked={config.enabled} onChange={() => updateConfig('enabled', !config.enabled)} />
          </div>

          {config.enabled && config.vacancy_condition && (
            <DurationConditionUI
              label="vacancy period"
              condition={config.vacancy_condition}
              onUpdate={updateVacancyCondition}
            />
          )}
        </div>
      )}

      {/* ================================================================
          Enable Auto-generation — Recurring (with schedule)
          ================================================================ */}
      {config.trigger_type === 'recurring' && (
        <div className="flex items-center justify-between p-4 bg-neutral-50 dark:bg-neutral-800 rounded-lg">
          <div>
            <div className="font-medium">Enable Auto-generation</div>
          </div>
          <Toggle checked={config.enabled} onChange={() => updateConfig('enabled', !config.enabled)} />
        </div>
      )}

      {/* ================================================================
          Trigger-specific Schedule Sections (only when enabled)
          ================================================================ */}
      {config.enabled && (
        <>
          {/* TURNOVER: Schedule Configuration */}
          {config.trigger_type === 'turnover' && (
            <div className="border rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">Auto-Scheduling</div>
                  <div className="text-xs text-neutral-500">Automatically set task scheduled time</div>
                </div>
                <Toggle checked={config.schedule.enabled} onChange={() => updateSchedule('enabled', !config.schedule.enabled)} />
              </div>

              {config.schedule.enabled && (
                <div className="space-y-4 pt-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Select
                      value={config.schedule.type}
                      onValueChange={(value) => updateSchedule('type', value as AutomationScheduleType)}
                    >
                      <SelectTrigger className="w-32 h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="on">On</SelectItem>
                        <SelectItem value="before">Before</SelectItem>
                        <SelectItem value="after">After</SelectItem>
                      </SelectContent>
                    </Select>

                    {config.schedule.type !== 'on' && (
                      <Input
                        type="number"
                        min={0}
                        value={config.schedule.days_offset}
                        onChange={(e) => updateSchedule('days_offset', parseInt(e.target.value) || 0)}
                        className="w-20 h-9"
                      />
                    )}

                    {config.schedule.type !== 'on' && (
                      <span className="text-sm text-neutral-600 dark:text-neutral-400">day(s)</span>
                    )}

                    <Select
                      value={config.schedule.relative_to}
                      onValueChange={(value) => updateSchedule('relative_to', value as AutomationScheduleRelativeTo)}
                    >
                      <SelectTrigger className="w-40 h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="check_out">Check-out</SelectItem>
                        <SelectItem value="next_check_in">Next Check-in</SelectItem>
                      </SelectContent>
                    </Select>

                    <span className="text-sm text-neutral-600 dark:text-neutral-400">at</span>
                    <Input
                      type="time"
                      value={config.schedule.time}
                      onChange={(e) => updateSchedule('time', e.target.value)}
                      className="w-32 h-9"
                    />
                  </div>

                  {/* Same-day override */}
                  <div className="border-t pt-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className="font-medium text-sm">Same-Day Turnover Override</div>
                        <div className="text-xs text-neutral-500">Different schedule when checkout & next check-in are same day</div>
                      </div>
                      <Toggle
                        checked={config.same_day_override.enabled}
                        onChange={() => updateConfig('same_day_override', {
                          ...config.same_day_override,
                          enabled: !config.same_day_override.enabled,
                        })}
                      />
                    </div>

                    {config.same_day_override.enabled && (
                      <div className="flex items-center gap-2 flex-wrap pt-2 pl-4 border-l-2 border-purple-200 dark:border-purple-800">
                        <Select
                          value={config.same_day_override.schedule.type}
                          onValueChange={(value) => updateSameDaySchedule('type', value as AutomationScheduleType)}
                        >
                          <SelectTrigger className="w-32 h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="on">On</SelectItem>
                            <SelectItem value="before">Before</SelectItem>
                            <SelectItem value="after">After</SelectItem>
                          </SelectContent>
                        </Select>

                        {config.same_day_override.schedule.type !== 'on' && (
                          <>
                            <Input
                              type="number"
                              min={0}
                              value={config.same_day_override.schedule.days_offset}
                              onChange={(e) => updateSameDaySchedule('days_offset', parseInt(e.target.value) || 0)}
                              className="w-20 h-9"
                            />
                            <span className="text-sm text-neutral-600 dark:text-neutral-400">day(s)</span>
                          </>
                        )}

                        <Select
                          value={config.same_day_override.schedule.relative_to}
                          onValueChange={(value) => updateSameDaySchedule('relative_to', value as AutomationScheduleRelativeTo)}
                        >
                          <SelectTrigger className="w-40 h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="check_out">Check-out</SelectItem>
                            <SelectItem value="next_check_in">Next Check-in</SelectItem>
                          </SelectContent>
                        </Select>

                        <span className="text-sm text-neutral-600 dark:text-neutral-400">at</span>
                        <Input
                          type="time"
                          value={config.same_day_override.schedule.time}
                          onChange={(e) => updateSameDaySchedule('time', e.target.value)}
                          className="w-32 h-9"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* OCCUPANCY: Schedule Configuration */}
          {config.trigger_type === 'occupancy' && config.occupancy_schedule && (
            <PeriodScheduleUI
              label="occupancy"
              schedule={{
                enabled: config.occupancy_schedule.enabled,
                day_of_period: config.occupancy_schedule.day_of_occupancy,
                time: config.occupancy_schedule.time,
                repeat: config.occupancy_schedule.repeat,
              }}
              onUpdateField={(field, value) => {
                // Map day_of_period back to day_of_occupancy
                const mappedField = field === 'day_of_period' ? 'day_of_occupancy' : field;
                updateOccupancySchedule(mappedField, value);
              }}
              onUpdateRepeat={updateOccupancyRepeat}
            />
          )}

          {/* VACANCY: Schedule Configuration */}
          {config.trigger_type === 'vacancy' && config.vacancy_schedule && (
            <>
              <PeriodScheduleUI
                label="vacancy"
                schedule={{
                  enabled: config.vacancy_schedule.enabled,
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

              {/* Vacancy-specific: Max days ahead */}
              {config.vacancy_schedule.enabled && (
                <div className="border rounded-lg p-4 space-y-2">
                  <div className="font-medium text-sm">Task Generation Limit</div>
                  <div className="text-xs text-neutral-500">
                    When there is no upcoming booking, limit how far ahead tasks are generated
                  </div>
                  <div className="flex items-center gap-2 flex-wrap pt-2">
                    <span className="text-sm text-neutral-600 dark:text-neutral-400">Generate tasks up to</span>
                    <Input
                      type="number"
                      min={7}
                      value={config.vacancy_schedule.max_days_ahead}
                      onChange={(e) => updateVacancySchedule('max_days_ahead', parseInt(e.target.value) || 90)}
                      className="w-20 h-9"
                    />
                    <span className="text-sm text-neutral-600 dark:text-neutral-400">days ahead when no next booking exists</span>
                  </div>
                </div>
              )}
            </>
          )}

          {/* RECURRING: Schedule Configuration */}
          {config.trigger_type === 'recurring' && config.recurring_schedule && (
            <div className="border rounded-lg p-4 space-y-4">
              <div className="font-medium text-sm">Recurring Schedule</div>
              <div className="text-xs text-neutral-500">Configure when this task starts and how often it repeats</div>

              <div className="space-y-4 pt-2">
                {/* Start date and time */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-neutral-600 dark:text-neutral-400">Starting on</span>
                  <Input
                    type="date"
                    value={config.recurring_schedule.start_date}
                    onChange={(e) => updateRecurringSchedule('start_date', e.target.value)}
                    className="w-44 h-9"
                  />
                  <span className="text-sm text-neutral-600 dark:text-neutral-400">at</span>
                  <Input
                    type="time"
                    value={config.recurring_schedule.time}
                    onChange={(e) => updateRecurringSchedule('time', e.target.value)}
                    className="w-32 h-9"
                  />
                </div>

                {/* Repeat interval */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-neutral-600 dark:text-neutral-400">Repeats every</span>
                  <Input
                    type="number"
                    min={1}
                    value={config.recurring_schedule.interval_value}
                    onChange={(e) => updateRecurringSchedule('interval_value', parseInt(e.target.value) || 1)}
                    className="w-20 h-9"
                  />
                  <Select
                    value={config.recurring_schedule.interval_unit}
                    onValueChange={(value) => updateRecurringSchedule('interval_unit', value as RecurringIntervalUnit)}
                  >
                    <SelectTrigger className="w-32 h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="days">day(s)</SelectItem>
                      <SelectItem value="weeks">week(s)</SelectItem>
                      <SelectItem value="months">month(s)</SelectItem>
                      <SelectItem value="years">year(s)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
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
          <div className="border rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">Auto-Assign Users</div>
                <div className="text-xs text-neutral-500">Automatically assign users to generated tasks</div>
              </div>
              <Toggle checked={config.auto_assign.enabled} onChange={() => updateAutoAssign('enabled', !config.auto_assign.enabled)} />
            </div>

            {config.auto_assign.enabled && (
              <div className="space-y-2 pt-2">
                {users.length > 0 ? (
                  users.map((user) => (
                    <label
                      key={user.id}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={config.auto_assign.user_ids.includes(user.id)}
                        onChange={() => toggleUserAssignment(user.id)}
                        className="w-4 h-4 rounded border-neutral-300 text-purple-600 focus:ring-purple-500"
                      />
                      <span className="text-lg">{user.avatar || '👤'}</span>
                      <div>
                        <div className="text-sm font-medium">{user.name}</div>
                        <div className="text-xs text-neutral-500">{user.role}</div>
                      </div>
                    </label>
                  ))
                ) : (
                  <p className="text-sm text-neutral-500">No users available.</p>
                )}
              </div>
            )}
          </div>

          {/* ================================================================
              Preset Actions
              ================================================================ */}
          {!isNew && onSavePreset && (
            <div className="flex items-center gap-2 pt-4 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={onSavePreset}
              >
                Save as Preset
              </Button>
              {presets.length > 0 && (
                <Select onValueChange={(presetId) => {
                  const preset = presets.find(p => p.id === presetId);
                  if (preset) handleLoadPreset(preset);
                }}>
                  <SelectTrigger className="w-48 h-9">
                    <SelectValue placeholder="Load preset..." />
                  </SelectTrigger>
                  <SelectContent>
                    {presets.map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        {preset.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {isNew && presets.length > 0 && (
            <div className="flex items-center gap-2 pt-4 border-t">
              <Select onValueChange={(presetId) => {
                const preset = presets.find(p => p.id === presetId);
                if (preset) handleLoadPreset(preset);
              }}>
                <SelectTrigger className="w-48 h-9">
                  <SelectValue placeholder="Load preset..." />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </>
      )}
    </div>
  );
}
