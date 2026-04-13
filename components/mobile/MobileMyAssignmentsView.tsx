'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/authContext';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useRouter } from 'next/navigation';

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
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  type?: string;
  assignees: Assignee[];
  raw: any;
}

interface DateGroup {
  label: string;
  sublabel?: string;
  items: UnifiedItem[];
}

interface MobileMyAssignmentsViewProps {
  onTaskClick?: (task: any) => void;
  onProjectClick?: (project: any) => void;
  refreshTrigger?: number;
}

function StatusDot({ status }: { status: string }) {
  switch (status) {
    case 'not_started':
      return (
        <span className="w-[6px] h-[6px] rounded-full bg-neutral-800 dark:bg-[#f0efed] shadow-[0_0_0_3px_rgba(0,0,0,0.06)] dark:shadow-[0_0_0_3px_rgba(240,239,237,0.08)] shrink-0" />
      );
    case 'in_progress':
      return (
        <span className="w-[7px] h-[7px] rounded-full border-[1.5px] border-neutral-400 dark:border-[#8a8884] shrink-0" />
      );
    case 'paused':
      return (
        <span className="w-[6px] h-[6px] rounded-full bg-amber-500 dark:bg-[#d97757] shadow-[0_0_0_3px_rgba(217,119,87,0.12)] dark:shadow-[0_0_0_3px_rgba(217,119,87,0.15)] shrink-0" />
      );
    case 'complete':
      return (
        <span className="w-[6px] h-[6px] rounded-full bg-neutral-300 dark:bg-[#4a4946] shrink-0" />
      );
    default:
      return (
        <span className="w-[6px] h-[6px] rounded-full bg-neutral-400 dark:bg-[#66645f] shrink-0" />
      );
  }
}

function PriorityTag({ priority }: { priority: string }) {
  if (!priority || priority === 'low') return null;
  const colorClass =
    priority === 'urgent'
      ? 'text-red-500 dark:text-[#d97757]'
      : priority === 'high'
        ? 'text-neutral-800 dark:text-[#f0efed]'
        : 'text-neutral-500 dark:text-[#a09e9a]';
  return (
    <span className={`text-[10.5px] uppercase tracking-[0.06em] font-medium pl-2 border-l border-neutral-200 dark:border-[rgba(255,255,255,0.07)] ${colorClass}`}>
      {priority}
    </span>
  );
}

const STATUS_LABELS: Record<string, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  paused: 'Paused',
  complete: 'Complete',
};

export default function MobileMyAssignmentsView({
  onTaskClick,
  onProjectClick,
  refreshTrigger,
}: MobileMyAssignmentsViewProps) {
  const { user, loading: authLoading, allUsers, role, switchUser } = useAuth();
  const { theme, setTheme } = useTheme();
  const [rawData, setRawData] = useState<{ tasks: any[]; projects: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!showUserMenu) return;
    function onTap(e: MouseEvent | TouchEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener('mousedown', onTap);
    document.addEventListener('touchstart', onTap);
    return () => {
      document.removeEventListener('mousedown', onTap);
      document.removeEventListener('touchstart', onTap);
    };
  }, [showUserMenu]);

  const fetchAssignments = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/my-assignments?user_id=${user.id}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to fetch assignments');
      setRawData({ tasks: result.tasks || [], projects: result.projects || [] });
    } catch (err: any) {
      console.error('Error fetching assignments:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (user?.id) fetchAssignments();
  }, [user?.id, refreshTrigger, fetchAssignments]);

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
        scheduled_date: task.scheduled_date,
        scheduled_time: task.scheduled_time,
        type: task.type,
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
        priority: project.priority || 'medium',
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

  const { groups, todayTurnoverCount, openCount } = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    const endOfWeek = new Date(now);
    const dayOfWeek = now.getDay();
    const daysUntilSunday = 7 - dayOfWeek;
    endOfWeek.setDate(now.getDate() + daysUntilSunday);
    const endOfWeekStr = endOfWeek.toISOString().split('T')[0];

    const today: UnifiedItem[] = [];
    const thisWeek: UnifiedItem[] = [];
    const later: UnifiedItem[] = [];
    const unscheduled: UnifiedItem[] = [];
    let turnoverCount = 0;
    let open = 0;

    for (const item of items) {
      if (item.status !== 'complete') open++;
      const d = item.scheduled_date;
      if (!d) {
        unscheduled.push(item);
      } else if (d === todayStr) {
        today.push(item);
        if (item.type === 'cleaning' || item.type === 'turnover') turnoverCount++;
      } else if (d > todayStr && d <= endOfWeekStr) {
        thisWeek.push(item);
      } else if (d > endOfWeekStr) {
        later.push(item);
      } else {
        // Past dates still show under today
        today.push(item);
      }
    }

    const sortByTime = (a: UnifiedItem, b: UnifiedItem) => {
      const ta = a.scheduled_time || '';
      const tb = b.scheduled_time || '';
      return ta.localeCompare(tb);
    };
    today.sort(sortByTime);
    thisWeek.sort((a, b) => {
      const da = a.scheduled_date || '';
      const db = b.scheduled_date || '';
      if (da !== db) return da.localeCompare(db);
      return sortByTime(a, b);
    });
    later.sort((a, b) => {
      const da = a.scheduled_date || '';
      const db = b.scheduled_date || '';
      if (da !== db) return da.localeCompare(db);
      return sortByTime(a, b);
    });

    const result: DateGroup[] = [];
    if (today.length > 0) result.push({ label: 'Today', sublabel: `${today.length} scheduled`, items: today });
    if (thisWeek.length > 0) result.push({ label: 'This week', sublabel: `${thisWeek.length} scheduled`, items: thisWeek });
    if (later.length > 0) result.push({ label: 'Later', sublabel: `${later.length} scheduled`, items: later });
    if (unscheduled.length > 0) result.push({ label: 'Unscheduled', sublabel: `${unscheduled.length}`, items: unscheduled });

    return { groups: result, todayTurnoverCount: turnoverCount, openCount: open };
  }, [items]);

  const formatTimeCol = (timeString?: string | null) => {
    if (!timeString) return null;
    const [h, m] = timeString.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return { time: `${hour12}:${String(m).padStart(2, '0')}`, meridiem: ampm };
  };

  const getDayLabel = (dateStr?: string | null) => {
    if (!dateStr) return null;
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
  };

  const todayFormatted = useMemo(() => {
    const now = new Date();
    const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
    const month = now.toLocaleDateString('en-US', { month: 'short' });
    const day = now.getDate();
    return `${weekday} · ${month} ${day}`;
  }, []);

  // Loading / error / auth states
  if (authLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <div className="w-7 h-7 border-2 border-neutral-400 dark:border-[#66645f] border-t-transparent rounded-full animate-spin mb-3" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-64 px-6">
        <p className="text-neutral-600 dark:text-[#a09e9a] font-medium mb-3">Sign in to see your assignments</p>
        <Button onClick={() => router.push('/login')}>Sign In</Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <div className="w-7 h-7 border-2 border-neutral-400 dark:border-[#66645f] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 px-6">
        <p className="text-neutral-600 dark:text-[#a09e9a] text-center text-sm mb-3">{error}</p>
        <Button variant="outline" size="sm" onClick={fetchAssignments}>Try Again</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-[22px] pt-2 pb-4">
        <div className="flex items-start justify-between">
          <h1 className="text-[28px] font-semibold tracking-tight leading-none text-neutral-900 dark:text-[#f0efed]">
            My Assignments
          </h1>

          {/* User avatar */}
          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setShowUserMenu(v => !v)}
              className="w-9 h-9 rounded-full overflow-hidden ring-2 ring-neutral-200/60 dark:ring-[rgba(255,255,255,0.07)] active:scale-95 transition-transform"
            >
              {user?.avatar ? (
                <img src={user.avatar} alt={user.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-neutral-200 dark:bg-[#1a1a1d] flex items-center justify-center text-[11px] font-semibold text-neutral-600 dark:text-[#a09e9a]">
                  {user?.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?'}
                </div>
              )}
            </button>

            {showUserMenu && (
              <>
                <div className="fixed inset-0 z-[39]" onClick={() => setShowUserMenu(false)} />
                <div className="absolute right-0 top-full mt-2 z-40 w-[200px] py-2 rounded-xl bg-white dark:bg-[#1a1a1d] border border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)] shadow-xl">
                  {/* Current user */}
                  <div className="px-3 pb-2 mb-1 border-b border-neutral-100 dark:border-[rgba(255,255,255,0.07)]">
                    <p className="text-[13px] font-medium text-neutral-800 dark:text-[#f0efed] truncate">{user?.name}</p>
                    <p className="text-[11px] text-neutral-400 dark:text-[#66645f] capitalize">{role}</p>
                  </div>

                  {/* Switch user */}
                  {allUsers.length > 1 && (
                    <div className="px-1 pb-1 mb-1 border-b border-neutral-100 dark:border-[rgba(255,255,255,0.07)]">
                      {allUsers.map((u) => (
                        <button
                          key={u.id}
                          onClick={() => { switchUser(u.id); setShowUserMenu(false); }}
                          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-[12px] transition-colors ${
                            u.id === user?.id
                              ? 'text-neutral-800 dark:text-[#f0efed] font-medium'
                              : 'text-neutral-500 dark:text-[#a09e9a] active:bg-neutral-50 dark:active:bg-[rgba(255,255,255,0.03)]'
                          }`}
                        >
                          <UserAvatar src={u.avatar} name={u.name} size="sm" />
                          <span className="truncate">{u.name}</span>
                          {u.id === user?.id && (
                            <svg className="w-3.5 h-3.5 ml-auto shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Theme toggle */}
                  <button
                    onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); setShowUserMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-neutral-500 dark:text-[#a09e9a] active:bg-neutral-50 dark:active:bg-[rgba(255,255,255,0.03)] transition-colors"
                  >
                    {theme === 'dark' ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                      </svg>
                    )}
                    {theme === 'dark' ? 'Light mode' : 'Dark mode'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 mt-2.5 text-[12px] text-neutral-500 dark:text-[#66645f] uppercase tracking-[0.04em] font-medium">
          <span>{todayFormatted}</span>
          <span className="w-[3px] h-[3px] rounded-full bg-neutral-300 dark:bg-[#3e3d3a]" />
          <span>{openCount} open</span>
        </div>
      </div>

      {/* Turnover banner */}
      {todayTurnoverCount > 0 && (
        <div className="mx-[22px] mb-4 px-[18px] py-4 bg-neutral-100/80 dark:bg-[rgba(255,255,255,0.025)] border border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)] rounded-xl flex items-center justify-between relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-neutral-800 dark:bg-[#f0efed]" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-neutral-500 dark:text-[#66645f] uppercase tracking-[0.1em] font-semibold">Due today</span>
            <span className="text-[15px] font-medium text-neutral-800 dark:text-[#f0efed] tracking-tight">
              {todayTurnoverCount === 1 ? 'One turnover' : todayTurnoverCount === 2 ? 'Two turnovers' : todayTurnoverCount === 3 ? 'Three turnovers' : `${todayTurnoverCount} turnovers`}
            </span>
          </div>
          <span className="font-mono text-[32px] font-normal text-neutral-800 dark:text-[#f0efed] leading-none tracking-tight tabular-nums">
            {todayTurnoverCount}
          </span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto hide-scrollbar">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 px-6">
            <p className="text-neutral-600 dark:text-[#a09e9a] font-medium">No tasks assigned</p>
            <p className="text-sm text-neutral-500 dark:text-[#66645f] mt-1">You're all caught up</p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="px-[22px] pt-5">
              {/* Section header */}
              <div className="flex items-baseline justify-between mb-3">
                <span className="text-[11px] font-semibold text-neutral-600 dark:text-[#a09e9a] uppercase tracking-[0.08em]">
                  {group.label}
                </span>
                {group.sublabel && (
                  <span className="text-[11px] text-neutral-400 dark:text-[#66645f] tracking-[0.05em] tabular-nums uppercase">
                    {group.sublabel}
                  </span>
                )}
              </div>

              {/* Assignment rows */}
              <div className="flex flex-col">
                {group.items.map((item, idx) => {
                  const timeInfo = formatTimeCol(item.scheduled_time);
                  const isToday = group.label === 'Today';
                  const dayLabel = !isToday ? getDayLabel(item.scheduled_date) : null;

                  return (
                    <button
                      key={item.key}
                      onClick={() => {
                        if (item.source === 'task') onTaskClick?.(item.raw);
                        else onProjectClick?.(item.raw);
                      }}
                      className={`grid grid-cols-[44px_1fr_auto] gap-3.5 py-3.5 text-left transition-colors active:bg-neutral-100/50 dark:active:bg-[rgba(255,255,255,0.03)] ${
                        idx < group.items.length - 1 ? 'border-b border-neutral-100 dark:border-[rgba(255,255,255,0.07)]' : ''
                      }`}
                    >
                      {/* Time column */}
                      <div className="text-right pt-0.5">
                        {timeInfo ? (
                          <>
                            {dayLabel && (
                              <div className="text-[10px] text-neutral-400 dark:text-[#66645f] uppercase tracking-[0.08em] font-medium mb-0.5">{dayLabel}</div>
                            )}
                            <div className="font-mono text-[14px] font-medium text-neutral-800 dark:text-[#f0efed] leading-none tracking-tight tabular-nums">{timeInfo.time}</div>
                            <div className="text-[9px] text-neutral-400 dark:text-[#66645f] uppercase tracking-[0.08em] font-medium mt-0.5">{timeInfo.meridiem}</div>
                          </>
                        ) : (
                          <div className="text-[9px] text-neutral-300 dark:text-[#3e3d3a] uppercase tracking-[0.08em] font-medium leading-snug pt-0.5">
                            no<br />date
                          </div>
                        )}
                      </div>

                      {/* Body */}
                      <div className="min-w-0">
                        <div className="text-[14.5px] font-medium text-neutral-800 dark:text-[#f0efed] leading-snug tracking-tight mb-0.5 line-clamp-2">
                          {item.title}
                        </div>
                        {item.property_name && (
                          <div className="text-[12px] text-neutral-500 dark:text-[#66645f] leading-snug truncate">
                            {item.property_name}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-2">
                          <StatusDot status={item.status} />
                          <span className="text-[10.5px] text-neutral-500 dark:text-[#a09e9a] uppercase tracking-[0.06em] font-medium">
                            {STATUS_LABELS[item.status] || item.status}
                          </span>
                          <PriorityTag priority={item.priority} />
                        </div>
                      </div>

                      {/* Right — avatars */}
                      <div className="flex flex-col items-end gap-2 pt-0.5">
                        {item.assignees.length > 0 && (
                          <div className="flex">
                            {item.assignees.slice(0, 3).map((u, i) => (
                              <div
                                key={u.user_id}
                                className="w-[22px] h-[22px] rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center text-[8.5px] font-semibold text-neutral-600 dark:text-[#a09e9a] overflow-hidden ring-[2px] ring-white dark:ring-[#0b0b0c]"
                                style={{ marginLeft: i > 0 ? '-7px' : 0 }}
                                title={u.name}
                              >
                                {u.avatar ? (
                                  <img src={u.avatar} alt={u.name} className="w-full h-full object-cover" />
                                ) : (
                                  u.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
