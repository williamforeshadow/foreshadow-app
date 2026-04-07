'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import MobileBinPicker from '@/components/mobile/MobileBinPicker';
import MobileProjectDetail from '@/components/mobile/MobileProjectDetail';
import { ProjectsKanban } from '@/components/windows/projects/ProjectsKanban';
import { useProjectBins } from '@/lib/hooks/useProjectBins';
import { useColumnVisibility } from '@/lib/hooks/useColumnVisibility';
import { useAuth } from '@/lib/authContext';
import { useDepartments } from '@/lib/departmentsContext';
import { STATUS_ORDER, STATUS_LABELS, PRIORITY_ORDER, PRIORITY_LABELS } from '@/lib/useProjects';
import type { ProjectViewMode } from '@/lib/useProjects';
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
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-white/30 dark:bg-white/[0.08] backdrop-blur-sm border border-white/20 dark:border-white/10 text-neutral-900 dark:text-white"
      >
        {VIEW_MODE_LABELS[viewMode]}
        <svg className={`w-3.5 h-3.5 opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-20 rounded-xl glass-card bg-white/85 dark:bg-neutral-900/90 border border-white/30 dark:border-white/10 min-w-[140px]">
          <div className="relative overflow-hidden rounded-xl glass-sheen flex flex-col gap-0.5 p-1.5">
          {ALL_VIEW_MODES.map((mode) => (
            <button
              key={mode}
              onClick={() => {
                setViewMode(mode);
                setOpen(false);
              }}
              className={`px-3.5 py-2 text-sm font-medium rounded-lg text-left transition-all ${
                viewMode === mode
                  ? 'bg-white/60 dark:bg-white/15 text-neutral-900 dark:text-white shadow-sm'
                  : 'text-neutral-500 dark:text-neutral-400 active:bg-white/30 dark:active:bg-white/10'
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

  // Template state
  const [availableTemplates, setAvailableTemplates] = useState<TaskTemplate[]>([]);
  const [taskTemplates, setTaskTemplates] = useState<Record<string, Template>>({});
  const [loadingTemplate, setLoadingTemplate] = useState(false);

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
        setTaskTemplates(prev => ({ ...prev, [cacheKey]: result }));
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
      setScreen({ type: 'kanban', binId: screen.binId, binName: screen.binName });
      fetchTasksForBin(screen.binId);
    } else if (screen.type === 'kanban') {
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

  const handleNewTask = useCallback(async () => {
    try {
      const payload: Record<string, unknown> = {
        title: 'New Task',
        status: 'not_started',
        priority: 'medium',
      };
      const binId = screen.type === 'kanban' ? screen.binId : null;
      if (binId && binId !== '__none__') {
        payload.bin_id = binId;
      }
      const res = await fetch('/api/tasks-for-bin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (result.data && screen.type === 'kanban') {
        setTasks(prev => [...prev, result.data]);
        setScreen({ type: 'detail', project: result.data, binId: screen.binId, binName: screen.binName });
      }
    } catch (err) {
      console.error('Error creating task:', err);
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
          unbinnedCount={binsHook.unbinnedCount}
          loadingBins={binsHook.loadingBins}
          onSelectBin={(binId) => {
            const bin = binsHook.bins.find(b => b.id === binId);
            navigateToBin(binId, bin?.name || 'Bin');
          }}
          onSelectAll={() => navigateToBin(null, 'All Tasks')}
          onSelectUnbinned={() => navigateToBin('__none__', 'Unbinned')}
          onCreateBin={binsHook.createBin}
          onUpdateBin={binsHook.updateBin}
          onDeleteBin={binsHook.deleteBin}
        />
      )}

      {/* Kanban screen */}
      {screen.type === 'kanban' && (
        <div className="flex flex-col h-full">
          <div className="shrink-0 relative z-20 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 px-4 py-3">
            <div className="flex items-center gap-2">
              <button
                onClick={goBack}
                className="flex items-center gap-1 text-sm text-neutral-500 dark:text-neutral-400"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold text-neutral-900 dark:text-white truncate">{screen.binName}</h2>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {tasks.length} task{tasks.length !== 1 ? 's' : ''}
                </p>
              </div>
              <MobileViewModeToggle viewMode={viewMode} setViewMode={setViewMode} />
              <ColumnPicker
                columns={allColumnOptions}
                visibleColumnIds={columnVis.visibleIds}
                onToggle={columnVis.toggle}
                onSelectAll={() => columnVis.selectAll(allColumnOptions.map((c) => c.id))}
                onClearAll={columnVis.clearAll}
              />
              <button
                onClick={handleNewTask}
                className="p-2 rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 active:scale-95 transition-all"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>
          </div>

          <div className={`flex-1 min-h-0 flex flex-col mobile-kanban-wrapper${kanbanDragging ? ' is-dragging' : ''}`}>
            {loadingTasks ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-neutral-500">Loading tasks...</p>
              </div>
            ) : tasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-neutral-400">
                <svg className="w-12 h-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-sm font-medium">No tasks yet</p>
                <button
                  onClick={handleNewTask}
                  className="mt-3 text-xs font-medium text-emerald-500 active:text-emerald-600"
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
              />
            )}
          </div>
        </div>
      )}

      {/* Task detail screen */}
      {screen.type === 'detail' && (
        <MobileProjectDetail
          project={screen.project}
          users={users}
          onClose={goBack}
          onSave={handleSaveProject}
          onDelete={handleDeleteTask}
          allProperties={allProperties}
          onPropertyChange={async (propertyId, propertyName) => {
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
          }}
          bins={binsHook.bins}
          onBinChange={async (binId) => {
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
          template={detailTemplate}
          formMetadata={screen.project.form_metadata as Record<string, unknown> | undefined}
          onSaveForm={handleSaveForm}
          loadingTemplate={loadingTemplate}
          availableTemplates={availableTemplates}
          onTemplateChange={handleTemplateChange}
        />
      )}
    </div>
  );
}
