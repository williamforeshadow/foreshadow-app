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
import { useProperties } from '@/lib/queries';
import type {
  Project,
  User,
} from '@/lib/types';
import { MobileTaskRow } from '@/components/tasks/MobileTaskRow';
import type { TaskRowItem } from '@/components/tasks/TaskRow';
import { TaskDetailPanel } from '@/components/tasks/detail/TaskDetailPanel';
import { projectToTaskInput, type TaskDraft } from '@/components/tasks/detail/taskInput';
import type { TaskCreatePayload } from '@/components/tasks/detail/useTaskDetailController';
import { MobileTaskFilterBar } from '@/components/mobile/MobileTaskFilterBar';
import { useExclusiveDetailPanelHost } from '@/lib/reservationViewerContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from '@/components/ui/toast';

// Mobile-tailored Tasks view. Shares the same useTasks hook + filter bar as
// the desktop dashboard tab — only the row + detail components swap out for
// the mobile-friendly variants. Lives at the /tasks route so URL-sync writes
// don't conflict with any other surface.

interface DateGroup {
  id: string;
  label: string;
  sublabel?: string;
  items: TaskRowData[];
  defaultCollapsed?: boolean;
}

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function endOfWeekISO(): string {
  const now = new Date();
  const eow = new Date(now);
  const daysUntilSunday = 7 - now.getDay();
  eow.setDate(now.getDate() + daysUntilSunday);
  return `${eow.getFullYear()}-${String(eow.getMonth() + 1).padStart(2, '0')}-${String(eow.getDate()).padStart(2, '0')}`;
}

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
  };
}

// Adapters between this view's Project-shaped draft state and the panel's
// TaskDraft (same pattern as MobileProjectsView).
function projectToDraft(project: Project): TaskDraft {
  return {
    title: project.title || '',
    description: project.description ?? null,
    priority: project.priority || 'medium',
    status: project.status || 'not_started',
    department_id: project.department_id || null,
    scheduled_date: project.scheduled_date || null,
    scheduled_time: project.scheduled_time || null,
    assigned_staff: (project.project_assignments ?? []).map((a) => a.user_id),
    property_id: project.property_id ?? null,
    property_name: project.property_name ?? null,
    template_id: project.template_id ?? null,
    template_name: project.template_name ?? null,
    bin_id: project.bin_id ?? null,
  };
}

function applyDraftToProject(project: Project, draft: TaskDraft): Project {
  return {
    ...project,
    title: draft.title,
    description: draft.description as Project['description'],
    priority: draft.priority as Project['priority'],
    status: draft.status as Project['status'],
    department_id: draft.department_id,
    scheduled_date: draft.scheduled_date,
    scheduled_time: draft.scheduled_time,
    property_id: draft.property_id,
    property_name: draft.property_name,
    template_id: draft.template_id,
    template_name: draft.template_name,
    bin_id: draft.bin_id,
    project_assignments: draft.assigned_staff.map((id) => ({ user_id: id })),
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

  const closeGlobals = useExclusiveDetailPanelHost(() => {
    setSelectedTask(null);
    setDraftTask(null);
  });

  // ---- Supporting lists --------------------------------------------------

  const { properties: allProperties } = useProperties();

  // ---- Detail / draft state ---------------------------------------------

  const [draftTask, setDraftTask] = useState<Project | null>(null);
  const [creatingTask, setCreatingTask] = useState(false);

  // ---- New task draft flow ----------------------------------------------

  const handleNewTask = useCallback(() => {
    const draft: Project = {
      id: `draft-${Date.now()}`,
      property_name: null,
      bin_id: null,
      is_binned: false,
      template_id: null,
      template_name: null,
      title: 'New Task',
      description: null,
      status: 'not_started' as Project['status'],
      priority: 'medium' as Project['priority'],
      department_id: null,
      department_name: null,
      scheduled_date: null,
      scheduled_time: null,
      form_metadata: undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    closeGlobals();
    setSelectedTask(null);
    setDraftTask(draft);
  }, [closeGlobals, setSelectedTask]);

  // Auto-open the new-task draft when arriving via `/tasks?newTask=1` (e.g.
  // the + task button on Schedule / My Assignments, which have no local
  // draft flow). Fires once, then strips the param so a refresh doesn't
  // re-open it.
  const router = useRouter();
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

  const handleConfirmCreate = useCallback(
    async (create: TaskCreatePayload) => {
      if (!draftTask) return;
      const fields = create.fields;
      const propertyName = create.property_name;

      setCreatingTask(true);
      try {
        const matchedProperty = propertyName
          ? allProperties.find((p) => p.name === propertyName)
          : null;
        const payload: Record<string, unknown> = {
          title: fields.title || 'New Task',
          status: fields.status || 'not_started',
          priority: fields.priority || 'medium',
          is_binned: false,
          description: fields.description || null,
          department_id: fields.department_id || null,
          scheduled_date: fields.scheduled_date || null,
          scheduled_time: fields.scheduled_time || null,
          template_id: create.template_id || null,
          property_id: create.property_id ?? matchedProperty?.id ?? null,
          property_name: propertyName,
        };
        if (fields.assigned_staff?.length)
          payload.assigned_user_ids = fields.assigned_staff;

        const res = await fetch('/api/tasks-for-bin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const result = await res.json();
        if (result.data) {
          setDraftTask(null);
          await fetchTasks();
        } else {
          console.error('Create failed:', result.error);
          toast.error(result.error || "Couldn't create the task");
        }
      } catch (err) {
        console.error('Error creating task:', err);
        toast.error("Couldn't create the task");
      } finally {
        setCreatingTask(false);
      }
    },
    [draftTask, allProperties, fetchTasks]
  );

  // ---- Selection → Project mapping --------------------------------------

  const itemAsProject: Project | null = useMemo(() => {
    if (draftTask) return draftTask;
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
  }, [selectedTask, draftTask]);

  // ---- Grouping ---------------------------------------------------------

  const groups = useMemo((): DateGroup[] => {
    const today = todayISO();
    const eow = endOfWeekISO();
    const overdue: TaskRowData[] = [];
    const todayBucket: TaskRowData[] = [];
    const thisWeek: TaskRowData[] = [];
    const later: TaskRowData[] = [];
    const unscheduled: TaskRowData[] = [];
    const completed: TaskRowData[] = [];

    for (const t of tasks) {
      if (t.status === 'complete') {
        completed.push(t);
        continue;
      }
      const d = t.scheduled_date;
      if (!d) unscheduled.push(t);
      else if (d < today) overdue.push(t);
      else if (d === today) todayBucket.push(t);
      else if (d <= eow) thisWeek.push(t);
      else later.push(t);
    }

    const out: DateGroup[] = [];
    if (overdue.length)
      out.push({ id: 'overdue', label: 'Overdue', sublabel: `${overdue.length}`, items: overdue });
    if (todayBucket.length)
      out.push({ id: 'today', label: 'Today', sublabel: `${todayBucket.length} scheduled`, items: todayBucket });
    if (thisWeek.length)
      out.push({ id: 'thisWeek', label: 'This week', sublabel: `${thisWeek.length} scheduled`, items: thisWeek });
    if (later.length)
      out.push({ id: 'later', label: 'Later', sublabel: `${later.length} scheduled`, items: later });
    if (unscheduled.length)
      out.push({ id: 'noDate', label: 'No date', sublabel: `${unscheduled.length}`, items: unscheduled });
    if (completed.length)
      out.push({
        id: 'completed',
        label: 'Completed',
        sublabel: `${completed.length}`,
        items: completed,
        defaultCollapsed: true,
      });
    return out;
  }, [tasks]);

  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => new Set(['completed'])
  );
  const toggleSection = useCallback((id: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="h-dvh flex flex-col overflow-hidden bg-white dark:bg-card">
      {/* Header region — one continuous neutral gradient behind the title +
          subtitle + toolbar, capped with a hairline where it meets the flat
          list. */}
      <div className="flex-shrink-0 bg-white dark:bg-card bg-[linear-gradient(to_bottom,#f4f4f6,transparent)] dark:bg-[linear-gradient(to_bottom,#30303a,transparent)] border-b border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]">
      {/* Title row — hamburger + page title (rendered here, inside the
          gradient, so the fade reaches the very top). */}
      <div
        className="px-[22px] pb-1"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => router.push('/menu')}
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

      {/* Subtitle row — supporting line under the title. */}
      <div className="px-[22px] pb-2">
        <div className="flex items-center gap-3 text-[11px] text-neutral-500 dark:text-[#66645f] uppercase tracking-[0.04em] font-medium">
          <span>Every task in the workspace</span>
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
          <div className="flex items-center justify-center py-16">
            <div className="w-7 h-7 border-2 border-neutral-400 dark:border-[#66645f] border-t-transparent rounded-full animate-spin" />
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
          <div className="px-5 pb-8">
            {groups.map((group) => {
              const isCollapsed = collapsedSections.has(group.id);
              return (
                <div key={group.id} className="pt-5">
                  <button
                    onClick={() => toggleSection(group.id)}
                    className="flex items-center justify-between w-full mb-3"
                  >
                    <div className="flex items-center gap-1.5">
                      <svg
                        className={`w-3 h-3 text-neutral-400 dark:text-[#66645f] transition-transform ${
                          isCollapsed ? '-rotate-90' : ''
                        }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 9l-7 7-7-7"
                        />
                      </svg>
                      <span className="text-[11px] font-semibold text-neutral-600 dark:text-[#a09e9a] uppercase tracking-[0.08em]">
                        {group.label}
                      </span>
                    </div>
                    {group.sublabel && (
                      <span className="text-[11px] text-neutral-400 dark:text-[#66645f] tracking-[0.05em] tabular-nums uppercase">
                        {group.sublabel}
                      </span>
                    )}
                  </button>

                  {!isCollapsed && (
                    <div className="flex flex-col">
                      {group.items.map((t, idx) => {
                        const dept = allDepts.find((d) => d.id === t.department_id);
                        const DeptIcon = getDepartmentIcon(dept?.icon);
                        const isSelected = selectedTask?.task_id === t.task_id;
                        const isLast = idx === group.items.length - 1;
                        return (
                          <MobileTaskRow
                            key={`task-${t.task_id}`}
                            item={toRowItem(t)}
                            selected={isSelected}
                            isLast={isLast}
                            onClick={() => {
                              if (isSelected) {
                                setSelectedTask(null);
                              } else {
                                closeGlobals();
                                setDraftTask(null);
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
              );
            })}
          </div>
        )}
      </div>

      {/* Detail overlay — unified panel (self-renders fixed inset-0 on mobile) */}
      {draftTask ? (
        <TaskDetailPanel
          task={null}
          draft={projectToDraft(draftTask)}
          onDraftChange={(d) => setDraftTask((prev) => (prev ? applyDraftToProject(prev, d) : prev))}
          onConfirmCreate={handleConfirmCreate}
          creating={creatingTask}
          onClose={() => setDraftTask(null)}
        />
      ) : selectedTask && itemAsProject ? (
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
