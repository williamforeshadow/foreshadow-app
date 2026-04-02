'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useAuth } from '@/lib/authContext';
import { useDepartments } from '@/lib/departmentsContext';
import { getDepartmentIcon } from '@/lib/departmentIcons';
import DynamicCleaningForm from '@/components/DynamicCleaningForm';
import type { Template } from '@/components/DynamicCleaningForm';
import type { Task, User } from '@/lib/types';
import DiamondIcon from '@/components/icons/AssignmentIcon';

// ============================================================================
// Types
// ============================================================================

interface MobileTaskDetailProps {
  task: Task;
  users: User[];
  onClose: () => void;
  onUpdateStatus: (taskId: string, status: string) => void;
  onSaveForm: (taskId: string, formData: Record<string, unknown>) => Promise<void>;
  taskTemplates: Record<string, Template>;
  loadingTaskTemplate: string | null;
  onUpdateSchedule?: (taskId: string, scheduledDate: string | null, scheduledTime: string | null) => void;
  onUpdateAssignment?: (taskId: string, userIds: string[]) => void;
}

// ============================================================================
// Status Configs
// ============================================================================

function getStatusStyles(status: string) {
  const glassBase = 'glass-card glass-sheen relative overflow-hidden rounded-xl';
  switch (status) {
    case 'complete':
      return `${glassBase} bg-emerald-50/55 dark:bg-emerald-500/[0.12] border border-emerald-200/40 dark:border-emerald-400/20`;
    case 'in_progress':
      return `${glassBase} bg-indigo-50/55 dark:bg-indigo-500/[0.12] border border-indigo-300/40 dark:border-indigo-400/20`;
    case 'paused':
      return `${glassBase} bg-indigo-50/55 dark:bg-indigo-500/[0.12] border border-indigo-300/40 dark:border-indigo-400/20`;
    case 'contingent':
      return `${glassBase} bg-white/45 dark:bg-white/[0.05] border border-dashed border-neutral-400/50 dark:border-white/15`;
    default:
      return `${glassBase} bg-amber-50/55 dark:bg-amber-400/[0.10] border border-amber-200/40 dark:border-amber-400/18`;
  }
}

function formatTime12(time: string) {
  const [h, m] = time.slice(0, 5).split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ============================================================================
// Main Component
// ============================================================================

export default function MobileTaskDetail({
  task: initialTask,
  users,
  onClose,
  onUpdateStatus,
  onSaveForm,
  taskTemplates,
  loadingTaskTemplate,
  onUpdateSchedule,
  onUpdateAssignment,
}: MobileTaskDetailProps) {
  const { user: currentUser } = useAuth();
  const { deptIconMap } = useDepartments();

  const [task, setTask] = useState<Task>(initialTask);
  const [showStaffPicker, setShowStaffPicker] = useState(false);
  const [staffSearch, setStaffSearch] = useState('');
  const [requiredFieldsFilled, setRequiredFieldsFilled] = useState(false);

  const DeptIcon = getDepartmentIcon(task.department_id ? deptIconMap[task.department_id] : null);
  const cardStyles = getStatusStyles(task.status || 'not_started');
  const isAssigned = (task.assigned_users || []).some((u) => u.user_id === currentUser?.id);
  const isContingent = task.status === 'contingent';
  const isNotStarted = task.status === 'not_started' || !task.status;
  const isActive = !isContingent && !isNotStarted;
  const assignedUsers = task.assigned_users || [];

  const resolvedTemplate = task.template_id
    ? (taskTemplates[`${task.template_id}__${task.property_name}`] || taskTemplates[task.template_id])
    : undefined;

  const tinyBtn = 'h-7 text-[11px] px-2.5 rounded-md font-medium';

  const handleStatusChange = (newStatus: string) => {
    onUpdateStatus(task.task_id, newStatus);
    setTask(prev => ({ ...prev, status: newStatus as Task['status'] }));
  };

  const handleToggleStaff = (userId: string) => {
    const currentIds = assignedUsers.map(u => u.user_id);
    const newIds = currentIds.includes(userId)
      ? currentIds.filter(id => id !== userId)
      : [...currentIds, userId];
    onUpdateAssignment?.(task.task_id, newIds);
    const newAssignedUsers = newIds.map(id => {
      const existing = assignedUsers.find(u => u.user_id === id);
      if (existing) return existing;
      const user = users.find(u => u.id === id);
      return { user_id: id, name: user?.name || '', avatar: user?.avatar || '', role: user?.role || '' };
    });
    setTask(prev => ({ ...prev, assigned_users: newAssignedUsers }));
  };

  const renderActionButtons = () => {
    if (isContingent) {
      return (
        <Button size="sm" className={tinyBtn} onClick={() => handleStatusChange('not_started')}>
          Approve
        </Button>
      );
    }
    if (!isAssigned) return null;
    if (isNotStarted) {
      return (
        <Button size="sm" className={tinyBtn} onClick={() => handleStatusChange('in_progress')}>
          Start Task
        </Button>
      );
    }
    if (task.status === 'in_progress') {
      return (
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" className={tinyBtn} onClick={() => handleStatusChange('paused')}>
            Pause
          </Button>
          <Button size="sm" className={tinyBtn} disabled={!requiredFieldsFilled} onClick={() => handleStatusChange('complete')}>
            Complete
          </Button>
        </div>
      );
    }
    if (task.status === 'paused') {
      return (
        <div className="flex gap-1.5">
          <Button size="sm" className={tinyBtn} onClick={() => handleStatusChange('in_progress')}>
            Resume
          </Button>
          <Button size="sm" variant="outline" className={tinyBtn} disabled={!requiredFieldsFilled} onClick={() => handleStatusChange('complete')}>
            Complete
          </Button>
        </div>
      );
    }
    if (task.status === 'complete' || task.status === 'reopened') {
      return (
        <Button size="sm" variant="outline" className={tinyBtn} onClick={() => handleStatusChange('not_started')}>
          Reopen
        </Button>
      );
    }
    return null;
  };

  const actionButtons = renderActionButtons();

  return (
    <div
      className="fixed inset-0 z-[60] bg-white dark:bg-neutral-950 flex flex-col"
      style={{ height: '100dvh' }}
    >
      {/* ── Unified Header ── */}
      <div className="shrink-0 p-4 space-y-3 backdrop-blur-xl bg-white/80 dark:bg-neutral-900/80 border-b border-neutral-200 dark:border-neutral-800">
        {/* Back row */}
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-sm text-neutral-500 dark:text-neutral-400 active:text-neutral-700 dark:active:text-neutral-300 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        {/* Glass card — mirrors desktop TaskDetailPanel exactly */}
        <div className={`p-3 ${cardStyles}`}>
          <div className="flex items-center gap-3">
            {/* Department icon */}
            <div className="w-9 h-9 rounded-lg bg-black/10 dark:bg-black/40 flex items-center justify-center shrink-0">
              <DeptIcon className="w-4.5 h-4.5 text-neutral-600 dark:text-neutral-300" />
            </div>

            {/* Middle: title, property, date+action row */}
            <div className="flex-1 min-w-0 flex flex-col gap-2">
              {/* Title + property grouped */}
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium truncate flex items-center gap-3">
                  {task.template_name || 'Task'}
                  <DiamondIcon size={10} className="shrink-0 opacity-40" />
                </span>
                <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                  {task.property_name}
                  {task.guest_name && (
                    <span className="text-neutral-400 dark:text-neutral-600"> · {task.guest_name}</span>
                  )}
                </div>
              </div>

              {/* Date/time + action button — same row */}
              <div className="flex items-center gap-2.5 flex-wrap">
                <div className="flex items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400 px-2 py-1 rounded-lg bg-black/10 dark:bg-black/40">
                  <svg className="w-3 h-3 shrink-0 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  {onUpdateSchedule ? (
                    <>
                      <Popover modal>
                        <PopoverTrigger asChild>
                          <button className="active:text-neutral-700 dark:active:text-neutral-300 transition-colors">
                            {task.scheduled_date ? new Date(task.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Date'}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0 z-[70]" align="start">
                          <Calendar
                            mode="single"
                            selected={task.scheduled_date ? new Date(task.scheduled_date + 'T00:00:00') : undefined}
                            onSelect={(date) => {
                              if (date) {
                                const y = date.getFullYear();
                                const m = String(date.getMonth() + 1).padStart(2, '0');
                                const d = String(date.getDate()).padStart(2, '0');
                                onUpdateSchedule(task.task_id, `${y}-${m}-${d}`, task.scheduled_time || null);
                                setTask(prev => ({ ...prev, scheduled_date: `${y}-${m}-${d}` }));
                              }
                            }}
                          />
                        </PopoverContent>
                      </Popover>
                      <span className="text-neutral-400 dark:text-neutral-600">·</span>
                      <Popover modal>
                        <PopoverTrigger asChild>
                          <button className="active:text-neutral-700 dark:active:text-neutral-300 transition-colors">
                            {task.scheduled_time ? formatTime12(task.scheduled_time) : 'Time'}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-2 z-[70]" align="start">
                          <input
                            type="time"
                            className="bg-transparent text-sm cursor-pointer"
                            value={task.scheduled_time ? task.scheduled_time.slice(0, 5) : ''}
                            autoFocus
                            onChange={(e) => {
                              const newTime = e.target.value || null;
                              onUpdateSchedule(task.task_id, task.scheduled_date || null, newTime);
                              setTask(prev => ({ ...prev, scheduled_time: newTime }));
                            }}
                          />
                        </PopoverContent>
                      </Popover>
                    </>
                  ) : (
                    <>
                      {task.scheduled_date && (
                        <span>
                          {new Date(task.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                      {task.scheduled_date && task.scheduled_time && (
                        <span className="text-neutral-400 dark:text-neutral-600">·</span>
                      )}
                      {task.scheduled_time && (
                        <span>{formatTime12(task.scheduled_time)}</span>
                      )}
                    </>
                  )}
                </div>
                {actionButtons}
              </div>
            </div>

            {/* Assigned user avatars */}
            <button
              onClick={() => setShowStaffPicker(!showStaffPicker)}
              className="flex items-center shrink-0 active:opacity-80 transition-opacity self-center"
            >
              {assignedUsers.length > 0 ? (
                <span className="flex items-center -space-x-2">
                  {assignedUsers.slice(0, 3).map((u) => (
                    <UserAvatar
                      key={u.user_id}
                      src={u.avatar}
                      name={u.name}
                      size="sm"
                      className="ring-2 ring-white/50 dark:ring-white/10"
                    />
                  ))}
                  {assignedUsers.length > 3 && (
                    <span className="text-neutral-500 dark:text-neutral-400 ml-1.5 text-xs">+{assignedUsers.length - 3}</span>
                  )}
                </span>
              ) : (
                <span className="h-9 w-9 rounded-full border-2 border-dashed border-neutral-400/50 dark:border-white/20 flex items-center justify-center text-neutral-400 dark:text-neutral-500">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Scrollable Body — form ── */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain hide-scrollbar" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="p-5">
          {task.template_id ? (
            loadingTaskTemplate === task.template_id ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : resolvedTemplate ? (
              <DynamicCleaningForm
                cleaningId={task.task_id}
                propertyName={task.property_name || ''}
                template={resolvedTemplate}
                formMetadata={task.form_metadata}
                onSave={async (formData) => {
                  await onSaveForm(task.task_id, formData);
                }}
                readOnly={!isActive || !isAssigned}
                onValidationChange={setRequiredFieldsFilled}
              />
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-neutral-400">
                <svg className="w-10 h-10 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-sm font-medium">No template configured</p>
              </div>
            )
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-neutral-400">
              <svg className="w-10 h-10 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm font-medium">No template configured</p>
            </div>
          )}
          <div className="h-8" />
        </div>
      </div>

      {/* Staff Picker — bottom sheet */}
      {showStaffPicker && onUpdateAssignment && (
        <StaffPickerSheet
          users={users}
          assignedUsers={assignedUsers}
          staffSearch={staffSearch}
          setStaffSearch={setStaffSearch}
          onToggle={handleToggleStaff}
          onClose={() => { setShowStaffPicker(false); setStaffSearch(''); }}
        />
      )}
    </div>
  );
}

// ============================================================================
// Staff Picker Bottom Sheet
// ============================================================================

function StaffPickerSheet({
  users,
  assignedUsers,
  staffSearch,
  setStaffSearch,
  onToggle,
  onClose,
}: {
  users: User[];
  assignedUsers: { user_id: string; name: string; avatar?: string }[];
  staffSearch: string;
  setStaffSearch: (v: string) => void;
  onToggle: (userId: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const assignedIds = assignedUsers.map(u => u.user_id);

  return (
    <>
      <div className="fixed inset-0 z-[65] bg-black/40" onClick={onClose} />
      <div
        ref={ref}
        className="fixed bottom-0 left-0 right-0 z-[66] bg-white dark:bg-neutral-900 rounded-t-2xl max-h-[60vh] flex flex-col safe-area-bottom"
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <p className="text-sm font-semibold text-neutral-900 dark:text-white">Assign Staff</p>
          <button onClick={onClose} className="text-sm text-neutral-500">Done</button>
        </div>
        <div className="px-4 pb-2">
          <input
            type="text"
            placeholder="Search staff..."
            value={staffSearch}
            onChange={(e) => setStaffSearch(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-neutral-200/60 dark:border-white/10 text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-500 outline-none focus:border-neutral-300 dark:focus:border-white/20"
          />
        </div>
        <div className="flex-1 overflow-y-auto pb-4">
          {assignedIds.length > 0 && (
            <button
              onClick={() => assignedIds.forEach(id => onToggle(id))}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-neutral-500 active:bg-black/[0.03] dark:active:bg-white/[0.05]"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              <span className="text-[15px]">Clear all</span>
            </button>
          )}
          {users
            .filter(user => !staffSearch.trim() || user.name.toLowerCase().includes(staffSearch.toLowerCase()))
            .map((user) => {
              const isAssigned = assignedIds.includes(user.id);
              return (
                <button
                  key={user.id}
                  onClick={() => onToggle(user.id)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    isAssigned ? 'bg-white/40 dark:bg-white/10' : 'active:bg-black/[0.03] dark:active:bg-white/[0.05]'
                  }`}
                >
                  <UserAvatar src={user.avatar} name={user.name} size="sm" />
                  <span className="text-[15px] text-neutral-900 dark:text-white flex-1">{user.name}</span>
                  {isAssigned && (
                    <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              );
            })}
        </div>
      </div>
    </>
  );
}
