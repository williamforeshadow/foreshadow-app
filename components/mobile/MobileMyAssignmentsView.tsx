'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/lib/authContext';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { getDepartmentIcon } from '@/lib/departmentIcons';
import { useDepartments } from '@/lib/departmentsContext';

function getStatusStyles(status: string) {
  const glassBase = 'glass-card glass-sheen relative overflow-hidden rounded-xl';
  switch (status) {
    case 'complete':
      return `${glassBase} bg-emerald-50/55 dark:bg-emerald-500/[0.12] border border-emerald-200/40 dark:border-emerald-400/20`;
    case 'in_progress':
    case 'paused':
      return `${glassBase} bg-indigo-50/55 dark:bg-indigo-500/[0.12] border border-indigo-300/40 dark:border-indigo-400/20`;
    default:
      return `${glassBase} bg-amber-50/55 dark:bg-amber-400/[0.10] border border-amber-200/40 dark:border-amber-400/18`;
  }
}

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
  department_id: string | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  assignees: Assignee[];
  raw: any;
}

interface MobileMyAssignmentsViewProps {
  onTaskClick?: (task: any) => void;
  onProjectClick?: (project: any) => void;
  refreshTrigger?: number;
}

export default function MobileMyAssignmentsView({
  onTaskClick,
  onProjectClick,
  refreshTrigger,
}: MobileMyAssignmentsViewProps) {
  const { user, loading: authLoading } = useAuth();
  const { deptIconMap } = useDepartments();
  const [rawData, setRawData] = useState<{ tasks: any[]; projects: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (user?.id) {
      fetchAssignments();
    }
  }, [user?.id, refreshTrigger]);

  const fetchAssignments = async () => {
    if (!user?.id) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/my-assignments?user_id=${user.id}`);
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to fetch assignments');
      }
      
      setRawData({ tasks: result.tasks || [], projects: result.projects || [] });
    } catch (err: any) {
      console.error('Error fetching assignments:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

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
        department_id: task.department_id || null,
        scheduled_date: task.scheduled_date,
        scheduled_time: task.scheduled_time,
        assignees: (task.assigned_users || []).map((u: any) => ({
          user_id: u.user_id,
          name: u.name || 'Unknown',
          avatar: u.avatar || null,
        })),
        raw: task,
      });
    }

    for (const project of rawData.projects) {
      result.push({
        key: `proj-${project.id}`,
        source: 'project',
        title: project.title || 'Untitled Task',
        property_name: project.property_name || '',
        status: project.status || 'not_started',
        department_id: project.department_id || null,
        scheduled_date: project.scheduled_date,
        scheduled_time: project.scheduled_time,
        assignees: (project.project_assignments || []).map((a: any) => ({
          user_id: a.user_id,
          name: a.user?.name || 'Unknown',
          avatar: a.user?.avatar || null,
        })),
        raw: project,
      });
    }

    return result;
  }, [rawData]);

  const formatDate = (dateString?: string | null) => {
    if (!dateString) return null;
    const date = new Date(dateString + 'T00:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatTime = (timeString?: string | null) => {
    if (!timeString) return null;
    const [h, m] = timeString.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return `${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
  };

  if (authLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-neutral-500 dark:text-neutral-400">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-64 px-4">
        <div className="w-12 h-12 mb-3 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
          <svg className="w-6 h-6 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>
        <p className="text-neutral-600 dark:text-neutral-400 font-medium mb-3">Sign in to see your assignments</p>
        <Button onClick={() => router.push('/login')}>
          Sign In
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-neutral-500 dark:text-neutral-400">Loading your work...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 px-4">
        <div className="w-12 h-12 mb-3 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <p className="text-neutral-600 dark:text-neutral-400 text-center mb-3">{error}</p>
        <Button variant="outline" size="sm" onClick={fetchAssignments}>
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800">
        <div className="flex items-center px-4 py-3 relative">
          <h2 className="absolute left-1/2 -translate-x-1/2 text-xl font-semibold text-neutral-900 dark:text-white">My Assignments</h2>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-neutral-400">{items.length} task{items.length !== 1 ? 's' : ''}</span>
            <button
              onClick={fetchAssignments}
              disabled={loading}
              className="p-2 rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 active:scale-95 transition-all"
            >
              <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Unified list */}
      <div className="flex-1 overflow-auto hide-scrollbar">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 px-4">
            <div className="w-12 h-12 mb-3 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <svg className="w-6 h-6 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-neutral-600 dark:text-neutral-400 font-medium">No tasks assigned</p>
            <p className="text-sm text-neutral-500 mt-1">You're all caught up!</p>
          </div>
        ) : (
          <div className="p-4 flex flex-col gap-3">
            {items.map((item) => {
              const DeptIcon = getDepartmentIcon(item.department_id ? deptIconMap[item.department_id] : null);
              return (
                <button
                  key={item.key}
                  className={`w-full text-left p-3.5 active:scale-[0.99] transition-all duration-200 ease-out ${getStatusStyles(item.status)}`}
                  onClick={() => {
                    if (item.source === 'task') {
                      onTaskClick?.(item.raw);
                    } else {
                      onProjectClick?.(item.raw);
                    }
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-black/10 dark:bg-black/40 flex items-center justify-center shrink-0">
                      <DeptIcon className="w-4 h-4 text-neutral-600 dark:text-neutral-300" />
                    </div>

                    <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                      <span className="text-sm font-medium truncate">{item.title}</span>
                      {item.property_name && (
                        <span className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                          {item.property_name}
                        </span>
                      )}
                      <div className="flex items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400 px-2 py-1 rounded-lg bg-black/10 dark:bg-black/40 w-fit">
                        <svg className="w-3 h-3 shrink-0 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span>
                          {item.scheduled_date
                            ? `${formatDate(item.scheduled_date)}${formatTime(item.scheduled_time) ? ` · ${formatTime(item.scheduled_time)}` : ''}`
                            : 'No schedule'}
                        </span>
                      </div>
                    </div>

                    {item.assignees.length > 0 && (
                      <div className="flex items-center shrink-0">
                        {item.assignees.slice(0, 3).map((u, i) => (
                          <div
                            key={u.user_id}
                            className="w-8 h-8 rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center text-[10px] font-semibold text-neutral-600 dark:text-neutral-300 ring-2 ring-white/50 dark:ring-white/10 overflow-hidden"
                            style={{ marginLeft: i > 0 ? '-8px' : 0 }}
                            title={u.name}
                          >
                            {u.avatar ? (
                              <img src={u.avatar} alt={u.name} className="w-full h-full object-cover" />
                            ) : (
                              u.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
                            )}
                          </div>
                        ))}
                        {item.assignees.length > 3 && (
                          <div
                            className="w-8 h-8 rounded-full bg-neutral-300 dark:bg-neutral-600 flex items-center justify-center text-[10px] font-semibold text-neutral-600 dark:text-neutral-300 ring-2 ring-white/50 dark:ring-white/10"
                            style={{ marginLeft: '-8px' }}
                          >
                            +{item.assignees.length - 3}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
