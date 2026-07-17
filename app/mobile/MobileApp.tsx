'use client';

import { useState, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUsers } from '@/lib/useUsers';
import { useProperties } from '@/lib/queries';
import {
  MobileLayout,
  MobileTimelineView,
  MobileMyAssignmentsView,
  MobileProjectsView,
  type MobileTab
} from '@/components/mobile';
import type { Project, Task } from '@/lib/types';
import { TaskDetailPanel } from '@/components/tasks/detail/TaskDetailPanel';
import { projectToTaskInput } from '@/components/tasks/detail/taskInput';
import { ReservationDetailOverlay } from '@/components/reservations/ReservationDetailOverlay';
import { ContextTaskDetailOverlay } from '@/components/reservations/ContextTaskDetailOverlay';
import { useExclusiveDetailPanelHost } from '@/lib/reservationViewerContext';

export default function MobileApp() {
  const router = useRouter();
  const { users } = useUsers();

  // Fetch properties list (replaces projectsHook.allProperties)
  const { properties: allProperties } = useProperties();

  // Tab state is driven by ?tab= so the drawer (rendered from any route) can
  // navigate cross-route into the right workspace view via router.push().
  // Default (no param) = My Assignments.
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab');
  const mobileView: MobileTab =
    tabParam === 'projects' || tabParam === 'timeline' ? tabParam : 'assignments';

  // Keep-mounted tabs: a view mounts on first visit and stays mounted (hidden
  // via CSS) afterwards, so flipping tabs preserves data, filters, scroll, and
  // nav state instead of cold-starting every time. Views refresh themselves
  // quietly when re-shown (see their isActive prop).
  const [visitedTabs, setVisitedTabs] = useState<Set<MobileTab>>(() => new Set([mobileView]));
  if (!visitedTabs.has(mobileView)) {
    // Render-phase state adjustment (React's "adjusting state when a prop
    // changes" pattern) — re-renders immediately, before children mount.
    setVisitedTabs(new Set(visitedTabs).add(mobileView));
  }

  const [mobileSelectedTask, setMobileSelectedTask] = useState<Task | null>(null);
  const [mobileSelectedProject, setMobileSelectedProject] = useState<Project | null>(null);
  const [mobileRefreshTrigger, setMobileRefreshTrigger] = useState(0);

  // Strict single-panel rule: when any global detail panel (reservation
  // overlay or context task overlay) opens, close the mobile-shell panels.
  const closeGlobals = useExclusiveDetailPanelHost(() => {
    setMobileSelectedTask(null);
    setMobileSelectedProject(null);
  });

  // Transform Task → Project shape for unified detail panel
  const taskAsProject = useMemo((): Project | null => {
    if (!mobileSelectedTask) return null;
    const task = mobileSelectedTask;
    const status: Project['status'] =
      task.status === 'contingent' ? 'not_started' : task.status;
    const priority: Project['priority'] =
      task.priority === 'urgent' ||
      task.priority === 'high' ||
      task.priority === 'medium' ||
      task.priority === 'low'
        ? task.priority
        : 'medium';
    // Task API only carries property_name; resolve to property_id via the
    // already-loaded allProperties list so the scheduled-date picker can
    // load reservations for this task's property.
    const resolvedPropertyId =
      (task as { property_id?: string | null }).property_id ||
      allProperties.find((p) => p.name === task.property_name)?.id ||
      null;
    return {
      id: task.task_id,
      property_id: resolvedPropertyId,
      property_name: task.property_name || null,
      bin_id: task.bin_id ?? null,
      is_binned: task.is_binned ?? false,
      template_id: task.template_id ?? null,
      template_name: task.template_name ?? null,
      title: task.title || task.template_name || 'Task',
      description: task.description || null,
      status,
      priority,
      assigned_user_ids: task.assigned_users?.map(u => u.user_id) || [],
      project_assignments: task.assigned_users?.map(u => ({
        user_id: u.user_id,
        user: { id: u.user_id, name: u.name, email: '', role: u.role || 'staff', avatar: u.avatar },
      })) || [],
      department_id: task.department_id || null,
      department_name: task.department_name || null,
      scheduled_date: task.scheduled_date || null,
      scheduled_time: task.scheduled_time || null,
      reservation_id: task.reservation_id ?? null,
      form_metadata: task.form_metadata,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }, [mobileSelectedTask, allProperties]);

  return (
    <>
      <MobileLayout>
        {visitedTabs.has('assignments') && (
          <div className={mobileView === 'assignments' ? 'h-full' : 'hidden'}>
          <MobileMyAssignmentsView
            isActive={mobileView === 'assignments'}
            onTaskClick={(task: Task) => {
              closeGlobals();
              setMobileSelectedTask(task);
            }}
            onProjectClick={(project: Project) => {
              closeGlobals();
              setMobileSelectedProject(project);
            }}
            refreshTrigger={mobileRefreshTrigger}
          />
          </div>
        )}

        {visitedTabs.has('projects') && (
          <div className={mobileView === 'projects' ? 'h-full' : 'hidden'}>
          <MobileProjectsView
            isActive={mobileView === 'projects'}
            users={users}
          />
          </div>
        )}

        {visitedTabs.has('timeline') && (
          <div className={mobileView === 'timeline' ? 'h-full' : 'hidden'}>
          <MobileTimelineView
            isActive={mobileView === 'timeline'}
            onCardClick={() => {}}
            refreshTrigger={mobileRefreshTrigger}
            onTaskClick={(task: Task) => {
              closeGlobals();
              setMobileSelectedTask(task);
            }}
            onNewTask={({ propertyName, dateStr }) => {
              // Mobile timeline only knows property *names*, but the task
              // ledger route is keyed by id. Resolve via allProperties; if
              // the lookup fails we silently no-op rather than push a
              // broken URL.
              const match = allProperties.find((p) => p.name === propertyName);
              if (!match) return;
              router.push(`/properties/${match.id}/tasks?newTaskDate=${dateStr}`);
            }}
          />
          </div>
        )}

      </MobileLayout>

      {/* Task Detail overlay */}
      {mobileSelectedTask && taskAsProject && (
        <TaskDetailPanel
          task={projectToTaskInput(taskAsProject, users)}
          onClose={() => {
            setMobileSelectedTask(null);
            setMobileRefreshTrigger(prev => prev + 1);
          }}
          onDeleted={() => setMobileSelectedTask(null)}
        />
      )}

      {/* Project Detail overlay (from My Assignments) */}
      {mobileSelectedProject && (
        <TaskDetailPanel
          task={projectToTaskInput(mobileSelectedProject, users)}
          onClose={() => {
            setMobileSelectedProject(null);
            setMobileRefreshTrigger(prev => prev + 1);
          }}
          onDeleted={() => setMobileSelectedProject(null)}
        />
      )}
      {/* Reservation + context task overlays.
          Mobile renders both as `fixed inset-0` sheets, so anchor location
          doesn't matter — only one is rendered at a time (mutual exclusion
          enforced in ReservationViewerProvider). */}
      <ReservationDetailOverlay />
      <ContextTaskDetailOverlay />
    </>
  );
}
