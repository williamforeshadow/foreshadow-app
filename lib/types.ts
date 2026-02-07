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

export type TaskStatus = 'not_started' | 'in_progress' | 'paused' | 'complete' | 'reopened';
export type TaskType = 'cleaning' | 'maintenance';

export interface Task {
  task_id: string;
  template_id?: string;
  template_name?: string;
  type: TaskType;
  status: TaskStatus;
  property_name?: string;
  assigned_users?: AssignedUser[];
  assigned_staff?: string;
  scheduled_start?: string | null;
  scheduled_date?: string;
  form_metadata?: Record<string, unknown>;
  guest_name?: string;
}

export interface TaskTemplate {
  id: string;
  name: string;
  type: string;
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
// Project Types
// ============================================================================

export type ProjectStatus = 'not_started' | 'in_progress' | 'on_hold' | 'complete';
export type ProjectPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Project {
  id: string;
  property_name: string;
  title: string;
  description?: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  assigned_staff?: string;
  assigned_user_ids?: string[];
  project_assignments?: Array<{ user_id: string; user?: User }>;
  scheduled_start?: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectFormData {
  property_name: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assigned_staff: string;
  scheduled_start: string;
}

export interface ProjectFormFields {
  title: string;
  description: string;
  status: string;
  priority: string;
  assigned_staff: string;
  scheduled_start: string;
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
  project_id: string;
  file_name: string;
  file_url: string;
  url?: string; // Alternate field name used in some contexts
  file_type?: string;
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

/** Property template assignment with automation config */
export interface PropertyTemplateAssignment {
  id: string;
  property_name: string;
  template_id: string;
  enabled: boolean;
  automation_config?: AutomationConfig | null;
}

/** Default automation config factory */
export function createDefaultAutomationConfig(): AutomationConfig {
  return {
    enabled: false,
    trigger_type: 'turnover',
    // Turnover-specific defaults
    schedule: {
      enabled: false,
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
      enabled: false,
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
      enabled: false,
      day_of_vacancy: 1,
      time: '10:00',
      repeat: {
        enabled: false,
        interval_days: 7,
      },
      max_days_ahead: 90,
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
// Filter Types (re-export from cleaningFilters for convenience)
// ============================================================================

export type { CleaningFilters } from './cleaningFilters';

