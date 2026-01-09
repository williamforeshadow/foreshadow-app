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
  due_date?: string;
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
  due_date?: string;
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
  due_date: string;
}

export interface ProjectFormFields {
  title: string;
  description: string;
  status: string;
  priority: string;
  assigned_staff: string;
  due_date: string;
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
// Filter Types (re-export from cleaningFilters for convenience)
// ============================================================================

export type { CleaningFilters } from './cleaningFilters';

