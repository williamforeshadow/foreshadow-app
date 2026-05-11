/**
 * Core TypeScript interfaces for the application
 */

// ============================================================================
// User Types
// ============================================================================

export interface User {
  id: string;
  name: string;
  email?: string;
  avatar?: string;
  role?: string;
}

export interface AssignedUser {
  user_id: string;
  name: string;
  avatar?: string;
  role?: string;
}

// ============================================================================
// Task Types
// ============================================================================

export type TaskStatus = 'contingent' | 'not_started' | 'in_progress' | 'paused' | 'complete';

// ============================================================================
// Department Types
// ============================================================================

export interface Department {
  id: string;
  name: string;
  icon: string;
  created_at: string;
  updated_at: string;
}

export interface Task {
  task_id: string;
  template_id?: string;
  template_name?: string;
  title?: string | null;
  description?: TiptapJSON | null;
  priority?: string | null;
  bin_id?: string | null;
  is_binned?: boolean;
  department_id?: string | null;
  department_name?: string | null;
  status: TaskStatus;
  property_name?: string;
  assigned_users?: AssignedUser[];
  assigned_staff?: string;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  form_metadata?: Record<string, unknown>;
  guest_name?: string;
  /**
   * FK to the reservation that auto-generated this task. null for recurring
   * or manually-created tasks. Drives the key-icon affordance everywhere
   * a task title is rendered — see lib/reservationViewerContext + the
   * KeyAffordance component.
   */
  reservation_id?: string | null;
}

export interface TaskTemplate {
  id: string;
  name: string;
  department_id?: string | null;
  department_name?: string | null;
  sections?: TaskTemplateSection[];
  fields?: TaskTemplateField[];
}

export interface TaskTemplateSection {
  id: string;
  title: string;
  fields?: TaskTemplateField[];
}

export interface TaskTemplateField {
  id: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
}

// ============================================================================
// Turnover Types
// ============================================================================

export type TurnoverStatus = 'not_started' | 'in_progress' | 'complete' | 'no_tasks';
export type OccupancyStatus = 'occupied' | 'vacant';

export interface Turnover {
  id: string;
  property_name: string;
  guest_name?: string;
  check_in?: string;
  check_out?: string;
  next_check_in?: string;
  tasks: Task[];
  total_tasks: number;
  completed_tasks: number;
  tasks_in_progress: number;
  turnover_status: TurnoverStatus;
  occupancy_status: OccupancyStatus;
  /** Runtime flag set by UI for timeline filtering */
  _isActive?: boolean | null;
}

// ============================================================================
// Property Types
// ============================================================================

/** A property option returned by /api/properties (id may be null for legacy entries) */
export interface PropertyOption {
  id: string | null;
  name: string;
}

// ============================================================================
// Bin Types (project grouping containers)
// ============================================================================

export interface ProjectBin {
  id: string;
  name: string;
  description?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  sort_order: number;
  /** When true, completed tasks in this bin are auto-dismissed after `auto_dismiss_days` days */
  auto_dismiss_enabled?: boolean;
  /** Number of elapsed days after status=complete before auto-dismissal (default 7) */
  auto_dismiss_days?: number;
  /**
   * When true, this is a protected system bin — the "Task Bin" that owns
   * orphan binned tasks (those with `is_binned = true` but no `bin_id`).
   * System bins cannot be renamed or deleted; only their auto-dismiss config
   * is editable.
   */
  is_system?: boolean;
  project_count?: number; // computed client-side
}

// ============================================================================
// Project Types
// ============================================================================

export type ProjectStatus = 'not_started' | 'in_progress' | 'paused' | 'complete';
export type ProjectPriority = 'low' | 'medium' | 'high' | 'urgent';

export type ProjectViewMode = 'property' | 'status' | 'priority' | 'department' | 'assignee';

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  'not_started': 'Not Started',
  'in_progress': 'In Progress',
  'paused': 'Paused',
  'complete': 'Complete'
};

export const PRIORITY_LABELS: Record<ProjectPriority, string> = {
  'urgent': 'Urgent',
  'high': 'High',
  'medium': 'Medium',
  'low': 'Low'
};

export const STATUS_ORDER: ProjectStatus[] = ['paused', 'not_started', 'in_progress', 'complete'];
export const PRIORITY_ORDER: ProjectPriority[] = ['urgent', 'high', 'medium', 'low'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TiptapJSON = Record<string, any>;

export interface Project {
  id: string;
  property_id?: string | null;
  property_name?: string | null;
  bin_id?: string | null;
  is_binned?: boolean;
  template_id?: string | null;
  template_name?: string | null;
  title: string;
  description?: TiptapJSON | null;
  status: ProjectStatus;
  priority: ProjectPriority;
  assigned_staff?: string;
  assigned_user_ids?: string[];
  project_assignments?: Array<{ user_id: string; user?: User }>;
  department_id?: string | null;
  department_name?: string | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  /**
   * Foreign key to the linked reservation when this row is bound to a
   * turnover. Populated for tasks generated by reservation triggers
   * (turnover/occupancy/vacancy); null for recurring tasks and manually
   * created one-off projects. Drives the small "key" badge next to the
   * Scheduled label in detail panels.
   */
  reservation_id?: string | null;
  form_metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  /** Timestamp of the most recent transition to status=complete (reset on re-complete) */
  completed_at?: string | null;
}

export interface ProjectFormData {
  property_id: string;
  property_name: string;
  title: string;
  description: TiptapJSON | null;
  status: string;
  priority: string;
  assigned_staff: string[];
  department_id: string;
  scheduled_date: string;
  scheduled_time: string;
  bin_id: string;
}

export interface ProjectFormFields {
  title: string;
  description: TiptapJSON | null;
  status: string;
  priority: string;
  assigned_staff: string[];
  department_id: string;
  scheduled_date: string;
  scheduled_time: string;
}

// ============================================================================
// Comment Types
// ============================================================================

export interface Comment {
  id: string;
  project_id: string;
  user_id: string;
  user_name?: string;
  comment_content: string;
  created_at: string;
}

// ============================================================================
// Attachment Types
// ============================================================================

export interface Attachment {
  id: string;
  project_id: string | null;
  task_id?: string | null;
  file_name: string;
  file_url?: string;
  url?: string; // Alternate field name used in some contexts
  file_type?: 'image' | 'video' | 'document' | string;
  mime_type?: string | null;
  file_size?: number;
  uploaded_by?: string;
  created_at: string;
}

// ============================================================================
// Time Entry Types
// ============================================================================

export interface TimeEntry {
  id: string;
  project_id: string;
  user_id: string;
  user_name?: string;
  start_time: string;
  end_time?: string;
  duration_seconds?: number;
  description?: string;
}

// ============================================================================
// Activity Types
// ============================================================================

export interface ActivityLogEntry {
  id: string;
  project_id: string;
  user_id?: string;
  user_name?: string;
  action: string;
  details?: Record<string, unknown>;
  created_at: string;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============================================================================
// Automation Types
// ============================================================================

/** Trigger types for task automation */
export type AutomationTriggerType = 'turnover' | 'occupancy' | 'vacancy' | 'recurring';

/** Schedule type - when to schedule relative to an event */
export type AutomationScheduleType = 'on' | 'before' | 'after';

/** Reference point for scheduling */
export type AutomationScheduleRelativeTo = 'check_out' | 'next_check_in';

/** Schedule configuration for automation */
export interface AutomationScheduleConfig {
  enabled: boolean;
  type: AutomationScheduleType;
  relative_to: AutomationScheduleRelativeTo;
  days_offset: number;
  time: string; // 24-hour format, e.g., "10:00", "14:30"
}

/** Same-day turnover override configuration */
export interface AutomationSameDayConfig {
  enabled: boolean;
  schedule: Omit<AutomationScheduleConfig, 'enabled'>;
}

/** Auto-assignment configuration */
export interface AutomationAutoAssignConfig {
  enabled: boolean;
  user_ids: string[];
}

// ============================================================================
// Occupancy Period Automation Types
// ============================================================================

/** Comparison operators for occupancy duration conditions */
export type OccupancyDurationOperator = 
  | 'gte'     // greater than or equal to
  | 'eq'      // is equal to
  | 'gt'      // is greater than
  | 'lt'      // is less than
  | 'lte'     // is less than or equal to
  | 'between'; // is between

/** Occupancy duration condition for determining which stays get the task */
export interface OccupancyDurationCondition {
  operator: OccupancyDurationOperator;
  days: number;
  days_end?: number; // Only used for 'between' operator
}

/** Occupancy schedule configuration - when to schedule within the stay */
export interface OccupancyScheduleConfig {
  enabled: boolean;
  day_of_occupancy: number; // Schedule on Nth full day of occupancy
  time: string; // Time of day in 24-hour format
  repeat: {
    enabled: boolean;
    interval_days: number; // Repeat every N days
  };
}

// ============================================================================
// Vacancy Period Automation Types
// ============================================================================

/** Vacancy duration condition for determining which vacancy periods get the task */
export interface VacancyDurationCondition {
  operator: OccupancyDurationOperator; // Reuse same operators
  days: number;
  days_end?: number; // Only used for 'between' operator
}

/** Vacancy schedule configuration - when to schedule during vacancy */
export interface VacancyScheduleConfig {
  enabled: boolean;
  day_of_vacancy: number; // Schedule on Nth full day of vacancy
  time: string; // Time of day in 24-hour format
  repeat: {
    enabled: boolean;
    interval_days: number; // Repeat every N days
  };
  max_days_ahead: number; // Cap for generating tasks when next_check_in is unknown
}

// ============================================================================
// Recurring Automation Types
// ============================================================================

/** Interval unit for recurring schedules */
export type RecurringIntervalUnit = 'days' | 'weeks' | 'months' | 'years';

/** Recurring schedule configuration */
export interface RecurringScheduleConfig {
  start_date: string; // ISO date string, e.g. "2026-03-01"
  time: string; // 24-hour format, e.g. "10:00"
  interval_value: number; // Every N...
  interval_unit: RecurringIntervalUnit; // ...days/weeks/months/years
}

/** Contingent tasks configuration */
export interface ContingentTasksConfig {
  enabled: boolean;
  auto_approve_enabled: boolean;
  auto_approve_days: number; // Approve N days before scheduled date
}

/** Full automation configuration stored in property_templates.automation_config */
export interface AutomationConfig {
  enabled: boolean;
  trigger_type: AutomationTriggerType;
  // Turnover-specific config
  schedule: AutomationScheduleConfig;
  same_day_override: AutomationSameDayConfig;
  // Occupancy-specific config
  occupancy_condition?: OccupancyDurationCondition;
  occupancy_schedule?: OccupancyScheduleConfig;
  // Vacancy-specific config
  vacancy_condition?: VacancyDurationCondition;
  vacancy_schedule?: VacancyScheduleConfig;
  // Recurring-specific config
  recurring_schedule?: RecurringScheduleConfig;
  // Contingent tasks config
  contingent?: ContingentTasksConfig;
  // Shared config
  auto_assign: AutomationAutoAssignConfig;
  preset_id?: string | null;
}

/** Automation preset - reusable automation configuration */
export interface AutomationPreset {
  id: string;
  name: string;
  description?: string | null;
  trigger_type: AutomationTriggerType;
  config: Omit<AutomationConfig, 'enabled' | 'trigger_type' | 'preset_id'>;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Template Modifier Types (Property-level overrides)
// ============================================================================

/** Field override configuration stored in property_templates.field_overrides */
export interface FieldOverrides {
  /** Extra fields to append to the base template */
  additional_fields: FieldOverrideEntry[];
  /** IDs of base template fields to hide for this property */
  removed_field_ids: string[];
  /** Per-field label/required overrides keyed by field ID */
  modified_fields: Record<string, FieldModification>;
}

/** A single additional field added per-property */
export interface FieldOverrideEntry {
  id: string;
  type: 'rating' | 'yes-no' | 'text' | 'checkbox' | 'photo' | 'photos' | 'separator';
  label: string;
  required: boolean;
}

/** Partial modifications applied to an existing base template field */
export interface FieldModification {
  label?: string;
  required?: boolean;
}

/** Factory for an empty FieldOverrides object */
export function createDefaultFieldOverrides(): FieldOverrides {
  return {
    additional_fields: [],
    removed_field_ids: [],
    modified_fields: {},
  };
}

/** Property template assignment with automation config */
export interface PropertyTemplateAssignment {
  id: string;
  property_name: string;
  template_id: string;
  enabled: boolean;
  automation_config?: AutomationConfig | null;
  field_overrides?: FieldOverrides | null;
}

/** Default automation config factory */
export function createDefaultAutomationConfig(): AutomationConfig {
  return {
    enabled: false,
    trigger_type: 'turnover',
    // Turnover-specific defaults.
    // schedule.enabled is hard-coded true now — Auto-Scheduling is implicit
    // (all auto-generated tasks must carry a scheduled date). The field is
    // retained on the type for backward-compat with rows in JSONB but is
    // ignored by both the SQL functions and the manual-add API route.
    schedule: {
      enabled: true,
      type: 'on',
      relative_to: 'check_out',
      days_offset: 0,
      time: '10:00',
    },
    same_day_override: {
      enabled: true,
      schedule: {
        type: 'on',
        relative_to: 'check_out',
        days_offset: 0,
        time: '10:00',
      },
    },
    // Occupancy-specific defaults
    occupancy_condition: {
      operator: 'gte',
      days: 7,
    },
    occupancy_schedule: {
      enabled: true,
      day_of_occupancy: 1,
      time: '10:00',
      repeat: {
        enabled: false,
        interval_days: 7,
      },
    },
    // Vacancy-specific defaults
    vacancy_condition: {
      operator: 'gte',
      days: 7,
    },
    vacancy_schedule: {
      enabled: true,
      day_of_vacancy: 1,
      time: '10:00',
      repeat: {
        enabled: false,
        interval_days: 7,
      },
      max_days_ahead: 90,
    },
    // Recurring-specific defaults
    recurring_schedule: {
      start_date: new Date().toISOString().split('T')[0], // Today
      time: '10:00',
      interval_value: 1,
      interval_unit: 'months',
    },
    // Contingent tasks defaults
    contingent: {
      enabled: false,
      auto_approve_enabled: false,
      auto_approve_days: 7,
    },
    // Shared defaults
    auto_assign: {
      enabled: false,
      user_ids: [],
    },
    preset_id: null,
  };
}

// ============================================================================
// Slack Automation Types
// ============================================================================

export type SlackAutomationTrigger =
  | 'new_booking'
  | 'check_in'
  | 'check_out'
  | 'task_assigned';

export type SlackAutomationDeliveryType = 'channel' | 'task_assignee_dm';

/**
 * Variables available for `{{var}}` substitution inside a Slack automation's
 * message template. The execution layer renders these against the firing
 * reservation; missing values render as the empty string.
 *
 * Universal across all triggers — keeps the editor's "Insert variable"
 * dropdown the same regardless of trigger type. Triggers that don't have a
 * concept of a given variable (e.g. recurring automations later) simply
 * leave it blank rather than erroring.
 */
export const SLACK_RESERVATION_AUTOMATION_VARIABLES: ReadonlyArray<{
  key: string;
  label: string;
  description: string;
}> = [
  { key: 'property_name', label: 'Property name', description: 'e.g. "Beach House"' },
  { key: 'guest_name', label: 'Guest name', description: 'e.g. "Alex Smith"' },
  { key: 'check_in', label: 'Check-in date', description: 'e.g. "May 30, 2026"' },
  { key: 'check_in_time', label: 'Check-in time', description: 'Org default check-in time, e.g. "3:00 PM". Hostaway does not provide actual guest arrival times.' },
  { key: 'check_in_datetime', label: 'Check-in date & time', description: 'e.g. "May 30, 2026 at 3:00 PM"' },
  { key: 'check_in_iso', label: 'Check-in (raw)', description: 'YYYY-MM-DD' },
  { key: 'check_out', label: 'Check-out date', description: 'e.g. "June 2, 2026"' },
  { key: 'check_out_time', label: 'Check-out time', description: 'Org default check-out time, e.g. "11:00 AM"' },
  { key: 'check_out_datetime', label: 'Check-out date & time', description: 'e.g. "June 2, 2026 at 11:00 AM"' },
  { key: 'check_out_iso', label: 'Check-out (raw)', description: 'YYYY-MM-DD' },
  { key: 'nights', label: 'Number of nights', description: 'e.g. "3"' },
  { key: 'trigger_date', label: 'Today (in property TZ)', description: 'YYYY-MM-DD, resolved in the property\'s timezone' },
];

export const SLACK_TASK_ASSIGNMENT_AUTOMATION_VARIABLES: ReadonlyArray<{
  key: string;
  label: string;
  description: string;
}> = [
  { key: 'actor_name', label: 'Actor name', description: 'The user who assigned the task' },
  { key: 'actor_email', label: 'Actor email', description: 'Email for the user who assigned the task' },
  { key: 'assignee_name', label: 'Assignee name', description: 'The newly assigned user' },
  { key: 'assignee_email', label: 'Assignee email', description: 'Email for the newly assigned user' },
  { key: 'task_title', label: 'Task title', description: 'The assigned task title' },
  { key: 'task_url', label: 'Task link', description: 'Direct link to the task in Foreshadow' },
  { key: 'task_status', label: 'Task status', description: 'Current task status' },
  { key: 'task_priority', label: 'Task priority', description: 'Current task priority' },
  { key: 'property_name', label: 'Property name', description: 'Property attached to the task, when present' },
  { key: 'department_name', label: 'Department name', description: 'Department attached to the task, when present' },
  { key: 'scheduled_date', label: 'Scheduled date', description: 'Task scheduled date, YYYY-MM-DD' },
  { key: 'scheduled_time', label: 'Scheduled time', description: 'Task scheduled time, HH:MM' },
  { key: 'trigger_date', label: 'Trigger date', description: 'Date the assignment automation fired, YYYY-MM-DD' },
];

export const SLACK_AUTOMATION_VARIABLES = SLACK_RESERVATION_AUTOMATION_VARIABLES;

export interface SlackAutomationAttachment {
  /** Random hex token; matches the storage path stem. */
  id: string;
  /** Original filename for display. */
  name: string;
  /** Path inside the slack-automation-attachments bucket. */
  storage_path: string;
  /** Public URL for editor preview only (execution reads bytes from storage). */
  url: string;
  mime_type: string | null;
  size_bytes: number;
}

export interface SlackAutomationConfig {
  /**
   * Where to deliver the message. Older automations omit this and are
   * treated as channel messages by the execution layer.
   */
  delivery_type?: SlackAutomationDeliveryType;
  /**
   * Slack channel id (e.g. C0123456789). Canonical — channel names can
   * change. The picker stores this from `conversations.list`.
   */
  channel_id: string;
  /** Denormalized channel name for display in the configuration UI. */
  channel_name: string;
  /**
   * Message template. Supports `{{variable}}` placeholders from
   * SLACK_AUTOMATION_VARIABLES. Multi-line. Slack mrkdwn is allowed.
   */
  message_template: string;
  attachments: SlackAutomationAttachment[];
}

export interface SlackAutomation {
  id: string;
  name: string;
  enabled: boolean;
  trigger: SlackAutomationTrigger;
  property_ids: string[];
  config: SlackAutomationConfig;
  created_at: string;
  updated_at: string;
}

export function createDefaultSlackAutomationConfig(): SlackAutomationConfig {
  return {
    delivery_type: 'channel',
    channel_id: '',
    channel_name: '',
    message_template: '',
    attachments: [],
  };
}

// ============================================================================
// Filter Types (re-export from cleaningFilters for convenience)
// ============================================================================

export type { CleaningFilters } from './cleaningFilters';

