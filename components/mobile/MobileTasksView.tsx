'use client';

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useUsers } from '@/lib/useUsers';
import { useDepartments } from '@/lib/departmentsContext';
import { getDepartmentIcon } from '@/lib/departmentIcons';
import { useTasks, type TaskRow as TaskRowData } from '@/lib/useTasks';
import type {
  Project,
  User,
} from '@/lib/types';
import { MobileTaskRow } from '@/components/tasks/MobileTaskRow';
import type { TaskRowItem } from '@/components/tasks/TaskRow';
import { todayISO } from '@/components/tasks/taskDateSections';
import { TaskDetailPanel } from '@/components/tasks/detail/TaskDetailPanel';
import { projectToTaskInput } from '@/components/tasks/detail/taskInput';
import { CreateTaskPanel } from '@/components/tasks/create/CreateTaskPanel';
import { MobileTaskFilterBar } from '@/components/mobile/MobileTaskFilterBar';
import { LoadingState } from '@/components/ui/loading-state';
import { useExclusiveDetailPanelHost } from '@/lib/reservationViewerContext';
import { useBackNavigation } from '@/lib/navigationHistoryTracker';
import { useRouter, useSearchParams } from 'next/navigation';

// Mobile-tailored Tasks view. Shares the same useTasks hook + filter bar as
// the desktop dashboard tab — only the row + detail components swap out for
// the mobile-friendly variants. Lives at the /tasks route so URL-sync writes
// don't conflict with any other surface.

function toRowItem(task: TaskRowData): TaskRowItem {
  return {
    key: `task-${task.task_id}`,
    title: task.title || task.template_name || 'Untitled Task',
    property_name: task.property_name,
    status: task.status,
    priority: task.priority,
    department_id: task.department_id,
    department_name: task.department_name,
    scheduled_date: task.scheduled_date,
    scheduled_time: task.scheduled_time,
    assignees: task.assigned_users.map((a) => ({
      user_id: a.user_id,
      name: a.name,
      avatar: a.avatar ?? null,
    })),
    bin_id: task.bin_id,
    bin_name: task.bin_name,
    is_binned: task.is_binned,
    is_automated: task.is_automated,
    reservation_id: task.reservation_id,
    comment_count: task.comment_count,
    occupancy: task.occupancy ?? null,
  };
}


function MobileTasksViewContent() {
  // This view owns the full mobile page chrome (safe-area container + header)
  // so its header — title + subtitle + toolbar — lives in one gradient block,
  // matching the Schedule / My Assignments / Bins pattern. (Previously the
  // title sat in MobileRouteShell's separate bar, breaking the gradient.)
  // Tasks is reached from the Menu tab, so the header leads with a back arrow.
  const { users: rawUsers } = useUsers();
  const users = rawUsers as unknown as User[];
  const { departments: allDepts } = useDepartments();

  const {
    tasks,
    allTasks,
    loading,
    error,
    fetchTasks,

    filters,
    filterOptions,
    setSearch,
    setStatuses,
    setAssignees,
    setDepartments,
    setBins,
    setOrigins,
    setPriorities,
    setProperties,
    setScheduledDateRange,
    clearFilters,
    anyFilterActive,

    sort,
    setSort,

    selectedTask,
    setSelectedTask,
  } = useTasks({ urlSync: true });

  // Declared before closeGlobals, which closes over setCreatingOpen.
  const [creatingOpen, setCreatingOpen] = useState(false);

  const closeGlobals = useExclusiveDetailPanelHost(() => {
    setSelectedTask(null);
    setCreatingOpen(false);
  });

  // ---- New task draft flow ----------------------------------------------

  const handleNewTask = useCallback(() => {
    closeGlobals();
    setSelectedTask(null);
    setCreatingOpen(true);
  }, [closeGlobals, setSelectedTask]);

  // Auto-open the new-task form when arriving via `/tasks?newTask=1` (e.g.
  // the + task button on Schedule / My Assignments, which have no local
  // create flow). Fires once, then strips the param so a refresh doesn't
  // re-open it.
  const router = useRouter();
  const goBack = useBackNavigation();
  const searchParams = useSearchParams();
  const newTaskSentinel = searchParams?.get('newTask');
  const handledNewTaskRef = useRef(false);
  useEffect(() => {
    if (!newTaskSentinel || handledNewTaskRef.current) return;
    handledNewTaskRef.current = true;
    handleNewTask();
    const params = new URLSearchParams(searchParams?.toString());
    params.delete('newTask');
    const qs = params.toString();
    router.replace(qs ? `/tasks?${qs}` : '/tasks');
  }, [newTaskSentinel, handleNewTask, router, searchParams]);

  // Creation itself is owned by useTaskCreate (CreateTaskPanel).

  // ---- Selection → Project mapping --------------------------------------

  const itemAsProject: Project | null = useMemo(() => {
    if (!selectedTask) return null;
    return {
      id: selectedTask.task_id,
      property_id: selectedTask.property_id,
      property_name: selectedTask.property_name,
      bin_id: selectedTask.bin_id,
      is_binned: selectedTask.is_binned,
      template_id: selectedTask.template_id,
      template_name: selectedTask.template_name,
      title: selectedTask.title || selectedTask.template_name || 'Task',
      description: selectedTask.description,
      status: selectedTask.status as Project['status'],
      priority: (selectedTask.priority || 'medium') as Project['priority'],
      department_id: selectedTask.department_id,
      department_name: selectedTask.department_name,
      scheduled_date: selectedTask.scheduled_date,
      scheduled_time: selectedTask.scheduled_time,
      reservation_id: selectedTask.reservation_id,
      form_metadata: selectedTask.form_metadata ?? undefined,
      project_assignments: selectedTask.assigned_users.map((u) => ({
        user_id: u.user_id,
        user: {
          id: u.user_id,
          name: u.name,
          avatar: u.avatar,
          role: u.role,
        } as any,
      })),
      created_at: selectedTask.created_at || '',
      updated_at: selectedTask.updated_at || '',
    } as Project;
  }, [selectedTask]);

  // ---- Grouping ---------------------------------------------------------

  // No grouping — this page is the raw all-tasks ledger, curated by the
  // filters and sort alone (My Assignments keeps its date sections). `today`
  // marks past-due open tasks with the urgent-red inline date.
  const today = todayISO();

  return (
    <div className="h-dvh flex flex-col overflow-hidden bg-white dark:bg-card">
      {/* Header region — one continuous neutral gradient behind the title +
          subtitle + toolbar, capped with a hairline where it meets the flat
          list. */}
      <div className="flex-shrink-0 bg-white dark:bg-card bg-[linear-gradient(to_bottom,var(--header-scrim),transparent)] border-b border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]">
      {/* Title row — hamburger + page title (rendered here, inside the
          gradient, so the fade reaches the very top). */}
      <div
        className="px-[22px] pb-1"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {/* This view renders its own chrome rather than MobileRouteShell (so
              the header gradient runs unbroken from the title through the
              toolbar), so it needs the history-aware back wired up by hand.
              /menu is the fallback for a cold entry only. */}
          <button
            onClick={() => goBack('/menu')}
            className="-ml-2 w-10 h-10 flex items-center justify-center rounded-lg text-neutral-700 dark:text-[#a09e9a] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] transition-colors"
            aria-label="Back"
          >
            <svg className="w-[22px] h-[22px]" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-[20px] font-semibold tracking-tight leading-none text-neutral-900 dark:text-[#f0efed] truncate">
            Tasks
          </h1>
        </div>
      </div>

      {/* Mobile-native filter bar: compact row + portalled bottom sheets.
          Avoids cramming 8+ desktop chips into a horizontally-scrolling row,
          and renders its sheets via portal so they can't be clipped by the
          list's scroll container. Background comes from the gradient wrapper. */}
      <div>
        <MobileTaskFilterBar
          search={filters.search}
          onSearchChange={setSearch}
          statusOptions={filterOptions.statuses}
          statusSelected={filters.statuses}
          onStatusChange={setStatuses}
          assigneeOptions={filterOptions.assignees}
          assigneeSelected={filters.assignees}
          onAssigneeChange={setAssignees}
          departmentOptions={filterOptions.departments}
          departmentSelected={filters.departments}
          onDepartmentChange={setDepartments}
          binOptions={filterOptions.bins}
          binSelected={filters.bins}
          onBinChange={setBins}
          originOptions={filterOptions.origins}
          originSelected={filters.origins}
          onOriginChange={setOrigins}
          priorityOptions={filterOptions.priorities}
          prioritySelected={filters.priorities}
          onPriorityChange={setPriorities}
          propertyOptions={filterOptions.properties}
          propertySelected={filters.properties}
          onPropertyChange={setProperties}
          scheduledDateRange={filters.scheduledDateRange}
          onScheduledDateRangeChange={setScheduledDateRange}
          sortKey={sort.key}
          sortDir={sort.dir}
          onSortChange={setSort}
          onClearAll={clearFilters}
          anyFilterActive={anyFilterActive}
          onNewTask={handleNewTask}
          totalCount={allTasks.length}
          filteredCount={tasks.length}
        />
      </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto pb-mobile-bubble">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <LoadingState />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-neutral-500 dark:text-[#a09e9a] text-sm px-5 text-center">
              {error}
            </p>
          </div>
        ) : allTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-5 text-center">
            <p className="text-neutral-600 dark:text-[#a09e9a] font-medium">
              No tasks in the workspace yet
            </p>
            <p className="text-sm text-neutral-500 dark:text-[#66645f] mt-1">
              Tasks created from properties or generated by automations will appear here.
            </p>
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-5 text-center">
            <p className="text-neutral-600 dark:text-[#a09e9a] font-medium">No matches</p>
            <p className="text-sm text-neutral-500 dark:text-[#66645f] mt-1">
              No tasks match your current filters.
            </p>
            <button
              onClick={clearFilters}
              className="mt-3 text-[12px] font-medium text-[var(--accent-3)] dark:text-[var(--accent-1)] hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="px-5 pt-5 pb-8 flex flex-col gap-2.5">
            {tasks.map((t) => {
              const dept = allDepts.find((d) => d.id === t.department_id);
              const DeptIcon = getDepartmentIcon(dept?.icon);
              const isSelected = selectedTask?.task_id === t.task_id;
              return (
                <MobileTaskRow
                  key={`task-${t.task_id}`}
                  item={toRowItem(t)}
                  selected={isSelected}
                  // Flat ledger: no section headers to carry dates, so every
                  // card shows its own. Past-due open tasks keep the urgent
                  // red — it's the only overdue signal left.
                  showDateInline
                  overdue={
                    !!t.scheduled_date &&
                    t.scheduled_date < today &&
                    t.status !== 'complete'
                  }
                  onClick={() => {
                    if (isSelected) {
                      setSelectedTask(null);
                    } else {
                      closeGlobals();
                      setCreatingOpen(false);
                      setSelectedTask(t);
                    }
                  }}
                  departmentIcon={DeptIcon}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Detail overlay — unified panel (self-renders fixed inset-0 on mobile) */}
      {creatingOpen && (
        <CreateTaskPanel
          onClose={() => setCreatingOpen(false)}
          onCreated={() => {
            setCreatingOpen(false);
            void fetchTasks();
          }}
        />
      )}
      {selectedTask && itemAsProject ? (
        <TaskDetailPanel
          task={projectToTaskInput(itemAsProject, users)}
          onClose={() => setSelectedTask(null)}
          onDeleted={() => setSelectedTask(null)}
        />
      ) : null}
    </div>
  );
}

const MobileTasksView = memo(MobileTasksViewContent);
export default MobileTasksView;
