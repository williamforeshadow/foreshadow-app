'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAuth } from '@/lib/authContext';
import { useProjectComments } from '@/lib/hooks/useProjectComments';
import { useProjectAttachments } from '@/lib/hooks/useProjectAttachments';
import { useProjectTimeTracking } from '@/lib/hooks/useProjectTimeTracking';
import { useProjectBins } from '@/lib/hooks/useProjectBins';
import type {
  Project,
  ProjectFormFields,
  PropertyOption,
  TaskTemplate,
  User,
} from '@/lib/types';
import type { Template } from '@/components/DynamicCleaningForm';
import {
  ProjectDetailPanel,
  AttachmentLightbox,
} from '@/components/windows/projects';
import MobileProjectDetail from '@/components/mobile/MobileProjectDetail';
import { useIsMobile } from '@/lib/useIsMobile';
import { DESKTOP_DETAIL_PANEL_FLEX } from '@/lib/detailPanelGeometry';

// Self-contained detail overlay for a property-scoped task. Wraps the shared
// ProjectDetailPanel with all the plumbing each consumer previously had to
// wire up locally (comments, attachments, time tracking, bins, users,
// properties list, templates cache, edit state, save/delete/change
// handlers).
//
// Scope: read + edit an *existing* task only. Draft-task creation
// ("+ Task" button flow) stays in PropertyTasksView because it's entangled
// with list-side state; we'll unify later.
//
// Layout: renders an absolute overlay anchored to the outer /properties
// main column (which has `relative` on `app/properties/layout.tsx`), so it
// spans from the top of the viewport (overriding the property header) down
// to the bottom. Width is the right 1/3 of the main column, matching the
// Bins detail panel aesthetic.

// Minimal task shape the overlay needs. Schedule and Tasks ledger both
// provide this same set of fields from their respective APIs.
export interface OverlayTaskInput {
  task_id: string;
  reservation_id: string | null;
  property_id: string | null;
  property_name: string | null;
  template_id: string | null;
  template_name: string | null;
  title: string | null;
  description: unknown;
  priority: string;
  type?: string;
  department_id: string | null;
  department_name: string | null;
  status: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  form_metadata: Record<string, unknown> | null;
  bin_id: string | null;
  bin_name?: string | null;
  is_binned: boolean;
  created_at: string;
  updated_at: string;
  assigned_users: {
    user_id: string;
    name: string;
    avatar: string | null;
    role?: string;
  }[];
}

interface PropertyTaskDetailOverlayProps {
  task: OverlayTaskInput | null;
  onClose: () => void;
  // Called after any successful mutation so the parent can re-fetch its
  // list. Kept optional — Schedule doesn't strictly need a re-fetch on
  // every tweak since the calendar view is event-driven.
  onTaskUpdated?: () => void;
}

export function PropertyTaskDetailOverlay({
  task,
  onClose,
  onTaskUpdated,
}: PropertyTaskDetailOverlayProps) {
  const { user: authUser, allUsers } = useAuth();
  const users = allUsers as unknown as User[];
  const currentUser = authUser as unknown as User | null;
  const isMobile = useIsMobile();

  // Lazy caches for users-independent data the panel needs.
  const [allProperties, setAllProperties] = useState<PropertyOption[]>([]);
  const [availableTemplates, setAvailableTemplates] = useState<TaskTemplate[]>(
    []
  );
  const [taskTemplates, setTaskTemplates] = useState<
    Record<string, Template>
  >({});
  const [loadingTaskTemplate, setLoadingTaskTemplate] = useState<string | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/properties');
        const result = await res.json();
        if (!cancelled && res.ok && result.properties) {
          setAllProperties(result.properties);
        }
      } catch (err) {
        console.error('[TaskDetailOverlay] properties fetch failed:', err);
      }
    })();
    (async () => {
      try {
        const res = await fetch('/api/tasks');
        const result = await res.json();
        if (!cancelled && res.ok && result.data) {
          setAvailableTemplates(result.data);
        }
      } catch (err) {
        console.error('[TaskDetailOverlay] templates fetch failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchTaskTemplate = useCallback(
    async (templateId: string, propName?: string | null) => {
      const cacheKey = propName ? `${templateId}__${propName}` : templateId;
      if (taskTemplates[cacheKey]) return taskTemplates[cacheKey];
      setLoadingTaskTemplate(templateId);
      try {
        const url = propName
          ? `/api/templates/${templateId}?property_name=${encodeURIComponent(propName)}`
          : `/api/templates/${templateId}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.template) {
          setTaskTemplates((prev) => ({ ...prev, [cacheKey]: data.template }));
          return data.template as Template;
        }
      } catch (err) {
        console.error('[TaskDetailOverlay] template fetch failed:', err);
      } finally {
        setLoadingTaskTemplate(null);
      }
      return null;
    },
    [taskTemplates]
  );

  // Detail panel-local state.
  const [taskPatch, setTaskPatch] = useState<Partial<OverlayTaskInput>>({});
  const [editingFields, setEditingFields] = useState<ProjectFormFields | null>(
    null
  );
  const editingFieldsRef = useRef<ProjectFormFields | null>(null);
  const [staffOpen, setStaffOpen] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [viewingAttachmentIndex, setViewingAttachmentIndex] = useState<
    number | null
  >(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const commentsHook = useProjectComments({ currentUser });
  const attachmentsHook = useProjectAttachments({ currentUser });
  const timeTrackingHook = useProjectTimeTracking({ currentUser });
  const binsHook = useProjectBins({ currentUser });

  useEffect(() => {
    editingFieldsRef.current = editingFields;
  }, [editingFields]);

  // Apply any in-session patches on top of the incoming task prop so that
  // field edits / bin toggles reflect immediately without a parent refetch.
  const effectiveTask: OverlayTaskInput | null = useMemo(() => {
    if (!task) return null;
    return { ...task, ...taskPatch };
  }, [task, taskPatch]);

  // Seed/reseed editing state when the selected task changes.
  useEffect(() => {
    if (!task) {
      setEditingFields(null);
      setStaffOpen(false);
      setNewComment('');
      setTaskPatch({});
      commentsHook.clearComments();
      attachmentsHook.clearAttachments();
      timeTrackingHook.clearTimeTracking();
      return;
    }
    setTaskPatch({});
    setEditingFields({
      title: task.title || task.template_name || 'Task',
      description: (task.description as ProjectFormFields['description']) || null,
      status: task.status || 'not_started',
      priority: task.priority || 'medium',
      assigned_staff: task.assigned_users.map((u) => u.user_id),
      department_id: task.department_id || '',
      scheduled_date: task.scheduled_date || '',
      scheduled_time: task.scheduled_time || '',
    });
    const taskId = task.task_id;
    commentsHook.fetchProjectComments(taskId, 'task');
    attachmentsHook.fetchProjectAttachments(taskId, 'task');
    timeTrackingHook.fetchProjectTimeEntries(taskId, 'task');
    if (task.template_id) {
      fetchTaskTemplate(task.template_id, task.property_name || undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.task_id]);

  // ---- Mutation handlers ------------------------------------------------

  const updateLocalPatch = useCallback(
    (patch: Partial<OverlayTaskInput>) => {
      setTaskPatch((prev) => ({ ...prev, ...patch }));
    },
    []
  );

  // ProjectDetailPanel passes the freshly-updated fields as an argument when
  // toggling assignees (so the save happens synchronously with the toggle).
  // Without honoring `directFields` we'd read a stale ref and miss the
  // change. Timeline uses the same `directFields ?? ref.current` pattern.
  const handleSaveFields = useCallback(
    async (directFields?: ProjectFormFields) => {
      if (!effectiveTask) return;
      const fields = directFields ?? editingFieldsRef.current;
      if (!fields) return;
      const taskId = effectiveTask.task_id;

      // Fan the save out to the right endpoints — `/api/update-task-fields`
      // has a server-side allow-list and silently drops status /
      // scheduled_date / scheduled_time, so those need their own endpoints
      // (matches TimelineWindow's handleSaveTaskEditFields pattern):
      //   /api/update-task-fields      title, description, priority, department_id
      //   /api/update-task-action      status
      //   /api/update-task-schedule    scheduled_date + scheduled_time
      //   /api/update-task-assignment  assignees
      const oldAssignees = effectiveTask.assigned_users
        .map((u) => u.user_id)
        .sort()
        .join(',');
      const newAssignees = (fields.assigned_staff || []).slice().sort().join(',');
      const assigneesChanged = oldAssignees !== newAssignees;

      // Plain-field diffs — allowed through /api/update-task-fields.
      const fieldUpdates: Record<string, unknown> = {};
      if (
        fields.title !==
        (effectiveTask.title || effectiveTask.template_name || 'Task')
      )
        fieldUpdates.title = fields.title;
      if (
        JSON.stringify(fields.description) !==
        JSON.stringify(effectiveTask.description || null)
      )
        fieldUpdates.description = fields.description;
      if (fields.priority !== (effectiveTask.priority || 'medium'))
        fieldUpdates.priority = fields.priority;
      if (fields.department_id !== (effectiveTask.department_id || ''))
        fieldUpdates.department_id = fields.department_id || null;

      // Status — dedicated action endpoint.
      const oldStatus = effectiveTask.status || 'not_started';
      const newStatus = fields.status || 'not_started';
      const statusChanged = newStatus !== oldStatus;

      // Schedule — dedicated endpoint; normalize empty strings.
      const oldDate = effectiveTask.scheduled_date || '';
      const oldTime = effectiveTask.scheduled_time || '';
      const newDate = fields.scheduled_date || '';
      const newTime = fields.scheduled_time || '';
      const scheduleChanged = newDate !== oldDate || newTime !== oldTime;

      const hasFieldChanges = Object.keys(fieldUpdates).length > 0;
      if (!hasFieldChanges && !assigneesChanged && !statusChanged && !scheduleChanged)
        return;

      setSavingEdit(true);

      // Optimistic patches so the panel reflects edits before the
      // network round-trip returns.
      if (hasFieldChanges) {
        updateLocalPatch(fieldUpdates as Partial<OverlayTaskInput>);
      }
      if (statusChanged) {
        updateLocalPatch({ status: newStatus } as Partial<OverlayTaskInput>);
      }
      if (scheduleChanged) {
        updateLocalPatch({
          scheduled_date: newDate || null,
          scheduled_time: newTime || null,
        } as Partial<OverlayTaskInput>);
      }
      if (assigneesChanged) {
        // Optimistically patch the assigned_users list so the right-rail
        // avatars reflect immediately. We reconcile full user records from
        // the lookup so names/avatars render correctly without a refetch.
        const nextAssignedUsers = (fields.assigned_staff || [])
          .map((uid) => {
            const u = users.find((x) => x.id === uid);
            if (!u) {
              // Fall back to whatever we had previously for that user.
              const existing = effectiveTask.assigned_users.find(
                (a) => a.user_id === uid
              );
              return existing || {
                user_id: uid,
                name: '',
                avatar: null,
                role: '',
              };
            }
            return {
              user_id: u.id,
              name: u.name || '',
              avatar: u.avatar || null,
              role: u.role || '',
            };
          });
        updateLocalPatch({
          assigned_users: nextAssignedUsers,
        } as Partial<OverlayTaskInput>);
      }

      try {
        const calls: Promise<Response>[] = [];
        if (hasFieldChanges) {
          calls.push(
            fetch('/api/update-task-fields', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId, fields: fieldUpdates }),
            })
          );
        }
        if (statusChanged) {
          calls.push(
            fetch('/api/update-task-action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId, action: newStatus }),
            })
          );
        }
        if (scheduleChanged) {
          calls.push(
            fetch('/api/update-task-schedule', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                taskId,
                scheduledDate: newDate || null,
                scheduledTime: newTime || null,
              }),
            })
          );
        }
        if (assigneesChanged) {
          calls.push(
            fetch('/api/update-task-assignment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                taskId,
                userIds: fields.assigned_staff || [],
              }),
            })
          );
        }
        await Promise.all(calls);
        onTaskUpdated?.();
      } catch (err) {
        console.error('[TaskDetailOverlay] save failed:', err);
      } finally {
        setSavingEdit(false);
      }
    },
    [effectiveTask, onTaskUpdated, updateLocalPatch, users]
  );

  const handleTemplateChange = useCallback(
    async (templateId: string | null) => {
      if (!effectiveTask) return;
      const taskId = effectiveTask.task_id;
      const templateName = templateId
        ? availableTemplates.find((t) => t.id === templateId)?.name || null
        : null;
      updateLocalPatch({
        template_id: templateId || null,
        template_name: templateName,
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
          fetchTaskTemplate(templateId, effectiveTask.property_name || undefined);
        }
        onTaskUpdated?.();
      } catch (err) {
        console.error('[TaskDetailOverlay] template change failed:', err);
      }
    },
    [effectiveTask, availableTemplates, fetchTaskTemplate, onTaskUpdated, updateLocalPatch]
  );

  const handlePropertyChange = useCallback(
    async (_propertyId: string | null, propName: string | null) => {
      if (!effectiveTask) return;
      const taskId = effectiveTask.task_id;
      updateLocalPatch({ property_name: propName || null });
      try {
        await fetch('/api/update-task-fields', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId,
            fields: { property_name: propName || null },
          }),
        });
        onTaskUpdated?.();
      } catch (err) {
        console.error('[TaskDetailOverlay] property change failed:', err);
      }
    },
    [effectiveTask, onTaskUpdated, updateLocalPatch]
  );

  const handleSaveTaskForm = useCallback(
    async (formData: Record<string, unknown>) => {
      if (!effectiveTask) return;
      const taskId = effectiveTask.task_id;
      try {
        await fetch('/api/save-task-form', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, formData }),
        });
      } catch (err) {
        console.error('[TaskDetailOverlay] form save failed:', err);
      }
    },
    [effectiveTask]
  );

  const handleDeleteTask = useCallback(
    async (project: Project) => {
      try {
        const res = await fetch(`/api/tasks-for-bin/${project.id}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          onClose();
          onTaskUpdated?.();
        }
      } catch (err) {
        console.error('[TaskDetailOverlay] delete failed:', err);
      }
    },
    [onClose, onTaskUpdated]
  );

  // Project shape the panel consumes. Derived from effectiveTask (with patch
  // applied) so field edits reflect immediately.
  const taskAsProject: Project | null = useMemo(() => {
    const t = effectiveTask;
    if (!t) return null;
    return {
      id: t.task_id,
      property_name: t.property_name || null,
      bin_id: t.bin_id || null,
      is_binned: t.is_binned,
      template_id: t.template_id || null,
      template_name: t.template_name || null,
      title: t.title || t.template_name || 'Task',
      description: (t.description as Project['description']) || null,
      status: (t.status || 'not_started') as Project['status'],
      priority: (t.priority || 'medium') as Project['priority'],
      department_id: t.department_id || null,
      department_name: t.department_name || null,
      scheduled_date: t.scheduled_date || null,
      scheduled_time: t.scheduled_time || null,
      reservation_id: t.reservation_id || null,
      form_metadata: t.form_metadata || undefined,
      project_assignments: t.assigned_users.map((u) => ({
        user_id: u.user_id,
        user: {
          id: u.user_id,
          name: u.name,
          avatar: u.avatar,
          role: u.role,
        } as any,
      })),
      created_at: t.created_at || '',
      updated_at: t.updated_at || '',
    } as Project;
  }, [effectiveTask]);

  if (!task || !taskAsProject || !editingFields) {
    return null;
  }

  const resolvedTemplate = task.template_id
    ? ((taskTemplates[`${task.template_id}__${task.property_name}`] as Template) ||
        (taskTemplates[task.template_id] as Template) ||
        undefined)
    : undefined;

  // Mobile: render the native mobile detail sheet (fixed inset-0, owns its
  // own chrome). MobileProjectDetail encapsulates comments/attachments/time
  // tracking internally, so we feed it just the editable props; our
  // handleSaveFields routes field + assignment diffs through the right
  // endpoints when it receives the fresh fields.
  if (isMobile) {
    return (
      <MobileProjectDetail
        project={taskAsProject}
        users={users}
        onClose={onClose}
        onSave={async (_projectId, nextFields) => {
          await handleSaveFields(nextFields);
          return taskAsProject;
        }}
        onDelete={handleDeleteTask}
        allProperties={allProperties}
        onPropertyChange={handlePropertyChange}
        bins={binsHook.bins}
        onBinChange={async (binId) => {
          updateLocalPatch({ bin_id: binId || null });
          try {
            await fetch('/api/update-task-fields', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                taskId: task.task_id,
                fields: { bin_id: binId || null },
              }),
            });
            binsHook.fetchBins();
            onTaskUpdated?.();
          } catch (err) {
            console.error('[TaskDetailOverlay] bin change failed:', err);
          }
        }}
        onIsBinnedChange={async (isBinned) => {
          const patch: Partial<OverlayTaskInput> = { is_binned: isBinned };
          if (!isBinned) patch.bin_id = null;
          updateLocalPatch(patch);
          try {
            const fields: Record<string, unknown> = { is_binned: isBinned };
            if (!isBinned) fields.bin_id = null;
            await fetch('/api/update-task-fields', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId: task.task_id, fields }),
            });
            binsHook.fetchBins();
            onTaskUpdated?.();
          } catch (err) {
            console.error('[TaskDetailOverlay] is_binned change failed:', err);
          }
        }}
        template={resolvedTemplate ?? null}
        formMetadata={task.form_metadata ?? undefined}
        onSaveForm={handleSaveTaskForm}
        loadingTemplate={!!task.template_id && loadingTaskTemplate === task.template_id}
        availableTemplates={availableTemplates}
        onTemplateChange={handleTemplateChange}
      />
    );
  }

  return (
    <>
      <div className={DESKTOP_DETAIL_PANEL_FLEX}>
        <ProjectDetailPanel
          project={taskAsProject}
          editingFields={editingFields}
          setEditingFields={setEditingFields}
          users={users}
          allProperties={allProperties}
          savingEdit={savingEdit}
          onSave={handleSaveFields}
          onDelete={handleDeleteTask}
          onClose={onClose}
          onOpenActivity={() => {}}
          onPropertyChange={handlePropertyChange}
          staffOpen={staffOpen}
          setStaffOpen={setStaffOpen}
          template={resolvedTemplate}
          formMetadata={task.form_metadata ?? undefined}
          onSaveForm={handleSaveTaskForm}
          loadingTemplate={!!task.template_id && loadingTaskTemplate === task.template_id}
          currentUser={currentUser}
          comments={commentsHook.projectComments}
          loadingComments={commentsHook.loadingComments}
          newComment={newComment}
          setNewComment={setNewComment}
          postingComment={commentsHook.postingComment}
          onPostComment={async () => {
            if (newComment.trim()) {
              await commentsHook.postProjectComment(
                task.task_id,
                newComment,
                'task'
              );
              setNewComment('');
            }
          }}
          attachments={attachmentsHook.projectAttachments}
          loadingAttachments={attachmentsHook.loadingAttachments}
          uploadingAttachment={attachmentsHook.uploadingAttachment}
          attachmentInputRef={attachmentsHook.attachmentInputRef}
          onAttachmentUpload={(e) => {
            attachmentsHook.handleAttachmentUpload(e, task.task_id, 'task');
          }}
          onViewAttachment={(index) => setViewingAttachmentIndex(index)}
          activeTimeEntry={timeTrackingHook.activeTimeEntry}
          displaySeconds={timeTrackingHook.displaySeconds}
          formatTime={timeTrackingHook.formatTime}
          onStartTimer={() => {
            timeTrackingHook.startProjectTimer(task.task_id, 'task');
          }}
          onStopTimer={timeTrackingHook.stopProjectTimer}
          availableTemplates={availableTemplates}
          onTemplateChange={handleTemplateChange}
          bins={binsHook.bins}
          onBinChange={async (binId) => {
            updateLocalPatch({ bin_id: binId || null });
            try {
              await fetch('/api/update-task-fields', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  taskId: task.task_id,
                  fields: { bin_id: binId || null },
                }),
              });
              binsHook.fetchBins();
              onTaskUpdated?.();
            } catch (err) {
              console.error('[TaskDetailOverlay] bin change failed:', err);
            }
          }}
          onIsBinnedChange={async (isBinned) => {
            const patch: Partial<OverlayTaskInput> = { is_binned: isBinned };
            if (!isBinned) patch.bin_id = null;
            updateLocalPatch(patch);
            try {
              const fields: Record<string, unknown> = { is_binned: isBinned };
              if (!isBinned) fields.bin_id = null;
              await fetch('/api/update-task-fields', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId: task.task_id, fields }),
              });
              binsHook.fetchBins();
              onTaskUpdated?.();
            } catch (err) {
              console.error('[TaskDetailOverlay] is_binned change failed:', err);
            }
          }}
        />
      </div>

      <AttachmentLightbox
        attachments={attachmentsHook.projectAttachments}
        viewingIndex={viewingAttachmentIndex}
        onClose={() => setViewingAttachmentIndex(null)}
        onNavigate={setViewingAttachmentIndex}
      />
    </>
  );
}
