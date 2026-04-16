'use client';

import { memo, useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import type { ProjectViewMode } from '@/lib/types';
import { STATUS_LABELS, STATUS_ORDER, PRIORITY_LABELS, PRIORITY_ORDER } from '@/lib/types';
import { useProjectBins } from '@/lib/hooks/useProjectBins';
import { useColumnVisibility } from '@/lib/hooks/useColumnVisibility';
import { useKanbanTexture } from '@/lib/hooks/useKanbanTexture';
import { useProjectComments } from '@/lib/hooks/useProjectComments';
import { useProjectAttachments } from '@/lib/hooks/useProjectAttachments';
import { useProjectTimeTracking } from '@/lib/hooks/useProjectTimeTracking';
import { useProjectActivity } from '@/lib/hooks/useProjectActivity';
import {
  ProjectDetailPanel,
  ProjectActivitySheet,
  AttachmentLightbox,
  BinPicker,
} from './projects';
import { ColumnPicker } from './projects/ColumnPicker';
import { ProjectsKanban } from './projects/ProjectsKanban';
import { useDepartments } from '@/lib/departmentsContext';
import type { User, Project, Attachment, Comment, ProjectFormFields, PropertyOption, TaskTemplate } from '@/lib/types';
import type { Template } from '@/components/DynamicCleaningForm';

// ============================================================================
// View Mode Toggle — compact pill that expands on click
// ============================================================================

const VIEW_MODE_LABELS: Record<ProjectViewMode, string> = {
  property: 'Property',
  status: 'Status',
  priority: 'Priority',
  department: 'Dept',
  assignee: 'Assignee',
};

const ALL_VIEW_MODES: ProjectViewMode[] = ['property', 'status', 'priority', 'department', 'assignee'];

function ViewModeToggle({
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
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-white/30 dark:bg-white/[0.08] backdrop-blur-sm border border-white/20 dark:border-white/10 text-neutral-900 dark:text-white transition-all hover:bg-white/50 dark:hover:bg-white/[0.12]"
      >
        {VIEW_MODE_LABELS[viewMode]}
        <svg className={`w-3.5 h-3.5 opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 rounded-xl glass-card bg-white/[0.97] dark:bg-neutral-900/[0.98] border border-white/30 dark:border-white/15 min-w-[140px]">
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
                    : 'text-neutral-500 dark:text-neutral-400 hover:bg-white/30 dark:hover:bg-white/10'
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

interface ProjectsWindowProps {
  users: User[];
  currentUser: User | null;
}

function ProjectsWindowContent({ users, currentUser }: ProjectsWindowProps) {
  const { departments } = useDepartments();
  const binsHook = useProjectBins({ currentUser });

  // Bin navigation state
  const [selectedBinId, setSelectedBinId] = useState<string | null>(null);
  const [selectedBinName, setSelectedBinName] = useState<string>('All Binned Tasks');
  const [showKanban, setShowKanban] = useState(false);

  // Task data (fetched from tasks-for-bin API)
  const [tasks, setTasks] = useState<Project[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [allProperties, setAllProperties] = useState<PropertyOption[]>([]);

  // Template state
  const [availableTemplates, setAvailableTemplates] = useState<TaskTemplate[]>([]);
  const [taskTemplates, setTaskTemplates] = useState<Record<string, Template>>({});
  const [loadingTaskTemplate, setLoadingTaskTemplate] = useState<string | null>(null);

  // View mode
  const [viewMode, setViewMode] = useState<ProjectViewMode>('status');

  // Sub-hooks for detail panel features
  const commentsHook = useProjectComments({ currentUser });
  const attachmentsHook = useProjectAttachments({ currentUser });
  const timeTrackingHook = useProjectTimeTracking({ currentUser });
  const activityHook = useProjectActivity();

  // UI state
  const [expandedProject, setExpandedProject] = useState<Project | null>(null);
  const [editingProjectFields, setEditingProjectFields] = useState<ProjectFormFields | null>(null);
  const [newComment, setNewComment] = useState('');
  const [staffOpen, setStaffOpen] = useState(false);
  const [viewingAttachmentIndex, setViewingAttachmentIndex] = useState<number | null>(null);
  const [activityPopoverOpen, setActivityPopoverOpen] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  // Draft task state — local-only project not yet persisted
  const [draftTask, setDraftTask] = useState<Project | null>(null);
  const [creatingTask, setCreatingTask] = useState(false);

  const editingFieldsRef = useRef<ProjectFormFields | null>(null);

  useEffect(() => {
    editingFieldsRef.current = editingProjectFields;
  }, [editingProjectFields]);

  // Fetch properties list on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/properties');
        const result = await res.json();
        if (res.ok && result.properties) {
          setAllProperties(result.properties);
        }
      } catch (err) {
        console.error('Error fetching properties:', err);
      }
    })();
  }, []);

  // Fetch available templates on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/tasks');
        const result = await res.json();
        if (res.ok && result.data) {
          setAvailableTemplates(result.data);
        }
      } catch (err) {
        console.error('Error fetching templates:', err);
      }
    })();
  }, []);

  const fetchTaskTemplate = useCallback(async (templateId: string, propertyName?: string) => {
    const cacheKey = propertyName ? `${templateId}__${propertyName}` : templateId;
    if (taskTemplates[cacheKey]) return taskTemplates[cacheKey];

    setLoadingTaskTemplate(templateId);
    try {
      const url = propertyName
        ? `/api/templates/${templateId}?property_name=${encodeURIComponent(propertyName)}`
        : `/api/templates/${templateId}`;
      const res = await fetch(url);
      const result = await res.json();
      if (res.ok && result.template) {
        setTaskTemplates(prev => ({ ...prev, [cacheKey]: result.template }));
        return result.template as Template;
      }
    } catch (err) {
      console.error('Error fetching template:', err);
    } finally {
      setLoadingTaskTemplate(null);
    }
    return null;
  }, [taskTemplates]);

  const handleSaveTaskForm = useCallback(async (taskId: string, formData: Record<string, unknown>) => {
    try {
      const res = await fetch('/api/save-task-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, formData }),
      });
      if (res.ok) {
        setTasks(prev => prev.map(t =>
          t.id === taskId ? { ...t, form_metadata: formData } : t
        ));
        if (expandedProject?.id === taskId) {
          setExpandedProject(prev => prev ? { ...prev, form_metadata: formData } : prev);
        }
      }
    } catch (err) {
      console.error('Error saving task form:', err);
    }
  }, [expandedProject?.id]);

  const handleTemplateChange = useCallback(async (templateId: string | null) => {
    if (!expandedProject) return;
    try {
      const res = await fetch(`/api/tasks-for-bin/${expandedProject.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: templateId }),
      });
      const result = await res.json();
      if (result.data) {
        const updated = { ...result.data, form_metadata: templateId ? (result.data.form_metadata || {}) : null };
        setExpandedProject(updated);
        setTasks(prev => prev.map(t => t.id === expandedProject.id ? updated : t));
        if (templateId) {
          fetchTaskTemplate(templateId, updated.property_name || undefined);
        }
      }
    } catch (err) {
      console.error('Error changing template:', err);
    }
  }, [expandedProject, fetchTaskTemplate]);

  // Fetch tasks for a given bin
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
      console.error('Error fetching tasks for bin:', err);
    } finally {
      setLoadingTasks(false);
    }
  }, [currentUser?.id]);

  // Column visibility
  const columnVis = useColumnVisibility(selectedBinId, viewMode);

  // Board texture preference
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

  // ============================================================================
  // Bin Navigation
  // ============================================================================
  const handleSelectBin = useCallback(async (binId: string | null) => {
    setSelectedBinId(binId);
    setShowKanban(true);
    setExpandedProject(null);

    if (binId === null) {
      setSelectedBinName('All Binned Tasks');
    } else {
      const bin = binsHook.bins.find(b => b.id === binId);
      setSelectedBinName(bin?.name || 'Bin');
    }

    await fetchTasksForBin(binId);
  }, [binsHook.bins, fetchTasksForBin]);

  const handleBackToBins = useCallback(() => {
    setShowKanban(false);
    setExpandedProject(null);
    setSelectedBinId(null);
    setSelectedBinName('All Binned Tasks');
    binsHook.fetchBins();
  }, [binsHook.fetchBins]);

  const handleCreateBin = useCallback(async (name: string, description?: string) => {
    return binsHook.createBin(name, description);
  }, [binsHook.createBin]);

  const handleDeleteBin = useCallback((binId: string) => {
    binsHook.deleteBin(binId);
  }, [binsHook.deleteBin]);

  const handleRenameBin = useCallback((binId: string, name: string) => {
    binsHook.updateBin(binId, { name });
  }, [binsHook.updateBin]);

  // ============================================================================
  // Detail panel initialization
  // ============================================================================
  const isDraft = expandedProject?.id?.startsWith('draft-') ?? false;

  useEffect(() => {
    if (expandedProject) {
      setEditingProjectFields({
        title: expandedProject.title,
        description: expandedProject.description || null,
        status: expandedProject.status,
        priority: expandedProject.priority,
        assigned_staff: expandedProject.project_assignments?.map(a => a.user_id) || [],
        department_id: expandedProject.department_id || '',
        scheduled_date: expandedProject.scheduled_date || '',
        scheduled_time: expandedProject.scheduled_time || ''
      });

      if (!expandedProject.id.startsWith('draft-')) {
        commentsHook.fetchProjectComments(expandedProject.id, 'task');
        attachmentsHook.fetchProjectAttachments(expandedProject.id, 'task');
        timeTrackingHook.fetchProjectTimeEntries(expandedProject.id, 'task');

        if (expandedProject.template_id) {
          const propName = expandedProject.property_name || undefined;
          const cacheKey = propName ? `${expandedProject.template_id}__${propName}` : expandedProject.template_id;
          if (!taskTemplates[cacheKey]) {
            fetchTaskTemplate(expandedProject.template_id, propName);
          }
        }
      }
    }
  }, [expandedProject?.id]);

  // ============================================================================
  // Task CRUD via tasks-for-bin APIs
  // ============================================================================
  const handleSaveProject = useCallback(async (directFields?: ProjectFormFields) => {
    const currentFields = directFields || editingFieldsRef.current;
    if (!expandedProject || !currentFields) return;
    if (expandedProject.id.startsWith('draft-')) return;

    setSavingEdit(true);
    try {
      const res = await fetch(`/api/tasks-for-bin/${expandedProject.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: currentFields.title,
          description: currentFields.description || null,
          status: currentFields.status,
          priority: currentFields.priority,
          assigned_user_ids: currentFields.assigned_staff || [],
          department_id: currentFields.department_id || null,
          scheduled_date: currentFields.scheduled_date || null,
          scheduled_time: currentFields.scheduled_time || null,
        }),
      });
      const result = await res.json();
      if (result.data) {
        const d = result.data;
        setExpandedProject(d);
        setTasks(prev => prev.map(t => t.id === expandedProject.id ? d : t));
        setEditingProjectFields({
          title: d.title,
          description: d.description || null,
          status: d.status,
          priority: d.priority,
          assigned_staff: d.project_assignments?.map((a: { user_id: string }) => a.user_id) || currentFields.assigned_staff || [],
          department_id: d.department_id || '',
          scheduled_date: d.scheduled_date || '',
          scheduled_time: d.scheduled_time || '',
        });
      }
    } catch (err) {
      console.error('Error saving task:', err);
    } finally {
      setSavingEdit(false);
    }
  }, [expandedProject]);

  const handleNewTask = useCallback(() => {
    const draft: Project = {
      id: `draft-${Date.now()}`,
      property_name: null,
      bin_id: selectedBinId || null,
      is_binned: true,
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
    setDraftTask(draft);
    setExpandedProject(draft);
  }, [selectedBinId]);

  const handleConfirmCreateTask = useCallback(async () => {
    if (!draftTask) return;
    setCreatingTask(true);
    try {
      const fields = editingFieldsRef.current;
      const payload: Record<string, unknown> = {
        title: fields?.title || draftTask.title || 'New Task',
        status: fields?.status || 'not_started',
        priority: fields?.priority || 'medium',
        is_binned: true,
        description: fields?.description || null,
        department_id: fields?.department_id || null,
        scheduled_date: fields?.scheduled_date || null,
        scheduled_time: fields?.scheduled_time || null,
      };
      if (draftTask.bin_id) payload.bin_id = draftTask.bin_id;
      if (draftTask.property_name) payload.property_name = draftTask.property_name;
      if (draftTask.template_id) payload.template_id = draftTask.template_id;
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
        setExpandedProject(result.data);
      }
    } catch (err) {
      console.error('Error creating task:', err);
    } finally {
      setCreatingTask(false);
    }
  }, [draftTask]);

  const handleDeleteTask = useCallback(async (task: Project) => {
    try {
      const res = await fetch(`/api/tasks-for-bin/${task.id}`, { method: 'DELETE' });
      if (res.ok) {
        setTasks(prev => prev.filter(t => t.id !== task.id));
        if (expandedProject?.id === task.id) {
          setExpandedProject(null);
        }
      }
    } catch (err) {
      console.error('Error deleting task:', err);
    }
  }, [expandedProject?.id]);

  const handleColumnMove = useCallback(async (taskId: string, field: string, value: string) => {
    if (field === 'property_name') {
      const task = tasks.find(t => t.id === taskId);
      if (task) {
        const currentProp = task.property_name || '';
        if (currentProp !== value) {
          alert('Property can\'t be changed after a task is created.');
          return;
        }
      }
    }
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
        const d = result.data;
        setTasks(prev => prev.map(t => t.id === taskId ? d : t));
        if (expandedProject?.id === taskId) {
          setExpandedProject(d);
          setEditingProjectFields({
            title: d.title,
            description: d.description || null,
            status: d.status,
            priority: d.priority,
            assigned_staff: d.project_assignments?.map((a: { user_id: string }) => a.user_id) || [],
            department_id: d.department_id || '',
            scheduled_date: d.scheduled_date || '',
            scheduled_time: d.scheduled_time || '',
          });
        }
      }
    } catch (err) {
      console.error('Error updating task field:', err);
    }
  }, [expandedProject?.id]);

  // Unread comment count from the task data
  const getUnreadCommentCount = useCallback((project: Project): number => {
    return (project as any).unread_comment_count || 0;
  }, []);

  // Record project view (reuses existing project_views table with task ID)
  const recordView = useCallback(async (taskId: string) => {
    if (!currentUser?.id) return;
    try {
      await fetch('/api/project-views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: taskId, user_id: currentUser.id }),
      });
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, unread_comment_count: 0 } as any : t
      ));
    } catch (err) {
      console.error('Error recording view:', err);
    }
  }, [currentUser?.id]);

  // ============================================================================
  // Detail panel actions
  // ============================================================================
  const handlePostComment = useCallback(async () => {
    if (!expandedProject || !newComment.trim()) return;
    await commentsHook.postProjectComment(expandedProject.id, newComment, 'task');
    setNewComment('');
  }, [expandedProject, newComment, commentsHook]);

  const handleAttachmentUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!expandedProject) return;
    attachmentsHook.handleAttachmentUpload(e, expandedProject.id, 'task');
  }, [expandedProject, attachmentsHook]);

  const handleStartTimer = useCallback(() => {
    if (!expandedProject) return;
    timeTrackingHook.startProjectTimer(expandedProject.id, 'task');
  }, [expandedProject, timeTrackingHook]);

  const handleOpenActivity = useCallback(() => {
    if (expandedProject) {
      activityHook.fetchProjectActivity(expandedProject.id);
      setActivityPopoverOpen(true);
    }
  }, [expandedProject, activityHook]);

  const handleProjectSelect = useCallback((project: Project) => {
    if (expandedProject?.id === project.id) {
      setExpandedProject(null);
    } else {
      setExpandedProject(project);
      recordView(project.id);
    }
  }, [expandedProject?.id, recordView]);

  // ============================================================================
  // RENDER
  // ============================================================================
  if (!showKanban) {
    return (
      <BinPicker
        bins={binsHook.bins}
        loadingBins={binsHook.loadingBins}
        totalProjects={binsHook.totalProjects}
        onSelectBin={handleSelectBin}
        onCreateBin={handleCreateBin}
        onDeleteBin={handleDeleteBin}
        onRenameBin={handleRenameBin}
      />
    );
  }

  return (
    <div className="flex h-full overflow-hidden glass-bg-neutral">
      {/* Left Panel - Kanban Board */}
      <div className={`${expandedProject ? 'w-2/3' : 'w-full'} h-full flex flex-col transition-[width] duration-200 ease-out`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/20 dark:border-white/10 glass-panel bg-white/40 dark:bg-white/[0.05] flex-shrink-0 relative z-20">
          <div className="flex items-center gap-3">
            <button
              onClick={handleBackToBins}
              className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Bins
            </button>
            <span className="text-neutral-400/50 dark:text-white/20">/</span>
            <h3 className="text-lg font-semibold text-neutral-900 dark:text-white">
              {selectedBinName}
            </h3>
          </div>
          <div className="flex items-center gap-3">
            <ViewModeToggle viewMode={viewMode} setViewMode={setViewMode} />
            <ColumnPicker
              columns={allColumnOptions}
              visibleColumnIds={columnVis.visibleIds}
              onToggle={columnVis.toggle}
              onSelectAll={() => columnVis.selectAll(allColumnOptions.map((c) => c.id))}
              onClearAll={columnVis.clearAll}
            />
            <Button size="sm" onClick={handleNewTask}>
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              New Task
            </Button>
          </div>
        </div>

        {loadingTasks ? (
          <div className="flex items-center justify-center flex-1">
            <p className="text-neutral-500">Loading tasks...</p>
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex items-center justify-center flex-1">
            <div className="text-center">
              <p className="text-neutral-500 dark:text-neutral-400 mb-4">
                No tasks in this bin yet.
              </p>
              <Button onClick={handleNewTask}>
                Create First Task
              </Button>
            </div>
          </div>
        ) : (
          <ProjectsKanban
            projects={tasks}
            viewMode={viewMode}
            allProperties={allProperties}
            users={users}
            departments={departments}
            onProjectClick={handleProjectSelect}
            expandedProjectId={expandedProject?.id || null}
            getUnreadCommentCount={getUnreadCommentCount}
            onColumnMove={handleColumnMove}
            visibleColumnIds={columnVis.visibleIds}
            showTexture={showBoardTexture}
          />
        )}
      </div>

      {/* Right Panel - Task Detail */}
      {expandedProject && editingProjectFields && (() => {
        const propName = expandedProject.property_name || undefined;
        const resolvedTemplate = expandedProject.template_id
          ? (taskTemplates[`${expandedProject.template_id}__${propName}`] as Template
            || taskTemplates[expandedProject.template_id] as Template
            || null)
          : null;

        return (
        <div className="w-1/3 flex-shrink-0 border-l border-[rgba(30,25,20,0.08)] dark:border-white/10 bg-white dark:bg-white/[0.03]">
        <ProjectDetailPanel
          project={expandedProject}
          editingFields={editingProjectFields}
          setEditingFields={setEditingProjectFields}
          users={users}
          allProperties={allProperties}
          savingEdit={savingEdit}
          onSave={handleSaveProject}
          onDelete={handleDeleteTask}
          onClose={() => { setExpandedProject(null); setDraftTask(null); }}
          onOpenActivity={handleOpenActivity}
          isNewTask={isDraft}
          onConfirmCreate={isDraft ? handleConfirmCreateTask : undefined}
          creatingTask={creatingTask}
          onPropertyChange={isDraft
            ? (_propertyId, propertyName) => {
                const updated = { ...expandedProject, property_name: propertyName };
                setExpandedProject(updated);
                setDraftTask(updated);
              }
            : async (_propertyId, propertyName) => {
                try {
                  const res = await fetch(`/api/tasks-for-bin/${expandedProject.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ property_name: propertyName || null }),
                  });
                  const result = await res.json();
                  if (result.data) {
                    setExpandedProject(result.data);
                    setTasks(prev => prev.map(t => t.id === expandedProject.id ? result.data : t));
                  }
                } catch (err) {
                  console.error('Error updating property:', err);
                }
              }
          }
          bins={binsHook.bins}
          onBinChange={async (binId) => {
            try {
              const res = await fetch(`/api/tasks-for-bin/${expandedProject.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bin_id: binId || null }),
              });
              const result = await res.json();
              if (result.data) {
                setExpandedProject(result.data);
                setTasks(prev => prev.map(t => t.id === expandedProject.id ? result.data : t));
              }
              binsHook.fetchBins();
            } catch (err) {
              console.error('Error updating bin:', err);
            }
          }}
          onIsBinnedChange={async (isBinned) => {
            try {
              const payload: Record<string, unknown> = { is_binned: isBinned };
              if (!isBinned) payload.bin_id = null;
              const res = await fetch(`/api/tasks-for-bin/${expandedProject.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              });
              const result = await res.json();
              if (result.data) {
                setExpandedProject(result.data);
                setTasks(prev => prev.map(t => t.id === expandedProject.id ? result.data : t));
              }
              binsHook.fetchBins();
            } catch (err) {
              console.error('Error updating is_binned:', err);
            }
          }}
          comments={commentsHook.projectComments as Comment[]}
          loadingComments={commentsHook.loadingComments}
          newComment={newComment}
          setNewComment={setNewComment}
          postingComment={commentsHook.postingComment}
          onPostComment={handlePostComment}
          attachments={attachmentsHook.projectAttachments as Attachment[]}
          loadingAttachments={attachmentsHook.loadingAttachments}
          uploadingAttachment={attachmentsHook.uploadingAttachment}
          attachmentInputRef={attachmentsHook.attachmentInputRef}
          onAttachmentUpload={handleAttachmentUpload}
          onViewAttachment={setViewingAttachmentIndex}
          activeTimeEntry={timeTrackingHook.activeTimeEntry}
          displaySeconds={timeTrackingHook.displaySeconds}
          formatTime={timeTrackingHook.formatTime}
          onStartTimer={handleStartTimer}
          onStopTimer={timeTrackingHook.stopProjectTimer}
          staffOpen={staffOpen}
          setStaffOpen={setStaffOpen}
          template={resolvedTemplate || undefined}
          formMetadata={expandedProject.form_metadata}
          onSaveForm={async (formData) => {
            await handleSaveTaskForm(expandedProject.id, formData);
          }}
          loadingTemplate={loadingTaskTemplate === expandedProject.template_id}
          currentUser={currentUser}
          availableTemplates={availableTemplates}
          onTemplateChange={isDraft
            ? (templateId) => {
                const tmpl = availableTemplates.find(t => t.id === templateId);
                const updated = { ...expandedProject, template_id: templateId, template_name: tmpl?.name || null };
                setExpandedProject(updated);
                setDraftTask(updated);
              }
            : handleTemplateChange
          }
        />
        </div>
        );
      })()}

      <ProjectActivitySheet
        open={activityPopoverOpen}
        onOpenChange={setActivityPopoverOpen}
        activities={activityHook.projectActivity}
        loading={activityHook.loadingActivity}
      />

      <AttachmentLightbox
        attachments={attachmentsHook.projectAttachments as Attachment[]}
        viewingIndex={viewingAttachmentIndex}
        onClose={() => setViewingAttachmentIndex(null)}
        onNavigate={setViewingAttachmentIndex}
      />
    </div>
  );
}

const ProjectsWindow = memo(ProjectsWindowContent);
export default ProjectsWindow;
