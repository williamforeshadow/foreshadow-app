'use client';

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { useDepartments } from '@/lib/departmentsContext';
import { getDepartmentIcon } from '@/lib/departmentIcons';
import { useProjectComments } from '@/lib/hooks/useProjectComments';
import { useProjectAttachments } from '@/lib/hooks/useProjectAttachments';
import { useProjectTimeTracking } from '@/lib/hooks/useProjectTimeTracking';
import { useProjectBins } from '@/lib/hooks/useProjectBins';
import type {
  Project,
  ProjectFormFields,
  TaskTemplate,
  PropertyOption,
  User,
} from '@/lib/types';
import type { Template } from '@/components/DynamicCleaningForm';
import {
  ProjectDetailPanel,
  AttachmentLightbox,
} from '@/components/windows/projects';
import MobileProjectDetail from '@/components/mobile/MobileProjectDetail';
import { TaskRow, TaskListHeader, type TaskRowItem } from '@/components/tasks/TaskRow';
import { MobileTaskRow } from '@/components/tasks/MobileTaskRow';
import { useIsMobile } from '@/lib/useIsMobile';
import { DESKTOP_DETAIL_PANEL_FLEX } from '@/lib/detailPanelGeometry';
import { useExclusiveDetailPanelHost } from '@/lib/reservationViewerContext';
import {
  TaskFilterBar,
  type SortKey,
  type SortDir,
  type FilterOption,
  ORIGIN_MANUAL,
  ORIGIN_AUTOMATED,
} from '@/components/tasks/TaskFilterBar';
import { taskPath } from '@/src/lib/links';

// Property Tasks ledger — shows every task ever linked to the property.
// Curation is done by the user via filter + sort, not by the component. The
// main list renders tasks grouped by scheduled date (Overdue / Today / This
// week / Later / No date / Completed), with a right-side 1/3 detail panel
// that matches the Projects kanban detail width.

// ---- Types ----------------------------------------------------------------

interface RawTask {
  task_id: string;
  reservation_id: string | null;
  property_id: string | null;
  property_name: string | null;
  template_id: string | null;
  template_name: string | null;
  title: string | null;
  // description can be either a legacy plain-text string or a Tiptap JSON doc;
  // we keep it loose here and let the detail panel figure it out (same as
  // MyAssignmentsWindow, which treats raw as `any`).
  description: any;
  priority: string;
  department_id: string | null;
  department_name: string | null;
  status: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  form_metadata: Record<string, unknown> | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  bin_id: string | null;
  bin_name: string | null;
  bin_is_system: boolean;
  is_binned: boolean;
  is_automated: boolean;
  guest_name: string | null;
  check_in: string | null;
  check_out: string | null;
  assigned_users: {
    user_id: string;
    name: string;
    avatar: string | null;
    role: string;
  }[];
  comment_count: number;
}

interface UnifiedItem extends TaskRowItem {
  raw: RawTask;
  source: 'task';
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface DateGroup {
  id: string;
  label: string;
  sublabel?: string;
  items: UnifiedItem[];
  defaultCollapsed?: boolean;
}

// ---- URL persistence ------------------------------------------------------

const URL_KEYS = {
  search: 'q',
  status: 'status',
  assignee: 'assignee',
  department: 'dept',
  bin: 'bin',
  origin: 'origin',
  sortKey: 'sort',
  sortDir: 'dir',
} as const;

function parseSet(raw: string | null): Set<string> {
  if (!raw) return new Set();
  return new Set(raw.split(',').filter(Boolean));
}

function serializeSet(set: Set<string>): string | null {
  return set.size === 0 ? null : Array.from(set).join(',');
}

// ---- Date bucketing -------------------------------------------------------

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

// ---- Component ------------------------------------------------------------

interface PropertyTasksViewProps {
  propertyId: string;
  propertyName: string;
}

function PropertyTasksViewContent({
  propertyId,
  propertyName,
}: PropertyTasksViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user: authUser, allUsers } = useAuth();
  const { departments: allDepts } = useDepartments();
  const isMobile = useIsMobile();

  // The detail panel props type `User[]` from lib/types; AppUser is
  // structurally compatible for the fields used. Cast once at the boundary.
  const users = allUsers as unknown as User[];
  const currentUser = authUser as unknown as User | null;

  // ---- Filter / sort state (URL-persisted) --------------------------------

  const [search, setSearch] = useState(
    () => searchParams?.get(URL_KEYS.search) || ''
  );
  const [statusSelected, setStatusSelected] = useState<Set<string>>(() =>
    parseSet(searchParams?.get(URL_KEYS.status) || null)
  );
  const [assigneeSelected, setAssigneeSelected] = useState<Set<string>>(() =>
    parseSet(searchParams?.get(URL_KEYS.assignee) || null)
  );
  const [departmentSelected, setDepartmentSelected] = useState<Set<string>>(() =>
    parseSet(searchParams?.get(URL_KEYS.department) || null)
  );
  const [binSelected, setBinSelected] = useState<Set<string>>(() =>
    parseSet(searchParams?.get(URL_KEYS.bin) || null)
  );
  const [originSelected, setOriginSelected] = useState<Set<string>>(() =>
    parseSet(searchParams?.get(URL_KEYS.origin) || null)
  );
  const [prioritySelected, setPrioritySelected] = useState<Set<string>>(() =>
    parseSet(searchParams?.get('priority') || null)
  );
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const v = searchParams?.get(URL_KEYS.sortKey);
    return v === 'completed' || v === 'created' || v === 'updated' || v === 'priority'
      ? v
      : 'scheduled';
  });
  const [sortDir, setSortDir] = useState<SortDir>(() => {
    const v = searchParams?.get(URL_KEYS.sortDir);
    return v === 'asc' ? 'asc' : 'desc';
  });

  // Sync state → URL (replace, don't push, so back button isn't polluted).
  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set(URL_KEYS.search, search);
    const status = serializeSet(statusSelected);
    if (status) params.set(URL_KEYS.status, status);
    const assignee = serializeSet(assigneeSelected);
    if (assignee) params.set(URL_KEYS.assignee, assignee);
    const dept = serializeSet(departmentSelected);
    if (dept) params.set(URL_KEYS.department, dept);
    const bin = serializeSet(binSelected);
    if (bin) params.set(URL_KEYS.bin, bin);
    const origin = serializeSet(originSelected);
    if (origin) params.set(URL_KEYS.origin, origin);
    const priority = serializeSet(prioritySelected);
    if (priority) params.set('priority', priority);
    if (sortKey !== 'scheduled') params.set(URL_KEYS.sortKey, sortKey);
    if (sortDir !== 'desc') params.set(URL_KEYS.sortDir, sortDir);

    const qs = params.toString();
    const href = qs ? `?${qs}` : window.location.pathname;
    router.replace(href as any, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    search,
    statusSelected,
    assigneeSelected,
    departmentSelected,
    binSelected,
    originSelected,
    prioritySelected,
    sortKey,
    sortDir,
  ]);

  // ---- Data fetch ---------------------------------------------------------

  const [rawTasks, setRawTasks] = useState<RawTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/properties/${propertyId}/tasks`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch tasks');
      setRawTasks(data.tasks || []);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch tasks');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Supporting data for the detail panel (properties list, templates list).
  const [allProperties, setAllProperties] = useState<PropertyOption[]>([]);
  const [availableTemplates, setAvailableTemplates] = useState<TaskTemplate[]>([]);
  const [taskTemplates, setTaskTemplates] = useState<Record<string, Template>>({});
  const [loadingTaskTemplate, setLoadingTaskTemplate] = useState<string | null>(null);

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
    (async () => {
      try {
        const res = await fetch('/api/tasks');
        const result = await res.json();
        if (res.ok && result.data) setAvailableTemplates(result.data);
      } catch (err) {
        console.error('Error fetching templates:', err);
      }
    })();
  }, []);

  const fetchTaskTemplate = useCallback(
    async (templateId: string, propName?: string) => {
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
          return data.template;
        }
      } catch (err) {
        console.error('Error fetching template:', err);
      } finally {
        setLoadingTaskTemplate(null);
      }
      return null;
    },
    [taskTemplates]
  );

  // ---- Derived: unified items, filter options ---------------------------

  const allItems: UnifiedItem[] = useMemo(() => {
    return rawTasks.map((task) => ({
      key: `task-${task.task_id}`,
      source: 'task' as const,
      title: task.title || task.template_name || 'Untitled Task',
      property_name: task.property_name || propertyName,
      status: task.status || 'not_started',
      priority: task.priority || 'medium',
      department_id: task.department_id,
      department_name: task.department_name,
      scheduled_date: task.scheduled_date,
      scheduled_time: task.scheduled_time,
      assignees: task.assigned_users.map((u) => ({
        user_id: u.user_id,
        name: u.name,
        avatar: u.avatar,
      })),
      bin_id: task.bin_id,
      bin_name: task.bin_name,
      is_binned: task.is_binned,
      is_automated: task.is_automated,
      reservation_id: task.reservation_id,
      comment_count: task.comment_count ?? 0,
      completed_at: task.completed_at,
      created_at: task.created_at,
      updated_at: task.updated_at,
      raw: task,
    }));
  }, [rawTasks, propertyName]);

  // Filter option lists (computed from the full set so users can discover all
  // available values even if their current filter hides them).
  const statusOptions: FilterOption[] = useMemo(() => {
    const counts: Record<string, number> = {};
    allItems.forEach((i) => {
      counts[i.status] = (counts[i.status] || 0) + 1;
    });
    return [
      { value: 'not_started', label: 'Not started', count: counts.not_started },
      { value: 'in_progress', label: 'In progress', count: counts.in_progress },
      { value: 'paused', label: 'Paused', count: counts.paused },
      { value: 'complete', label: 'Complete', count: counts.complete },
    ].filter((o) => (o.count ?? 0) > 0 || true);
  }, [allItems]);

  const assigneeOptions: FilterOption[] = useMemo(() => {
    const seen = new Map<string, { name: string; count: number }>();
    allItems.forEach((i) => {
      i.assignees.forEach((a) => {
        const existing = seen.get(a.user_id);
        seen.set(a.user_id, {
          name: a.name,
          count: (existing?.count || 0) + 1,
        });
      });
    });
    return Array.from(seen.entries())
      .map(([id, v]) => ({ value: id, label: v.name, count: v.count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allItems]);

  const departmentOptions: FilterOption[] = useMemo(() => {
    const counts: Record<string, number> = {};
    allItems.forEach((i) => {
      if (i.department_id) {
        counts[i.department_id] = (counts[i.department_id] || 0) + 1;
      }
    });
    return Object.entries(counts)
      .map(([id, count]) => ({
        value: id,
        label: allDepts.find((d) => d.id === id)?.name || 'Unknown dept',
        count,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allItems, allDepts]);

  // Bin filter options:
  //   1. Not binned
  //   2. All binned tasks (matches is_binned=true; orphan binned tasks with
  //      no bin_id are implicitly included here — that's exactly how the
  //      system "All Binned Tasks" bin behaves in the Bins tab)
  //   3. Each named bin, counted by bin_id
  // No separate "any bin" / "orphan" entries — those collapsed into #2.
  const binOptions: FilterOption[] = useMemo(() => {
    const namedCounts: Record<string, { name: string; count: number }> = {};
    let notBinnedCount = 0;
    let allBinnedCount = 0;
    allItems.forEach((i) => {
      if (!i.is_binned) {
        notBinnedCount++;
        return;
      }
      allBinnedCount++;
      if (i.bin_id) {
        const existing = namedCounts[i.bin_id];
        namedCounts[i.bin_id] = {
          name: i.bin_name || 'Bin',
          count: (existing?.count || 0) + 1,
        };
      }
    });
    return [
      { value: '__none__', label: 'Not binned', count: notBinnedCount },
      { value: '__any__', label: 'All binned tasks', count: allBinnedCount },
      ...Object.entries(namedCounts)
        .map(([id, v]) => ({ value: id, label: v.name, count: v.count }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [allItems]);

  // Origin filter options. Empty set == both selected == "no filter".
  const originOptions: FilterOption[] = useMemo(() => {
    let manual = 0;
    let automated = 0;
    allItems.forEach((i) => {
      if (i.is_automated) automated++;
      else manual++;
    });
    return [
      { value: ORIGIN_MANUAL, label: 'Manual', count: manual },
      { value: ORIGIN_AUTOMATED, label: 'Automated', count: automated },
    ];
  }, [allItems]);

  const priorityOptions: FilterOption[] = useMemo(() => {
    const counts: Record<string, number> = {};
    allItems.forEach((i) => {
      counts[i.priority] = (counts[i.priority] || 0) + 1;
    });
    return [
      { value: 'urgent', label: 'Urgent', count: counts.urgent || 0 },
      { value: 'high', label: 'High', count: counts.high || 0 },
      { value: 'medium', label: 'Medium', count: counts.medium || 0 },
      { value: 'low', label: 'Low', count: counts.low || 0 },
    ];
  }, [allItems]);

  // ---- Filter + sort ------------------------------------------------------

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allItems.filter((item) => {
      if (q) {
        const hay = `${item.title} ${item.raw.description || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusSelected.size > 0 && !statusSelected.has(item.status)) return false;

      if (departmentSelected.size > 0) {
        if (!item.department_id || !departmentSelected.has(item.department_id)) return false;
      }

      if (assigneeSelected.size > 0) {
        if (!item.assignees.some((a) => assigneeSelected.has(a.user_id))) return false;
      }

      if (binSelected.size > 0) {
        const matches = Array.from(binSelected).some((val) => {
          if (val === '__none__') return !item.is_binned;
          if (val === '__any__') return item.is_binned;
          return item.bin_id === val;
        });
        if (!matches) return false;
      }

      // Origin: empty set OR both values selected == no filter. Exactly one
      // selection narrows to manual- or automated-only.
      if (originSelected.size === 1) {
        const wantAutomated = originSelected.has(ORIGIN_AUTOMATED);
        if (wantAutomated !== item.is_automated) return false;
      }

      if (prioritySelected.size > 0 && !prioritySelected.has(item.priority))
        return false;

      return true;
    });
  }, [
    allItems,
    search,
    statusSelected,
    assigneeSelected,
    departmentSelected,
    binSelected,
    originSelected,
    prioritySelected,
  ]);

  const sortedItems = useMemo(() => {
    const arr = [...filteredItems];
    // 'priority' sort uses a numeric ordering (urgent → low) so missing /
    // unknown priorities sort last regardless of direction. All other keys
    // are date strings.
    const PRIORITY_ORDER: Record<string, number> = {
      urgent: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    const keyOf = (i: UnifiedItem): string | number => {
      switch (sortKey) {
        case 'completed':
          return i.completed_at || '';
        case 'created':
          return i.created_at || '';
        case 'updated':
          return i.updated_at || '';
        case 'priority':
          return PRIORITY_ORDER[i.priority] ?? 99;
        case 'scheduled':
        default:
          return `${i.scheduled_date || ''}T${i.scheduled_time || ''}`;
      }
    };
    arr.sort((a, b) => {
      const av = keyOf(a);
      const bv = keyOf(b);
      const aEmpty = av === '' || av === 99;
      const bEmpty = bv === '' || bv === 99;
      if (aEmpty && !bEmpty) return 1;
      if (!aEmpty && bEmpty) return -1;
      if (aEmpty && bEmpty) return 0;
      let cmp = 0;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filteredItems, sortKey, sortDir]);

  // ---- Grouping (respects the current sort; completed goes to own group) --

  const groups = useMemo((): DateGroup[] => {
    const today = todayISO();
    const eow = endOfWeekISO();

    const overdue: UnifiedItem[] = [];
    const todayBucket: UnifiedItem[] = [];
    const thisWeek: UnifiedItem[] = [];
    const later: UnifiedItem[] = [];
    const unscheduled: UnifiedItem[] = [];
    const completed: UnifiedItem[] = [];

    for (const item of sortedItems) {
      if (item.status === 'complete') {
        completed.push(item);
        continue;
      }
      const d = item.scheduled_date;
      if (!d) unscheduled.push(item);
      else if (d < today) overdue.push(item);
      else if (d === today) todayBucket.push(item);
      else if (d <= eow) thisWeek.push(item);
      else later.push(item);
    }

    const out: DateGroup[] = [];
    if (overdue.length)
      out.push({ id: 'overdue', label: 'Overdue', sublabel: `${overdue.length}`, items: overdue });
    if (todayBucket.length)
      out.push({
        id: 'today',
        label: 'Today',
        sublabel: `${todayBucket.length} scheduled`,
        items: todayBucket,
      });
    if (thisWeek.length)
      out.push({
        id: 'thisWeek',
        label: 'This week',
        sublabel: `${thisWeek.length} scheduled`,
        items: thisWeek,
      });
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
  }, [sortedItems]);

  const anyFilterActive = useMemo(
    () =>
      !!search ||
      statusSelected.size > 0 ||
      assigneeSelected.size > 0 ||
      departmentSelected.size > 0 ||
      binSelected.size > 0 ||
      // Only count origin as active when it actually narrows results.
      // Empty set or both values selected = pass-through, so no chip
      // highlight and no "clear" required.
      originSelected.size === 1 ||
      prioritySelected.size > 0,
    [
      search,
      statusSelected,
      assigneeSelected,
      departmentSelected,
      binSelected,
      originSelected,
      prioritySelected,
    ]
  );

  const clearAll = useCallback(() => {
    setSearch('');
    setStatusSelected(new Set());
    setAssigneeSelected(new Set());
    setDepartmentSelected(new Set());
    setBinSelected(new Set());
    setOriginSelected(new Set());
    setPrioritySelected(new Set());
  }, []);

  // Collapsible section state. "Completed" starts collapsed; user toggles are
  // keyed by group.id and remembered for the session.
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

  // ---- Detail panel wiring (mirrors MyAssignmentsWindow pattern) ---------

  const [selectedItem, setSelectedItem] = useState<UnifiedItem | null>(null);
  const [draftTask, setDraftTask] = useState<Project | null>(null);
  const [creatingTask, setCreatingTask] = useState(false);

  // Strict single-panel rule (both directions):
  //   global → local: close our locals when context overlays open
  //   local → global: call closeGlobals() before opening any local panel
  //                   so the new local doesn't render behind a still-open
  //                   context overlay (same z-20 slot).
  const closeGlobals = useExclusiveDetailPanelHost(() => {
    setSelectedItem(null);
    setDraftTask(null);
  });

  const [editingFields, setEditingFields] = useState<ProjectFormFields | null>(null);
  const editingFieldsRef = useRef<ProjectFormFields | null>(null);
  const [staffOpen, setStaffOpen] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [viewingAttachmentIndex, setViewingAttachmentIndex] = useState<number | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const commentsHook = useProjectComments({ currentUser });
  const attachmentsHook = useProjectAttachments({ currentUser });
  const timeTrackingHook = useProjectTimeTracking({ currentUser });
  const binsHook = useProjectBins({ currentUser });

  useEffect(() => {
    editingFieldsRef.current = editingFields;
  }, [editingFields]);

  const updateSelectedRaw = useCallback(
    (patch: Record<string, unknown>) => {
      setSelectedItem((prev) => {
        if (!prev) return prev;
        return { ...prev, raw: { ...prev.raw, ...patch } };
      });
    },
    []
  );

  // Seed editingFields when selection changes. Draft tasks seed from the draft
  // Project shape; real tasks seed from raw.
  useEffect(() => {
    if (draftTask) {
      setEditingFields({
        title: draftTask.title || 'New Task',
        description: draftTask.description || null,
        status: draftTask.status || 'not_started',
        priority: draftTask.priority || 'medium',
        assigned_staff: [],
        department_id: draftTask.department_id || '',
        scheduled_date: draftTask.scheduled_date || '',
        scheduled_time: draftTask.scheduled_time || '',
      });
      commentsHook.clearComments();
      attachmentsHook.clearAttachments();
      timeTrackingHook.clearTimeTracking();
      return;
    }
    if (selectedItem) {
      const raw = selectedItem.raw;
      setEditingFields({
        title: raw.title || raw.template_name || 'Task',
        description: raw.description || null,
        status: raw.status || 'not_started',
        priority: raw.priority || 'medium',
        assigned_staff: raw.assigned_users.map((u) => u.user_id),
        department_id: raw.department_id || '',
        scheduled_date: raw.scheduled_date || '',
        scheduled_time: raw.scheduled_time || '',
      });
      const taskId = raw.task_id;
      commentsHook.fetchProjectComments(taskId, 'task');
      attachmentsHook.fetchProjectAttachments(taskId, 'task');
      timeTrackingHook.fetchProjectTimeEntries(taskId, 'task');
      if (raw.template_id) {
        fetchTaskTemplate(raw.template_id, raw.property_name || undefined);
      }
    } else {
      setEditingFields(null);
      setStaffOpen(false);
      setNewComment('');
      commentsHook.clearComments();
      attachmentsHook.clearAttachments();
      timeTrackingHook.clearTimeTracking();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItem?.key, draftTask?.id]);

  // ProjectDetailPanel passes fresh fields synchronously when toggling
  // assignees (onSave(f)). Honor `directFields` so we don't read a stale
  // ref, and fan the save out to the right endpoints — same pattern as
  // TimelineWindow's handleSaveTaskEditFields:
  //   /api/update-task-fields      title, description, priority, department_id
  //   /api/update-task-action      status (server-side allow-list on the action)
  //   /api/update-task-schedule    scheduled_date + scheduled_time
  //   /api/update-task-assignment  assignees
  // `/api/update-task-fields`'s server allow-list silently drops status /
  // scheduled_date / scheduled_time, which is why sending those through it
  // used to appear to update the row (optimistic patch) and then revert on
  // reopen. All four endpoints can run in parallel — they touch different
  // DB columns / tables.
  const handleSaveFields = useCallback(
    async (directFields?: ProjectFormFields) => {
      if (!selectedItem) return;
      const fields = directFields ?? editingFieldsRef.current;
      if (!fields) return;
      const raw = selectedItem.raw;
      const taskId = raw.task_id;

      const oldAssignees = raw.assigned_users
        .map((u) => u.user_id)
        .sort()
        .join(',');
      const newAssignees = (fields.assigned_staff || []).slice().sort().join(',');
      const assigneesChanged = oldAssignees !== newAssignees;

      // Plain-field diffs — allowed through /api/update-task-fields.
      const fieldUpdates: Record<string, unknown> = {};
      if (fields.title !== (raw.title || raw.template_name || 'Task'))
        fieldUpdates.title = fields.title;
      if (JSON.stringify(fields.description) !== JSON.stringify(raw.description || null))
        fieldUpdates.description = fields.description;
      if (fields.priority !== (raw.priority || 'medium'))
        fieldUpdates.priority = fields.priority;
      if (fields.department_id !== (raw.department_id || ''))
        fieldUpdates.department_id = fields.department_id || null;

      // Status has its own action endpoint so the server can validate the
      // transition and keep a single write path across the app.
      const oldStatus = raw.status || 'not_started';
      const newStatus = fields.status || 'not_started';
      const statusChanged = newStatus !== oldStatus;

      // Schedule has its own endpoint; compare normalized empty strings.
      const oldDate = raw.scheduled_date || '';
      const oldTime = raw.scheduled_time || '';
      const newDate = fields.scheduled_date || '';
      const newTime = fields.scheduled_time || '';
      const scheduleChanged = newDate !== oldDate || newTime !== oldTime;

      const hasFieldChanges = Object.keys(fieldUpdates).length > 0;
      if (!hasFieldChanges && !assigneesChanged && !statusChanged && !scheduleChanged)
        return;

      setSavingEdit(true);

      // Optimistic local patches so the detail panel + list row reflect
      // the change immediately, before any network round-trip.
      if (hasFieldChanges) updateSelectedRaw(fieldUpdates);
      if (statusChanged) updateSelectedRaw({ status: newStatus });
      if (scheduleChanged)
        updateSelectedRaw({
          scheduled_date: newDate || null,
          scheduled_time: newTime || null,
        });
      if (assigneesChanged) {
        const nextAssignedUsers = (fields.assigned_staff || []).map((uid) => {
          const u = users.find((x) => x.id === uid);
          if (!u) {
            const existing = raw.assigned_users.find((a) => a.user_id === uid);
            return existing || { user_id: uid, name: '', avatar: null, role: '' };
          }
          return {
            user_id: u.id,
            name: u.name || '',
            avatar: u.avatar || null,
            role: u.role || '',
          };
        });
        updateSelectedRaw({ assigned_users: nextAssignedUsers });
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
        fetchTasks();
      } catch (err) {
        console.error('Error updating task fields:', err);
      } finally {
        setSavingEdit(false);
      }
    },
    [selectedItem, fetchTasks, updateSelectedRaw, users]
  );

  const handleTemplateChange = useCallback(
    async (templateId: string | null) => {
      if (!selectedItem) return;
      const taskId = selectedItem.raw.task_id;
      const templateName = templateId
        ? availableTemplates.find((t) => t.id === templateId)?.name || null
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
        fetchTasks();
      } catch (err) {
        console.error('Error changing template:', err);
      }
    },
    [selectedItem, availableTemplates, fetchTaskTemplate, fetchTasks, updateSelectedRaw]
  );

  const handlePropertyChange = useCallback(
    async (_propertyId: string | null, propName: string | null) => {
      if (!selectedItem) return;
      const taskId = selectedItem.raw.task_id;
      updateSelectedRaw({ property_name: propName || null });
      try {
        await fetch('/api/update-task-fields', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, fields: { property_name: propName || null } }),
        });
        fetchTasks();
      } catch (err) {
        console.error('Error updating property:', err);
      }
    },
    [selectedItem, fetchTasks, updateSelectedRaw]
  );

  const handleSaveTaskForm = useCallback(
    async (formData: Record<string, unknown>) => {
      if (!selectedItem) return;
      const taskId = selectedItem.raw.task_id;
      try {
        await fetch('/api/save-task-form', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, formData }),
        });
      } catch (err) {
        console.error('Error saving form:', err);
      }
    },
    [selectedItem]
  );

  const handleDeleteTask = useCallback(
    async (task: Project) => {
      try {
        const res = await fetch(`/api/tasks-for-bin/${task.id}`, { method: 'DELETE' });
        if (res.ok) {
          setSelectedItem(null);
          fetchTasks();
        }
      } catch (err) {
        console.error('Error deleting task:', err);
      }
    },
    [fetchTasks]
  );

  // ---- New task (draft → POST) -------------------------------------------

  const handleNewTask = useCallback((prefilledDate?: string) => {
    const draft: Project = {
      id: `draft-${Date.now()}`,
      property_name: propertyName,
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
      scheduled_date: prefilledDate ?? null,
      scheduled_time: null,
      form_metadata: undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    closeGlobals();
    setSelectedItem(null);
    setDraftTask(draft);
  }, [propertyName, closeGlobals]);

  // The Schedule tab's DayDetailPanel deep-links "New task" here by pushing
  // `?newTaskDate=YYYY-MM-DD`. We pop the draft with that date pre-filled
  // and strip the param so a refresh doesn't re-open the draft.
  useEffect(() => {
    const prefilled = searchParams?.get('newTaskDate');
    if (!prefilled) return;
    handleNewTask(prefilled);
    const current = new URLSearchParams(searchParams?.toString() || '');
    current.delete('newTaskDate');
    const next = current.toString();
    router.replace(
      next ? `?${next}` : `/properties/${propertyId}/tasks`,
      { scroll: false }
    );
    // Intentionally run only when the query param appears (or changes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams?.get('newTaskDate')]);

  // Accept fields either from the ref (desktop ProjectDetailPanel flow) or
  // directly from the caller (MobileProjectDetail passes fields to
  // onConfirmCreate) so both surfaces can share the same create logic.
  const handleConfirmCreateTask = useCallback(
    async (directFields?: ProjectFormFields) => {
      if (!draftTask) return;
      setCreatingTask(true);
      try {
        const fields = directFields ?? editingFieldsRef.current;
        const payload: Record<string, unknown> = {
          title: fields?.title || draftTask.title || 'New Task',
          status: fields?.status || 'not_started',
          priority: fields?.priority || 'medium',
          is_binned: false,
          description: fields?.description || null,
          department_id: fields?.department_id || null,
          scheduled_date: fields?.scheduled_date || null,
          scheduled_time: fields?.scheduled_time || null,
          property_id: propertyId,
          property_name: propertyName,
        };
        if (fields?.assigned_staff?.length) payload.assigned_user_ids = fields.assigned_staff;

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
    [draftTask, propertyId, propertyName, fetchTasks]
  );

  const handleDeleteDraft = useCallback(() => {
    setDraftTask(null);
  }, []);

  // Convert the active selection (real task or draft) into the Project shape
  // that ProjectDetailPanel expects.
  const itemAsProject: Project | null = useMemo(() => {
    if (draftTask) return draftTask;
    if (!selectedItem) return null;
    const raw = selectedItem.raw;
    return {
      id: raw.task_id,
      property_name: raw.property_name || null,
      bin_id: raw.bin_id || null,
      is_binned: raw.is_binned,
      template_id: raw.template_id || null,
      template_name: raw.template_name || null,
      title: raw.title || raw.template_name || 'Task',
      description: raw.description || null,
      status: (raw.status || 'not_started') as Project['status'],
      priority: (raw.priority || 'medium') as Project['priority'],
      department_id: raw.department_id || null,
      department_name: raw.department_name || null,
      scheduled_date: raw.scheduled_date || null,
      scheduled_time: raw.scheduled_time || null,
      reservation_id: raw.reservation_id || null,
      form_metadata: raw.form_metadata || undefined,
      project_assignments: raw.assigned_users.map((u) => ({
        user_id: u.user_id,
        user: {
          id: u.user_id,
          name: u.name,
          avatar: u.avatar,
          role: u.role,
        } as any,
      })),
      created_at: raw.created_at || '',
      updated_at: raw.updated_at || '',
    } as Project;
  }, [selectedItem, draftTask]);

  const openCount = useMemo(
    () => allItems.filter((i) => i.status !== 'complete').length,
    [allItems]
  );

  const detailOpen = selectedItem != null || draftTask != null;

  // ---- Render -------------------------------------------------------------

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      {/* List side — full-width when no detail; 2/3 when detail is open on
          desktop (the detail panel renders as an absolute overlay on the
          outer `/properties` column, anchored by app/properties/layout.tsx
          → `relative`, so it spans from the viewport top past the
          property header). On mobile the detail panel is a full-screen
          sheet, so the list stays at full width underneath. */}
      <div
        className={`${!isMobile && detailOpen ? 'w-2/3' : 'w-full'} flex flex-col min-w-0 transition-all`}
      >
        {/* Header + filters */}
        <div className="flex-shrink-0 border-b border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]">
          <TaskFilterBar
            search={search}
            onSearchChange={setSearch}
            statusOptions={statusOptions}
            statusSelected={statusSelected}
            onStatusChange={setStatusSelected}
            assigneeOptions={assigneeOptions}
            assigneeSelected={assigneeSelected}
            onAssigneeChange={setAssigneeSelected}
            departmentOptions={departmentOptions}
            departmentSelected={departmentSelected}
            onDepartmentChange={setDepartmentSelected}
            binOptions={binOptions}
            binSelected={binSelected}
            onBinChange={setBinSelected}
            originOptions={originOptions}
            originSelected={originSelected}
            onOriginChange={setOriginSelected}
            priorityOptions={priorityOptions}
            prioritySelected={prioritySelected}
            onPriorityChange={setPrioritySelected}
            sortKey={sortKey}
            sortDir={sortDir}
            onSortChange={(k, d) => {
              setSortKey(k);
              setSortDir(d);
            }}
            onClearAll={clearAll}
            anyFilterActive={anyFilterActive}
            onNewTask={handleNewTask}
            totalCount={allItems.length}
            filteredCount={filteredItems.length}
          />
        </div>

        {/* List */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-7 h-7 border-2 border-neutral-400 dark:border-[#66645f] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-16">
              <p className="text-neutral-500 dark:text-[#a09e9a] text-sm">{error}</p>
            </div>
          ) : allItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <p className="text-neutral-600 dark:text-[#a09e9a] font-medium">
                No tasks for this property yet
              </p>
              <p className="text-sm text-neutral-500 dark:text-[#66645f] mt-1">
                Tasks created here or via Hostaway turnovers will appear in this ledger.
              </p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <p className="text-neutral-600 dark:text-[#a09e9a] font-medium">No matches</p>
              <p className="text-sm text-neutral-500 dark:text-[#66645f] mt-1">
                No tasks match your current filters.
              </p>
              <button
                onClick={clearAll}
                className="mt-3 text-[12px] font-medium text-[var(--accent-3)] dark:text-[var(--accent-1)] hover:underline"
              >
                Clear filters
              </button>
              <p className="text-[11px] text-neutral-400 dark:text-[#66645f] mt-2">
                {openCount} open · {allItems.length} total
              </p>
            </div>
          ) : (
            <div className={isMobile ? 'px-5 pb-8' : 'px-8 pb-8'}>
              {/* Column labels are desktop-only — mobile doesn't have the
                  extra assignee/department/bin/comments columns to label. */}
              {!isMobile && (
                <div className="pt-5">
                  <TaskListHeader />
                </div>
              )}
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
                        {group.items.map((item, idx) => {
                          const dept = allDepts.find((d) => d.id === item.department_id);
                          const DeptIcon = getDepartmentIcon(dept?.icon);
                          const isSelected = selectedItem?.key === item.key;
                          const isLast = idx === group.items.length - 1;
                          const handleClick = () => {
                            if (isSelected) {
                              setDraftTask(null);
                              setSelectedItem(null);
                            } else {
                              closeGlobals();
                              setDraftTask(null);
                              setSelectedItem(item);
                            }
                          };
                          if (isMobile) {
                            return (
                              <MobileTaskRow
                                key={item.key}
                                item={item}
                                selected={isSelected}
                                isLast={isLast}
                                onClick={handleClick}
                                hideProperty
                                departmentIcon={DeptIcon}
                              />
                            );
                          }
                          return (
                            <TaskRow
                              key={item.key}
                              item={item}
                              selected={isSelected}
                              isLast={isLast}
                              onClick={handleClick}
                              hideProperty
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

      {/* Detail panel — desktop renders the shared ProjectDetailPanel as
          an absolute right-1/3 overlay anchored to the outer /properties
          column (so it spans from the viewport top past the property
          header). Mobile renders MobileProjectDetail, which owns its own
          `fixed inset-0` full-screen chrome. */}
      {detailOpen && itemAsProject && editingFields && (() => {
        const raw = selectedItem?.raw;
        const resolvedTemplate = raw?.template_id
          ? ((taskTemplates[`${raw.template_id}__${raw.property_name}`] as Template) ||
              (taskTemplates[raw.template_id] as Template) ||
              undefined)
          : undefined;
        const isDraft = draftTask != null;

        if (isMobile) {
          return (
            <MobileProjectDetail
              project={itemAsProject}
              users={users}
              onClose={() => {
                setSelectedItem(null);
                setDraftTask(null);
              }}
              onSave={async (_projectId, nextFields) => {
                // Drafts shouldn't hit the server per keystroke — their
                // state is captured on "Create Task". For existing tasks
                // route through the shared handler so fields + assignment
                // diffs go to the right endpoints.
                if (isDraft) {
                  setEditingFields(nextFields);
                  return itemAsProject;
                }
                await handleSaveFields(nextFields);
                return itemAsProject;
              }}
              onDelete={isDraft ? handleDeleteDraft : handleDeleteTask}
              allProperties={allProperties}
              onPropertyChange={isDraft
                ? (_pid, name) => {
                    setDraftTask((prev) =>
                      prev ? { ...prev, property_name: name } : prev
                    );
                  }
                : handlePropertyChange}
              bins={binsHook.bins}
              onBinChange={async (binId) => {
                if (!selectedItem) return;
                const taskId = selectedItem.raw.task_id;
                updateSelectedRaw({ bin_id: binId || null });
                try {
                  await fetch('/api/update-task-fields', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      taskId,
                      fields: { bin_id: binId || null },
                    }),
                  });
                  binsHook.fetchBins();
                  fetchTasks();
                } catch (err) {
                  console.error('Error updating bin:', err);
                }
              }}
              onIsBinnedChange={async (isBinned) => {
                if (!selectedItem) return;
                const taskId = selectedItem.raw.task_id;
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
                  fetchTasks();
                } catch (err) {
                  console.error('Error updating is_binned:', err);
                }
              }}
              template={resolvedTemplate ?? null}
              formMetadata={raw?.form_metadata ?? undefined}
              onSaveForm={handleSaveTaskForm}
              loadingTemplate={
                !!raw?.template_id && loadingTaskTemplate === raw.template_id
              }
              availableTemplates={availableTemplates}
              onTemplateChange={handleTemplateChange}
              isNewTask={isDraft}
              onConfirmCreate={
                isDraft
                  ? (fields) => handleConfirmCreateTask(fields)
                  : undefined
              }
              creatingTask={creatingTask}
            />
          );
        }

        return (
          <div className={DESKTOP_DETAIL_PANEL_FLEX}>
            <ProjectDetailPanel
              project={itemAsProject}
              editingFields={editingFields}
              setEditingFields={setEditingFields}
              users={users}
              allProperties={allProperties}
              savingEdit={savingEdit}
              onSave={handleSaveFields}
              onDelete={isDraft ? handleDeleteDraft : handleDeleteTask}
              onClose={() => {
                setSelectedItem(null);
                setDraftTask(null);
              }}
              onOpenInPage={
                !isDraft && itemAsProject
                  ? () => {
                      const id = itemAsProject.id;
                      setSelectedItem(null);
                      setDraftTask(null);
                      router.push(taskPath(id));
                    }
                  : undefined
              }
              onOpenActivity={() => {}}
              isNewTask={isDraft}
              onConfirmCreate={isDraft ? handleConfirmCreateTask : undefined}
              creatingTask={creatingTask}
              onPropertyChange={isDraft
                ? (_pid, name) => {
                    setDraftTask((prev) => (prev ? { ...prev, property_name: name } : prev));
                  }
                : handlePropertyChange}
              staffOpen={staffOpen}
              setStaffOpen={setStaffOpen}
              template={resolvedTemplate}
              formMetadata={raw?.form_metadata ?? undefined}
              onSaveForm={handleSaveTaskForm}
              loadingTemplate={!!raw?.template_id && loadingTaskTemplate === raw.template_id}
              currentUser={currentUser}
              comments={commentsHook.projectComments}
              loadingComments={commentsHook.loadingComments}
              newComment={newComment}
              setNewComment={setNewComment}
              postingComment={commentsHook.postingComment}
              onPostComment={async () => {
                if (raw && newComment.trim()) {
                  await commentsHook.postProjectComment(raw.task_id, newComment, 'task');
                  setNewComment('');
                }
              }}
              attachments={attachmentsHook.projectAttachments}
              loadingAttachments={attachmentsHook.loadingAttachments}
              uploadingAttachment={attachmentsHook.uploadingAttachment}
              attachmentInputRef={attachmentsHook.attachmentInputRef}
              onAttachmentUpload={(e) => {
                if (raw) {
                  attachmentsHook.handleAttachmentUpload(e, raw.task_id, 'task');
                }
              }}
              onViewAttachment={(index) => setViewingAttachmentIndex(index)}
              activeTimeEntry={timeTrackingHook.activeTimeEntry}
              displaySeconds={timeTrackingHook.displaySeconds}
              formatTime={timeTrackingHook.formatTime}
              onStartTimer={() => {
                if (raw) timeTrackingHook.startProjectTimer(raw.task_id, 'task');
              }}
              onStopTimer={timeTrackingHook.stopProjectTimer}
              availableTemplates={availableTemplates}
              onTemplateChange={handleTemplateChange}
              bins={binsHook.bins}
              onBinChange={async (binId) => {
                if (!selectedItem) return;
                const taskId = selectedItem.raw.task_id;
                updateSelectedRaw({ bin_id: binId || null });
                try {
                  await fetch('/api/update-task-fields', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ taskId, fields: { bin_id: binId || null } }),
                  });
                  binsHook.fetchBins();
                  fetchTasks();
                } catch (err) {
                  console.error('Error updating bin:', err);
                }
              }}
              onIsBinnedChange={async (isBinned) => {
                if (!selectedItem) return;
                const taskId = selectedItem.raw.task_id;
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
                  fetchTasks();
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

export const PropertyTasksView = memo(PropertyTasksViewContent);
