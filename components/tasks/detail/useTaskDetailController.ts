'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/apiFetch';
import { toast } from '@/components/ui/toast';
import { useAuth } from '@/lib/authContext';
import { useDepartments } from '@/lib/departmentsContext';
import { useProjectBins } from '@/lib/hooks/useProjectBins';
import { useProjectComments } from '@/lib/hooks/useProjectComments';
import { useProjectAttachments } from '@/lib/hooks/useProjectAttachments';
import { useProjectTimeTracking } from '@/lib/hooks/useProjectTimeTracking';
import { ensureTemplateDetail, qk, useProperties, useTaskTemplates } from '@/lib/queries';
import {
  hasIncompleteChecklist,
  hasIncompleteChecklistFromMetadata,
  templateProgress,
} from '@/lib/tasks/templateProgress';
import type { ProjectFormFields, User } from '@/lib/types';
import type { Template } from '@/components/DynamicCleaningForm';
import {
  buildFields,
  draftToFields,
  emptyDraft,
  type TaskDetailInput,
  type TaskDraft,
} from './taskInput';

export type TaskDetailView = 'main' | 'checklist' | 'comments';

export interface TaskCreatePayload {
  fields: ProjectFormFields;
  property_id: string | null;
  property_name: string | null;
  template_id: string | null;
  bin_id: string | null;
}

interface ControllerArgs {
  task: TaskDetailInput | null;
  draft?: TaskDraft | null;
  onSaved?: (row: TaskDetailInput) => void;
  onDeleted?: (taskId: string) => void;
  onDraftChange?: (draft: TaskDraft) => void;
  /** Demo fixtures mode: saves apply locally, no network. */
  demo?: boolean;
}

// Flush the checklist form's pending debounced save (DynamicCleaningForm
// installs window.__currentFormSave on mount). Must run before status writes
// and on checklist exit so the last ~800ms of edits can't race them.
async function flushChecklistSave() {
  const save = (window as { __currentFormSave?: () => Promise<void> }).__currentFormSave;
  if (save) {
    try {
      await save();
    } catch {
      /* form save surfaces its own errors */
    }
  }
}

export function useTaskDetailController({
  task,
  draft,
  onSaved,
  onDeleted,
  onDraftChange,
  demo = false,
}: ControllerArgs) {
  const queryClient = useQueryClient();
  const { user: authUser, allUsers } = useAuth();
  const currentUser = authUser as unknown as User | null;
  const users = allUsers as unknown as User[];
  const { departments } = useDepartments();
  const { properties: allProperties } = useProperties();
  const { templates: availableTemplates } = useTaskTemplates();
  const binsHook = useProjectBins({ currentUser });

  const isDraft = !task && !!draft;
  const taskId = task?.task_id ?? null;

  // ---- fields state (seeded from task/draft; reseeds when the row changes
  // externally — keyed on updated_at, not just id) ------------------------
  const [fields, setFields] = useState<ProjectFormFields>(() =>
    task ? buildFields(task) : draftToFields(draft ?? emptyDraft())
  );
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;

  // Local mirror of the task row: optimistic patches + PUT responses land
  // here so the panel is self-consistent between parent refreshes.
  const [row, setRow] = useState<TaskDetailInput | null>(task);
  const seedKey = task ? `${task.task_id}:${task.updated_at}` : 'draft';
  const lastSeedRef = useRef(seedKey);
  useEffect(() => {
    if (lastSeedRef.current === seedKey) return;
    lastSeedRef.current = seedKey;
    if (task) {
      setRow(task);
      setFields(buildFields(task));
    } else {
      setRow(null);
      setFields(draftToFields(draft ?? emptyDraft()));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  const [savingEdit, setSavingEdit] = useState(false);
  const [view, setView] = useState<TaskDetailView>('main');

  // ---- sub-feature hooks (existing tasks only) ---------------------------
  const commentsHook = useProjectComments({ currentUser });
  const attachmentsHook = useProjectAttachments({ currentUser });
  const timeHook = useProjectTimeTracking({ currentUser });
  const {
    fetchProjectComments,
    clearComments,
  } = commentsHook;
  const { fetchProjectAttachments, clearAttachments } = attachmentsHook;
  const { fetchProjectTimeEntries, clearTimeTracking } = timeHook;

  useEffect(() => {
    if (!taskId || demo) return;
    fetchProjectComments(taskId, 'task');
    fetchProjectAttachments(taskId, 'task');
    fetchProjectTimeEntries(taskId, 'task');
    return () => {
      clearComments();
      clearAttachments();
      clearTimeTracking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // ---- template loading ---------------------------------------------------
  const templateId = task?.template_id ?? draft?.template_id ?? null;
  const propertyName = task?.property_name ?? draft?.property_name ?? null;
  const [template, setTemplate] = useState<Template | null>(null);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!templateId) {
      setTemplate(null);
      return;
    }
    setLoadingTemplate(true);
    ensureTemplateDetail(queryClient, templateId, propertyName)
      .then((t) => {
        if (!cancelled) setTemplate(t);
      })
      .catch((err) => {
        console.error('Error fetching template:', err);
        if (!cancelled) toast.error("Couldn't load the task template");
      })
      .finally(() => {
        if (!cancelled) setLoadingTemplate(false);
      });
    return () => {
      cancelled = true;
    };
  }, [templateId, propertyName, queryClient]);

  // formMetadata mirror — updates optimistically as the checklist saves so
  // the progress bar tracks within the form's 800ms debounce.
  const [formMetadata, setFormMetadata] = useState<Record<string, unknown> | null>(
    task?.form_metadata ?? null
  );
  useEffect(() => {
    setFormMetadata(task?.form_metadata ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  const progress = useMemo(
    () => templateProgress(template, formMetadata),
    [template, formMetadata]
  );

  // ---- derived flags (ported semantics) -----------------------------------
  const isTemplated = !!templateId;
  const isAssigned = currentUser ? fields.assigned_staff?.includes(currentUser.id) : false;
  const isContingent = fields.status === 'contingent';
  const isChecklistReadOnly =
    !isAssigned || isContingent || (isTemplated && fields.status !== 'in_progress');

  const checklistIncomplete = useCallback(() => {
    if (!isTemplated) return false;
    if (template) return hasIncompleteChecklist(template, formMetadata);
    // Template body not loaded yet — legacy metadata-only fallback so
    // Complete isn't blocked behind a fetch.
    return hasIncompleteChecklistFromMetadata(formMetadata) || !formMetadata;
  }, [isTemplated, template, formMetadata]);

  // ---- cache reconciliation ------------------------------------------------
  const invalidateTaskCaches = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['tasks-for-bin'] });
    queryClient.invalidateQueries({ queryKey: qk.allTasks });
    queryClient.invalidateQueries({ queryKey: qk.timeline });
    queryClient.invalidateQueries({ queryKey: qk.turnovers });
    if (currentUser?.id) {
      queryClient.invalidateQueries({ queryKey: qk.myAssignments(currentUser.id) });
    }
    const pid = task?.property_id ?? row?.property_id;
    if (pid) queryClient.invalidateQueries({ queryKey: qk.propertyTasks(pid) });
  }, [queryClient, currentUser?.id, task?.property_id, row?.property_id]);

  // ---- canonical save (diffed PUT) -----------------------------------------
  const rowRef = useRef(row);
  rowRef.current = row;

  const saveFields = useCallback(
    async (directFields?: ProjectFormFields) => {
      const current = rowRef.current;
      const nextFields = directFields ?? fieldsRef.current;
      if (isDraft) {
        // Draft mode never touches the network — mirror to the parent.
        onDraftChange?.({
          ...(draft ?? emptyDraft()),
          title: nextFields.title,
          description: nextFields.description,
          priority: nextFields.priority,
          status: nextFields.status,
          department_id: nextFields.department_id || null,
          scheduled_date: nextFields.scheduled_date || null,
          scheduled_time: nextFields.scheduled_time || null,
          assigned_staff: nextFields.assigned_staff || [],
        });
        return;
      }
      if (!current) return;

      if (demo) {
        // Demo fixtures: apply the edit locally so the UI walk works
        // without an authenticated API.
        const adapted: TaskDetailInput = {
          ...current,
          title: nextFields.title,
          description: nextFields.description,
          priority: nextFields.priority,
          department_id: nextFields.department_id || null,
          status: nextFields.status,
          scheduled_date: nextFields.scheduled_date || null,
          scheduled_time: nextFields.scheduled_time || null,
          assigned_users: (nextFields.assigned_staff || []).map((id) => {
            const u = users.find((x) => x.id === id);
            return { user_id: id, name: u?.name ?? id, avatar: u?.avatar ?? null };
          }),
          updated_at: current.updated_at,
        };
        setRow(adapted);
        setFields(nextFields);
        onSaved?.(adapted);
        return;
      }

      // Diff before send — especially assigned_user_ids: including it always
      // rewrites task_assignments (resetting assigned_at), so only send it
      // when membership actually changed.
      const body: Record<string, unknown> = {};
      if (nextFields.title !== (current.title || current.template_name || 'Task')) {
        body.title = nextFields.title;
      }
      if (JSON.stringify(nextFields.description) !== JSON.stringify(current.description ?? null)) {
        body.description = nextFields.description;
      }
      if (nextFields.priority !== (current.priority || 'medium')) body.priority = nextFields.priority;
      if ((nextFields.department_id || null) !== (current.department_id || null)) {
        body.department_id = nextFields.department_id || null;
      }
      if ((nextFields.status || 'not_started') !== (current.status || 'not_started')) {
        body.status = nextFields.status;
      }
      if ((nextFields.scheduled_date || null) !== (current.scheduled_date || null)) {
        body.scheduled_date = nextFields.scheduled_date || null;
      }
      if ((nextFields.scheduled_time || null) !== (current.scheduled_time || null)) {
        body.scheduled_time = nextFields.scheduled_time || null;
      }
      const oldAssignees = current.assigned_users.map((u) => u.user_id).sort().join(',');
      const newAssignees = (nextFields.assigned_staff || []).slice().sort().join(',');
      if (oldAssignees !== newAssignees) {
        body.assigned_user_ids = nextFields.assigned_staff || [];
      }
      if (Object.keys(body).length === 0) return;

      setSavingEdit(true);
      try {
        const res = await apiFetch(`/api/tasks-for-bin/${current.task_id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok || !result.data) {
          throw new Error(result?.error || `Failed to save task (HTTP ${res.status})`);
        }
        const updated = result.data as {
          id: string;
          [key: string]: unknown;
        };
        const adapted: TaskDetailInput = {
          ...current,
          ...(updated as Partial<TaskDetailInput>),
          task_id: current.task_id,
          assigned_users:
            ((updated.project_assignments as { user_id: string; user?: { name?: string; avatar?: string | null; role?: string } }[] | undefined)?.map((a) => ({
              user_id: a.user_id,
              name: a.user?.name ?? users.find((u) => u.id === a.user_id)?.name ?? '',
              avatar: a.user?.avatar ?? users.find((u) => u.id === a.user_id)?.avatar ?? null,
              role: a.user?.role,
            })) ?? current.assigned_users),
        };
        // Keep the seed guard in sync so the reseed effect doesn't clobber
        // fresher local state when the parent re-renders with this row.
        lastSeedRef.current = `${adapted.task_id}:${adapted.updated_at}`;
        setRow(adapted);
        setFields(buildFields(adapted));
        onSaved?.(adapted);
        invalidateTaskCaches();
      } catch (err) {
        console.error('Error saving task:', err);
        toast.error(err instanceof Error ? err.message : "Couldn't save the task");
        // Revert optimistic field edits to server truth.
        setFields(buildFields(current));
      } finally {
        setSavingEdit(false);
      }
    },
    [isDraft, draft, onDraftChange, onSaved, invalidateTaskCaches, users, demo]
  );

  // Field update helpers: pickers save immediately (optimistic), text saves
  // on blur via saveFields().
  const updateField = useCallback(
    <K extends keyof ProjectFormFields>(key: K, value: ProjectFormFields[K], saveNow = true) => {
      const updated = { ...fieldsRef.current, [key]: value };
      setFields(updated);
      if (saveNow) void saveFields(updated);
    },
    [saveFields]
  );

  // ---- checklist form save --------------------------------------------------
  const saveForm = useCallback(
    async (formData: Record<string, unknown>) => {
      if (!taskId) return;
      setFormMetadata(formData);
      if (demo) {
        setRow((prev) => (prev ? { ...prev, form_metadata: formData } : prev));
        return;
      }
      try {
        const res = await apiFetch('/api/save-task-form', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task_id: taskId, form_metadata: formData }),
        });
        if (!res.ok) throw new Error('Failed to save the form');
        setRow((prev) => (prev ? { ...prev, form_metadata: formData } : prev));
        invalidateTaskCaches();
      } catch (err) {
        console.error('Error saving task form:', err);
        toast.error("Couldn't save the form");
      }
    },
    [taskId, invalidateTaskCaches, demo]
  );

  // ---- timer/status coupling (ported verbatim from ProjectDetailPanel) ----
  const activeTimeEntryRef = useRef(timeHook.activeTimeEntry);
  activeTimeEntryRef.current = timeHook.activeTimeEntry;
  const stopTimerRef = useRef(timeHook.stopProjectTimer);
  stopTimerRef.current = timeHook.stopProjectTimer;

  // Flag: when an action handler already initiated the timer change + status
  // change, the effect below must not duplicate it.
  const manualTimerActionRef = useRef(false);

  // Auto-stop the timer when status leaves in_progress via external paths.
  // Never auto-starts — starting is always explicit.
  useEffect(() => {
    if (manualTimerActionRef.current) {
      manualTimerActionRef.current = false;
      return;
    }
    if (activeTimeEntryRef.current && fields.status !== 'in_progress') {
      stopTimerRef.current();
    }
  }, [fields.status]);

  const writeStatus = useCallback(
    (targetStatus: string) => {
      updateField('status', targetStatus as ProjectFormFields['status']);
    },
    [updateField]
  );

  const startTimer = useCallback(() => {
    if (demo) return; // timers need the real API; demo shows the idle rail
    if (taskId) timeHook.startProjectTimer(taskId, 'task');
  }, [taskId, timeHook, demo]);

  const handleStart = useCallback(async () => {
    manualTimerActionRef.current = true;
    startTimer();
    writeStatus('in_progress');
  }, [startTimer, writeStatus]);

  const handlePause = useCallback(async () => {
    await flushChecklistSave();
    manualTimerActionRef.current = true;
    stopTimerRef.current();
    writeStatus('paused');
  }, [writeStatus]);

  const handleComplete = useCallback(async () => {
    await flushChecklistSave();
    if (
      checklistIncomplete() &&
      !confirm('Are you sure you want to complete this task? The checklist has not been completed.')
    ) {
      return;
    }
    if (activeTimeEntryRef.current) {
      manualTimerActionRef.current = true;
      stopTimerRef.current();
    }
    writeStatus('complete');
  }, [checklistIncomplete, writeStatus]);

  // Reopen: paused only. No timer start, checklist stays locked until Start.
  const handleReopen = useCallback(() => {
    writeStatus('paused');
  }, [writeStatus]);

  // ---- bin move (not part of ProjectFormFields — its own small PUT) --------
  const updateBin = useCallback(
    async (binId: string | null) => {
      if (isDraft) {
        onDraftChange?.({ ...(draft ?? emptyDraft()), bin_id: binId });
        return;
      }
      const current = rowRef.current;
      if (!current) return;
      try {
        const res = await apiFetch(`/api/tasks-for-bin/${current.task_id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bin_id: binId, is_binned: true }),
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok || !result.data) throw new Error(result?.error || 'Failed to move the task');
        const binName = binsHook.bins.find((b) => b.id === binId)?.name ?? null;
        const adapted = { ...current, bin_id: binId, bin_name: binName };
        lastSeedRef.current = `${adapted.task_id}:${(result.data as { updated_at?: string }).updated_at ?? adapted.updated_at}`;
        setRow(adapted);
        onSaved?.(adapted);
        invalidateTaskCaches();
        queryClient.invalidateQueries({ queryKey: qk.projectBins });
      } catch (err) {
        console.error('Error updating bin:', err);
        toast.error("Couldn't move the task to that bin");
      }
    },
    [isDraft, draft, onDraftChange, binsHook.bins, onSaved, invalidateTaskCaches, queryClient]
  );

  // ---- delete ---------------------------------------------------------------
  const [deleting, setDeleting] = useState(false);
  const deleteTask = useCallback(async () => {
    if (!taskId) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/tasks-for-bin/${taskId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete the task');
      invalidateTaskCaches();
      onDeleted?.(taskId);
    } catch (err) {
      console.error('Error deleting task:', err);
      toast.error("Couldn't delete the task");
    } finally {
      setDeleting(false);
    }
  }, [taskId, invalidateTaskCaches, onDeleted]);

  // ---- view navigation (flush the form when leaving the checklist) --------
  const openView = useCallback(async (next: TaskDetailView) => {
    if (next !== 'checklist') await flushChecklistSave();
    setView(next);
  }, []);

  return {
    // identity/context
    isDraft,
    row,
    fields,
    updateField,
    saveFields,
    savingEdit,
    currentUser,
    users,
    departments,
    allProperties,
    availableTemplates,
    bins: binsHook.bins,
    // template/checklist
    isTemplated,
    template,
    loadingTemplate,
    formMetadata,
    saveForm,
    progress,
    checklistIncomplete,
    isChecklistReadOnly,
    isAssigned,
    isContingent,
    // status/timer
    handleStart,
    handlePause,
    handleComplete,
    handleReopen,
    writeStatus,
    timeHook,
    startTimer,
    // sub-features
    commentsHook,
    attachmentsHook,
    updateBin,
    // lifecycle
    deleteTask,
    deleting,
    view,
    openView,
    flushChecklistSave,
  };
}
