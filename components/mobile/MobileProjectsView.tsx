'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import MobileBinPicker from '@/components/mobile/MobileBinPicker';
import MobileProjectDetail from '@/components/mobile/MobileProjectDetail';
import { ProjectsKanban } from '@/components/windows/projects/ProjectsKanban';
import { useProjectBins } from '@/lib/hooks/useProjectBins';
import { useColumnVisibility } from '@/lib/hooks/useColumnVisibility';
import { useKanbanTexture } from '@/lib/hooks/useKanbanTexture';
import { useAuth } from '@/lib/authContext';
import { useDepartments } from '@/lib/departmentsContext';
import { STATUS_ORDER, STATUS_LABELS, PRIORITY_ORDER, PRIORITY_LABELS } from '@/lib/types';
import type { ProjectViewMode } from '@/lib/types';
import { ColumnPicker } from '@/components/windows/projects/ColumnPicker';
import type { Project, User, PropertyOption, TaskTemplate } from '@/lib/types';
import type { Template } from '@/components/DynamicCleaningForm';

// ============================================================================
// Types
// ============================================================================

type Screen =
  | { type: 'bins' }
  | { type: 'kanban'; binId: string | null; binName: string }
  | { type: 'detail'; project: Project; binId: string | null; binName: string };

interface MobileProjectsViewProps {
  users: User[];
}

// ============================================================================
// View Mode Toggle (compact mobile version)
// ============================================================================

const VIEW_MODE_LABELS: Record<ProjectViewMode, string> = {
  property: 'Property',
  status: 'Status',
  priority: 'Priority',
  department: 'Dept',
  assignee: 'Assignee',
};

const ALL_VIEW_MODES: ProjectViewMode[] = ['property', 'status', 'priority', 'department', 'assignee'];

function MobileViewModeToggle({
  viewMode,
  setViewMode,
}: {
  viewMode: ProjectViewMode;
  setViewMode: (m: ProjectViewMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onTap(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onTap);
    document.addEventListener('touchstart', onTap);
    return () => {
      document.removeEventListener('mousedown', onTap);
      document.removeEventListener('touchstart', onTap);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 h-9 px-3 text-[12px] font-medium rounded-[10px] border border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)] text-neutral-600 dark:text-[#a09e9a]"
      >
        {VIEW_MODE_LABELS[viewMode]}
        <svg className={`w-3 h-3 opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-20 rounded-xl bg-white dark:bg-[#1a1a1d] border border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)] shadow-xl min-w-[140px]">
          <div className="flex flex-col gap-0.5 p-1.5">
          {ALL_VIEW_MODES.map((mode) => (
            <button
              key={mode}
              onClick={() => {
                setViewMode(mode);
                setOpen(false);
              }}
              className={`px-3.5 py-2 text-[12px] font-medium rounded-lg text-left transition-all ${
                viewMode === mode
                  ? 'bg-neutral-100 dark:bg-[rgba(255,255,255,0.06)] text-neutral-900 dark:text-[#f0efed]'
                  : 'text-neutral-500 dark:text-[#66645f] active:bg-neutral-50 dark:active:bg-[rgba(255,255,255,0.03)]'
              }`}
            >
              {VIEW_MODE_LABELS[mode]}
            </button>
          ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Component
// ============================================================================

export default function MobileProjectsView({ users }: MobileProjectsViewProps) {
  const { user: currentUser } = useAuth();
  const { departments } = useDepartments();
  const binsHook = useProjectBins({ currentUser: currentUser as User | null });

  const [screen, setScreen] = useState<Screen>({ type: 'bins' });
  const [kanbanDragging, setKanbanDragging] = useState(false);

  // Task data (fetched via tasks-for-bin API, same as desktop ProjectsWindow)
  const [tasks, setTasks] = useState<Project[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [allProperties, setAllProperties] = useState<PropertyOption[]>([]);
  const [viewMode, setViewMode] = useState<ProjectViewMode>('status');
  const [kanbanSelectionMode, setKanbanSelectionMode] = useState(false);

  // Template state
  const [availableTemplates, setAvailableTemplates] = useState<TaskTemplate[]>([]);
  const [taskTemplates, setTaskTemplates] = useState<Record<string, Template>>({});
  const [loadingTemplate, setLoadingTemplate] = useState(false);

  // Draft task state — local-only project not yet persisted
  const [draftTask, setDraftTask] = useState<Project | null>(null);
  const [creatingTask, setCreatingTask] = useState(false);

  // Fetch properties on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/properties');
        const result = await res.json();
        if (res.ok && result.properties) {
          setAllProperties(result.properties);
        }
      } catch {}
    })();
  }, []);

  // Fetch available templates lazily when detail opens
  useEffect(() => {
    if (screen.type === 'detail' && availableTemplates.length === 0) {
      fetch('/api/tasks').then(r => r.json()).then(result => {
        if (result?.data) setAvailableTemplates(result.data);
      }).catch(() => {});
    }
  }, [screen.type]);

  const fetchTaskTemplate = useCallback(async (templateId: string, propertyName?: string | null) => {
    const cacheKey = propertyName ? `${templateId}__${propertyName}` : templateId;
    if (taskTemplates[cacheKey]) return;
    setLoadingTemplate(true);
    try {
      const params = new URLSearchParams({ id: templateId });
      if (propertyName) params.set('property_name', propertyName);
      const res = await fetch(`/api/templates/${templateId}?${params.toString()}`);
      const result = await res.json();
      if (res.ok && result) {
        setTaskTemplates(prev => ({ ...prev, [cacheKey]: result.template }));
      }
    } catch {
    } finally {
      setLoadingTemplate(false);
    }
  }, [taskTemplates]);

  const detailProject = screen.type === 'detail' ? screen.project : null;

  const detailTemplate = useMemo((): Template | null => {
    if (!detailProject?.template_id) return null;
    const templateId = detailProject.template_id;
    const cacheKey = detailProject.property_name
      ? `${templateId}__${detailProject.property_name}`
      : templateId;
    return taskTemplates[cacheKey] || taskTemplates[templateId] || null;
  }, [detailProject, taskTemplates]);

  useEffect(() => {
    if (detailProject?.template_id) {
      fetchTaskTemplate(detailProject.template_id, detailProject.property_name);
    }
  }, [detailProject?.id]);

  const handleTemplateChange = useCallback(async (templateId: string | null) => {
    if (!detailProject) return;
    const res = await fetch(`/api/tasks-for-bin/${detailProject.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: templateId }),
    });
    const result = await res.json();
    if (result.data) {
      setScreen(prev => prev.type === 'detail' ? { ...prev, project: result.data } : prev);
      setTasks(prev => prev.map(t => t.id === detailProject.id ? result.data : t));
      if (templateId) {
        await fetchTaskTemplate(templateId, result.data.property_name);
      }
    }
  }, [detailProject, fetchTaskTemplate]);

  const handleSaveForm = useCallback(async (formData: Record<string, unknown>) => {
    if (!detailProject) return;
    await fetch('/api/save-task-form', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: detailProject.id, form_metadata: formData }),
    });
    setScreen(prev => prev.type === 'detail' ? {
      ...prev,
      project: { ...prev.project, form_metadata: formData },
    } : prev);
    setTasks(prev => prev.map(t => t.id === detailProject.id ? { ...t, form_metadata: formData } : t));
  }, [detailProject]);

  // Fetch tasks for a given bin (via tasks-for-bin API)
  const fetchTasksForBin = useCallback(async (binId: string | null) => {
    setLoadingTasks(true);
    try {
      const params = new URLSearchParams();
      if (currentUser?.id) params.set('viewer_user_id', currentUser.id);
      if (binId !== null) {
        params.set('bin_id', binId);
      }
      const res = await fetch(`/api/tasks-for-bin?${params.toString()}`);
      const result = await res.json();
      if (res.ok && result.data) {
        setTasks(result.data);
      }
    } catch (err) {
      console.error('Error fetching tasks:', err);
    } finally {
      setLoadingTasks(false);
    }
  }, [currentUser?.id]);

  // Column visibility for the kanban
  const activeBinId = screen.type !== 'bins' ? (screen as any).binId : null;
  const columnVis = useColumnVisibility(activeBinId, viewMode);
  const { enabled: showBoardTexture } = useKanbanTexture();

  const allColumnOptions = useMemo(() => {
    if (viewMode === 'property') {
      const names = new Set<string>();
      names.add('No Property');
      tasks.forEach((p) => names.add(p.property_name || 'No Property'));
      allProperties.forEach((p) => { if (p.name) names.add(p.name); });
      const sorted = Array.from(names).sort((a, b) => {
        if (a === 'No Property') return -1;
        if (b === 'No Property') return 1;
        return a.localeCompare(b);
      });
      return sorted.map((name) => ({ id: `prop:${name}`, name }));
    }
    if (viewMode === 'status') {
      return STATUS_ORDER.map((s) => ({ id: `status:${s}`, name: STATUS_LABELS[s] }));
    }
    if (viewMode === 'priority') {
      return PRIORITY_ORDER.map((p) => ({ id: `priority:${p}`, name: PRIORITY_LABELS[p] }));
    }
    if (viewMode === 'department') {
      const names = new Set<string>();
      names.add('No Department');
      tasks.forEach((p) => names.add(p.department_name || 'No Department'));
      departments.forEach((d) => { if (d.name) names.add(d.name); });
      const sorted = Array.from(names).sort((a, b) => {
        if (a === 'No Department') return -1;
        if (b === 'No Department') return 1;
        return a.localeCompare(b);
      });
      return sorted.map((name) => ({ id: `dept:${name}`, name }));
    }
    const names = new Set<string>();
    names.add('Unassigned');
    tasks.forEach((p) => {
      if (p.project_assignments && p.project_assignments.length > 0) {
        p.project_assignments.forEach((a) => names.add(a.user?.name || a.user_id));
      }
    });
    users.forEach((u) => { if (u.name) names.add(u.name); });
    const sorted = Array.from(names).sort((a, b) => {
      if (a === 'Unassigned') return -1;
      if (b === 'Unassigned') return 1;
      return a.localeCompare(b);
    });
    return sorted.map((name) => ({ id: `assignee:${name}`, name }));
  }, [viewMode, tasks, allProperties, departments, users]);

  useEffect(() => {
    if (allColumnOptions.length > 0 && columnVis.initialized) {
      columnVis.initWithDefaults(allColumnOptions.map((c) => c.id));
    }
  }, [allColumnOptions, columnVis.initialized]);

  // Navigation
  const navigateToBin = useCallback(async (binId: string | null, binName: string) => {
    setScreen({ type: 'kanban', binId, binName });
    await fetchTasksForBin(binId);
  }, [fetchTasksForBin]);

  const navigateToProject = useCallback((project: Project, binId: string | null, binName: string) => {
    if (currentUser?.id) {
      fetch('/api/project-views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: project.id, user_id: currentUser.id }),
      }).catch(() => {});
    }
    setScreen({ type: 'detail', project, binId, binName });
  }, [currentUser?.id]);

  const goBack = useCallback(() => {
    if (screen.type === 'detail') {
      setDraftTask(null);
      draftFieldsRef.current = null;
      setScreen({ type: 'kanban', binId: screen.binId, binName: screen.binName });
      fetchTasksForBin(screen.binId);
    } else if (screen.type === 'kanban') {
      setKanbanSelectionMode(false);
      setScreen({ type: 'bins' });
      binsHook.fetchBins();
    }
  }, [screen, fetchTasksForBin, binsHook]);

  const handleColumnMove = useCallback(async (taskId: string, field: string, value: string) => {
    try {
      const payload: Record<string, unknown> = {};
      if (field === 'property_name') {
        payload.property_name = value || null;
      } else if (field === 'assigned_user_ids') {
        payload.assigned_user_ids = value ? value.split(',').filter(Boolean) : [];
      } else {
        payload[field] = value || null;
      }
      const res = await fetch(`/api/tasks-for-bin/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (result.data) {
        setTasks(prev => prev.map(t => t.id === taskId ? result.data : t));
      }
    } catch (err) {
      console.error('Error updating task field:', err);
    }
  }, []);

  const handleNewTask = useCallback(() => {
    if (screen.type !== 'kanban') return;
    const draft: Project = {
      id: `draft-${Date.now()}`,
      title: 'New Task',
      description: null,
      status: 'not_started',
      priority: 'medium',
      property_name: null,
      template_id: null,
      template_name: null,
      bin_id: screen.binId ?? null,
      is_binned: true,
      assigned_user_ids: [],
      project_assignments: [],
      department_id: null,
      department_name: null,
      scheduled_date: null,
      scheduled_time: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setDraftTask(draft);
    setScreen({ type: 'detail', project: draft, binId: screen.binId, binName: screen.binName });
  }, [screen]);

  const draftFieldsRef = useRef<any>(null);
  const draftTaskRef = useRef<Project | null>(null);
  draftTaskRef.current = draftTask;

  const handleDraftSave = useCallback(async (_projectId: string, fields: any) => {
    draftFieldsRef.current = fields;
    return null;
  }, []);

  const handleConfirmCreateTask = useCallback(async (latestFields?: any) => {
    const currentDraft = draftTaskRef.current;
    if (!currentDraft) return;
    setCreatingTask(true);
    try {
      const fields = latestFields || draftFieldsRef.current;
      const payload: Record<string, unknown> = {
        title: fields?.title || currentDraft.title || 'New Task',
        status: fields?.status || 'not_started',
        priority: fields?.priority || 'medium',
        is_binned: true,
        description: fields?.description || null,
        department_id: fields?.department_id || null,
        scheduled_date: fields?.scheduled_date || null,
        scheduled_time: fields?.scheduled_time || null,
      };
      if (currentDraft.bin_id) payload.bin_id = currentDraft.bin_id;
      if (currentDraft.property_name) payload.property_name = currentDraft.property_name;
      if (currentDraft.template_id) payload.template_id = currentDraft.template_id;
      if (fields?.assigned_staff?.length) payload.assigned_user_ids = fields.assigned_staff;

      const res = await fetch('/api/tasks-for-bin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (result.data) {
        setTasks(prev => [...prev, result.data]);
        setDraftTask(null);
        draftFieldsRef.current = null;
        if (screen.type === 'detail') {
          setScreen({ type: 'detail', project: result.data, binId: screen.binId, binName: screen.binName });
        }
      }
    } catch (err) {
      console.error('Error creating task:', err);
    } finally {
      setCreatingTask(false);
    }
  }, [screen]);

  const handleDeleteTask = useCallback(async (task: Project) => {
    try {
      const res = await fetch(`/api/tasks-for-bin/${task.id}`, { method: 'DELETE' });
      if (res.ok) {
        setTasks(prev => prev.filter(t => t.id !== task.id));
        if (screen.type === 'detail') {
          setScreen({ type: 'kanban', binId: screen.binId, binName: screen.binName });
        }
      }
    } catch (err) {
      console.error('Error deleting task:', err);
    }
  }, [screen]);

  const handleSaveProject = useCallback(async (projectId: string, fields: any) => {
    try {
      const payload: Record<string, unknown> = {};
      if (fields.title !== undefined) payload.title = fields.title;
      if (fields.description !== undefined) payload.description = fields.description || null;
      if (fields.status !== undefined) payload.status = fields.status;
      if (fields.priority !== undefined) payload.priority = fields.priority;
      if (fields.assigned_staff !== undefined) payload.assigned_user_ids = fields.assigned_staff || [];
      if (fields.department_id !== undefined) payload.department_id = fields.department_id || null;
      if (fields.scheduled_date !== undefined) payload.scheduled_date = fields.scheduled_date || null;
      if (fields.scheduled_time !== undefined) payload.scheduled_time = fields.scheduled_time || null;

      const res = await fetch(`/api/tasks-for-bin/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (result.data) {
        setScreen(prev => prev.type === 'detail' ? { ...prev, project: result.data } : prev);
        setTasks(prev => prev.map(t => t.id === projectId ? result.data : t));
        return result.data;
      }
    } catch (err) {
      console.error('Error saving task:', err);
    }
    return null;
  }, []);

  const getUnreadCommentCount = useCallback((project: Project): number => {
    return (project as any).unread_comment_count || 0;
  }, []);

  return (
    <div className="h-full">
      {/* Bins screen */}
      {screen.type === 'bins' && (
        <MobileBinPicker
          bins={binsHook.bins}
          totalProjects={binsHook.totalProjects}
          loadingBins={binsHook.loadingBins}
          onSelectBin={(binId) => {
            const bin = binsHook.bins.find(b => b.id === binId);
            navigateToBin(binId, bin?.name || 'Bin');
          }}
          onSelectAll={() => navigateToBin(null, 'All Binned Tasks')}
          onCreateBin={binsHook.createBin}
          onUpdateBin={binsHook.updateBin}
          onDeleteBin={binsHook.deleteBin}
        />
      )}

      {/* Kanban screen */}
      {screen.type === 'kanban' && (
        <div className="flex flex-col h-full relative">
          {/* Header */}
          <div className="shrink-0 px-[22px] pt-2 pb-3">
            <div className="flex items-center gap-2 mb-3">
              <button
                onClick={goBack}
                className="w-9 h-9 rounded-[10px] border border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)] flex items-center justify-center text-neutral-500 dark:text-[#a09e9a]"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="flex-1" />
              <MobileViewModeToggle viewMode={viewMode} setViewMode={setViewMode} />
              <ColumnPicker
                columns={allColumnOptions}
                visibleColumnIds={columnVis.visibleIds}
                onToggle={columnVis.toggle}
                onSelectAll={() => columnVis.selectAll(allColumnOptions.map((c) => c.id))}
                onClearAll={columnVis.clearAll}
              />
            </div>
            <h1 className="text-[30px] font-semibold tracking-tight leading-none text-neutral-900 dark:text-[#f0efed]">
              {screen.binName}
            </h1>
            <div className="flex items-center gap-3 mt-2.5 text-[12.5px] text-neutral-500 dark:text-[#66645f] tracking-[0.01em] font-medium">
              <span>Operations board</span>
              <span className="w-[3px] h-[3px] rounded-full bg-neutral-300 dark:bg-[#3e3d3a]" />
              <span>{tasks.length} total</span>
              {tasks.length > 0 && !kanbanSelectionMode && (
                <button
                  onClick={() => setKanbanSelectionMode(true)}
                  className="ml-auto flex items-center gap-1 text-neutral-600 dark:text-[#a09e9a] active:opacity-70 transition-opacity"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7l-3 3-1.5-1.5" />
                  </svg>
                  Select
                </button>
              )}
            </div>
          </div>

          <div className={`flex-1 min-h-0 flex flex-col mobile-kanban-wrapper${kanbanDragging ? ' is-dragging' : ''}`}>
            {loadingTasks ? (
              <div className="flex items-center justify-center h-full">
                <div className="w-7 h-7 border-2 border-neutral-400 dark:border-[#66645f] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : tasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full">
                <p className="text-sm font-medium text-neutral-400 dark:text-[#66645f]">No tasks yet</p>
                <button
                  onClick={handleNewTask}
                  className="mt-3 text-xs font-medium text-neutral-600 dark:text-[#a09e9a] active:opacity-70"
                >
                  + Create one
                </button>
              </div>
            ) : (
              <ProjectsKanban
                projects={tasks}
                viewMode={viewMode}
                allProperties={allProperties}
                users={users}
                departments={departments}
                onProjectClick={(project) => navigateToProject(project, screen.binId, screen.binName)}
                expandedProjectId={null}
                getUnreadCommentCount={getUnreadCommentCount}
                onColumnMove={handleColumnMove}
                visibleColumnIds={columnVis.visibleIds}
                onDraggingChange={setKanbanDragging}
                showTexture={showBoardTexture}
                bins={binsHook.bins}
                selectionMode={kanbanSelectionMode}
                onSelectionModeChange={setKanbanSelectionMode}
                onBulkDismiss={async (taskIds) => {
                  if (taskIds.length === 0) return;
                  try {
                    const res = await fetch('/api/tasks-bulk-dismiss', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ taskIds }),
                    });
                    const result = await res.json();
                    if (res.ok) {
                      const dismissed: string[] = result?.dismissed_ids || taskIds;
                      const dismissedSet = new Set(dismissed);
                      setTasks(prev => prev.filter(t => !dismissedSet.has(t.id)));
                      binsHook.fetchBins();
                    } else {
                      console.error('Bulk dismiss failed:', result?.error);
                    }
                  } catch (err) {
                    console.error('Error bulk dismissing tasks:', err);
                  }
                }}
              />
            )}
          </div>

          {/* FAB */}
          <button
            onClick={handleNewTask}
            className="absolute right-[22px] bottom-6 w-[52px] h-[52px] rounded-full bg-neutral-800 dark:bg-[#f0efed] text-white dark:text-[#0b0b0c] flex items-center justify-center shadow-[0_10px_30px_-8px_rgba(0,0,0,0.5)] active:scale-95 transition-transform z-30"
          >
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      )}

      {/* Task detail screen */}
      {screen.type === 'detail' && (() => {
        const isDraft = screen.project.id.startsWith('draft-');
        return (
          <MobileProjectDetail
            project={screen.project}
            users={users}
            onClose={goBack}
            onSave={isDraft ? handleDraftSave : handleSaveProject}
            onDelete={isDraft ? undefined : handleDeleteTask}
            allProperties={allProperties}
            isNewTask={isDraft}
            onConfirmCreate={isDraft ? handleConfirmCreateTask : undefined}
            creatingTask={creatingTask}
            onPropertyChange={isDraft
              ? (_propertyId, propertyName) => {
                  const updated = { ...screen.project, property_name: propertyName };
                  setScreen(prev => prev.type === 'detail' ? { ...prev, project: updated } : prev);
                  setDraftTask(updated);
                }
              : async (propertyId, propertyName) => {
                  const res = await fetch(`/api/tasks-for-bin/${screen.project.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ property_name: propertyName || null }),
                  });
                  const result = await res.json();
                  if (result.data) {
                    setScreen(prev => prev.type === 'detail' ? { ...prev, project: result.data } : prev);
                    setTasks(prev => prev.map(t => t.id === screen.project.id ? result.data : t));
                  }
                }
            }
            bins={binsHook.bins}
            onBinChange={async (binId) => {
              if (isDraft) return;
              const res = await fetch(`/api/tasks-for-bin/${screen.project.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bin_id: binId || null }),
              });
              const result = await res.json();
              if (result.data) {
                setScreen(prev => prev.type === 'detail' ? { ...prev, project: result.data } : prev);
                setTasks(prev => prev.map(t => t.id === screen.project.id ? result.data : t));
              }
              binsHook.fetchBins();
            }}
            onIsBinnedChange={async (isBinned) => {
              if (isDraft) return;
              const payload: Record<string, unknown> = { is_binned: isBinned };
              if (!isBinned) payload.bin_id = null;
              const res = await fetch(`/api/tasks-for-bin/${screen.project.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              });
              const result = await res.json();
              if (result.data) {
                if (!isBinned) {
                  // Dismissed from bin — drop from this bin view and return to the board.
                  const dismissedId = screen.project.id;
                  setTasks(prev => prev.filter(t => t.id !== dismissedId));
                  goBack();
                } else {
                  setScreen(prev => prev.type === 'detail' ? { ...prev, project: result.data } : prev);
                  setTasks(prev => prev.map(t => t.id === screen.project.id ? result.data : t));
                }
              }
              binsHook.fetchBins();
            }}
            template={detailTemplate}
            formMetadata={screen.project.form_metadata as Record<string, unknown> | undefined}
            onSaveForm={handleSaveForm}
            loadingTemplate={loadingTemplate}
            availableTemplates={availableTemplates}
            onTemplateChange={isDraft
              ? (templateId) => {
                  const tmpl = availableTemplates.find(t => t.id === templateId);
                  const updated = { ...screen.project, template_id: templateId, template_name: tmpl?.name || null };
                  setScreen(prev => prev.type === 'detail' ? { ...prev, project: updated } : prev);
                  setDraftTask(updated);
                }
              : handleTemplateChange
            }
          />
        );
      })()}
    </div>
  );
}
