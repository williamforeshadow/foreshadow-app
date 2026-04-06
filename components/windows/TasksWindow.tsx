'use client';

import { memo, useEffect, useState, useCallback, useRef } from 'react';
import { useTasks } from '@/lib/useTasks';
import { useProjectComments } from '@/lib/hooks/useProjectComments';
import { useProjectAttachments } from '@/lib/hooks/useProjectAttachments';
import { useProjectTimeTracking } from '@/lib/hooks/useProjectTimeTracking';
import { useProjectBins } from '@/lib/hooks/useProjectBins';
import type { User, Project, ProjectFormFields } from '@/lib/types';
import type { Template } from '@/components/DynamicCleaningForm';
import {
  TaskRowItem,
  TaskFilterBar,
} from './tasks';
import { ProjectDetailPanel, AttachmentLightbox } from './projects';

interface TasksWindowProps {
  currentUser: User | null;
  users: User[];
}

function TasksWindowContent({ currentUser, users }: TasksWindowProps) {
  const {
    tasks,
    summary,
    loading,
    error,
    filters,
    toggleStatusFilter,
    toggleTypeFilter,
    toggleTimelineFilter,
    setSearchQuery,
    setDateRange,
    setScheduledDateRange,
    toggleAssignedUserFilter,
    clearFilters,
    getActiveFilterCount,
    sortBy,
    setSortBy,
    selectedTask,
    setSelectedTask,
    // Template functionality
    taskTemplates,
    loadingTaskTemplate,
    fetchTaskTemplate,
    saveTaskForm,
    updateTaskStatus,
  } = useTasks();

  // Task → ProjectDetailPanel state
  const [taskEditingFields, setTaskEditingFields] = useState<ProjectFormFields | null>(null);
  const [taskStaffOpen, setTaskStaffOpen] = useState(false);
  const taskEditingFieldsRef = useRef<ProjectFormFields | null>(null);
  const [taskNewComment, setTaskNewComment] = useState('');

  const taskCommentsHook = useProjectComments({ currentUser });
  const taskAttachmentsHook = useProjectAttachments({ currentUser });
  const taskTimeTrackingHook = useProjectTimeTracking({ currentUser });
  const binsHook = useProjectBins({ currentUser });
  const [taskViewingAttachmentIndex, setTaskViewingAttachmentIndex] = useState<number | null>(null);

  useEffect(() => {
    taskEditingFieldsRef.current = taskEditingFields;
  }, [taskEditingFields]);

  // Fetch template when a task with template_id is selected (with property context)
  useEffect(() => {
    if (selectedTask?.template_id) {
      fetchTaskTemplate(selectedTask.template_id, selectedTask.property_name);
    }
  }, [selectedTask?.template_id, selectedTask?.property_name, fetchTaskTemplate]);

  // Initialize editing fields + fetch data when a task is selected
  useEffect(() => {
    if (selectedTask) {
      setTaskEditingFields({
        title: selectedTask.title || selectedTask.template_name || 'Task',
        description: selectedTask.description || null,
        status: selectedTask.status,
        priority: selectedTask.priority || 'medium',
        assigned_staff: (selectedTask.assigned_users || []).map(u => u.user_id),
        department_id: selectedTask.department_id || '',
        scheduled_date: selectedTask.scheduled_date || '',
        scheduled_time: selectedTask.scheduled_time || '',
      });
      taskCommentsHook.fetchProjectComments(selectedTask.task_id, 'task');
      taskAttachmentsHook.fetchProjectAttachments(selectedTask.task_id, 'task');
      taskTimeTrackingHook.fetchProjectTimeEntries(selectedTask.task_id, 'task');
    } else {
      setTaskEditingFields(null);
      setTaskStaffOpen(false);
      setTaskNewComment('');
      taskCommentsHook.clearComments();
      taskAttachmentsHook.clearAttachments();
      taskTimeTrackingHook.clearTimeTracking();
    }
  }, [selectedTask?.task_id]);

  const handleSaveTaskFields = useCallback(async () => {
    if (!selectedTask) return;
    const fields = taskEditingFieldsRef.current;
    if (!fields) return;
    const taskId = selectedTask.task_id;

    if (fields.status !== selectedTask.status) {
      await updateTaskStatus(taskId, fields.status as any);
      setSelectedTask({ ...selectedTask, status: fields.status as any });
    }

    const fieldUpdates: Record<string, unknown> = {};
    const origTitle = selectedTask.title || selectedTask.template_name || 'Task';
    const origPriority = selectedTask.priority || 'medium';
    if (fields.title !== origTitle) fieldUpdates.title = fields.title;
    if (JSON.stringify(fields.description) !== JSON.stringify(selectedTask.description || null)) fieldUpdates.description = fields.description;
    if (fields.priority !== origPriority) fieldUpdates.priority = fields.priority;
    if (fields.department_id !== (selectedTask.department_id || '')) fieldUpdates.department_id = fields.department_id || null;

    if (Object.keys(fieldUpdates).length > 0) {
      try {
        await fetch('/api/update-task-fields', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, fields: fieldUpdates }),
        });
      } catch (err) {
        console.error('Error updating task fields:', err);
      }
    }
  }, [selectedTask, updateTaskStatus, setSelectedTask]);

  const resolvedTemplate: Template | undefined = selectedTask?.template_id
    ? (taskTemplates[`${selectedTask.template_id}__${selectedTask.property_name}`] as Template
       || taskTemplates[selectedTask.template_id] as Template)
    : undefined;

  const taskAsProject: Project | null = selectedTask ? {
    id: selectedTask.task_id,
    property_name: selectedTask.property_name || null,
    bin_id: selectedTask.bin_id || null,
    title: selectedTask.title || selectedTask.template_name || 'Task',
    description: selectedTask.description || null,
    status: selectedTask.status as Project['status'],
    priority: (selectedTask.priority || 'medium') as Project['priority'],
    department_id: selectedTask.department_id || null,
    department_name: selectedTask.department_name || null,
    scheduled_date: selectedTask.scheduled_date || null,
    scheduled_time: selectedTask.scheduled_time || null,
    project_assignments: (selectedTask.assigned_users || []).map(u => ({
      user_id: u.user_id,
      user: { id: u.user_id, name: u.name, avatar: u.avatar, role: u.role }
    })),
    created_at: selectedTask.created_at || '',
    updated_at: selectedTask.updated_at || '',
  } : null;

  const formatTimeDisplay = useCallback((seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }, []);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main Content - container resizes, content stays full width via min-w-max */}
      <div className={`${selectedTask ? 'w-1/2' : 'w-full'} flex flex-col min-w-0`}>
        {/* Header with filters */}
        <TaskFilterBar
          filters={filters}
          summary={summary}
          taskCount={tasks.length}
          sortBy={sortBy}
          users={users}
          toggleStatusFilter={toggleStatusFilter}
          toggleTypeFilter={toggleTypeFilter}
          toggleTimelineFilter={toggleTimelineFilter}
          setSearchQuery={setSearchQuery}
          setDateRange={setDateRange}
          setScheduledDateRange={setScheduledDateRange}
          toggleAssignedUserFilter={toggleAssignedUserFilter}
          clearFilters={clearFilters}
          getActiveFilterCount={getActiveFilterCount}
          setSortBy={setSortBy}
        />

        {/* Task List */}
        <div className="flex-1 overflow-scroll">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-neutral-500 dark:text-neutral-400">Loading tasks...</p>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-red-500">{error}</p>
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-12 h-12 rounded-xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mb-3">
                <svg className="w-6 h-6 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <p className="text-neutral-500 dark:text-neutral-400">
                {getActiveFilterCount() > 0 ? 'No tasks match your filters' : 'No tasks found'}
              </p>
            </div>
          ) : (
            <div className="min-w-max">
              {/* Column headers */}
              <div className="flex items-center gap-6 px-4 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50 sticky top-0">
                <div className="w-2" />
                <div className="w-48">Task</div>
                <div className="w-32 text-center">Turnover Window</div>
                <div className="w-24">Type</div>
                <div className="w-24">Status</div>
                <div className="w-24 text-right">Scheduled</div>
                <div className="w-24">Assigned</div>
                <div className="w-28">Guest</div>
              </div>

              {/* Task rows */}
              {tasks.map(task => (
                <TaskRowItem
                  key={task.task_id}
                  task={task}
                  isSelected={selectedTask?.task_id === task.task_id}
                  onSelect={() => setSelectedTask(
                    selectedTask?.task_id === task.task_id ? null : task
                  )}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail Panel - flex sibling so scrollbar stays accessible */}
      {selectedTask && taskAsProject && taskEditingFields && (
        <div className="w-1/2 border-l border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 flex-shrink-0">
          <ProjectDetailPanel
            project={taskAsProject}
            editingFields={taskEditingFields}
            setEditingFields={setTaskEditingFields}
            users={users}
            savingEdit={false}
            onSave={handleSaveTaskFields}
            onDelete={() => setSelectedTask(null)}
            onClose={() => setSelectedTask(null)}
            onOpenActivity={() => {}}
            staffOpen={taskStaffOpen}
            setStaffOpen={setTaskStaffOpen}
            template={resolvedTemplate}
            formMetadata={selectedTask.form_metadata ?? undefined}
            onSaveForm={async (formData) => {
              await saveTaskForm(selectedTask.task_id, formData);
            }}
            loadingTemplate={loadingTaskTemplate === selectedTask.template_id}
            currentUser={currentUser}
            comments={taskCommentsHook.projectComments}
            loadingComments={taskCommentsHook.loadingComments}
            newComment={taskNewComment}
            setNewComment={setTaskNewComment}
            postingComment={taskCommentsHook.postingComment}
            onPostComment={async () => {
              if (selectedTask && taskNewComment.trim()) {
                await taskCommentsHook.postProjectComment(selectedTask.task_id, taskNewComment, 'task');
                setTaskNewComment('');
              }
            }}
            attachments={taskAttachmentsHook.projectAttachments}
            loadingAttachments={taskAttachmentsHook.loadingAttachments}
            uploadingAttachment={taskAttachmentsHook.uploadingAttachment}
            attachmentInputRef={taskAttachmentsHook.attachmentInputRef}
            onAttachmentUpload={(e) => {
              if (selectedTask) {
                taskAttachmentsHook.handleAttachmentUpload(e, selectedTask.task_id, 'task');
              }
            }}
            onViewAttachment={(index) => setTaskViewingAttachmentIndex(index)}
            activeTimeEntry={taskTimeTrackingHook.activeTimeEntry}
            displaySeconds={taskTimeTrackingHook.displaySeconds}
            formatTime={taskTimeTrackingHook.formatTime}
            onStartTimer={() => {
              if (selectedTask) taskTimeTrackingHook.startProjectTimer(selectedTask.task_id, 'task');
            }}
            onStopTimer={taskTimeTrackingHook.stopProjectTimer}
            // Bins
            bins={binsHook.bins}
            onBinChange={async (binId) => {
              if (!selectedTask) return;
              try {
                await fetch('/api/update-task-fields', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ taskId: selectedTask.task_id, fields: { bin_id: binId || null } }),
                });
                binsHook.fetchBins();
              } catch (err) {
                console.error('Error updating bin:', err);
              }
            }}
          />
        </div>
      )}
      {/* Attachment Lightbox for tasks */}
      <AttachmentLightbox
        attachments={taskAttachmentsHook.projectAttachments}
        viewingIndex={taskViewingAttachmentIndex}
        onClose={() => setTaskViewingAttachmentIndex(null)}
        onNavigate={setTaskViewingAttachmentIndex}
      />
    </div>
  );
}

const TasksWindow = memo(TasksWindowContent);
export default TasksWindow;
