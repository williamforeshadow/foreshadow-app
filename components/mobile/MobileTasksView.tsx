'use client';

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAuth } from '@/lib/authContext';
import { useUsers } from '@/lib/useUsers';
import { useDepartments } from '@/lib/departmentsContext';
import { getDepartmentIcon } from '@/lib/departmentIcons';
import { useTasks, type TaskRow as TaskRowData } from '@/lib/useTasks';
import { useProjectBins } from '@/lib/hooks/useProjectBins';
import type {
  Project,
  ProjectFormFields,
  PropertyOption,
  TaskTemplate,
  User,
} from '@/lib/types';
import type { Template } from '@/components/DynamicCleaningForm';
import { MobileTaskRow } from '@/components/tasks/MobileTaskRow';
import type { TaskRowItem } from '@/components/tasks/TaskRow';
import MobileProjectDetail from '@/components/mobile/MobileProjectDetail';
import { TaskFilterBar } from '@/components/tasks/TaskFilterBar';
import { useExclusiveDetailPanelHost } from '@/lib/reservationViewerContext';

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

function MobileTasksViewContent() {
  const { user: authUser } = useAuth();
  const { users: rawUsers } = useUsers();
  const users = rawUsers as unknown as User[];
  const currentUser = authUser as unknown as User | null;
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

    updateTaskInState,
    saveTaskFields,

    taskTemplates,
    loadingTaskTemplate,
    fetchTaskTemplate,
    saveTaskForm,
  } = useTasks({ urlSync: true });

  const closeGlobals = useExclusiveDetailPanelHost(() => {
    setSelectedTask(null);
    setDraftTask(null);
  });

  const binsHook = useProjectBins({ currentUser });

  // ---- Supporting lists --------------------------------------------------

  const [allProperties, setAllProperties] = useState<PropertyOption[]>([]);
  const [availableTemplates, setAvailableTemplates] = useState<TaskTemplate[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/properties');
        const result = await res.json();
        if (res.ok && result.properties) setAllProperties(result.properties);
      } catch {
        // ignore
      }
    })();
    (async () => {
      try {
        const res = await fetch('/api/tasks');
        const result = await res.json();
        if (res.ok && result.data) setAvailableTemplates(result.data);
      } catch {
        // ignore
      }
    })();
  }, []);

  // ---- Detail / draft state ---------------------------------------------

  const [draftTask, setDraftTask] = useState<Project | null>(null);
  const [creatingTask, setCreatingTask] = useState(false);
  const editingFieldsRef = useRef<ProjectFormFields | null>(null);

  // Resolve template for the selected task (mobile detail panel uses it).
  const taskTemplate = useMemo((): Template | null => {
    if (draftTask) return null;
    if (!selectedTask?.template_id) return null;
    const cacheKey = selectedTask.property_name
      ? `${selectedTask.template_id}__${selectedTask.property_name}`
      : selectedTask.template_id;
    return (
      (taskTemplates[cacheKey] as Template) ||
      (taskTemplates[selectedTask.template_id] as Template) ||
      null
    );
  }, [selectedTask, draftTask, taskTemplates]);

  useEffect(() => {
    if (selectedTask?.template_id) {
      fetchTaskTemplate(
        selectedTask.template_id,
        selectedTask.property_name || undefined
      );
    }
  }, [selectedTask?.template_id, selectedTask?.property_name, fetchTaskTemplate]);

  // ---- Save (existing tasks) — accepts directFields from MobileProjectDetail ----

  const handleSaveExisting = useCallback(
    async (_projectId: string, fields: ProjectFormFields) => {
      if (!selectedTask) return null;
      editingFieldsRef.current = fields;
      await saveTaskFields(selectedTask.task_id, fields, selectedTask, users);
      return null;
    },
    [selectedTask, saveTaskFields, users]
  );

  // ---- Property change (existing) ---------------------------------------

  const handlePropertyChange = useCallback(
    async (_propertyId: string | null, propertyName: string | null) => {
      if (!selectedTask) return;
      const taskId = selectedTask.task_id;
      updateTaskInState(taskId, {
        property_name: propertyName || 'Unknown Property',
      });
      try {
        await fetch('/api/update-task-fields', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId,
            fields: { property_name: propertyName || null },
          }),
        });
      } catch (err) {
        console.error('Error updating property:', err);
      }
    },
    [selectedTask, updateTaskInState]
  );

  // ---- Bin change handlers (existing) ----------------------------------

  const handleBinChange = useCallback(
    async (binId: string | null) => {
      if (!selectedTask) return;
      const taskId = selectedTask.task_id;
      updateTaskInState(taskId, { bin_id: binId || null });
      try {
        await fetch('/api/update-task-fields', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, fields: { bin_id: binId || null } }),
        });
        binsHook.fetchBins();
      } catch (err) {
        console.error('Error updating bin:', err);
      }
    },
    [selectedTask, updateTaskInState, binsHook]
  );

  const handleIsBinnedChange = useCallback(
    async (isBinned: boolean) => {
      if (!selectedTask) return;
      const taskId = selectedTask.task_id;
      const patch: Partial<TaskRowData> = { is_binned: isBinned };
      if (!isBinned) patch.bin_id = null;
      updateTaskInState(taskId, patch);
      try {
        const fields: Record<string, unknown> = { is_binned: isBinned };
        if (!isBinned) fields.bin_id = null;
        await fetch('/api/update-task-fields', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, fields }),
        });
        binsHook.fetchBins();
      } catch (err) {
        console.error('Error updating is_binned:', err);
      }
    },
    [selectedTask, updateTaskInState, binsHook]
  );

  // ---- Template change (existing) --------------------------------------

  const handleTemplateChange = useCallback(
    async (templateId: string | null) => {
      if (!selectedTask) return;
      const taskId = selectedTask.task_id;
      const templateName = templateId
        ? availableTemplates.find((t) => t.id === templateId)?.name || null
        : null;
      updateTaskInState(taskId, {
        template_id: templateId || null,
        template_name: templateName || 'Unnamed Task',
      });
      try {
        await fetch('/api/update-task-fields', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId,
            fields: { template_id: templateId || null },
          }),
        });
        if (templateId) {
          fetchTaskTemplate(templateId, selectedTask.property_name);
        }
      } catch (err) {
        console.error('Error changing template:', err);
      }
    },
    [selectedTask, availableTemplates, updateTaskInState, fetchTaskTemplate]
  );

  // ---- Form save -------------------------------------------------------

  const handleSaveForm = useCallback(
    async (formData: Record<string, unknown>) => {
      if (!selectedTask) return;
      await saveTaskForm(selectedTask.task_id, formData);
    },
    [selectedTask, saveTaskForm]
  );

  // ---- Delete (existing) -----------------------------------------------

  const handleDelete = useCallback(
    async (project: Project) => {
      try {
        const res = await fetch(`/api/tasks-for-bin/${project.id}`, { method: 'DELETE' });
        if (res.ok) {
          setSelectedTask(null);
          fetchTasks();
        }
      } catch (err) {
        console.error('Error deleting task:', err);
      }
    },
    [setSelectedTask, fetchTasks]
  );

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

  const handleConfirmCreate = useCallback(
    async (fields?: ProjectFormFields) => {
      if (!draftTask) return;
      const propertyName = draftTask.property_name;
      if (!propertyName) return;

      setCreatingTask(true);
      try {
        const matchedProperty = allProperties.find((p) => p.name === propertyName);
        const payload: Record<string, unknown> = {
          title: fields?.title || draftTask.title || 'New Task',
          status: fields?.status || 'not_started',
          priority: fields?.priority || 'medium',
          is_binned: false,
          description: fields?.description || null,
          department_id: fields?.department_id || null,
          scheduled_date: fields?.scheduled_date || null,
          scheduled_time: fields?.scheduled_time || null,
          property_id: matchedProperty?.id || null,
          property_name: propertyName,
        };
        if (fields?.assigned_staff?.length)
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
        }
      } catch (err) {
        console.error('Error creating task:', err);
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

  const isDraft = draftTask != null;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 px-5 pt-2 pb-2">
        <h1 className="text-[22px] font-semibold tracking-tight text-neutral-900 dark:text-[#f0efed]">
          Tasks
        </h1>
        <div className="flex items-center gap-3 mt-0.5 text-[11px] text-neutral-500 dark:text-[#66645f] uppercase tracking-[0.04em] font-medium">
          <span>Every task in the workspace</span>
        </div>
      </div>

      {/* Filter bar — shared component, scrolls horizontally if needed.
          We override the desktop padding by wrapping in a flush container
          and giving the chip row overflow-x-auto. */}
      <div className="flex-shrink-0 border-b border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)] overflow-x-auto hide-scrollbar">
        <div className="min-w-max">
          <TaskFilterBar
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
      <div className="flex-1 overflow-y-auto">
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

      {/* Mobile detail overlay */}
      {itemAsProject && (
        <MobileProjectDetail
          project={itemAsProject}
          users={users}
          onClose={() => {
            setSelectedTask(null);
            setDraftTask(null);
          }}
          onSave={async (_pid, fields) => {
            if (isDraft) {
              return itemAsProject;
            }
            await handleSaveExisting(_pid, fields);
            return itemAsProject;
          }}
          onDelete={isDraft ? () => setDraftTask(null) : handleDelete}
          allProperties={allProperties}
          onPropertyChange={
            isDraft
              ? (_pid, name) => {
                  setDraftTask((prev) =>
                    prev ? { ...prev, property_name: name } : prev
                  );
                }
              : handlePropertyChange
          }
          bins={binsHook.bins}
          onBinChange={handleBinChange}
          onIsBinnedChange={handleIsBinnedChange}
          template={taskTemplate}
          formMetadata={selectedTask?.form_metadata ?? undefined}
          onSaveForm={handleSaveForm}
          loadingTemplate={
            !!selectedTask?.template_id &&
            loadingTaskTemplate === selectedTask.template_id
          }
          availableTemplates={availableTemplates}
          onTemplateChange={handleTemplateChange}
          isNewTask={isDraft}
          onConfirmCreate={isDraft ? (fields) => handleConfirmCreate(fields) : undefined}
          creatingTask={creatingTask || (isDraft && !draftTask?.property_name)}
        />
      )}
    </div>
  );
}

const MobileTasksView = memo(MobileTasksViewContent);
export default MobileTasksView;
