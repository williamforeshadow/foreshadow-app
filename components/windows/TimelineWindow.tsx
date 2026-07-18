'use client';

import { apiFetch } from '@/lib/apiFetch';
import { toast } from '@/components/ui/toast';
import { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ensureTemplateDetail, fetchJson, qk, useProperties } from '@/lib/queries';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger, PopoverClose } from '@/components/ui/popover';
import { useTimeline } from '@/lib/useTimeline';
import { getActiveTurnoverForProperty } from '@/lib/turnoverUtils';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { ScheduledItemsCell, DayKanban } from './timeline';
import { TimelineNavBar } from './timeline/TimelineNavBar';
import { WeatherWidgetTrigger } from './timeline/WeatherWidgetTrigger';
import { marbleBackground } from './timeline/timelineStatus';
import { TaskRowList } from './timeline/TaskRowList';
import { TurnoverTaskList, TurnoverProjectsPanel } from './turnovers';
import { TaskDetailPanel } from '@/components/tasks/detail/TaskDetailPanel';
import type { TaskDetailInput, TaskDraft } from '@/components/tasks/detail/taskInput';
import type { TaskCreatePayload } from '@/components/tasks/detail/useTaskDetailController';
import { DayDetailPanel } from '@/components/tasks/DayDetailPanel';
import type { TaskRowItem } from '@/components/tasks/TaskRow';
import {
  TaskFilterBar,
  type FilterOption,
} from '@/components/tasks/TaskFilterBar';
import {
  DESKTOP_TIMELINE_DETAIL_PANEL_CLASS,
  DESKTOP_TIMELINE_DETAIL_PANEL_FLEX,
  DESKTOP_TASK_PANEL_SLOT,
} from '@/lib/detailPanelGeometry';
import { ClipboardCheck, Filter as FilterIcon } from 'lucide-react';
import { CompactSearch } from '@/components/ui/compact-search';
import { RowsIcon, KanbanColumnsIcon } from './timeline/TimelineViewIcons';
import type { Project, Task, User, Turnover, TaskTemplate } from '@/lib/types';
import type { Template } from '@/components/DynamicCleaningForm';
import { cn } from '@/lib/utils';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useExclusiveDetailPanelHost, useReservationViewer } from '@/lib/reservationViewerContext';
import { useRouter } from 'next/navigation';
import { taskPath } from '@/src/lib/links';

const getRowStyles = (status: string) => {
  const base = 'relative overflow-hidden rounded-lg';
  switch (status) {
    case 'complete':
      return `${base} bg-[rgba(76,72,105,0.06)] dark:bg-[rgba(76,72,105,0.12)] border border-[rgba(76,72,105,0.14)] dark:border-[rgba(76,72,105,0.22)]`;
    case 'in_progress':
      return `${base} bg-[rgba(99,102,241,0.06)] dark:bg-[rgba(99,102,241,0.12)] border border-[rgba(99,102,241,0.16)] dark:border-[rgba(99,102,241,0.25)]`;
    case 'paused':
      return `${base} bg-[rgba(139,133,168,0.06)] dark:bg-[rgba(139,133,168,0.10)] border border-[rgba(139,133,168,0.14)] dark:border-[rgba(139,133,168,0.22)]`;
    case 'contingent':
      return `${base} bg-white/45 dark:bg-white/[0.03] border border-dashed border-[rgba(30,25,20,0.15)] dark:border-[rgba(255,255,255,0.10)]`;
    default:
      return `${base} bg-[rgba(167,139,250,0.06)] dark:bg-[rgba(167,139,250,0.10)] border border-[rgba(167,139,250,0.14)] dark:border-[rgba(167,139,250,0.22)]`;
  }
};

// Map a Task-shaped row (task_id, assigned_users — lib/types' Task interface,
// the shape reservations/recurringTasks carry) into the unified
// TaskDetailInput. Mirrors projectToTaskInput, but Task lacks
// created_at/updated_at/bin_name/unread_comment_count — those fall back to
// '' / null since this shape never carries them.
function taskToTaskDetailInput(task: Task, propertyName: string): TaskDetailInput {
  return {
    task_id: task.task_id,
    reservation_id: task.reservation_id ?? null,
    property_id: task.property_id ?? null,
    property_name: propertyName || task.property_name || null,
    template_id: task.template_id ?? null,
    template_name: task.template_name ?? null,
    title: task.title ?? null,
    description: task.description ?? null,
    priority: task.priority ?? 'medium',
    department_id: task.department_id ?? null,
    department_name: task.department_name ?? null,
    status: task.status ?? 'not_started',
    scheduled_date: task.scheduled_date ?? null,
    scheduled_time: task.scheduled_time ?? null,
    form_metadata: (task.form_metadata as Record<string, unknown> | null) ?? null,
    bin_id: task.bin_id ?? null,
    bin_name: null,
    is_binned: task.is_binned ?? false,
    created_at: '',
    updated_at: '',
    assigned_users: (task.assigned_users || []).map((u) => ({
      user_id: u.user_id,
      name: u.name,
      avatar: u.avatar ?? null,
      role: u.role,
    })),
  };
}

// Draft (new-task) tasks flow through the grid/kanban/turnover creation
// entry points as Task-shaped placeholders (see createDraftTask below) so
// existing identity checks (`task_id.startsWith('draft-')`) keep working.
// These two converters translate that placeholder to/from the TaskDraft
// shape TaskDetailPanel's draft mode actually edits.
function taskToDraft(task: Task): TaskDraft {
  return {
    title: task.title || task.template_name || '',
    description: task.description ?? null,
    priority: task.priority || 'medium',
    status: task.status || 'not_started',
    department_id: task.department_id ?? null,
    scheduled_date: task.scheduled_date ?? null,
    scheduled_time: task.scheduled_time ?? null,
    assigned_staff: (task.assigned_users || []).map((u) => u.user_id),
    property_id: task.property_id ?? null,
    property_name: task.property_name ?? null,
    template_id: task.template_id ?? null,
    template_name: task.template_name ?? null,
    bin_id: task.bin_id ?? null,
    is_binned: task.is_binned ?? false,
  };
}

function applyDraftToTask(task: Task, draft: TaskDraft, users: User[]): Task {
  return {
    ...task,
    title: draft.title,
    description: draft.description as Task['description'],
    priority: draft.priority,
    status: draft.status as Task['status'],
    department_id: draft.department_id,
    scheduled_date: draft.scheduled_date,
    scheduled_time: draft.scheduled_time,
    assigned_users: draft.assigned_staff.map((id) => {
      const u = users.find((x) => x.id === id);
      return { user_id: id, name: u?.name || '', avatar: u?.avatar, role: u?.role };
    }),
    property_id: draft.property_id,
    property_name: draft.property_name || undefined,
    template_id: draft.template_id || undefined,
    template_name: draft.template_name || undefined,
    bin_id: draft.bin_id,
  };
}

interface TimelineWindowProps {
  users: User[];
  currentUser: User | null;
}

// Type for what's being viewed in the floating window
type FloatingWindowData = {
  type: 'task' | 'project' | 'turnover';
  item: Task | Project | Turnover;
  propertyName: string;
} | null;

const EMPTY_PROJECTS: Project[] = [];

// Droppable date cell: a task icon/dot dragged onto it reschedules the task
// to this day (same-property only — see handleTaskDragEnd). Forwards the
// original cell className/onClick/children unchanged; adds a ring only when a
// valid same-property drag is hovering.
function DroppableDateCell({
  property,
  dateStr,
  className,
  onClick,
  children,
}: {
  property: string;
  dateStr: string;
  className: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({
    id: `${property}__${dateStr}`,
    data: { property, dateStr },
  });
  return (
    <div ref={setNodeRef} className={className} onClick={onClick}>
      {children}
    </div>
  );
}

// Reservation bar with a cursor-following hover card. The popover is
// rendered via a fixed-position portal so it tracks the mouse instead of
// anchoring to the bar (HoverCard would anchor to the element).
function ReservationHoverBar({
  reservation,
  propertyName,
  propertyReservations,
  className,
  style,
  showLabel,
  labelPaddingPx,
  formatDate,
  onOpen,
}: {
  reservation: any;
  propertyName: string;
  propertyReservations: any[];
  className: string;
  style: React.CSSProperties;
  showLabel: boolean;
  labelPaddingPx: number;
  formatDate: (d: Date) => string;
  onOpen: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => setPortalReady(true), []);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popPos, setPopPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const openTimer = useRef<number | null>(null);

  const onEnter = (e: React.MouseEvent) => {
    setPos({ x: e.clientX, y: e.clientY });
    openTimer.current = window.setTimeout(() => setOpen(true), 80);
  };
  const onMove = (e: React.MouseEvent) => {
    setPos({ x: e.clientX, y: e.clientY });
  };
  const onLeave = () => {
    if (openTimer.current) { window.clearTimeout(openTimer.current); openTimer.current = null; }
    setOpen(false);
  };

  useEffect(() => () => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
  }, []);

  const guestLabel = reservation.kind === 'owner_stay' ? 'Owner Stay' : (reservation.guest_name || 'No guest');
  const checkInMs = new Date(reservation.check_in).getTime();
  const checkOutMs = new Date(reservation.check_out).getTime();
  const nights = Math.max(1, Math.round((checkOutMs - checkInMs) / (1000 * 60 * 60 * 24)));
  const nextRes = propertyReservations
    .filter((r) => new Date(r.check_in).getTime() > checkOutMs)
    .sort((a, b) => new Date(a.check_in).getTime() - new Date(b.check_in).getTime())[0];
  const fmt = (d: Date) => formatDate(d);

  // Position popover with a small offset from cursor so the mouse leaving the
  // bar onto the popover doesn't immediately retrigger close. Flip to the
  // other side of the cursor when it would otherwise overflow the viewport.
  useLayoutEffect(() => {
    if (!open) return;
    const margin = 8;
    const el = popoverRef.current;
    const w = el?.offsetWidth ?? 256;
    const h = el?.offsetHeight ?? 0;
    let left = pos.x + 14;
    let top = pos.y + 18;
    if (left + w + margin > window.innerWidth) left = pos.x - 14 - w;
    if (left < margin) left = margin;
    if (top + h + margin > window.innerHeight) top = pos.y - 18 - h;
    if (top < margin) top = margin;
    setPopPos({ left, top });
  }, [open, pos]);

  return (
    <>
      <div
        className={className}
        style={style}
        onMouseEnter={onEnter}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        onClick={(e) => {
          e.stopPropagation();
          onOpen(reservation.id);
        }}
      >
        {showLabel && (
          <span className="truncate" style={{ paddingLeft: labelPaddingPx, paddingRight: labelPaddingPx }}>
            {guestLabel}
          </span>
        )}
      </div>
      {open && portalReady && createPortal(
        <div
          ref={popoverRef}
          // pointer-events-none so the popover can't itself capture hover —
          // keeps the bar as the single hover authority and avoids flicker.
          className="fixed pointer-events-none w-64 p-3 bg-white dark:bg-[var(--timeline-surface-4)] border border-[rgba(30,25,20,0.08)] dark:border-[var(--timeline-border-strong)] shadow-lg rounded-md"
          style={{ left: popPos.left, top: popPos.top, zIndex: 9999 }}
        >
          <div className="flex flex-col gap-2">
            <div>
              <div className="text-sm font-semibold text-[#1a1a18] dark:text-[#e8e7e3] truncate">
                {guestLabel}
              </div>
              <div className="text-[11px] text-[#6b6963] dark:text-[#9a9893] truncate">
                {propertyName}
              </div>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
              <span className="text-[#9a9892] dark:text-[#66645f]">Check-in</span>
              <span className="text-[#1a1a18] dark:text-[#e8e7e3] tabular-nums">
                {fmt(new Date(reservation.check_in))}
              </span>
              <span className="text-[#9a9892] dark:text-[#66645f]">Check-out</span>
              <span className="text-[#1a1a18] dark:text-[#e8e7e3] tabular-nums">
                {fmt(new Date(reservation.check_out))}
                <span className="ml-1.5 text-[#9a9892] dark:text-[#66645f]">
                  · {nights} night{nights === 1 ? '' : 's'}
                </span>
              </span>
              {nextRes && (
                <>
                  <span className="text-[#9a9892] dark:text-[#66645f]">Next in</span>
                  <span className="text-[#1a1a18] dark:text-[#e8e7e3] tabular-nums">
                    {fmt(new Date(nextRes.check_in))}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// A blocked day's marker: a small centered ✕ inside the (already darkened)
// cell, with a cursor-following hover card showing the block note — mirrors
// the reservation hover card. Only the ✕ captures pointer events so the rest
// of the cell stays droppable.
function BlockedDayMarker({ note, propertyName }: { note: string | null; propertyName: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => setPortalReady(true), []);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popPos, setPopPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  const onEnter = (e: React.MouseEvent) => { setPos({ x: e.clientX, y: e.clientY }); setOpen(true); };
  const onMove = (e: React.MouseEvent) => setPos({ x: e.clientX, y: e.clientY });
  const onLeave = () => setOpen(false);

  useLayoutEffect(() => {
    if (!open) return;
    const margin = 8;
    const el = popoverRef.current;
    const w = el?.offsetWidth ?? 224;
    const h = el?.offsetHeight ?? 0;
    let left = pos.x + 14;
    let top = pos.y + 18;
    if (left + w + margin > window.innerWidth) left = pos.x - 14 - w;
    if (left < margin) left = margin;
    if (top + h + margin > window.innerHeight) top = pos.y - 18 - h;
    if (top < margin) top = margin;
    setPopPos({ left, top });
  }, [open, pos]);

  return (
    <>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span
          className="pointer-events-auto cursor-default select-none leading-none text-[rgba(70,72,84,0.32)] dark:text-[rgba(176,178,192,0.32)]"
          style={{ fontSize: 10 }}
          onMouseEnter={onEnter}
          onMouseMove={onMove}
          onMouseLeave={onLeave}
          onClick={(e) => e.stopPropagation()}
        >
          ✕
        </span>
      </div>
      {open && portalReady && createPortal(
        <div
          ref={popoverRef}
          className="fixed pointer-events-none w-56 p-3 bg-white dark:bg-[var(--timeline-surface-4)] border border-[rgba(30,25,20,0.08)] dark:border-[var(--timeline-border-strong)] shadow-lg rounded-md"
          style={{ left: popPos.left, top: popPos.top, zIndex: 9999 }}
        >
          <div className="text-sm font-semibold text-[#1a1a18] dark:text-[#e8e7e3]">Blocked</div>
          <div className="text-[11px] text-[#6b6963] dark:text-[#9a9893] truncate">{propertyName}</div>
          {note && (
            <div className="mt-1.5 text-[12px] text-[#1a1a18] dark:text-[#e8e7e3] whitespace-pre-wrap">{note}</div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

export default function TimelineWindow({
  users,
  currentUser,
}: TimelineWindowProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  // State for the floating window
  const [floatingData, setFloatingData] = useState<FloatingWindowData>(null);
  
  // State for view mode (grid vs kanban)
  const [viewMode, setViewMode] = useState<'grid' | 'kanban'>('grid');
  
  // State for kanban - use current date as default when in kanban view mode
  const [kanbanDate, setKanbanDate] = useState<Date>(new Date());

  // Filter bar state (mirrors Tasks page minus Scheduled date range, Origin,
  // and Bin — Timeline already implies scheduled tasks; Origin/Bin aren't
  // useful in this view).
  const [search, setSearch] = useState('');
  const [statusSel, setStatusSel] = useState<Set<string>>(new Set());
  const [assigneeSel, setAssigneeSel] = useState<Set<string>>(new Set());
  const [deptSel, setDeptSel] = useState<Set<string>>(new Set());
  const [prioritySel, setPrioritySel] = useState<Set<string>>(new Set());
  const [propSel, setPropSel] = useState<Set<string>>(new Set());
  const clearAllFilters = useCallback(() => {
    setSearch('');
    setStatusSel(new Set());
    setAssigneeSel(new Set());
    setDeptSel(new Set());
    setPrioritySel(new Set());
    setPropSel(new Set());
  }, []);
  const anyFilterActive =
    !!search.trim() ||
    statusSel.size +
      assigneeSel.size +
      deptSel.size +
      prioritySel.size +
      propSel.size >
      0;
  // Filter pills are collapsed behind a funnel icon by default to keep the
  // Timeline header compact; click the icon to expand them inline.
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  // State for the day detail panel (clicking a day header in the grid view).
  // Kanban access is preserved via the top-left view-mode toggle; clicking a
  // day in the grid now pops this shared panel instead of navigating away.
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  // ============================================================================
  // LOCAL project data (fetched from tasks-for-bin API)
  // ============================================================================
  const projectsQuery = useQuery({
    queryKey: qk.tasksForBin('__all__', currentUser?.id ?? null),
    queryFn: async () => {
      const params = new URLSearchParams({ bin_id: '__all__' });
      if (currentUser?.id) params.set('viewer_user_id', currentUser.id);
      const result = await fetchJson<{ data?: Project[] }>(`/api/tasks-for-bin?${params.toString()}`);
      return result.data ?? [];
    },
  });
  // Old fetch had no loading state — don't introduce one here.
  const projects = projectsQuery.data ?? EMPTY_PROJECTS;
  const { properties: allProperties } = useProperties();

  // fetchProjects remains as a refetch shim for existing callers.
  const { refetch: refetchProjects } = projectsQuery;
  const fetchProjects = useCallback(async () => {
    await refetchProjects();
  }, [refetchProjects]);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  // Property name → id lookup. Powers the clickable property labels in the
  // y-axis column: clicking a property opens its detail page in a new tab
  // (target="_blank"). A reservation can carry a property_name string that
  // doesn't have a matching row in `properties` (orphaned imports, name
  // drift) — those rows render as plain text instead of broken links.
  const propertyIdByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of allProperties) {
      if (p.id) map.set(p.name, p.id);
    }
    return map;
  }, [allProperties]);

  // ============================================================================
  // Timeline hook (needed early for fetchReservations)
  // ============================================================================
  const {
    properties,
    loading,
    selectedReservation,
    setSelectedReservation,
    view,
    setView,
    dateRange,
    goToPrevious,
    goToNext,
    goToToday,
    formatDate,
    isToday,
    getReservationsForProperty,
    getBlocksForProperty,
    getBlockPosition,
    reservations,
    setReservations,
    recurringTasks,
    setRecurringTasks,
    fetchReservations,
  } = useTimeline();

  // Strict single-panel rule (both directions):
  //   global → local: close our locals when context overlays open
  //   local → global: call closeGlobals() before opening any local panel
  //                   so the new local panel doesn't render behind the
  //                   still-open context overlay (same z-20 slot).
  const closeGlobals = useExclusiveDetailPanelHost(() => {
    setFloatingData(null);
    setSelectedDay(null);
    setSelectedReservation(null);
  });

  // Reservation viewer (global) — clicking a purple block on the timeline
  // opens the same ReservationDetailOverlay that the key icon and the
  // Properties → Schedule tab use, so the panel slots into the standard
  // detail-panel geometry and obeys strict-swap with any other panel.
  const { open: openReservationViewer } = useReservationViewer();

  // Expanded property rows in timeline grid
  const [expandedProperties, setExpandedProperties] = useState<Set<string>>(new Set());
  const togglePropertyExpanded = useCallback((property: string) => {
    setExpandedProperties(prev => {
      const next = new Set(prev);
      if (next.has(property)) {
        next.delete(property);
      } else {
        next.add(property);
      }
      return next;
    });
  }, []);
  const toggleAllExpanded = useCallback(() => {
    setExpandedProperties(prev => {
      if (prev.size === properties.length) return new Set();
      return new Set(properties);
    });
  }, [properties]);

  // ============================================================================
  // Task state
  // ============================================================================
  // taskTemplates/fetchTaskTemplate still feed TurnoverTaskList's template
  // labels — TaskDetailPanel loads its own template internally and no longer
  // needs this cache.
  const [taskTemplates, setTaskTemplates] = useState<Record<string, Template>>({});
  const [creatingTask, setCreatingTask] = useState(false);


  // ============================================================================
  // Turnover detail state
  // ============================================================================
  const [turnoverRightPanelView, setTurnoverRightPanelView] = useState<'tasks' | 'projects'>('tasks');
  const [showAddTaskDialog, setShowAddTaskDialog] = useState(false);
  const [availableTemplates, setAvailableTemplates] = useState<TaskTemplate[]>([]);

  // ============================================================================
  // Task functions
  // ============================================================================
  const fetchTaskTemplate = useCallback(async (templateId: string, propertyName?: string): Promise<any> => {
    const cacheKey = propertyName ? `${templateId}__${propertyName}` : templateId;

    if (taskTemplates[cacheKey]) {
      return taskTemplates[cacheKey];
    }

    try {
      const template = await ensureTemplateDetail(queryClient, templateId, propertyName);

      setTaskTemplates(prev => ({ ...prev, [cacheKey]: template }));
      return template;
    } catch (err) {
      console.error('Error fetching template:', err);
      toast.error("Couldn't load the task template");
      return null;
    }
  }, [taskTemplates, queryClient]);

  // ============================================================================
  // Turnover task handlers
  // ============================================================================
  const updateTurnoverTaskAssignment = useCallback(async (taskId: string, userIds: string[]) => {
    try {
      const res = await apiFetch('/api/update-task-assignment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, userIds })
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to update task assignment');

      // Update task in reservations
      const assignedUsers = (result.data?.task_assignments || []).map((ta: { user_id: string; users?: { name?: string; avatar?: string; role?: string } }) => ({
        user_id: ta.user_id,
        name: ta.users?.name || '',
        avatar: ta.users?.avatar || '',
        role: ta.users?.role || ''
      }));

      setReservations(prev => prev.map(reservation => ({
        ...reservation,
        tasks: (reservation.tasks || []).map((task: Task) =>
          task.task_id === taskId ? { ...task, assigned_users: assignedUsers } : task
        )
      })));

      // Update floatingData if it's the same task (turnover, or the open task panel)
      setFloatingData(prev => {
        if (!prev) return prev;
        if (prev.type === 'turnover') {
          const turnover = prev.item as Turnover;
          return {
            ...prev,
            item: {
              ...turnover,
              tasks: turnover.tasks.map(task =>
                task.task_id === taskId ? { ...task, assigned_users: assignedUsers } : task
              )
            }
          };
        }
        if (prev.type === 'task' && (prev.item as Task).task_id === taskId) {
          return { ...prev, item: { ...(prev.item as Task), assigned_users: assignedUsers } };
        }
        return prev;
      });
    } catch (err) {
      console.error('Error updating task assignment:', err);
      toast.error("Couldn't update the task assignment");
    }
  }, [setReservations]);

  const updateTurnoverTaskSchedule = useCallback(async (taskId: string, scheduledDate: string | null, scheduledTime: string | null) => {
    // Optimistic-first: move the task in local state immediately so the grid
    // repaints on drop with no network wait. The fetch runs after; on failure
    // we resync from the server (self-heals the bad optimistic move).
    setReservations(prev => prev.map(reservation => ({
      ...reservation,
      tasks: (reservation.tasks || []).map((task: Task) =>
        task.task_id === taskId ? { ...task, scheduled_date: scheduledDate, scheduled_time: scheduledTime } : task
      )
    })));

    setRecurringTasks((prev: any[]) => prev.map((t: any) =>
      t.task_id === taskId ? { ...t, scheduled_date: scheduledDate, scheduled_time: scheduledTime } : t
    ));

    if (floatingData?.type === 'task' && (floatingData.item as Task).task_id === taskId) {
      setFloatingData(prev => {
        if (!prev || prev.type !== 'task') return prev;
        return { ...prev, item: { ...(prev.item as Task), scheduled_date: scheduledDate, scheduled_time: scheduledTime } };
      });
    }

    if (floatingData?.type === 'turnover') {
      setFloatingData(prev => {
        if (!prev || prev.type !== 'turnover') return prev;
        const turnover = prev.item as Turnover;
        return {
          ...prev,
          item: {
            ...turnover,
            tasks: turnover.tasks.map(task =>
              task.task_id === taskId ? { ...task, scheduled_date: scheduledDate, scheduled_time: scheduledTime } : task
            )
          }
        };
      });
    }

    try {
      const res = await apiFetch('/api/update-task-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, scheduledDate, scheduledTime })
      });
      if (!res.ok) {
        const result = await res.json().catch(() => ({}));
        throw new Error(result.error || 'Failed to update task schedule');
      }
    } catch (err) {
      console.error('Error updating task schedule:', err);
      toast.error("Couldn't reschedule the task");
      // Resync from the server to undo the optimistic move.
      fetchReservations();
    }
  }, [floatingData, setReservations, setRecurringTasks, fetchReservations]);

  // ── Grid drag-and-drop: reschedule a task by dragging its icon/dot onto
  // another day in the SAME property row. Activation distance keeps clicks
  // (open task / open reservation) working.
  const dndSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
  );
  const [draggingTask, setDraggingTask] = useState<{
    property: string;
    scheduledTime: string | null;
    currentDate: string;
    status: string;
  } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const cellWidthRef = useRef(0);

  // Measured px width of one date column. Reservation bars are sized in
  // pixels off this (not cell-relative %) so check-in/check-out penetration
  // is identical for every bar regardless of span. Re-measured on resize and
  // when the visible range (week/month) changes.
  const [colWidth, setColWidth] = useState(0);
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const w = (el.clientWidth - 200) / Math.max(1, dateRange.length);
      setColWidth(w > 0 ? w : 0);
      cellWidthRef.current = w > 0 ? w : 0;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // viewMode is included so the observer re-attaches when the grid <div>
    // remounts after switching back from Kanban view — without this, colWidth
    // would stay stale and reservation bars would fall back to the old
    // span-dependent percentage geometry.
  }, [dateRange.length, viewMode]);

  // Lock the drag to the horizontal axis and snap the overlay to whole
  // column-widths so it jumps cell-to-cell instead of free-floating.
  // (cellWidthRef is measured once on drag start.)
  const snapXModifier = useCallback(
    ({ transform }: { transform: { x: number; y: number; scaleX: number; scaleY: number } }) => {
      const w = cellWidthRef.current;
      return {
        ...transform,
        y: 0,
        x: w > 0 ? Math.round(transform.x / w) * w : transform.x,
      };
    },
    [],
  );

  const handleTaskDragStart = useCallback((e: DragStartEvent) => {
    // Width is stable for the duration of a drag — measure once here instead
    // of wiring a ResizeObserver. 200 = the sticky property column.
    const el = gridRef.current;
    cellWidthRef.current = el
      ? (el.clientWidth - 200) / Math.max(1, dateRange.length)
      : 0;
    const d = e.active.data.current as
      | { property: string; scheduledTime: string | null; currentDate: string; status: string }
      | undefined;
    if (d) {
      setDraggingTask({
        property: d.property,
        scheduledTime: d.scheduledTime ?? null,
        currentDate: d.currentDate,
        status: d.status,
      });
    }
  }, [dateRange.length]);

  const handleTaskDragEnd = useCallback((e: DragEndEvent) => {
    const a = e.active.data.current as
      | { taskId: string; property: string; scheduledTime: string | null; currentDate: string }
      | undefined;
    const o = e.over?.data.current as { property: string; dateStr: string } | undefined;
    setDraggingTask(null);
    if (a && o && o.property === a.property && o.dateStr !== a.currentDate) {
      updateTurnoverTaskSchedule(a.taskId, o.dateStr, a.scheduledTime ?? null);
    }
  }, [updateTurnoverTaskSchedule]);

  // Stable handler + memoized modifiers array: passing inline/unstable values
  // to DndContext makes its internal effect dependency list churn (the
  // "useLayoutEffect changed size" error).
  const handleTaskDragCancel = useCallback(() => setDraggingTask(null), []);
  const dndModifiers = useMemo(() => [snapXModifier], [snapXModifier]);

  // Header nav — branches grid (date range) vs day-view Kanban (kanbanDate ±1).
  const handleTimelinePrev = useCallback(() => {
    if (viewMode === 'grid') {
      goToPrevious();
    } else {
      const d = new Date(kanbanDate);
      d.setDate(d.getDate() - 1);
      setKanbanDate(d);
    }
  }, [viewMode, goToPrevious, kanbanDate]);
  const handleTimelineToday = useCallback(() => {
    if (viewMode === 'grid') goToToday();
    else setKanbanDate(new Date());
  }, [viewMode, goToToday]);
  const handleTimelineNext = useCallback(() => {
    if (viewMode === 'grid') {
      goToNext();
    } else {
      const d = new Date(kanbanDate);
      d.setDate(d.getDate() + 1);
      setKanbanDate(d);
    }
  }, [viewMode, goToNext, kanbanDate]);

  // Freeze scrolling while a task is being dragged WITHOUT removing the
  // scrollbar (overflow stays `auto`, so no grid reflow). The horizontal-only
  // overlay can't compensate for a scroll, so an unblocked scroll mid-drag
  // would pull the task off its property row.
  const scrollLockRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!draggingTask) return;
    const el = scrollLockRef.current;
    if (!el) return;
    const prevent = (ev: Event) => ev.preventDefault();
    el.addEventListener('wheel', prevent, { passive: false });
    el.addEventListener('touchmove', prevent, { passive: false });
    return () => {
      el.removeEventListener('wheel', prevent);
      el.removeEventListener('touchmove', prevent);
    };
  }, [draggingTask]);

  const fetchAvailableTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks');
      const result = await res.json();
      if (res.ok && result.data) {
        setAvailableTemplates(result.data);
      }
    } catch (err) {
      console.error('Error fetching templates:', err);
      toast.error("Couldn't load task templates");
    }
  }, []);

  const addTaskToTurnover = useCallback(async (templateId: string) => {
    if (floatingData?.type !== 'turnover') return;
    const turnover = floatingData.item as Turnover;

    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reservation_id: turnover.id,
          template_id: templateId
        })
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to add task');

      const newTask = result.data as Task;

      // Update reservations
      setReservations(prev => prev.map(reservation => {
        if (reservation.id === turnover.id) {
          const updatedTasks = [...(reservation.tasks || []), newTask];
          return {
            ...reservation,
            tasks: updatedTasks,
            total_tasks: updatedTasks.length,
            completed_tasks: updatedTasks.filter((t: Task) => t.status === 'complete').length,
          };
        }
        return reservation;
      }));

      // Update floatingData
      setFloatingData(prev => {
        if (!prev || prev.type !== 'turnover') return prev;
        const t = prev.item as Turnover;
        const updatedTasks = [...t.tasks, newTask];
        return {
          ...prev,
          item: {
            ...t,
            tasks: updatedTasks,
            total_tasks: updatedTasks.length,
            completed_tasks: updatedTasks.filter(task => task.status === 'complete').length,
          }
        };
      });

      setShowAddTaskDialog(false);
    } catch (err) {
      console.error('Error adding task:', err);
      toast.error("Couldn't add the task");
    }
  }, [floatingData, setReservations]);

  const deleteTaskFromTurnover = useCallback(async (taskId: string) => {
    if (floatingData?.type !== 'turnover') return;
    const turnover = floatingData.item as Turnover;

    try {
      const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to delete task');

      // Update reservations
      setReservations(prev => prev.map(reservation => {
        if (reservation.id === turnover.id) {
          const updatedTasks = (reservation.tasks || []).filter((t: Task) => t.task_id !== taskId);
          return {
            ...reservation,
            tasks: updatedTasks,
            total_tasks: updatedTasks.length,
            completed_tasks: updatedTasks.filter((t: Task) => t.status === 'complete').length,
          };
        }
        return reservation;
      }));

      // Update floatingData
      setFloatingData(prev => {
        if (!prev || prev.type !== 'turnover') return prev;
        const t = prev.item as Turnover;
        const updatedTasks = t.tasks.filter(task => task.task_id !== taskId);
        return {
          ...prev,
          item: {
            ...t,
            tasks: updatedTasks,
            total_tasks: updatedTasks.length,
            completed_tasks: updatedTasks.filter(task => task.status === 'complete').length,
          }
        };
      });
    } catch (err) {
      console.error('Error deleting task:', err);
      toast.error("Couldn't delete the task");
    }
  }, [floatingData, setReservations]);

  const handleTurnoverTaskClick = useCallback((task: Task) => {
    if (floatingData?.type !== 'turnover') return;
    // Switch to task view within the same panel — TaskDetailPanel loads its
    // own template/comments/attachments/time entries once mounted.
    setFloatingData({
      type: 'task',
      item: task,
      propertyName: floatingData.propertyName,
    });
  }, [floatingData]);

  const handleCloseFloatingWindow = useCallback(() => {
    setFloatingData(null);
    setTurnoverRightPanelView('tasks');
  }, []);

  const createDraftTask = useCallback((payload: Record<string, unknown>): Task => {
    return {
      task_id: `draft-${Date.now()}`,
      template_id: undefined,
      template_name: undefined,
      title: (payload.title as string) || 'New Task',
      description: null,
      priority: (payload.priority as string) || 'medium',
      bin_id: (payload.bin_id as string) || null,
      department_id: null,
      department_name: null,
      status: (payload.status as Task['status']) || 'not_started',
      property_name: (payload.property_name as string) || undefined,
      scheduled_date: (payload.scheduled_date as string) || null,
      scheduled_time: (payload.scheduled_time as string) || null,
      assigned_users: [],
    } as Task;
  }, []);

  // TaskDetailPanel draft-mode create handler for the main floating task
  // panel (grid cell / header "new task" / day panel "new task" entry
  // points). Invalidates the shared caches afterward so the grid/kanban
  // (qk.timeline) and the tasks-for-bin lists pick up the new row without a
  // manual refetch — the old code left the grid stale until the next
  // natural reload; this closes that gap.
  const handleConfirmCreateTaskTimeline = useCallback(async (payload: TaskCreatePayload) => {
    setCreatingTask(true);
    try {
      const body: Record<string, unknown> = {
        title: payload.fields.title || 'New Task',
        status: payload.fields.status || 'not_started',
        priority: payload.fields.priority || 'medium',
        description: payload.fields.description || null,
        department_id: payload.fields.department_id || null,
        scheduled_date: payload.fields.scheduled_date || null,
        scheduled_time: payload.fields.scheduled_time || null,
      };
      if (payload.property_name) body.property_name = payload.property_name;
      if (payload.template_id) body.template_id = payload.template_id;
      if (payload.bin_id) body.bin_id = payload.bin_id;
      if (payload.fields.assigned_staff?.length) body.assigned_user_ids = payload.fields.assigned_staff;

      const res = await fetch('/api/tasks-for-bin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      const data = result.data;
      if (data) {
        const createdTask: Task = {
          task_id: data.id,
          template_id: data.template_id || undefined,
          template_name: data.template_name || undefined,
          title: data.title || 'New Task',
          description: data.description || null,
          priority: data.priority || 'medium',
          bin_id: data.bin_id || null,
          department_id: data.department_id || null,
          department_name: data.department_name || null,
          status: data.status || 'not_started',
          property_id: data.property_id || null,
          property_name: data.property_name || undefined,
          scheduled_date: data.scheduled_date || null,
          scheduled_time: data.scheduled_time || null,
          reservation_id: data.reservation_id ?? null,
          assigned_users: (data.project_assignments || []).map((a: any) => ({
            user_id: a.user_id,
            name: a.user?.name || '',
            avatar: a.user?.avatar || '',
            role: a.user?.role || '',
          })),
        } as Task;
        setFloatingData(prev => (prev && prev.type === 'task' ? { ...prev, item: createdTask } : prev));
        queryClient.invalidateQueries({ queryKey: ['tasks-for-bin'] });
        queryClient.invalidateQueries({ queryKey: qk.timeline });
        queryClient.invalidateQueries({ queryKey: qk.turnovers });
      }
    } catch (err) {
      console.error('Error creating task:', err);
      toast.error("Couldn't create the task");
    } finally {
      setCreatingTask(false);
    }
  }, [queryClient]);

  const handleCreateProjectFromTimelineCell = useCallback((propertyName: string, date: Date) => {
    const scheduledDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const draft = createDraftTask({ property_name: propertyName, scheduled_date: scheduledDate });

    closeGlobals();
    setFloatingData({
      type: 'task',
      item: draft,
      propertyName,
    });
  }, [createDraftTask, closeGlobals]);

  const handleCreateProjectFromHeader = useCallback(() => {
    const draft = createDraftTask({});

    closeGlobals();
    setFloatingData({
      type: 'task',
      item: draft,
      propertyName: '',
    });
  }, [createDraftTask, closeGlobals]);

  // Persist a task's full assignee list from a Timeline-Kanban drag, then
  // optimistically reflect it across reservation tasks, recurring tasks, and
  // the open detail panel. Empty list = unassigned.
  const handleTimelineKanbanAssign = useCallback(async (taskId: string, userIds: string[]) => {
    try {
      const res = await apiFetch('/api/update-task-assignment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, userIds }),
      });
      if (!res.ok) {
        const result = await res.json().catch(() => ({}));
        throw new Error(result.error || 'Failed to update task assignment');
      }

      const assignedUsers = userIds
        .map((id) => users.find((u: any) => u.id === id))
        .filter(Boolean)
        .map((u: any) => ({
          user_id: u.id,
          name: u.name || '',
          avatar: u.avatar || '',
          role: u.role || '',
        }));

      setReservations(prev => prev.map(reservation => ({
        ...reservation,
        tasks: (reservation.tasks || []).map((task: Task) =>
          task.task_id === taskId ? { ...task, assigned_users: assignedUsers } : task
        ),
      })));

      setRecurringTasks((prev: any[]) => prev.map((t: any) =>
        t.task_id === taskId ? { ...t, assigned_users: assignedUsers } : t
      ));

      if (floatingData?.type === 'task' && (floatingData.item as Task).task_id === taskId) {
        setFloatingData(prev =>
          prev && prev.type === 'task'
            ? { ...prev, item: { ...(prev.item as Task), assigned_users: assignedUsers } }
            : prev
        );
      }
    } catch (err) {
      console.error('Error updating kanban assignment:', err);
      toast.error("Couldn't update the task assignment");
    }
  }, [users, setReservations, setRecurringTasks, floatingData]);

  // Extract ALL tasks from reservations + recurring tasks, tagged with property_name
  const allTasksWithProperty = useMemo(() => {
    // Each task carries its own `reservation_id` FK from the
    // get_property_turnovers RPC payload — it points at the reservation
    // that auto-generated the task (via automation), which may NOT be
    // the reservation whose window the task currently appears in (a
    // contingent task generated for a future stay can fall inside an
    // earlier reservation's window). We forward the FK as-is so downstream
    // surfaces (DayDetailPanel, kanban, key icon) navigate to the source
    // reservation. Manual / recurring tasks have no FK and render plain.
    const tasks: (Task & {
      property_name: string;
      reservation_id?: string | null;
    })[] = [];
    const seen = new Set<string>();
    // Tasks from reservations (turnover, occupancy, vacancy triggers)
    reservations.forEach((res: any) => {
      (res.tasks || []).forEach((task: Task) => {
        if (!seen.has(task.task_id)) {
          seen.add(task.task_id);
          tasks.push({
            ...task,
            property_name: res.property_name,
            reservation_id: task.reservation_id ?? null,
          });
        }
      });
    });
    // Recurring tasks (property-level, no reservation)
    recurringTasks.forEach((task: any) => {
      if (!seen.has(task.task_id)) {
        seen.add(task.task_id);
        tasks.push({
          ...task,
          property_name: task.property_name,
          reservation_id: task.reservation_id ?? null,
        });
      }
    });
    return tasks;
  }, [reservations, recurringTasks]);

  // Extract tasks with scheduled_date (for kanban user columns)
  const allScheduledTasks = useMemo(() => {
    return allTasksWithProperty.filter(task => task.scheduled_date);
  }, [allTasksWithProperty]);

  // ---- Filter bar: options + predicate (mirrors useTasks logic) ----------
  const NO_DEPT = '__no_department__';
  const timelineFilterOptions = useMemo(() => {
    const statusCounts: Record<string, number> = {};
    const priorityCounts: Record<string, number> = {};
    const assigneeMap = new Map<string, { name: string; count: number }>();
    const deptMap = new Map<string, { name: string; count: number }>();
    const propertyMap = new Map<string, number>();
    let noDeptCount = 0;
    allScheduledTasks.forEach((t: any) => {
      statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
      if (t.priority) priorityCounts[t.priority] = (priorityCounts[t.priority] || 0) + 1;
      if (t.department_id) {
        const ex = deptMap.get(t.department_id);
        deptMap.set(t.department_id, { name: t.department_name || 'Department', count: (ex?.count || 0) + 1 });
      } else {
        noDeptCount++;
      }
      if (t.property_name) propertyMap.set(t.property_name, (propertyMap.get(t.property_name) || 0) + 1);
      (t.assigned_users || []).forEach((a: any) => {
        const ex = assigneeMap.get(a.user_id);
        assigneeMap.set(a.user_id, { name: a.name || 'Unknown', count: (ex?.count || 0) + 1 });
      });
    });
    const statuses: FilterOption[] = [
      { value: 'not_started', label: 'Not started', count: statusCounts.not_started || 0 },
      { value: 'in_progress', label: 'In progress', count: statusCounts.in_progress || 0 },
      { value: 'paused', label: 'Paused', count: statusCounts.paused || 0 },
      { value: 'complete', label: 'Complete', count: statusCounts.complete || 0 },
    ];
    const priorities: FilterOption[] = [
      { value: 'urgent', label: 'Urgent', count: priorityCounts.urgent || 0 },
      { value: 'high', label: 'High', count: priorityCounts.high || 0 },
      { value: 'medium', label: 'Medium', count: priorityCounts.medium || 0 },
      { value: 'low', label: 'Low', count: priorityCounts.low || 0 },
    ];
    const assignees: FilterOption[] = Array.from(assigneeMap.entries())
      .map(([id, v]) => ({ value: id, label: v.name, count: v.count }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const departments: FilterOption[] = [
      ...Array.from(deptMap.entries())
        .map(([id, v]) => ({ value: id, label: v.name, count: v.count }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      { value: NO_DEPT, label: 'No department', count: noDeptCount },
    ];
    const propertiesOpt: FilterOption[] = Array.from(propertyMap.entries())
      .map(([name, count]) => ({ value: name, label: name, count }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return { statuses, priorities, assignees, departments, propertiesOpt };
  }, [allScheduledTasks]);

  const displayedScheduledTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allScheduledTasks.filter((t: any) => {
      if (q) {
        const hay = [
          t.title || '',
          t.template_name || '',
          t.property_name || '',
          t.guest_name || '',
          t.department_name || '',
        ].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusSel.size > 0 && !statusSel.has(t.status)) return false;
      if (prioritySel.size > 0 && !prioritySel.has(t.priority || '')) return false;
      if (deptSel.size > 0) {
        const key = t.department_id || NO_DEPT;
        if (!deptSel.has(key)) return false;
      }
      if (assigneeSel.size > 0) {
        if (!(t.assigned_users || []).some((a: any) => assigneeSel.has(a.user_id))) return false;
      }
      if (propSel.size > 0) {
        if (!t.property_name || !propSel.has(t.property_name)) return false;
      }
      return true;
    });
  }, [allScheduledTasks, search, statusSel, assigneeSel, deptSel, prioritySel, propSel]);

  const displayedProperties = useMemo(
    () => (propSel.size > 0 ? properties.filter(p => propSel.has(p)) : properties),
    [properties, propSel],
  );

  // ---- Day detail panel (clicking a day header in grid view) -----------
  // Flat list of tasks + reservations intersecting the selected day,
  // across all properties. Handlers route task/reservation clicks back
  // into the existing Timeline detail panels so there's one canonical
  // editor per item type.
  const dayPanelData = useMemo(() => {
    if (!selectedDay) return null;
    const dayKey = `${selectedDay.getFullYear()}-${String(selectedDay.getMonth() + 1).padStart(2, '0')}-${String(selectedDay.getDate()).padStart(2, '0')}`;
    // Task is defined with a narrow shape in lib/types; ledger fields
    // (bin_name, is_automated, reservation_id) exist on the row payload
    // but aren't on the interface yet — widen locally. reservation_id
    // is the task's own FK (forwarded as-is by allTasksWithProperty),
    // not a stamp from the parent reservation.
    type TaskRowSource = Task & {
      property_name: string;
      bin_name?: string | null;
      is_automated?: boolean;
      reservation_id?: string | null;
    };
    const dayTasks: TaskRowItem[] = (displayedScheduledTasks as TaskRowSource[])
      .filter((t) => (t.scheduled_date || '').slice(0, 10) === dayKey)
      .map((t) => ({
        key: t.task_id,
        title: t.title || t.template_name || 'Task',
        property_name: t.property_name || null,
        status: t.status || 'not_started',
        priority: t.priority || 'medium',
        department_id: t.department_id ?? null,
        department_name: t.department_name ?? null,
        scheduled_date: t.scheduled_date ?? null,
        scheduled_time: t.scheduled_time ?? null,
        assignees: (t.assigned_users || []).map((u) => ({
          user_id: u.user_id,
          name: u.name,
          avatar: u.avatar ?? null,
        })),
        bin_id: t.bin_id ?? null,
        bin_name: t.bin_name ?? null,
        is_binned: !!t.is_binned,
        is_automated: t.is_automated,
        reservation_id: t.reservation_id ?? null,
      }));
    return { dayKey, dayTasks };
  }, [selectedDay, displayedScheduledTasks]);

  const handleOpenTaskFromDay = useCallback((taskKey: string) => {
    const task = allScheduledTasks.find((t) => t.task_id === taskKey);
    if (!task) return;
    closeGlobals();
    setSelectedDay(null);
    setFloatingData({
      type: 'task',
      item: task,
      propertyName: task.property_name || '',
    });
  }, [allScheduledTasks, closeGlobals]);

  const handleNewTaskFromDay = useCallback((dateStr: string) => {
    const draft = createDraftTask({ scheduled_date: dateStr });
    closeGlobals();
    setSelectedDay(null);
    setFloatingData({
      type: 'task',
      item: draft,
      propertyName: '',
    });
  }, [createDraftTask, closeGlobals]);

  // Note: projects state is kept for TurnoverProjectsPanel but NOT shown on the
  // grid — useTimeline's recurringTasks already includes all non-reservation tasks.

  const formatHeaderDate = (date: Date, isTodayDate: boolean) => {
    const month = date.getMonth() + 1;
    const day = date.getDate();

    return (
      <div className="text-left">
        <div className={`text-[11px] uppercase tracking-[0.08em] font-semibold ${isTodayDate ? 'text-[#1a1a18] dark:text-[#e8e7e3]' : 'text-[#9a9892] dark:text-[#66645f]'}`}>
          {date.toLocaleDateString('en-US', { weekday: 'short' })}
        </div>
        <div className={`text-[15px] font-medium tabular-nums tracking-[-0.01em] mt-0.5 ${isTodayDate ? 'text-[#8b7fc9] dark:text-[#a78bfa]' : 'text-[#1a1a18] dark:text-[#e8e7e3]'}`}>
          {month}/{day}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-white dark:bg-card">
        <div className="text-center py-12 text-neutral-500 dark:text-neutral-400">
          Loading timeline...
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col relative bg-white dark:bg-card">
      {/* Header region — title + fine print + controls row. The gradient
          fades to transparent over the content background (bg-white /
          dark:bg-card base), so the header blends seamlessly into the grid
          below — no divider. */}
      <div className="flex-shrink-0 bg-white dark:bg-card bg-[linear-gradient(to_bottom,#f4f4f6,transparent)] dark:bg-[linear-gradient(to_bottom,#30303a,transparent)] border-b border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)]">
        {/* Title + fine print (current date range) */}
        <div className="px-8 pt-6 pb-1">
          <h1 className="text-[24px] font-semibold tracking-tight text-neutral-900 dark:text-[#f0efed]">
            Schedule
          </h1>
          {dateRange.length > 0 && (
            <div className="flex items-center gap-3 mt-1.5 text-[12px] text-neutral-500 dark:text-[#66645f] uppercase tracking-[0.04em] font-medium">
              <span>
                {formatDate(dateRange[0])} – {formatDate(dateRange[dateRange.length - 1])}
              </span>
            </div>
          )}
        </div>

        {/* Controls row */}
        <div className="px-8 pb-4">
        <div className="flex items-center gap-3 flex-nowrap min-w-0">
          {/* View Mode Icons */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setViewMode('grid');
                setSelectedDay(null);
              }}
              className={`p-1.5 rounded transition-colors ${
                viewMode === 'grid' 
                  ? 'bg-[rgba(30,25,20,0.06)] dark:bg-[rgba(255,255,255,0.08)] text-[#1a1a18] dark:text-[#e8e7e3]' 
                  : 'text-[#9a9892] dark:text-[#66645f] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] hover:text-[#6b6963] dark:hover:text-[#9a9893]'
              }`}
              title="Grid View"
            >
              <RowsIcon className="w-[18px] h-[18px]" />
            </button>
            <button
              onClick={() => {
                setViewMode('kanban');
                setSelectedDay(null);
              }}
              className={`p-1.5 rounded transition-colors ${
                viewMode === 'kanban' 
                  ? 'bg-[rgba(30,25,20,0.06)] dark:bg-[rgba(255,255,255,0.08)] text-[#1a1a18] dark:text-[#e8e7e3]' 
                  : 'text-[#9a9892] dark:text-[#66645f] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] hover:text-[#6b6963] dark:hover:text-[#9a9893]'
              }`}
              title="Kanban View"
            >
              <KanbanColumnsIcon className="w-[18px] h-[18px]" />
            </button>
          </div>

          <TimelineNavBar
            showViewToggle={viewMode === 'grid'}
            view={view}
            onView={setView}
            onPrev={handleTimelinePrev}
            onToday={handleTimelineToday}
            onNext={handleTimelineNext}
          />

          <CompactSearch value={search} onChange={setSearch} />

          <button
            type="button"
            onClick={() => setFiltersExpanded((v) => !v)}
            title={filtersExpanded ? 'Hide filters' : 'Show filters'}
            aria-pressed={filtersExpanded}
            className={`p-1.5 rounded transition-colors ${
              filtersExpanded || anyFilterActive
                ? 'bg-[var(--accent-bg-soft)] dark:bg-[var(--accent-bg-soft-dark)] text-[var(--accent-3)] dark:text-[var(--accent-1)]'
                : 'text-[#9a9892] dark:text-[#66645f] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] hover:text-[#1a1a18] dark:hover:text-[#e8e7e3]'
            }`}
          >
            <FilterIcon className="w-4 h-4" />
          </button>

          {filtersExpanded && (
            <TaskFilterBar
              inline
              statusOptions={timelineFilterOptions.statuses}
              statusSelected={statusSel}
              onStatusChange={setStatusSel}
              assigneeOptions={timelineFilterOptions.assignees}
              assigneeSelected={assigneeSel}
              onAssigneeChange={setAssigneeSel}
              departmentOptions={timelineFilterOptions.departments}
              departmentSelected={deptSel}
              onDepartmentChange={setDeptSel}
              priorityOptions={timelineFilterOptions.priorities}
              prioritySelected={prioritySel}
              onPriorityChange={setPrioritySel}
              propertyOptions={timelineFilterOptions.propertiesOpt}
              propertySelected={propSel}
              onPropertyChange={setPropSel}
              onClearAll={clearAllFilters}
              anyFilterActive={anyFilterActive}
              totalCount={allScheduledTasks.length}
              filteredCount={displayedScheduledTasks.length}
            />
          )}

          {/* Right-anchored controls — ml-auto keeps them flush with the
              right edge whether or not the filter pills are expanded inline.
              `flex-shrink-0` guards against ever wrapping or being crushed
              by a long chip strip; the chip lane handles its own overflow. */}
          <div className="ml-auto flex items-center gap-3 flex-shrink-0">
            <WeatherWidgetTrigger />

            <button
              type="button"
              onClick={handleCreateProjectFromHeader}
              title="Create Task"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-[var(--accent-3)] text-white hover:bg-[var(--accent-4)] dark:bg-[var(--accent-2)] dark:hover:bg-[var(--accent-1)] dark:text-[#1a1a1a] transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              New task
            </button>
          </div>
        </div>
        </div>
      </div>

      {/* Content Area - Grid or Kanban based on viewMode */}
      {viewMode === 'grid' ? (
      <DndContext
        sensors={dndSensors}
        collisionDetection={closestCenter}
        modifiers={dndModifiers}
        autoScroll={false}
        onDragStart={handleTaskDragStart}
        onDragEnd={handleTaskDragEnd}
        onDragCancel={handleTaskDragCancel}
      >
      <div ref={scrollLockRef} className="flex-1 overflow-auto pb-4">
          <div
            ref={gridRef}
            className="grid border border-[rgba(30,25,20,0.06)] dark:border-[var(--timeline-border-subtle)] w-full overflow-x-clip"
            style={{
              gridTemplateColumns: `200px repeat(${dateRange.length}, minmax(0, 1fr))`
            }}
          >
            {/* Header Row - will stick when scrolling */}
            <div className="bg-white dark:bg-[var(--timeline-surface-2)] border-b border-r border-[rgba(30,25,20,0.06)] dark:border-[var(--timeline-border-subtle)] px-2 py-1 text-xs font-semibold text-[#6b6963] dark:text-[#9a9893] uppercase tracking-[0.06em] sticky left-0 top-0 z-30 flex items-center gap-1.5">
              {view !== 'month' && (
                <button
                  onClick={toggleAllExpanded}
                  className="p-0.5 rounded hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                  title={expandedProperties.size === displayedProperties.length ? 'Collapse all' : 'Expand all'}
                >
                  <svg className={`w-3 h-3 transition-transform duration-200 ${expandedProperties.size === displayedProperties.length ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}
              Property
            </div>
            {dateRange.map((date, idx) => {
              const isTodayDate = isToday(date);
              return (
                <div 
                  key={idx} 
                  className={`px-3 py-2.5 border-b border-r border-[rgba(30,25,20,0.06)] dark:border-[var(--timeline-border-subtle)] sticky top-0 z-20 cursor-pointer transition-colors ${
                    isTodayDate 
                      ? 'today-tint'
                      : 'bg-white dark:bg-[var(--timeline-surface-2)] hover:bg-[#f4f3f1] dark:hover:bg-[#222228]'
                  }`}
                  onClick={() => { closeGlobals(); setSelectedDay(date); }}
                >
                  {formatHeaderDate(date, isTodayDate)}
                </div>
              );
            })}

            {/* Property Rows */}
            {displayedProperties.map((property) => {
              const propertyReservations = getReservationsForProperty(property);
              const propertyBlocks = getBlocksForProperty(property);
              const activeTurnover = getActiveTurnoverForProperty(propertyReservations);

              const propertyCellBg = 'bg-white dark:bg-[var(--timeline-surface-2)]';

              return (
                <div
                  key={property}
                  className="contents"
                >
                  {/* Property Name with Status Indicator */}
                  <div className={`relative overflow-hidden px-2 text-[12px] font-medium text-[#1a1a18] dark:text-[#e8e7e3] border-b border-r border-[rgba(30,25,20,0.06)] dark:border-[var(--timeline-border-subtle)] sticky left-0 z-10 h-[44px] ${propertyCellBg} flex items-center gap-1.5`}>
                    {view !== 'month' && (
                      <button
                        onClick={() => togglePropertyExpanded(property)}
                        className="p-0.5 rounded hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.05)] transition-colors shrink-0"
                      >
                        <svg className={`w-3 h-3 transition-transform duration-200 ${expandedProperties.has(property) ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    )}
                    {(() => {
                      const propertyId = propertyIdByName.get(property);
                      return propertyId ? (
                        <a
                          href={`/properties/${propertyId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 min-w-0 truncate mr-14 px-1.5 py-0.5 rounded-md cursor-pointer hover:bg-[rgba(30,25,20,0.06)] dark:hover:bg-[rgba(255,255,255,0.06)] transition-colors"
                          title={`Open ${property}`}
                        >
                          {property}
                        </a>
                      ) : (
                        <span className="flex-1 min-w-0 truncate pr-14">{property}</span>
                      );
                    })()}
                    {activeTurnover && (() => {
                      return (
                        <Popover>
                          <PopoverTrigger asChild>
                            <div className="absolute right-0 top-0 bottom-0 w-16 flex items-center justify-end pr-2 cursor-pointer">
                              <div className="flex items-center px-2 py-1 rounded-lg bg-[rgba(30,25,20,0.06)] dark:bg-[rgba(255,255,255,0.06)] text-[#9a9892] dark:text-[#66645f] hover:bg-[rgba(30,25,20,0.10)] dark:hover:bg-[rgba(255,255,255,0.10)] transition-colors">
                                <ClipboardCheck className="w-3 h-3" />
                              </div>
                            </div>
                          </PopoverTrigger>
                          <PopoverContent side="right" align="start" sideOffset={4} collisionPadding={16} className="w-72 p-0 bg-white dark:bg-[var(--timeline-surface-4)] border border-[rgba(30,25,20,0.08)] dark:border-[var(--timeline-border-strong)] shadow-lg">
                            {/* Header with close button */}
                            <div className="flex items-center justify-between px-3 py-2 border-b border-[rgba(30,25,20,0.06)] dark:border-[var(--timeline-border-subtle)]">
                              <p className="text-sm font-medium">{property}</p>
                              <PopoverClose className="p-1 hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.05)] rounded-md transition-colors text-[#9a9892] dark:text-[#66645f]">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </PopoverClose>
                            </div>
                            
                            <div className="px-2 py-2">
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">
                                Active Turnover: ({activeTurnover.completed_tasks || 0}/{activeTurnover.total_tasks || 0})
                              </p>
                              <div className="flex flex-col gap-2 max-h-40 overflow-y-auto subtle-scrollbar">
                                {activeTurnover.tasks && activeTurnover.tasks.length > 0 ? (
                                  activeTurnover.tasks.map((task) => {
                                    const rowStyle = getRowStyles(task.status);
                                    return (
                                      <div 
                                        key={task.task_id} 
                                        className={`flex items-center justify-between gap-2 py-2 px-2.5 shrink-0 cursor-pointer transition-all duration-150 hover:shadow-md hover:scale-[1.01] active:scale-[0.99] ${rowStyle}`}
                                        onClick={() => {
                                          closeGlobals();
                                          setFloatingData({
                                            type: 'task',
                                            item: task,
                                            propertyName: activeTurnover.property_name,
                                          });
                                        }}
                                      >
                                        <span className="truncate text-sm">{task.title || task.template_name || 'Task'}</span>
                                      </div>
                                    );
                                  })
                                ) : (
                                  <p className="text-sm text-muted-foreground px-1">No tasks</p>
                                )}
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
                      );
                    })()}
                  </div>

                  {/* Date Cells with embedded reservations */}
                  {dateRange.map((date, idx) => {
                    const isTodayDate = isToday(date);
                    const cellDateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                    const startingReservation = propertyReservations.find(res => {
                      const { start } = getBlockPosition(res.check_in, res.check_out);
                      return start === idx;
                    });
                    // A manual/maintenance block covering THIS day (inclusive
                    // range) → darkened cell + center ✕ + hover card, instead
                    // of a reservation-style bar.
                    const blockForCell = propertyBlocks.find((b) => {
                      const ci = b.check_in.slice(0, 10);
                      const co = b.check_out.slice(0, 10);
                      return cellDateStr >= ci && cellDateStr <= co;
                    });

                    return (
                      <DroppableDateCell
                        key={idx}
                        property={property}
                        dateStr={cellDateStr}
                        className={`group border-b border-r border-[rgba(30,25,20,0.06)] dark:border-[var(--timeline-border-subtle)] h-[44px] relative overflow-visible ${blockForCell ? 'bg-[#f0eff2] dark:bg-[#212126]' : isTodayDate ? 'today-tint' : 'bg-white dark:bg-[var(--timeline-surface-2)]'}`}
                        onClick={() => {
                          const res = propertyReservations.find(r => {
                            const pos = getBlockPosition(r.check_in, r.check_out);
                            return idx >= pos.start && idx < pos.start + pos.span;
                          });
                          if (res) {
                            openReservationViewer(res.id);
                          }
                        }}
                      >
                        {startingReservation && (() => {
                          const { span, startsBeforeRange, endsAfterRange } = getBlockPosition(startingReservation.check_in, startingReservation.check_out);

                          const reachesLastColumn = idx + span >= dateRange.length;
                          const flushRight = endsAfterRange || reachesLastColumn;

                          // Pixel geometry off the measured column width so the
                          // check-in start and check-out end land at the same
                          // in-cell fraction for every bar, independent of span.
                          // (Cell-relative % drifts because span*100% of one cell
                          // ≠ the summed width of N rounded 1fr tracks.)
                          const START_FRAC = 0.60; // into the check-in cell
                          const END_FRAC = 0.40;   // into the check-out cell
                          const cw = colWidth;
                          let leftStyle: string;
                          let widthStyle: string;
                          if (cw > 0) {
                            const left = startsBeforeRange ? 0 : START_FRAC * cw;
                            const rightEdge = flushRight
                              ? span * cw
                              : (span - 1) * cw + END_FRAC * cw;
                            leftStyle = `${left}px`;
                            widthStyle = `${Math.max(8, rightEdge - left)}px`;
                          } else {
                            // First paint / SSR before the observer fires.
                            const lo = startsBeforeRange ? 0 : 50;
                            const ro = flushRight ? 0 : 50;
                            const tw = (span * 100) - lo - ro;
                            leftStyle = `${lo}%`;
                            widthStyle = flushRight ? `${tw + 20}%` : `${tw}%`;
                          }

                          const diagonalPx = 12;
                          const leftDiagonal = startsBeforeRange ? '0px' : `${diagonalPx}px`;
                          const rightDiagonal = flushRight ? '0px' : `${diagonalPx}px`;
                          const clipPath = `polygon(${leftDiagonal} 0%, 100% 0%, calc(100% - ${rightDiagonal}) 100%, 0% 100%)`;

                          // Reservation bar color — single shared lavender.
                          // Status (not_started / in_progress / complete) is
                          // communicated by the per-card progress bar, not by
                          // the bar's color. Tokens live in globals.css
                          // (--turnover-purple-bg / --turnover-purple-border)
                          // so TurnoverCards, MobileTimelineView, and the
                          // property Schedule MonthGrid all stay in lockstep.
                          // Opaque fill (the exact blend of the translucent
                          // gray over the cell surface) so the faint vertical
                          // gridlines beneath the bar are fully occluded rather
                          // than bleeding through. The bar's top:8/height:28
                          // inset keeps it off the horizontal borders, so those
                          // stay visible as before.
                          const isOwnerStay = startingReservation.kind === 'owner_stay';
                          const barColorClass = isOwnerStay
                            ? 'bg-[#e9d5a8] border-[rgba(180,130,60,0.55)] dark:bg-[#43391f] dark:border-[rgba(214,158,74,0.45)]'
                            : 'bg-[#d9d7d6] border-[rgba(120,113,108,0.55)] dark:bg-[#343234] dark:border-[rgba(168,158,150,0.45)]';

                          const barClassName =`absolute cursor-pointer transition-all duration-150 text-[#1a1a18] dark:text-[#e8e7e3] text-[11px] font-medium flex items-center overflow-hidden border-t ${barColorClass} ${selectedReservation?.id === startingReservation.id ? 'ring-2 ring-[rgba(120,113,108,0.6)] dark:ring-[rgba(168,158,150,0.6)] shadow-lg z-30' : ''}`;
                          const barStyle: React.CSSProperties = {
                            left: leftStyle,
                            top: '8px',
                            height: '28px',
                            width: widthStyle,
                            zIndex: 15,
                            clipPath,
                            borderRadius: startsBeforeRange && flushRight
                              ? '0'
                              : startsBeforeRange
                              ? '0 8px 8px 0'
                              : flushRight
                              ? '8px 0 0 8px'
                              : '8px',
                          };
                          return (
                            <ReservationHoverBar
                              reservation={startingReservation}
                              propertyName={property}
                              propertyReservations={propertyReservations}
                              className={barClassName}
                              style={barStyle}
                              showLabel={!startsBeforeRange}
                              labelPaddingPx={diagonalPx + 6}
                              formatDate={formatDate}
                              onOpen={openReservationViewer}
                            />
                          );
                        })()}
                        
                        {/* Manual/maintenance block: the cell is darkened
                            (above); this adds the small center ✕ + a hover card
                            showing the note. No reservation-style bar. */}
                        {blockForCell && (
                          <BlockedDayMarker note={blockForCell.note ?? null} propertyName={property} />
                        )}

                        {/* Scheduled tasks icons */}
                        <ScheduledItemsCell
                          propertyName={property}
                          date={date}
                          tasks={displayedScheduledTasks}
                          projects={[]}
                          viewMode={view}
                          expanded={expandedProperties.has(property)}
                          onTaskClick={(task) => {
                            closeGlobals();
                            setFloatingData({
                              type: 'task',
                              item: task,
                              propertyName: property,
                            });
                          }}
                        />

                        <button
                          className="absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border border-[rgba(30,25,20,0.10)] dark:border-[var(--timeline-border-strong)] bg-white dark:bg-[var(--timeline-surface-4)] text-[#9a9892] dark:text-[#66645f] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[var(--timeline-hover)] hover:text-[#1a1a18] dark:hover:text-[#e8e7e3] transition-all z-20 flex items-center justify-center opacity-0 group-hover:opacity-100 focus:outline-none"
                          title="Create task for this day"
                          onClick={(e) => {
                            e.stopPropagation();
                            e.currentTarget.blur();
                            handleCreateProjectFromTimelineCell(property, date);
                          }}
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m7-7H5" />
                          </svg>
                        </button>
                      </DroppableDateCell>
                    );
                  })}

                  {/* Expanded Detail Row */}
                  {view !== 'month' && expandedProperties.has(property) && (
                    <>
                      {/* Property column for expanded row — empty */}
                      <div className={`sticky left-0 z-10 border-b border-r border-[rgba(30,25,20,0.06)] dark:border-[var(--timeline-border-subtle)] ${propertyCellBg}`} />

                      {/* Date columns for expanded row */}
                      {dateRange.map((date, idx) => {
                        const isTodayDate = isToday(date);
                        const cellDateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                        const dateTasks = displayedScheduledTasks.filter(
                          (t) => t.property_name === property && t.scheduled_date === cellDateStr
                        );
                        const hasItems = dateTasks.length > 0;

                        return (
                          <div
                            key={`expanded-${idx}`}
                            className={`border-b border-r border-[rgba(30,25,20,0.06)] dark:border-[var(--timeline-border-subtle)] p-1.5 ${
                              isTodayDate ? 'today-tint' : 'bg-white dark:bg-[var(--timeline-surface-2)]'
                            }`}
                          >
                            {hasItems && (
                              <TaskRowList
                                tasks={dateTasks}
                                onTaskClick={(task) => {
                                  closeGlobals();
                                  setFloatingData({
                                    type: 'task',
                                    item: task,
                                    propertyName: property,
                                  });
                                }}
                              />
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              );
            })}
          </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {draggingTask ? (
          <div
            className="w-6 h-6 rounded shadow-lg"
            style={{ background: marbleBackground[draggingTask.status] || marbleBackground.not_started }}
          />
        ) : null}
      </DragOverlay>
      </DndContext>
      ) : (
        /* Full-screen Kanban View */
        <div className="flex-1 overflow-hidden">
          <DayKanban
            date={kanbanDate}
            tasks={displayedScheduledTasks}
            users={users}
            openTaskId={
              floatingData?.type === 'task' ? (floatingData.item as Task).task_id : null
            }
            onClose={() => setViewMode('grid')}
            onTaskClick={(task, propertyName) => {
              closeGlobals();
              setFloatingData({
                type: 'task',
                item: task,
                propertyName,
              });
            }}
            onAssignChange={handleTimelineKanbanAssign}
            isFullScreen
          />
        </div>
      )}

      {/* Day Detail Panel - opens when a day header in the grid is clicked.
          Shared component also used on the per-property Schedule tab. Task
          clicks / reservation clicks / "New task" route into the existing
          Timeline detail-panel pipeline via setFloatingData, keeping one
          canonical editor for each item type. */}
      {selectedDay && dayPanelData && !floatingData && (
        <div
          className={DESKTOP_TIMELINE_DETAIL_PANEL_FLEX}
          onWheel={(e) => e.stopPropagation()}
        >
          <DayDetailPanel
            date={selectedDay}
            title="All properties"
            onClose={() => setSelectedDay(null)}
            tasks={dayPanelData.dayTasks}
            onTaskClick={handleOpenTaskFromDay}
            showPropertyOnRows
            onNewTask={handleNewTaskFromDay}
          />
        </div>
      )}

      {/* Right Panel Overlay - Detail View
          Block layout + overflow-y-auto — TaskDetailPanel fills its host and
          manages its own interior scroll; the turnover branch below still
          expects the outer container to scroll. */}
      {floatingData && (
        <div
          className={
            floatingData.type === 'task'
              ? DESKTOP_TASK_PANEL_SLOT
              : `${DESKTOP_TIMELINE_DETAIL_PANEL_CLASS} overflow-y-auto`
          }
          onWheel={(e) => e.stopPropagation()}
        >
          {floatingData.type === 'task' ? (() => {
            const item = floatingData.item as Task;
            const isDraftTask = item.task_id.startsWith('draft-');
            return (
              <TaskDetailPanel
                task={isDraftTask ? null : taskToTaskDetailInput(item, floatingData.propertyName)}
                draft={isDraftTask ? taskToDraft(item) : null}
                onDraftChange={
                  isDraftTask
                    ? (d: TaskDraft) => {
                        setFloatingData(prev =>
                          prev && prev.type === 'task'
                            ? { ...prev, item: applyDraftToTask(item, d, users), propertyName: d.property_name || prev.propertyName }
                            : prev
                        );
                      }
                    : undefined
                }
                onConfirmCreate={isDraftTask ? handleConfirmCreateTaskTimeline : undefined}
                creating={creatingTask}
                onClose={handleCloseFloatingWindow}
                onDeleted={() => {
                  setRecurringTasks(prev => prev.filter((t: any) => t.task_id !== item.task_id));
                  handleCloseFloatingWindow();
                }}
                onOpenInPage={
                  !isDraftTask
                    ? () => {
                        const id = item.task_id;
                        handleCloseFloatingWindow();
                        router.push(taskPath(id));
                      }
                    : undefined
                }
              />
            );
          })() : floatingData.type === 'turnover' ? (
            /* Turnover Detail Panel */
            <div className="flex flex-col h-full">
              {/* Sticky Header - Property Info + Toggle */}
              <div className="sticky top-0 bg-white/40 dark:bg-white/[0.04] backdrop-blur-2xl z-10 border-b border-white/20 dark:border-white/10">
                {/* Top Row: Property name, Guest, Dates, Occupancy, Close button */}
                <div className="p-4 pb-3">
                  <div className="flex items-start justify-between gap-4">
                    {/* Property & Guest */}
                    <div className="flex-1 min-w-0">
                      <h2 className="text-lg font-semibold truncate">{(floatingData.item as Turnover).property_name}</h2>
                      {(floatingData.item as Turnover).guest_name && (
                        <div className="flex items-center gap-1.5 mt-0.5 text-sm text-neutral-500">
                          <svg className="w-3.5 h-3.5 text-purple-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                          <span className="truncate">{(floatingData.item as Turnover).guest_name}</span>
                        </div>
                      )}
                    </div>

                    {/* Dates & Occupancy - Compact */}
                    <div className="flex items-center gap-3 text-xs">
                      <div className="text-center">
                        <div className="text-neutral-500 dark:text-neutral-400">In</div>
                        <div className="font-medium text-blue-600 dark:text-blue-400">
                          {(floatingData.item as Turnover).check_in ? new Date((floatingData.item as Turnover).check_in!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-neutral-500 dark:text-neutral-400">Out</div>
                        <div className="font-medium text-red-600 dark:text-red-400">
                          {(floatingData.item as Turnover).check_out ? new Date((floatingData.item as Turnover).check_out!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-neutral-500 dark:text-neutral-400">Next In</div>
                        <div className="font-medium text-green-600 dark:text-green-400">
                          {(floatingData.item as Turnover).next_check_in ? new Date((floatingData.item as Turnover).next_check_in!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                        </div>
                      </div>
                    </div>

                    {/* Close Button */}
                    <button
                      onClick={handleCloseFloatingWindow}
                      className="p-1.5 hover:bg-white/40 dark:hover:bg-white/10 rounded-lg transition-colors shrink-0"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Toggle Button Row */}
                <div className="px-4 pb-3">
                  <div className="flex rounded-xl bg-white/20 dark:bg-white/[0.05] backdrop-blur-sm border border-white/20 dark:border-white/10 p-1">
                    <button
                      onClick={() => setTurnoverRightPanelView('tasks')}
                      className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                        turnoverRightPanelView === 'tasks'
                          ? 'bg-white/60 dark:bg-white/15 text-neutral-900 dark:text-white shadow-sm'
                          : 'text-neutral-500 dark:text-neutral-400 hover:bg-white/20 dark:hover:bg-white/10'
                      }`}
                    >
                      Turnover Tasks ({(floatingData.item as Turnover).completed_tasks || 0}/{(floatingData.item as Turnover).total_tasks || 0})
                    </button>
                    <button
                      onClick={() => setTurnoverRightPanelView('projects')}
                      className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                        turnoverRightPanelView === 'projects'
                          ? 'bg-white/60 dark:bg-white/15 text-neutral-900 dark:text-white shadow-sm'
                          : 'text-neutral-500 dark:text-neutral-400 hover:bg-white/20 dark:hover:bg-white/10'
                      }`}
                    >
                      Property Projects ({projects.filter(p => p.property_name === (floatingData.item as Turnover).property_name).length})
                    </button>
                  </div>
                </div>
              </div>

              {/* Scrollable Content */}
              <div className={`flex-1 overflow-y-auto hide-scrollbar ${turnoverRightPanelView === 'tasks' ? 'p-4 space-y-3' : ''}`}>
                {turnoverRightPanelView === 'tasks' ? (
                  <TurnoverTaskList
                    selectedCard={floatingData.item as Turnover}
                    users={users}
                    taskTemplates={taskTemplates as Record<string, Template>}
                    availableTemplates={availableTemplates}
                    showAddTaskDialog={showAddTaskDialog}
                    setShowAddTaskDialog={setShowAddTaskDialog}
                    onTaskClick={handleTurnoverTaskClick}
                    onDeleteTask={deleteTaskFromTurnover}
                    onUpdateSchedule={updateTurnoverTaskSchedule}
                    onUpdateAssignment={updateTurnoverTaskAssignment}
                    onAddTask={addTaskToTurnover}
                    onFetchTemplates={fetchAvailableTemplates}
                    fetchTaskTemplate={fetchTaskTemplate}
                  />
                ) : (
                  <TurnoverProjectsPanel
                    propertyName={(floatingData.item as Turnover).property_name}
                    projects={projects}
                    users={users}
                    onOpenProjectInWindow={() => {}}
                  />
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}

    </div>
  );
}
