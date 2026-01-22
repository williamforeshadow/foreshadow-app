'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Project {
  id: string;
  property_name: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  assigned_staff?: string;
  scheduled_start?: string;
  created_at: string;
}

interface MobileProjectsViewProps {
  projects: Project[];
  isLoading: boolean;
  onRefresh: () => void;
  onCreateProject: () => void;
  onEditProject: (project: Project) => void;
}

export default function MobileProjectsView({
  projects,
  isLoading,
  onRefresh,
  onCreateProject,
  onEditProject,
}: MobileProjectsViewProps) {
  const [filter, setFilter] = useState<'all' | 'active' | 'complete'>('all');
  const [sortBy, setSortBy] = useState<'scheduled_start' | 'priority' | 'created'>('priority');

  const filteredProjects = projects.filter(p => {
    if (filter === 'active') return p.status !== 'complete';
    if (filter === 'complete') return p.status === 'complete';
    return true;
  });

  const sortedProjects = [...filteredProjects].sort((a, b) => {
    if (sortBy === 'scheduled_start') {
      if (!a.scheduled_start) return 1;
      if (!b.scheduled_start) return -1;
      return new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime();
    }
    if (sortBy === 'priority') {
      const order = { urgent: 0, high: 1, medium: 2, low: 3 };
      return (order[a.priority as keyof typeof order] || 2) - (order[b.priority as keyof typeof order] || 2);
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'complete':
        return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800';
      case 'in_progress':
        return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800';
      case 'on_hold':
        return 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800';
      default:
        return 'bg-neutral-500/10 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700';
    }
  };

  const getPriorityStyle = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800';
      case 'high':
        return 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800';
      default:
        return 'bg-neutral-500/10 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700';
    }
  };

  const formatDueDate = (dateString?: string) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDate = new Date(date);
    dueDate.setHours(0, 0, 0, 0);
    
    const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) return { text: 'Overdue', isOverdue: true };
    if (diffDays === 0) return { text: 'Today', isOverdue: false };
    if (diffDays === 1) return { text: 'Tomorrow', isOverdue: false };
    if (diffDays <= 7) return { text: `${diffDays} days`, isOverdue: false };
    
    return { 
      text: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      isOverdue: false 
    };
  };

  return (
    <div className="flex flex-col h-full">
      {/* Filter Tabs */}
      <div className="sticky top-0 z-30 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 px-4 py-2">
        <div className="flex gap-2">
          <Button
            variant={filter === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('all')}
            className="flex-1"
          >
            All
            <Badge variant="secondary" className="ml-1 text-xs">{projects.length}</Badge>
          </Button>
          <Button
            variant={filter === 'active' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('active')}
            className="flex-1"
          >
            Active
          </Button>
          <Button
            variant={filter === 'complete' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('complete')}
            className="flex-1"
          >
            Done
          </Button>
        </div>
      </div>

      {/* Actions Bar */}
      <div className="sticky top-[3rem] z-20 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 px-4 py-2 flex items-center justify-between">
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          className="text-sm border border-neutral-200 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 px-2 py-1"
        >
          <option value="priority">Sort: Priority</option>
          <option value="scheduled_start">Sort: Start Date</option>
          <option value="created">Sort: Newest</option>
        </select>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onRefresh} disabled={isLoading}>
            <svg className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </Button>
          <Button variant="default" size="sm" onClick={onCreateProject}>
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New
          </Button>
        </div>
      </div>

      {/* Projects List */}
      <div className="flex-1 overflow-auto hide-scrollbar">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-neutral-500 dark:text-neutral-400">Loading projects...</div>
          </div>
        ) : sortedProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 px-4">
            <svg className="w-12 h-12 text-neutral-300 dark:text-neutral-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-neutral-500 dark:text-neutral-400">No projects found</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={onCreateProject}>
              Create your first project
            </Button>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {sortedProjects.map((project) => {
              const dueInfo = formatDueDate(project.scheduled_start);
              
              return (
                <div
                  key={project.id}
                  onClick={() => onEditProject(project)}
                  className="bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 p-4 active:bg-neutral-50 dark:active:bg-neutral-700/50 cursor-pointer"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-neutral-900 dark:text-white truncate">
                        {project.title}
                      </h3>
                      {project.property_name && (
                        <p className="text-sm text-neutral-500 dark:text-neutral-400 truncate">
                          {project.property_name}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge className={`text-xs ${getStatusStyle(project.status)}`}>
                        {project.status?.replace('_', ' ') || 'not started'}
                      </Badge>
                      <Badge className={`text-xs ${getPriorityStyle(project.priority)}`}>
                        {project.priority || 'medium'}
                      </Badge>
                    </div>
                  </div>

                  {/* Description */}
                  {project.description && (
                    <p className="text-sm text-neutral-600 dark:text-neutral-400 line-clamp-2 mb-3">
                      {project.description}
                    </p>
                  )}

                  {/* Footer */}
                  <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400 pt-2 border-t border-neutral-100 dark:border-neutral-700">
                    <div className="flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      <span>{project.assigned_staff || 'Unassigned'}</span>
                    </div>
                    
                    {dueInfo && (
                      <div className={`flex items-center gap-1 ${dueInfo.isOverdue ? 'text-red-500' : ''}`}>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span>{dueInfo.text}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

