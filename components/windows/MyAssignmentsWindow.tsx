'use client';

import { memo, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/authContext';
import { useDepartments } from '@/lib/departmentsContext';
import { getDepartmentIcon } from '@/lib/departmentIcons';
import { useProjectComments } from '@/lib/hooks/useProjectComments';
import { useProjectAttachments } from '@/lib/hooks/useProjectAttachments';
import { useProjectTimeTracking } from '@/lib/hooks/useProjectTimeTracking';
import { useProjectBins } from '@/lib/hooks/useProjectBins';
import type { User, Project, ProjectFormFields, TaskTemplate, PropertyOption } from '@/lib/types';
import type { Template } from '@/components/DynamicCleaningForm';
import { ProjectDetailPanel, AttachmentLightbox } from './projects';
import { TaskRow } from '@/components/tasks/TaskRow';

interface Assignee {
  user_id: string;
  name: string;
  avatar: string | null;
}

interface UnifiedItem {
  key: string;
  source: 'task' | 'project';
  title: string;
  property_name: string;
  status: string;
  priority: string;
  department_id: string | null;
  department_name: string | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  type?: string;
  assignees: Assignee[];
  bin_id: string | null;
  bin_name: string | null;
  is_binned: boolean;
  comment_count: number;
  raw: any;
}

interface DateGroup {
  label: string;
  sublabel?: string;
  items: UnifiedItem[];
}

interface MyAssignmentsWindowProps {
  users: User[];
  currentUser: User | null;
}

function MyAssignmentsWindowContent({ users, currentUser }: MyAssignmentsWindowProps) {
  const { departments: allDepts } = useDepartments();
  const [rawData, setRawData] = useState<{ tasks: any[]; projects: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [selectedItem, setSelectedItem] = useState<UnifiedItem | null>(null);

  // Detail panel state (mirrors TasksWindow pattern)
  const [editingFields, setEditingFields] = useState<ProjectFormFields | null>(null);
  const editingFieldsRef = useRef<ProjectFormFields | null>(null);
  const [staffOpen, setStaffOpen] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [viewingAttachmentIndex, setViewingAttachmentIndex] = useState<number | null>(null);
  const [availableTemplates, setAvailableTemplates] = useState<TaskTemplate[]>([]);
  const [allProperties, setAllProperties] = useState<PropertyOption[]>([]);
  const [taskTemplates, setTaskTemplates] = useState<Record<string, Template>>({});
  const [loadingTaskTemplate, setLoadingTaskTemplate] = useState<string | null>(null);

  const commentsHook = useProjectComments({ currentUser });
  const attachmentsHook = useProjectAttachments({ currentUser });
  const timeTrackingHook = useProjectTimeTracking({ currentUser });
  const binsHook = useProjectBins({ currentUser });

  useEffect(() => {
    editingFieldsRef.current = editingFields;
  }, [editingFields]);

  // Fetch properties list on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/properties');
        const result = await res.json();
        if (res.ok && result.properties) setAllProperties(result.properties);
      } catch (err) {
        console.error('Error fetching properties:', err);
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
      const data = await res.json();
      if (data.template) {
        setTaskTemplates(prev => ({ ...prev, [cacheKey]: data.template }));
        return data.template;
      }
    } catch (err) {
      console.error('Error fetching template:', err);
    } finally {
      setLoadingTaskTemplate(null);
    }
    return null;
  }, [taskTemplates]);

  // Update selectedItem.raw locally for instant UI feedback
  const updateSelectedRaw = useCallback((patch: Record<string, any>) => {
    setSelectedItem(prev => {
      if (!prev) return prev;
      return { ...prev, raw: { ...prev.raw, ...patch } };
    });
  }, []);

  // Fetch assignments
  const fetchAssignments = useCallback(async () => {
    if (!currentUser?.id) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/my-assignments?user_id=${currentUser.id}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to fetch assignments');
      setRawData({ tasks: result.tasks || [], projects: result.projects || [] });
    } catch (err: any) {
      console.error('Error fetching assignments:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    if (currentUser?.id) fetchAssignments();
  }, [currentUser?.id, fetchAssignments]);

  // Unify items
  const items = useMemo((): UnifiedItem[] => {
    if (!rawData) return [];
    const result: UnifiedItem[] = [];
    for (const task of rawData.tasks) {
      result.push({
        key: `task-${task.task_id}`,
        source: 'task',
        title: task.title || task.template_name || 'Unnamed Task',
        property_name: task.property_name || '',
        status: task.status || 'not_started',
        priority: task.priority || 'medium',
        department_id: task.department_id || null,
        department_name: task.department_name || null,
        scheduled_date: task.scheduled_date,
        scheduled_time: task.scheduled_time,
        type: task.type,
        assignees: (task.assigned_users || []).map((u: any) => ({
          user_id: u.user_id,
          name: u.name || 'Unknown',
          avatar: u.avatar || null,
        })),
        bin_id: task.bin_id || null,
        bin_name: task.bin_name || null,
        is_binned: !!task.is_binned,
        comment_count: Number(task.comment_count ?? 0),
        raw: task,
      });
    }
    return result;
  }, [rawData]);

  // Group by date
  const { groups, openCount } = useMemo(() => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const endOfWeek = new Date(now);
    const daysUntilSunday = 7 - now.getDay();
    endOfWeek.setDate(now.getDate() + daysUntilSunday);
    const endOfWeekStr = `${endOfWeek.getFullYear()}-${String(endOfWeek.getMonth() + 1).padStart(2, '0')}-${String(endOfWeek.getDate()).padStart(2, '0')}`;

    const overdue: UnifiedItem[] = [];
    const today: UnifiedItem[] = [];
    const thisWeek: UnifiedItem[] = [];
    const later: UnifiedItem[] = [];
    const unscheduled: UnifiedItem[] = [];
    let open = 0;

    for (const item of items) {
      if (item.status === 'complete') continue;
      open++;
      const d = item.scheduled_date;
      if (!d) {
        unscheduled.push(item);
      } else if (d === todayStr) {
        today.push(item);
      } else if (d > todayStr && d <= endOfWeekStr) {
        thisWeek.push(item);
      } else if (d > endOfWeekStr) {
        later.push(item);
      } else {
        overdue.push(item);
      }
    }

    const statusOrder: Record<string, number> = { in_progress: 0, paused: 1, not_started: 2 };
    const sortItems = (a: UnifiedItem, b: UnifiedItem, dateAsc = true) => {
      const da = a.scheduled_date || '';
      const db = b.scheduled_date || '';
      if (da !== db) return dateAsc ? da.localeCompare(db) : db.localeCompare(da);
      const sa = statusOrder[a.status] ?? 3;
      const sb = statusOrder[b.status] ?? 3;
      if (sa !== sb) return sa - sb;
      return (a.scheduled_time || '').localeCompare(b.scheduled_time || '');
    };
    overdue.sort((a, b) => sortItems(a, b, false));
    today.sort((a, b) => sortItems(a, b));
    thisWeek.sort((a, b) => sortItems(a, b));
    later.sort((a, b) => sortItems(a, b));
    unscheduled.sort((a, b) => {
      const sa = statusOrder[a.status] ?? 3;
      const sb = statusOrder[b.status] ?? 3;
      return sa - sb;
    });

    const result: DateGroup[] = [];
    if (overdue.length > 0) result.push({ label: 'Overdue', sublabel: `${overdue.length}`, items: overdue });
    if (today.length > 0) result.push({ label: 'Today', sublabel: `${today.length} scheduled`, items: today });
    if (thisWeek.length > 0) result.push({ label: 'This week', sublabel: `${thisWeek.length} scheduled`, items: thisWeek });
    if (later.length > 0) result.push({ label: 'Later', sublabel: `${later.length} scheduled`, items: later });
    if (unscheduled.length > 0) result.push({ label: 'No Date', sublabel: `${unscheduled.length}`, items: unscheduled });

    return { groups: result, openCount: open };
  }, [items]);

  const todayFormatted = useMemo(() => {
    const now = new Date();
    const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
    const month = now.toLocaleDateString('en-US', { month: 'short' });
    const day = now.getDate();
    return `${weekday} · ${month} ${day}`;
  }, []);

  // --- Detail panel wiring (mirrors TasksWindow) ---
  useEffect(() => {
    if (selectedItem) {
      const raw = selectedItem.raw;
      setEditingFields({
        title: raw.title || raw.template_name || 'Task',
        description: raw.description || null,
        status: raw.status || 'not_started',
        priority: raw.priority || 'medium',
        assigned_staff: (raw.assigned_users || []).map((u: any) => u.user_id),
        department_id: raw.department_id || '',
        scheduled_date: raw.scheduled_date || '',
        scheduled_time: raw.scheduled_time || '',
      });
      const taskId = raw.task_id || raw.id;
      const entityType = selectedItem.source === 'task' ? 'task' : 'project';
      commentsHook.fetchProjectComments(taskId, entityType);
      attachmentsHook.fetchProjectAttachments(taskId, entityType);
      timeTrackingHook.fetchProjectTimeEntries(taskId, entityType);
      if (raw.template_id) {
        const propName = raw.property_name || undefined;
        fetchTaskTemplate(raw.template_id, propName);
      }
    } else {
      setEditingFields(null);
      setStaffOpen(false);
      setNewComment('');
      commentsHook.clearComments();
      attachmentsHook.clearAttachments();
      timeTrackingHook.clearTimeTracking();
    }
  }, [selectedItem?.key]);

  useEffect(() => {
    if (selectedItem && availableTemplates.length === 0) {
      (async () => {
        try {
          const res = await fetch('/api/tasks');
          const result = await res.json();
          if (res.ok && result.data) setAvailableTemplates(result.data);
        } catch (err) {
          console.error('Error fetching templates:', err);
        }
      })();
    }
  }, [selectedItem?.key]);

  const handleSaveFields = useCallback(async () => {
    if (!selectedItem) return;
    const fields = editingFieldsRef.current;
    if (!fields) return;
    const raw = selectedItem.raw;
    const taskId = raw.task_id || raw.id;

    const fieldUpdates: Record<string, unknown> = {};
    if (fields.status !== (raw.status || 'not_started')) fieldUpdates.status = fields.status;
    if (fields.title !== (raw.title || raw.template_name || 'Task')) fieldUpdates.title = fields.title;
    if (JSON.stringify(fields.description) !== JSON.stringify(raw.description || null)) fieldUpdates.description = fields.description;
    if (fields.priority !== (raw.priority || 'medium')) fieldUpdates.priority = fields.priority;
    if (fields.department_id !== (raw.department_id || '')) fieldUpdates.department_id = fields.department_id || null;
    if (fields.scheduled_date !== (raw.scheduled_date || '')) fieldUpdates.scheduled_date = fields.scheduled_date || null;
    if (fields.scheduled_time !== (raw.scheduled_time || '')) fieldUpdates.scheduled_time = fields.scheduled_time || null;

    if (Object.keys(fieldUpdates).length > 0) {
      updateSelectedRaw(fieldUpdates);
      try {
        await fetch('/api/update-task-fields', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, fields: fieldUpdates }),
        });
        fetchAssignments();
      } catch (err) {
        console.error('Error updating task fields:', err);
      }
    }
  }, [selectedItem, fetchAssignments, updateSelectedRaw]);

  const handleTemplateChange = useCallback(async (templateId: string | null) => {
    if (!selectedItem) return;
    const taskId = selectedItem.raw.task_id || selectedItem.raw.id;
    const templateName = templateId
      ? availableTemplates.find(t => t.id === templateId)?.name || null
      : null;
    updateSelectedRaw({ template_id: templateId || null, template_name: templateName });
    try {
      await fetch('/api/update-task-fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, fields: { template_id: templateId || null } }),
      });
      if (templateId) {
        fetchTaskTemplate(templateId, selectedItem.raw.property_name || undefined);
      }
      fetchAssignments();
    } catch (err) {
      console.error('Error changing template:', err);
    }
  }, [selectedItem, fetchTaskTemplate, fetchAssignments, updateSelectedRaw, availableTemplates]);

  const handlePropertyChange = useCallback(async (_propertyId: string | null, propertyName: string | null) => {
    if (!selectedItem) return;
    const taskId = selectedItem.raw.task_id || selectedItem.raw.id;
    updateSelectedRaw({ property_name: propertyName || null });
    try {
      await fetch('/api/update-task-fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, fields: { property_name: propertyName || null } }),
      });
      fetchAssignments();
    } catch (err) {
      console.error('Error updating property:', err);
    }
  }, [selectedItem, fetchAssignments, updateSelectedRaw]);

  const handleSaveTaskForm = useCallback(async (formData: Record<string, unknown>) => {
    if (!selectedItem) return;
    const taskId = selectedItem.raw.task_id || selectedItem.raw.id;
    try {
      await fetch('/api/save-task-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, formData }),
      });
    } catch (err) {
      console.error('Error saving form:', err);
    }
  }, [selectedItem]);

  const itemAsProject: Project | null = selectedItem ? {
    id: selectedItem.raw.task_id || selectedItem.raw.id,
    property_name: selectedItem.raw.property_name || null,
    bin_id: selectedItem.raw.bin_id || null,
    is_binned: selectedItem.raw.is_binned ?? false,
    template_id: selectedItem.raw.template_id || null,
    template_name: selectedItem.raw.template_name || null,
    title: selectedItem.raw.title || selectedItem.raw.template_name || 'Task',
    description: selectedItem.raw.description || null,
    status: (selectedItem.raw.status || 'not_started') as Project['status'],
    priority: (selectedItem.raw.priority || 'medium') as Project['priority'],
    department_id: selectedItem.raw.department_id || null,
    department_name: selectedItem.raw.department_name || null,
    scheduled_date: selectedItem.raw.scheduled_date || null,
    scheduled_time: selectedItem.raw.scheduled_time || null,
    form_metadata: selectedItem.raw.form_metadata || undefined,
    project_assignments: (selectedItem.raw.assigned_users || []).map((u: any) => ({
      user_id: u.user_id,
      user: { id: u.user_id, name: u.name, avatar: u.avatar, role: u.role }
    })),
    created_at: selectedItem.raw.created_at || '',
    updated_at: selectedItem.raw.updated_at || '',
  } : null;

  // --- Render ---
  return (
    <div className="flex h-full overflow-hidden">
      {/* Assignment list */}
      <div className={`${selectedItem ? 'w-1/2' : 'w-full'} flex flex-col min-w-0 transition-all`}>
        {/* Header */}
        <div className="flex-shrink-0 px-8 pt-6 pb-4">
          <h1 className="text-[24px] font-semibold tracking-tight text-neutral-900 dark:text-[#f0efed]">
            My Assignments
          </h1>
          <div className="flex items-center gap-3 mt-1.5 text-[12px] text-neutral-500 dark:text-[#66645f] uppercase tracking-[0.04em] font-medium">
            <span>{todayFormatted}</span>
            <span className="w-[3px] h-[3px] rounded-full bg-neutral-300 dark:bg-[#3e3d3a]" />
            <span>{openCount} open</span>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-7 h-7 border-2 border-neutral-400 dark:border-[#66645f] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-16">
              <p className="text-neutral-500 dark:text-[#a09e9a] text-sm">{error}</p>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <p className="text-neutral-600 dark:text-[#a09e9a] font-medium">No tasks assigned</p>
              <p className="text-sm text-neutral-500 dark:text-[#66645f] mt-1">You&apos;re all caught up</p>
            </div>
          ) : (
            <div className="px-8 pb-8">
              {groups.map((group) => {
                const isCollapsed = collapsedSections.has(group.label);
                return (
                  <div key={group.label} className="pt-5">
                    {/* Section header */}
                    <button
                      onClick={() => setCollapsedSections(prev => {
                        const next = new Set(prev);
                        if (next.has(group.label)) next.delete(group.label);
                        else next.add(group.label);
                        return next;
                      })}
                      className="flex items-center justify-between w-full mb-3"
                    >
                      <div className="flex items-center gap-1.5">
                        <svg
                          className={`w-3 h-3 text-neutral-400 dark:text-[#66645f] transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                          fill="none" stroke="currentColor" viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
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

                    {/* Assignment rows */}
                    {!isCollapsed && (
                      <div className="flex flex-col">
                        {group.items.map((item, idx) => {
                          const dept = allDepts.find(d => d.id === item.department_id);
                          const DeptIcon = getDepartmentIcon(dept?.icon);
                          const isSelected = selectedItem?.key === item.key;
                          return (
                            <TaskRow
                              key={item.key}
                              item={item}
                              selected={isSelected}
                              isLast={idx === group.items.length - 1}
                              onClick={() => setSelectedItem(isSelected ? null : item)}
                              showBinPill
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
      </div>

      {/* Detail panel */}
      {selectedItem && itemAsProject && editingFields && (() => {
        const raw = selectedItem.raw;
        const propName = raw.property_name || undefined;
        const resolvedTemplate = raw.template_id
          ? (taskTemplates[`${raw.template_id}__${propName}`] as Template
            || taskTemplates[raw.template_id] as Template
            || undefined)
          : undefined;

        return (
        <div className="w-1/2 border-l border-[rgba(30,25,20,0.08)] dark:border-white/10 bg-white dark:bg-white/[0.03] flex-shrink-0">
          <ProjectDetailPanel
            project={itemAsProject}
            editingFields={editingFields}
            setEditingFields={setEditingFields}
            users={users}
            allProperties={allProperties}
            savingEdit={false}
            onSave={handleSaveFields}
            onDelete={() => { setSelectedItem(null); fetchAssignments(); }}
            onClose={() => setSelectedItem(null)}
            onOpenActivity={() => {}}
            onPropertyChange={handlePropertyChange}
            staffOpen={staffOpen}
            setStaffOpen={setStaffOpen}
            template={resolvedTemplate}
            formMetadata={raw.form_metadata ?? undefined}
            onSaveForm={handleSaveTaskForm}
            loadingTemplate={loadingTaskTemplate === raw.template_id}
            currentUser={currentUser}
            comments={commentsHook.projectComments}
            loadingComments={commentsHook.loadingComments}
            newComment={newComment}
            setNewComment={setNewComment}
            postingComment={commentsHook.postingComment}
            onPostComment={async () => {
              if (selectedItem && newComment.trim()) {
                const taskId = raw.task_id || raw.id;
                const entityType = selectedItem.source === 'task' ? 'task' : 'project';
                await commentsHook.postProjectComment(taskId, newComment, entityType);
                setNewComment('');
              }
            }}
            attachments={attachmentsHook.projectAttachments}
            loadingAttachments={attachmentsHook.loadingAttachments}
            uploadingAttachment={attachmentsHook.uploadingAttachment}
            attachmentInputRef={attachmentsHook.attachmentInputRef}
            onAttachmentUpload={(e) => {
              if (selectedItem) {
                const taskId = raw.task_id || raw.id;
                const entityType = selectedItem.source === 'task' ? 'task' : 'project';
                attachmentsHook.handleAttachmentUpload(e, taskId, entityType);
              }
            }}
            onViewAttachment={(index) => setViewingAttachmentIndex(index)}
            activeTimeEntry={timeTrackingHook.activeTimeEntry}
            displaySeconds={timeTrackingHook.displaySeconds}
            formatTime={timeTrackingHook.formatTime}
            onStartTimer={() => {
              if (selectedItem) {
                const taskId = raw.task_id || raw.id;
                const entityType = selectedItem.source === 'task' ? 'task' : 'project';
                timeTrackingHook.startProjectTimer(taskId, entityType);
              }
            }}
            onStopTimer={timeTrackingHook.stopProjectTimer}
            availableTemplates={availableTemplates}
            onTemplateChange={handleTemplateChange}
            bins={binsHook.bins}
            onBinChange={async (binId) => {
              if (!selectedItem) return;
              const taskId = selectedItem.raw.task_id || selectedItem.raw.id;
              updateSelectedRaw({ bin_id: binId || null });
              try {
                await fetch('/api/update-task-fields', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ taskId, fields: { bin_id: binId || null } }),
                });
                binsHook.fetchBins();
                fetchAssignments();
              } catch (err) {
                console.error('Error updating bin:', err);
              }
            }}
            onIsBinnedChange={async (isBinned) => {
              if (!selectedItem) return;
              const taskId = selectedItem.raw.task_id || selectedItem.raw.id;
              const patch: Record<string, unknown> = { is_binned: isBinned };
              if (!isBinned) patch.bin_id = null;
              updateSelectedRaw(patch);
              try {
                const fields: Record<string, unknown> = { is_binned: isBinned };
                if (!isBinned) fields.bin_id = null;
                await fetch('/api/update-task-fields', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ taskId, fields }),
                });
                binsHook.fetchBins();
                fetchAssignments();
              } catch (err) {
                console.error('Error updating is_binned:', err);
              }
            }}
          />
        </div>
        );
      })()}
      <AttachmentLightbox
        attachments={attachmentsHook.projectAttachments}
        viewingIndex={viewingAttachmentIndex}
        onClose={() => setViewingAttachmentIndex(null)}
        onNavigate={setViewingAttachmentIndex}
      />
    </div>
  );
}

const MyAssignmentsWindow = memo(MyAssignmentsWindowContent);
export default MyAssignmentsWindow;
