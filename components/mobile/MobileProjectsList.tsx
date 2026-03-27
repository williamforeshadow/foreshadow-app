'use client';

import { memo, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { UserAvatar } from '@/components/ui/user-avatar';
import type { Project, User, ProjectBin, ProjectStatus, ProjectPriority } from '@/lib/types';

// ============================================================================
// Types
// ============================================================================

interface MobileProjectsListProps {
  projects: Project[];
  users: User[];
  binName: string;
  viewMode: 'status' | 'priority' | 'property';
  onBack: () => void;
  onSelectProject: (project: Project) => void;
  onCreateProject: () => void;
}

// ============================================================================
// Config
// ============================================================================

const STATUS_CONFIG: Record<string, { dot: string; label: string; bg: string }> = {
  not_started: { dot: 'bg-amber-500', label: 'Not Started', bg: 'bg-amber-500/10' },
  in_progress: { dot: 'bg-indigo-500', label: 'In Progress', bg: 'bg-indigo-500/10' },
  on_hold: { dot: 'bg-neutral-400', label: 'On Hold', bg: 'bg-neutral-400/10' },
  complete: { dot: 'bg-emerald-500', label: 'Complete', bg: 'bg-emerald-500/10' },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  urgent: { label: 'Urgent', color: 'text-red-500' },
  high: { label: 'High', color: 'text-orange-500' },
  medium: { label: 'Medium', color: 'text-blue-500' },
  low: { label: 'Low', color: 'text-slate-400' },
};

const STATUS_ORDER: ProjectStatus[] = ['in_progress', 'not_started', 'on_hold', 'complete'];
const PRIORITY_ORDER: ProjectPriority[] = ['urgent', 'high', 'medium', 'low'];

// ============================================================================
// Component
// ============================================================================

const MobileProjectsList = memo(function MobileProjectsList({
  projects,
  users,
  binName,
  viewMode,
  onBack,
  onSelectProject,
  onCreateProject,
}: MobileProjectsListProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(STATUS_ORDER.slice(0, 2))
  );

  // Group projects based on view mode
  const grouped = useMemo(() => {
    if (viewMode === 'status') {
      return STATUS_ORDER.map((status) => ({
        key: status,
        label: STATUS_CONFIG[status]?.label || status,
        items: projects.filter((p) => p.status === status),
      }));
    }
    if (viewMode === 'priority') {
      return PRIORITY_ORDER.map((priority) => ({
        key: priority,
        label: PRIORITY_CONFIG[priority]?.label || priority,
        items: projects.filter((p) => p.priority === priority),
      }));
    }
    // Property grouping
    const byProperty = new Map<string, Project[]>();
    projects.forEach((p) => {
      const key = p.property_name || 'No Property';
      if (!byProperty.has(key)) byProperty.set(key, []);
      byProperty.get(key)!.push(p);
    });
    return Array.from(byProperty.entries()).map(([key, items]) => ({
      key,
      label: key,
      items,
    }));
  }, [projects, viewMode]);

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-sm text-neutral-500 dark:text-neutral-400"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white truncate">{binName}</h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {projects.length} project{projects.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={onCreateProject}
            className="p-2 rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 active:scale-95 transition-all"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto hide-scrollbar" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="p-4 space-y-3">
          {grouped.map((group) => {
            const isExpanded = expandedGroups.has(group.key);
            const statusCfg = STATUS_CONFIG[group.key];

            return (
              <div key={group.key}>
                {/* Group header */}
                <button
                  onClick={() => toggleGroup(group.key)}
                  className="w-full flex items-center gap-3 py-2 px-1"
                >
                  <svg
                    className={`w-3.5 h-3.5 text-neutral-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  {statusCfg && <span className={`w-2 h-2 rounded-full ${statusCfg.dot}`} />}
                  <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{group.label}</span>
                  <span className="text-xs text-neutral-400 ml-auto">{group.items.length}</span>
                </button>

                {/* Project cards */}
                {isExpanded && (
                  <div className="space-y-2 mt-1 ml-2">
                    {group.items.map((project) => (
                      <ProjectCard
                        key={project.id}
                        project={project}
                        users={users}
                        onSelect={() => onSelectProject(project)}
                      />
                    ))}
                    {group.items.length === 0 && (
                      <p className="text-xs text-neutral-400 py-3 pl-3 italic">No projects</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {projects.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-neutral-400">
              <svg className="w-12 h-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm font-medium">No projects yet</p>
              <button
                onClick={onCreateProject}
                className="mt-3 text-xs font-medium text-emerald-500 active:text-emerald-600"
              >
                + Create one
              </button>
            </div>
          )}

          <div className="h-4" />
        </div>
      </div>
    </div>
  );
});

// ============================================================================
// Project Card
// ============================================================================

function ProjectCard({
  project,
  users,
  onSelect,
}: {
  project: Project;
  users: User[];
  onSelect: () => void;
}) {
  const assignedUsers = users.filter(
    (u) => project.project_assignments?.some((a) => a.user_id === u.id)
  );
  const statusCfg = STATUS_CONFIG[project.status] || STATUS_CONFIG.not_started;
  const priorityCfg = PRIORITY_CONFIG[project.priority] || PRIORITY_CONFIG.medium;

  return (
    <button
      onClick={onSelect}
      className="w-full text-left p-3.5 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/60 active:scale-[0.99] transition-all shadow-sm"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-neutral-900 dark:text-white truncate">
            {project.title}
          </p>
          {project.property_name && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 truncate">
              {project.property_name}
            </p>
          )}
        </div>
        <span className={`text-[10px] font-semibold uppercase ${priorityCfg.color}`}>
          {priorityCfg.label}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-2">
        {/* Status badge */}
        <div className={`inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full ${statusCfg.bg} ${statusCfg.dot.replace('bg-', 'text-')}`}>
          <span className={`w-1 h-1 rounded-full ${statusCfg.dot}`} />
          {statusCfg.label}
        </div>
        {/* Scheduled date */}
        {project.scheduled_date && (
          <span className="text-[10px] text-neutral-400">
            {new Date(project.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}
        {/* Assignees */}
        {assignedUsers.length > 0 && (
          <div className="flex -space-x-1 ml-auto">
            {assignedUsers.slice(0, 3).map((u) => (
              <UserAvatar key={u.id} src={u.avatar} name={u.name} size="xs" className="ring-1 ring-white dark:ring-neutral-900" />
            ))}
            {assignedUsers.length > 3 && (
              <span className="text-[9px] text-neutral-400 ml-1">+{assignedUsers.length - 3}</span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

export default MobileProjectsList;
