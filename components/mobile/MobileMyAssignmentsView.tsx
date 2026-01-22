'use client';

import { useState, useEffect } from 'react';
import { useAuth, TEST_USERS, Role } from '@/lib/authContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from '@/components/ui/carousel';

interface Task {
  task_id: string;
  reservation_id: string;
  template_id: string;
  template_name: string;
  type: 'cleaning' | 'maintenance';
  description?: string;
  scheduled_start?: string;
  status: string;
  form_metadata?: any;
  assigned_at: string;
  property_name: string;
  check_out?: string;
  check_in?: string;
  guest_name?: string;
}

interface Project {
  id: string;
  property_name: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  scheduled_start?: string;
  created_at: string;
  assigned_at: string;
}

interface AssignmentsData {
  tasks: Task[];
  projects: Project[];
  summary: {
    total_tasks: number;
    completed_tasks: number;
    total_projects: number;
    completed_projects: number;
  };
}

interface MobileMyAssignmentsViewProps {
  onTaskClick?: (task: Task) => void;
  onProjectClick?: (project: Project) => void;
  refreshTrigger?: number;
}

export default function MobileMyAssignmentsView({
  onTaskClick,
  onProjectClick,
  refreshTrigger,
}: MobileMyAssignmentsViewProps) {
  const { user, role, switchUser } = useAuth();
  const [data, setData] = useState<AssignmentsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [carouselApi, setCarouselApi] = useState<CarouselApi>();
  const [activeSlide, setActiveSlide] = useState(0);

  useEffect(() => {
    fetchAssignments();
  }, [user.id, refreshTrigger]);

  // Handle carousel slide changes
  useEffect(() => {
    if (!carouselApi) return;
    
    const onSelect = () => {
      setActiveSlide(carouselApi.selectedScrollSnap());
    };
    
    carouselApi.on('select', onSelect);
    return () => {
      carouselApi.off('select', onSelect);
    };
  }, [carouselApi]);

  const fetchAssignments = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/my-assignments?user_id=${user.id}`);
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to fetch assignments');
      }
      
      setData(result);
    } catch (err: any) {
      console.error('Error fetching assignments:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadgeStyle = (status: string) => {
    switch (status) {
      case 'complete':
        return 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
      case 'in_progress':
        return 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800';
      case 'paused':
        return 'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800';
      case 'on_hold':
        return 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800';
      default: // not_started, reopened
        return 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800';
    }
  };

  const getPriorityStyle = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800';
      case 'high':
        return 'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800';
      default:
        return 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700';
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatTime = (dateString?: string) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const formatStatusLabel = (status: string) => {
    return status.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

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

  const tasks = data?.tasks || [];
  const projects = data?.projects || [];
  const summary = data?.summary;

  return (
    <div className="flex flex-col h-full relative">
      {/* Header with Page Labels and Indicators */}
      <div className="sticky top-0 z-30 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 px-4 py-3">
        {/* Page Labels with dots beneath each */}
        <div className="flex items-center justify-between">
          {/* Spacer for balance */}
          <div className="w-8" />
          
          {/* Centered Labels with dots */}
          <div className="flex items-center gap-8">
            <button 
              className="flex flex-col items-center gap-1"
              onClick={() => carouselApi?.scrollTo(0)}
            >
              <span className={`text-sm font-medium transition-colors ${activeSlide === 0 ? 'text-neutral-900 dark:text-white' : 'text-neutral-400'}`}>
                Tasks
              </span>
              <div className={`w-1.5 h-1.5 rounded-full transition-colors ${activeSlide === 0 ? 'bg-neutral-900 dark:bg-white' : 'bg-transparent'}`} />
            </button>
            <button 
              className="flex flex-col items-center gap-1"
              onClick={() => carouselApi?.scrollTo(1)}
            >
              <span className={`text-sm font-medium transition-colors ${activeSlide === 1 ? 'text-neutral-900 dark:text-white' : 'text-neutral-400'}`}>
                Projects
              </span>
              <div className={`w-1.5 h-1.5 rounded-full transition-colors ${activeSlide === 1 ? 'bg-neutral-900 dark:bg-white' : 'bg-transparent'}`} />
            </button>
          </div>

          {/* Refresh Button */}
          <Button variant="ghost" size="sm" onClick={fetchAssignments} disabled={loading} className="px-2 w-8">
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </Button>
        </div>
      </div>

      {/* Carousel Content */}
      <div className="flex-1 overflow-hidden pb-20">
        <Carousel
          className="h-full"
          setApi={setCarouselApi}
        >
          <CarouselContent className="-ml-0 h-full">
            {/* Tasks Slide */}
            <CarouselItem className="pl-0 h-full overflow-auto hide-scrollbar">
              {tasks.length === 0 ? (
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
                <div className="p-4 space-y-2">
                  {tasks.map((task) => (
                    <Card 
                      key={task.task_id}
                      className="cursor-pointer hover:shadow-md transition-all bg-white dark:bg-neutral-900 border !p-0 !gap-0"
                      onClick={() => onTaskClick?.(task)}
                    >
                      <CardHeader className="p-3">
                        <CardTitle className="text-sm font-medium truncate">
                          {task.template_name}
                        </CardTitle>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate mt-0.5">
                          {task.property_name}
                        </p>
                        
                        <div className="flex items-center gap-2 mt-2">
                          <Badge className={`px-2 py-0.5 text-xs border ${getStatusBadgeStyle(task.status)}`}>
                            {formatStatusLabel(task.status)}
                          </Badge>
                          <Badge className={`px-2 py-0.5 text-xs border ${task.type === 'maintenance' 
                            ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800' 
                            : 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800'
                          }`}>
                            {task.type === 'cleaning' ? 'Cleaning' : 'Maintenance'}
                          </Badge>
                        </div>

                        <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400 mt-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
                          <div className="flex items-center gap-1">
                            {task.scheduled_start ? (
                              <>
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                <span>{formatDate(task.scheduled_start)}{formatTime(task.scheduled_start) ? `, ${formatTime(task.scheduled_start)}` : ''}</span>
                              </>
                            ) : (
                              <span className="text-neutral-400">No schedule</span>
                            )}
                          </div>
                          
                          {task.guest_name && (
                            <div className="flex items-center gap-1">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                              </svg>
                              <span className="truncate max-w-[80px]">{task.guest_name}</span>
                            </div>
                          )}
                        </div>
                      </CardHeader>
                    </Card>
                  ))}
                </div>
              )}
            </CarouselItem>

            {/* Projects Slide */}
            <CarouselItem className="pl-0 h-full overflow-auto hide-scrollbar">
              {projects.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 px-4">
                  <div className="w-12 h-12 mb-3 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                    <svg className="w-6 h-6 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </div>
                  <p className="text-neutral-600 dark:text-neutral-400 font-medium">No projects assigned</p>
                  <p className="text-sm text-neutral-500 mt-1">Projects you're assigned to will appear here</p>
                </div>
              ) : (
                <div className="p-4 space-y-2">
                  {projects.map((project) => (
                    <Card
                      key={project.id}
                      onClick={() => onProjectClick?.(project)}
                      className="cursor-pointer hover:shadow-md transition-all bg-white dark:bg-neutral-900 border !p-0 !gap-0"
                    >
                      <CardHeader className="p-3">
                        <CardTitle className="text-sm font-medium truncate">
                          {project.title}
                        </CardTitle>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate mt-0.5">
                          {project.property_name}
                        </p>
                        
                        {project.description && (
                          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-2">
                            {project.description}
                          </p>
                        )}
                        
                        <div className="flex items-center gap-2 mt-2">
                          <Badge className={`px-2 py-0.5 text-xs border ${getStatusBadgeStyle(project.status)}`}>
                            {formatStatusLabel(project.status)}
                          </Badge>
                          {project.priority && (
                            <Badge className={`px-2 py-0.5 text-xs border ${getPriorityStyle(project.priority)}`}>
                              {project.priority}
                            </Badge>
                          )}
                        </div>

                        {project.scheduled_start && (
                          <div className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400 mt-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <span>Start: {formatDate(project.scheduled_start)}</span>
                          </div>
                        )}
                      </CardHeader>
                    </Card>
                  ))}
                </div>
              )}
            </CarouselItem>
          </CarouselContent>
        </Carousel>
      </div>

      {/* Floating Role Switcher - Bottom Right */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="fixed bottom-20 right-4 z-40 w-12 h-12 rounded-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 shadow-lg flex items-center justify-center text-xl hover:scale-105 transition-transform">
            {user.avatar}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {(Object.keys(TEST_USERS) as Role[]).map((r) => (
            <DropdownMenuItem 
              key={r} 
              onClick={() => switchUser(r)}
              className={role === r ? 'bg-neutral-100 dark:bg-neutral-800' : ''}
            >
              <span className="mr-2">{TEST_USERS[r].avatar}</span>
              <span className="flex-1">{TEST_USERS[r].name}</span>
              {role === r && (
                <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
