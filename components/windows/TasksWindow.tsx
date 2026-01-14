'use client';

import { memo, useEffect } from 'react';
import { useTasks } from '@/lib/useTasks';
import type { User } from '@/lib/types';
import {
  TaskRowItem,
  TaskFilterBar,
  TaskDetailPanel,
} from './tasks';

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

  // Fetch template when a task with template_id is selected
  useEffect(() => {
    if (selectedTask?.template_id) {
      fetchTaskTemplate(selectedTask.template_id);
    }
  }, [selectedTask?.template_id, fetchTaskTemplate]);

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
      {selectedTask && (
        <div className="w-1/2 border-l border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 flex-shrink-0">
          <TaskDetailPanel
            task={selectedTask}
            currentUser={currentUser}
            taskTemplates={taskTemplates}
            loadingTaskTemplate={loadingTaskTemplate}
            onClose={() => setSelectedTask(null)}
            onUpdateStatus={updateTaskStatus}
            onSaveForm={saveTaskForm}
            setTask={setSelectedTask}
          />
        </div>
      )}
    </div>
  );
}

const TasksWindow = memo(TasksWindowContent);
export default TasksWindow;
