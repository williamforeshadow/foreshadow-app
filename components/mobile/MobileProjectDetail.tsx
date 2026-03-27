'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useAuth } from '@/lib/authContext';
import { useDepartments } from '@/lib/departmentsContext';
import { getDepartmentIcon } from '@/lib/departmentIcons';
import { useProjectComments } from '@/lib/hooks/useProjectComments';
import { useProjectAttachments } from '@/lib/hooks/useProjectAttachments';
import { useProjectTimeTracking } from '@/lib/hooks/useProjectTimeTracking';
import type { Project, User, ProjectFormFields, Comment, Attachment } from '@/lib/types';

// ============================================================================
// Types
// ============================================================================

interface MobileProjectDetailProps {
  project: Project;
  users: User[];
  onClose: () => void;
  onSave: (projectId: string, fields: ProjectFormFields) => Promise<Project | null>;
  onDelete?: (project: Project) => void;
}

// ============================================================================
// Status / Priority Configs
// ============================================================================

const STATUS_CONFIG: Record<string, { bg: string; dot: string; label: string }> = {
  not_started: { bg: 'bg-amber-500/15 text-amber-600 dark:text-amber-400', dot: 'bg-amber-500', label: 'Not Started' },
  in_progress: { bg: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400', dot: 'bg-indigo-500', label: 'In Progress' },
  on_hold: { bg: 'bg-neutral-400/15 text-neutral-600 dark:text-neutral-400', dot: 'bg-neutral-400', label: 'On Hold' },
  complete: { bg: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500', label: 'Complete' },
};

const PRIORITY_CONFIG: Record<string, { bg: string; label: string }> = {
  low: { bg: 'bg-slate-500/15 text-slate-600 dark:text-slate-400', label: 'Low' },
  medium: { bg: 'bg-blue-500/15 text-blue-600 dark:text-blue-400', label: 'Medium' },
  high: { bg: 'bg-orange-500/15 text-orange-600 dark:text-orange-400', label: 'High' },
  urgent: { bg: 'bg-red-500/15 text-red-600 dark:text-red-400', label: 'Urgent' },
};

const STATUS_OPTIONS = ['not_started', 'in_progress', 'on_hold', 'complete'];
const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'urgent'];

// ============================================================================
// Main Component
// ============================================================================

export default function MobileProjectDetail({
  project,
  users,
  onClose,
  onSave,
  onDelete,
}: MobileProjectDetailProps) {
  const { user: currentUser } = useAuth();
  const { departments } = useDepartments();

  // Local editing fields
  const [fields, setFields] = useState<ProjectFormFields>({
    title: project.title,
    description: project.description || '',
    status: project.status,
    priority: project.priority,
    assigned_staff: project.project_assignments?.map(a => a.user_id) || [],
    department_id: project.department_id || '',
    scheduled_date: project.scheduled_date || '',
    scheduled_time: project.scheduled_time || '',
  });

  // UI state
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [showPriorityPicker, setShowPriorityPicker] = useState(false);
  const [showStaffPicker, setShowStaffPicker] = useState(false);
  const [showDeptPicker, setShowDeptPicker] = useState(false);
  const [activeSection, setActiveSection] = useState<'details' | 'comments' | 'attachments'>('details');
  const [saving, setSaving] = useState(false);
  const [newComment, setNewComment] = useState('');

  // Hooks for comments, attachments, time tracking
  const commentsHook = useProjectComments({ currentUser: currentUser as User | null });
  const attachmentsHook = useProjectAttachments({ currentUser: currentUser as User | null });
  const timeTrackingHook = useProjectTimeTracking({ currentUser: currentUser as User | null });

  const commentInputRef = useRef<HTMLTextAreaElement>(null);

  // Load data on mount
  useEffect(() => {
    commentsHook.fetchProjectComments(project.id);
    attachmentsHook.fetchProjectAttachments(project.id);
    timeTrackingHook.fetchProjectTimeEntries(project.id);
  }, [project.id]);

  // Auto-save helper
  const autoSave = useCallback(async (updatedFields: ProjectFormFields) => {
    setSaving(true);
    await onSave(project.id, updatedFields);
    setSaving(false);
  }, [project.id, onSave]);

  // Field update + auto-save
  const updateField = useCallback((key: keyof ProjectFormFields, value: string | string[]) => {
    setFields(prev => {
      const updated = { ...prev, [key]: value };
      // Auto-save after a brief delay
      setTimeout(() => autoSave(updated), 0);
      return updated;
    });
  }, [autoSave]);

  // Derived data
  const assignedUsers = users.filter(u => fields.assigned_staff?.includes(u.id));
  const dept = departments.find(d => d.id === fields.department_id);
  const DeptIcon = getDepartmentIcon(dept?.icon);
  const status = STATUS_CONFIG[fields.status] || STATUS_CONFIG.not_started;
  const priority = PRIORITY_CONFIG[fields.priority] || PRIORITY_CONFIG.medium;

  // Post comment
  const handlePostComment = async () => {
    if (!newComment.trim()) return;
    await commentsHook.postProjectComment(project.id, newComment.trim());
    setNewComment('');
  };

  // Upload attachment
  const handleAttachmentUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    attachmentsHook.handleAttachmentUpload(e, project.id);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-white dark:bg-neutral-950 flex flex-col"
      style={{ height: '100dvh' }}
    >
      {/* ── Header ── */}
      <div className="shrink-0 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <button
            onClick={onClose}
            className="flex items-center gap-1 text-sm text-neutral-500 dark:text-neutral-400"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <div className="flex items-center gap-2">
            {saving && (
              <span className="text-xs text-neutral-400">Saving...</span>
            )}
            {onDelete && (
              <button
                onClick={() => {
                  if (confirm(`Delete "${project.title}"?`)) {
                    onDelete(project);
                    onClose();
                  }
                }}
                className="p-2 text-red-400 hover:text-red-500"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Department icon + Title */}
        <div className="flex items-start gap-3 px-4 pb-3">
          <button
            onClick={() => setShowDeptPicker(!showDeptPicker)}
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-sky-500/10 dark:bg-sky-500/15 border border-sky-200/30 dark:border-sky-500/20"
          >
            <DeptIcon className="w-5 h-5 text-sky-500 dark:text-sky-400" />
          </button>
          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={fields.title}
              onChange={(e) => setFields(prev => ({ ...prev, title: e.target.value }))}
              onBlur={() => autoSave(fields)}
              placeholder="Untitled Project"
              className="text-lg font-semibold bg-transparent border-none outline-none w-full text-neutral-900 dark:text-white placeholder:text-neutral-400"
            />
            <div className="flex items-center gap-1.5 mt-0.5">
              <svg className="w-3 h-3 text-neutral-400" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 1.5a4.5 4.5 0 00-4.5 4.5c0 3.375 4.5 8.5 4.5 8.5s4.5-5.125 4.5-8.5A4.5 4.5 0 008 1.5zm0 6a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
              </svg>
              <span className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                {project.property_name || 'No property'}
              </span>
            </div>
          </div>
        </div>

        {/* Status + Priority pills */}
        <div className="flex items-center gap-2 px-4 pb-3 flex-wrap">
          <button
            onClick={() => setShowStatusPicker(!showStatusPicker)}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-opacity active:opacity-70 ${status.bg}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
            {status.label}
          </button>
          <button
            onClick={() => setShowPriorityPicker(!showPriorityPicker)}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-opacity active:opacity-70 ${priority.bg}`}
          >
            {priority.label} priority
          </button>
          {dept && (
            <button
              onClick={() => setShowDeptPicker(!showDeptPicker)}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 transition-opacity active:opacity-70"
            >
              <DeptIcon className="w-3 h-3" />
              {dept.name}
            </button>
          )}
        </div>

        {/* Section tabs */}
        <div className="flex border-t border-neutral-100 dark:border-neutral-800">
          {(['details', 'comments', 'attachments'] as const).map((section) => (
            <button
              key={section}
              onClick={() => setActiveSection(section)}
              className={`flex-1 py-2.5 text-xs font-medium text-center transition-colors relative ${
                activeSection === section
                  ? 'text-neutral-900 dark:text-white'
                  : 'text-neutral-400'
              }`}
            >
              {section === 'details' && 'Details'}
              {section === 'comments' && `Comments${commentsHook.projectComments.length > 0 ? ` (${commentsHook.projectComments.length})` : ''}`}
              {section === 'attachments' && `Files${attachmentsHook.projectAttachments.length > 0 ? ` (${attachmentsHook.projectAttachments.length})` : ''}`}
              {activeSection === section && (
                <div className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-neutral-900 dark:bg-white rounded-full" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Picker Overlays (inline dropdowns) ── */}
      {showStatusPicker && (
        <PickerOverlay onClose={() => setShowStatusPicker(false)}>
          <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 px-4 pt-3 pb-2">Status</p>
          {STATUS_OPTIONS.map((s) => {
            const cfg = STATUS_CONFIG[s];
            return (
              <button
                key={s}
                onClick={() => {
                  updateField('status', s);
                  setShowStatusPicker(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                  fields.status === s ? 'bg-neutral-100 dark:bg-neutral-800' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                <span className="text-sm text-neutral-900 dark:text-white">{cfg.label}</span>
                {fields.status === s && (
                  <svg className="w-4 h-4 ml-auto text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </PickerOverlay>
      )}

      {showPriorityPicker && (
        <PickerOverlay onClose={() => setShowPriorityPicker(false)}>
          <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 px-4 pt-3 pb-2">Priority</p>
          {PRIORITY_OPTIONS.map((p) => {
            const cfg = PRIORITY_CONFIG[p];
            return (
              <button
                key={p}
                onClick={() => {
                  updateField('priority', p);
                  setShowPriorityPicker(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                  fields.priority === p ? 'bg-neutral-100 dark:bg-neutral-800' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50'
                }`}
              >
                <span className={`inline-block w-2 h-2 rounded-full ${cfg.bg.includes('red') ? 'bg-red-500' : cfg.bg.includes('orange') ? 'bg-orange-500' : cfg.bg.includes('blue') ? 'bg-blue-500' : 'bg-slate-400'}`} />
                <span className="text-sm text-neutral-900 dark:text-white">{cfg.label}</span>
                {fields.priority === p && (
                  <svg className="w-4 h-4 ml-auto text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </PickerOverlay>
      )}

      {showStaffPicker && (
        <PickerOverlay onClose={() => setShowStaffPicker(false)}>
          <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 px-4 pt-3 pb-2">Assign Staff</p>
          {fields.assigned_staff.length > 0 && (
            <button
              onClick={() => {
                updateField('assigned_staff', []);
                setShowStaffPicker(false);
              }}
              className="w-full flex items-center gap-3 px-4 py-3 text-left text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              <span className="text-sm">Clear all</span>
            </button>
          )}
          {users.map((user) => {
            const isAssigned = fields.assigned_staff?.includes(user.id);
            return (
              <button
                key={user.id}
                onClick={() => {
                  const updated = isAssigned
                    ? fields.assigned_staff.filter(id => id !== user.id)
                    : [...fields.assigned_staff, user.id];
                  updateField('assigned_staff', updated);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                  isAssigned ? 'bg-neutral-100 dark:bg-neutral-800' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50'
                }`}
              >
                <UserAvatar src={user.avatar} name={user.name} size="sm" />
                <span className="text-sm text-neutral-900 dark:text-white flex-1">{user.name}</span>
                {isAssigned && (
                  <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </PickerOverlay>
      )}

      {showDeptPicker && (
        <PickerOverlay onClose={() => setShowDeptPicker(false)}>
          <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 px-4 pt-3 pb-2">Department</p>
          <button
            onClick={() => {
              updateField('department_id', '');
              setShowDeptPicker(false);
            }}
            className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
              !fields.department_id ? 'bg-neutral-100 dark:bg-neutral-800' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50'
            }`}
          >
            <span className="text-sm text-neutral-500">No Department</span>
            {!fields.department_id && (
              <svg className="w-4 h-4 ml-auto text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
          {departments.map((d) => {
            const DIcon = getDepartmentIcon(d.icon);
            return (
              <button
                key={d.id}
                onClick={() => {
                  updateField('department_id', d.id);
                  setShowDeptPicker(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                  fields.department_id === d.id ? 'bg-neutral-100 dark:bg-neutral-800' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50'
                }`}
              >
                <DIcon className="w-4 h-4 text-sky-500" />
                <span className="text-sm text-neutral-900 dark:text-white flex-1">{d.name}</span>
                {fields.department_id === d.id && (
                  <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </PickerOverlay>
      )}

      {/* ── Scrollable Body ── */}
      <div
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain hide-scrollbar"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {/* Details Section */}
        {activeSection === 'details' && (
          <div className="p-4 space-y-4">
            {/* Description */}
            <div className="rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-4">
              <p className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-2">Description</p>
              <textarea
                value={fields.description}
                onChange={(e) => setFields(prev => ({ ...prev, description: e.target.value }))}
                onBlur={() => autoSave(fields)}
                placeholder="Add a description..."
                rows={3}
                className="w-full resize-none bg-transparent border-none outline-none text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400"
              />
            </div>

            {/* Assigned Staff */}
            <div className="rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-4">
              <p className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">Assigned to</p>
              <button
                onClick={() => setShowStaffPicker(true)}
                className="flex items-center gap-2 w-full"
              >
                {assignedUsers.length > 0 ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex -space-x-1.5">
                      {assignedUsers.map((u) => (
                        <UserAvatar key={u.id} src={u.avatar} name={u.name} size="sm" className="ring-2 ring-white dark:ring-neutral-900" />
                      ))}
                    </div>
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">
                      {assignedUsers.map(u => u.name).join(', ')}
                    </span>
                    <div className="w-6 h-6 rounded-full border-2 border-dashed border-neutral-300 dark:border-neutral-600 flex items-center justify-center ml-1">
                      <svg className="w-3 h-3 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full border-2 border-dashed border-neutral-300 dark:border-neutral-600 flex items-center justify-center">
                      <svg className="w-3.5 h-3.5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                    <span className="text-sm text-neutral-400">Tap to assign</span>
                  </div>
                )}
              </button>
            </div>

            {/* Schedule */}
            <div className="rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-4">
              <p className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">Schedule</p>
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-neutral-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <input
                    type="date"
                    value={fields.scheduled_date}
                    onChange={(e) => updateField('scheduled_date', e.target.value)}
                    className="flex-1 bg-transparent border-none outline-none text-sm text-neutral-900 dark:text-neutral-100"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-neutral-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <input
                    type="time"
                    value={fields.scheduled_time}
                    onChange={(e) => updateField('scheduled_time', e.target.value)}
                    className="flex-1 bg-transparent border-none outline-none text-sm text-neutral-900 dark:text-neutral-100"
                  />
                </div>
              </div>
            </div>

            {/* Time Tracking */}
            <div className="rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm text-neutral-600 dark:text-neutral-400">Time tracked</span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="text-base font-medium font-mono text-neutral-900 dark:text-white">
                  {timeTrackingHook.formatTime(timeTrackingHook.displaySeconds)}
                </span>
                {timeTrackingHook.activeTimeEntry ? (
                  <button
                    onClick={timeTrackingHook.stopProjectTimer}
                    className="text-xs font-medium px-3 py-1.5 rounded-full bg-red-500/10 text-red-500 active:bg-red-500/20 transition-colors"
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={() => timeTrackingHook.startProjectTimer(project.id)}
                    className="text-xs font-medium px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-500 active:bg-emerald-500/20 transition-colors"
                  >
                    {timeTrackingHook.displaySeconds > 0 ? 'Resume' : 'Start'}
                  </button>
                )}
              </div>
            </div>

            {/* Bottom padding */}
            <div className="h-4" />
          </div>
        )}

        {/* Comments Section */}
        {activeSection === 'comments' && (
          <div className="flex flex-col h-full">
            <div className="flex-1 p-4 space-y-4">
              {commentsHook.loadingComments ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : commentsHook.projectComments.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-neutral-400">
                  <svg className="w-10 h-10 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <p className="text-sm font-medium">No comments yet</p>
                  <p className="text-xs mt-1">Start the conversation below</p>
                </div>
              ) : (
                commentsHook.projectComments.map((comment) => (
                  <div key={comment.id} className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center text-xs font-medium text-blue-500 shrink-0">
                      {(comment.user_name || 'U').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="text-sm font-medium text-neutral-900 dark:text-white">{comment.user_name || 'Unknown'}</span>
                        <span className="text-[11px] text-neutral-400">
                          {new Date(comment.created_at).toLocaleDateString('en-US', {
                            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
                          })}
                        </span>
                      </div>
                      <div className="text-sm text-neutral-600 dark:text-neutral-300 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 px-3 py-2 rounded-r-xl rounded-bl-xl whitespace-pre-wrap">
                        {comment.comment_content}
                      </div>
                    </div>
                  </div>
                ))
              )}
              <div className="h-4" />
            </div>
          </div>
        )}

        {/* Attachments Section */}
        {activeSection === 'attachments' && (
          <div className="p-4 space-y-4">
            {attachmentsHook.loadingAttachments ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <>
                {/* Upload button */}
                <div>
                  <input
                    ref={attachmentsHook.attachmentInputRef}
                    type="file"
                    multiple
                    accept="image/*,video/*,.pdf,.doc,.docx"
                    className="hidden"
                    onChange={handleAttachmentUpload}
                  />
                  <button
                    onClick={() => attachmentsHook.attachmentInputRef.current?.click()}
                    disabled={attachmentsHook.uploadingAttachment}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-neutral-200 dark:border-neutral-700 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:border-neutral-300 dark:hover:border-neutral-600 transition-colors"
                  >
                    {attachmentsHook.uploadingAttachment ? (
                      <div className="w-5 h-5 border-2 border-neutral-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    )}
                    <span className="text-sm font-medium">
                      {attachmentsHook.uploadingAttachment ? 'Uploading...' : 'Upload file'}
                    </span>
                  </button>
                </div>

                {/* Attachment grid */}
                {attachmentsHook.projectAttachments.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-neutral-400">
                    <svg className="w-10 h-10 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                    <p className="text-sm font-medium">No attachments</p>
                    <p className="text-xs mt-1">Upload files above</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {attachmentsHook.projectAttachments.map((attachment, index) => (
                      <div
                        key={attachment.id}
                        className="relative aspect-square rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 cursor-pointer"
                        onClick={() => {
                          // Open image in a simple view
                          if (attachment.file_type === 'image') {
                            window.open(attachment.url || attachment.file_url, '_blank');
                          }
                        }}
                      >
                        {attachment.file_type === 'image' ? (
                          <img
                            src={attachment.url || attachment.file_url}
                            alt={attachment.file_name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center">
                            <svg className="w-6 h-6 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span className="text-[10px] text-neutral-500 mt-1 px-1 truncate max-w-full">
                              {attachment.file_name?.split('.').pop()?.toUpperCase() || 'FILE'}
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            <div className="h-4" />
          </div>
        )}
      </div>

      {/* ── Comment Input (sticky bottom, only on comments tab) ── */}
      {activeSection === 'comments' && (
        <div className="shrink-0 border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-4 py-3 safe-area-bottom">
          <div className="flex items-end gap-2">
            <textarea
              ref={commentInputRef}
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handlePostComment();
                }
              }}
              placeholder="Add a comment..."
              rows={1}
              className="flex-1 resize-none bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 outline-none focus:border-neutral-400 dark:focus:border-neutral-600"
            />
            <button
              onClick={handlePostComment}
              disabled={commentsHook.postingComment || !newComment.trim()}
              className="p-2 text-neutral-500 disabled:opacity-30 active:text-neutral-800 dark:active:text-neutral-200"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Picker Overlay — bottom sheet style list picker
// ============================================================================

function PickerOverlay({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[60] bg-black/30"
        onClick={onClose}
      />
      {/* Content */}
      <div className="fixed bottom-0 left-0 right-0 z-[61] bg-white dark:bg-neutral-900 rounded-t-2xl border-t border-neutral-200 dark:border-neutral-700 max-h-[60vh] overflow-y-auto safe-area-bottom shadow-xl">
        <div className="w-10 h-1 bg-neutral-300 dark:bg-neutral-600 rounded-full mx-auto mt-2 mb-1" />
        {children}
        <div className="h-4" />
      </div>
    </>
  );
}
