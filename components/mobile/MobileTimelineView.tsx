'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from '@/components/ui/carousel';

interface MobileTimelineViewProps {
  onCardClick?: (card: any) => void; // Optional - for turnover card selection
  onTaskClick?: (task: any) => void; // Optional - for task detail view
  onProjectClick?: (project: any) => void; // Optional - for project detail view
  refreshTrigger?: number; // Optional - triggers refetch when changed
}

export default function MobileTimelineView({ onCardClick, onTaskClick, onProjectClick, refreshTrigger }: MobileTimelineViewProps) {
  const [reservations, setReservations] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [expandedCheckInId, setExpandedCheckInId] = useState<string | null>(null);
  const [carouselApis, setCarouselApis] = useState<{ [key: string]: CarouselApi }>({});
  const [activeSlides, setActiveSlides] = useState<{ [key: string]: number }>({});

  useEffect(() => {
    fetchData();
  }, [refreshTrigger]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch reservations and projects in parallel
      const [reservationsRes, projectsRes] = await Promise.all([
        supabase.rpc('get_property_turnovers'),
        fetch('/api/projects').then(res => res.json())
      ]);
      
      if (reservationsRes.error) throw reservationsRes.error;
      setReservations(reservationsRes.data || []);
      // API returns { data: [...] }, extract the array
      setProjects(projectsRes?.data || []);
    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Get projects for a specific property
  const getProjectsForProperty = (propertyName: string) => {
    return projects.filter((p: any) => p.property_name === propertyName);
  };

  // Handle carousel API for tracking active slide
  const handleCarouselApi = (checkInId: string, api: CarouselApi) => {
    if (!api) return;
    
    // Only update if this API isn't already stored (prevents infinite loop)
    if (carouselApis[checkInId] === api) return;
    
    setCarouselApis(prev => ({ ...prev, [checkInId]: api }));
    
    api.on('select', () => {
      setActiveSlides(prev => ({ ...prev, [checkInId]: api.selectedScrollSnap() }));
    });
  };

  // Helper to compare just date portion
  const toDateString = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Helper to find the previous turnover for a property
  const findPreviousTurnover = (currentCheckIn: any) => {
    const checkInDate = new Date(currentCheckIn.check_in);
    
    // Find all reservations for same property that checked out before this check-in
    const previousTurnovers = reservations.filter(res => 
      res.property_name === currentCheckIn.property_name &&
      res.id !== currentCheckIn.id &&
      new Date(res.check_out) <= checkInDate
    );
    
    // Return the most recent one (closest check_out to this check_in)
    if (previousTurnovers.length === 0) return null;
    
    return previousTurnovers.reduce((latest, current) => 
      new Date(current.check_out) > new Date(latest.check_out) ? current : latest
    );
  };

  // Helper to get badge color class based on turnover status
  const getTurnoverBadgeClass = (status: string | null) => {
    switch (status) {
      case 'complete':
        return 'bg-green-500 hover:bg-green-500';
      case 'in_progress':
        return 'bg-yellow-500 hover:bg-yellow-500';
      default: // not_started or null
        return 'bg-red-500 hover:bg-red-500';
    }
  };

  // Helper to get task status badge styles
  const getTaskStatusStyles = (status: string) => {
    switch (status) {
      case 'complete':
        return 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
      case 'in_progress':
        return 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800';
      case 'paused':
        return 'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800';
      default: // not_started
        return 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800';
    }
  };

  // Helper to format task status label
  const formatStatusLabel = (status: string) => {
    switch (status) {
      case 'complete': return 'Complete';
      case 'in_progress': return 'In Progress';
      case 'paused': return 'Paused';
      case 'reopened': return 'Reopened';
      default: return 'Not Started';
    }
  };

  // Helper to format scheduled date/time
  const formatScheduledDate = (dateString?: string) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatScheduledTime = (dateString?: string) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  // Helper to get project status badge styles
  const getProjectStatusStyles = (status: string) => {
    switch (status) {
      case 'complete':
        return 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
      case 'in_progress':
        return 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800';
      case 'on_hold':
        return 'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800';
      default: // not_started
        return 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800';
    }
  };

  // Helper to get project priority badge styles
  const getPriorityStyles = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800';
      case 'high':
        return 'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800';
      default:
        return 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700';
    }
  };

  // Get reservations with CHECK-IN on selected date
  const getCheckInsForDate = (date: Date) => {
    const dateStr = toDateString(date);
    return reservations.filter(res => {
      const checkInStr = toDateString(new Date(res.check_in));
      return checkInStr === dateStr;
    });
  };

  const navigateDay = (direction: number) => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + direction);
    setSelectedDate(newDate);
  };

  const goToToday = () => {
    setSelectedDate(new Date());
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-neutral-500 dark:text-neutral-400">Loading...</div>
      </div>
    );
  }

  const checkIns = getCheckInsForDate(selectedDate);
  const isToday = toDateString(selectedDate) === toDateString(new Date());

  return (
    <div className="flex flex-col h-full">
      {/* Date Picker */}
      <div className="sticky top-0 z-30 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => navigateDay(-1)}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Button>
          
          <div className="text-center">
            {isToday && (
              <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Today</div>
            )}
            <button onClick={goToToday} className="text-base font-bold text-neutral-900 dark:text-white">
              {selectedDate.toLocaleDateString('en-US', { 
                weekday: 'short',
                month: 'short', 
                day: 'numeric' 
              })}
            </button>
          </div>
          
          <Button variant="ghost" size="sm" onClick={() => navigateDay(1)}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Button>
        </div>
      </div>

      {/* Check-ins Header */}
      <div className="bg-neutral-100 dark:bg-neutral-800 px-4 py-2 border-b border-neutral-200 dark:border-neutral-700">
        <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          Check-ins ({checkIns.length})
        </span>
      </div>

      {/* Check-ins List */}
      <div className="flex-1 overflow-auto hide-scrollbar">
        {checkIns.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-neutral-500 dark:text-neutral-400">
              No check-ins on this date
            </div>
          </div>
        ) : (
          <div className="divide-y divide-neutral-200 dark:divide-neutral-700">
            {checkIns.map((item, idx) => {
              const previousTurnover = findPreviousTurnover(item);
              const badgeClass = getTurnoverBadgeClass(previousTurnover?.turnover_status);
              const isExpanded = expandedCheckInId === item.id;
              const tasks = previousTurnover?.tasks || [];
              
              return (
                <div key={item.id || idx}>
                  {/* Check-in Header Row - Clickable */}
                  <div
                    className="flex items-center px-4 py-3 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
                    onClick={() => setExpandedCheckInId(isExpanded ? null : item.id)}
                  >
                    {/* Expand/Collapse Icon */}
                    <svg 
                      className={`w-4 h-4 mr-2 text-neutral-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>

                    {/* Property Name with Turnover Status Badge */}
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Badge className={`w-3 h-3 p-0 rounded-full shrink-0 ${badgeClass}`} />
                      <div className="font-medium text-neutral-900 dark:text-white truncate">
                        {item.property_name}
                      </div>
                    </div>

                    {/* Task Progress */}
                    {previousTurnover && (
                      <div className="text-xs text-neutral-500 dark:text-neutral-400 mr-3">
                        {previousTurnover.completed_tasks || 0}/{previousTurnover.total_tasks || 0}
                      </div>
                    )}

                    {/* Rhombus Check-in Visual - neutral color */}
                    <div className="w-12 h-6 relative shrink-0">
                      <div 
                        className="absolute inset-0 bg-neutral-400 dark:bg-neutral-500"
                        style={{
                          clipPath: 'polygon(40% 0%, 100% 0%, 100% 100%, 0% 100%)',
                        }}
                      />
                    </div>
                  </div>

                  {/* Expanded Section - Carousel with Tasks and Projects */}
                  {isExpanded && (
                    <div className="bg-neutral-50 dark:bg-neutral-800/30">
                      {(() => {
                        const propertyProjects = getProjectsForProperty(item.property_name);
                        const activeSlide = activeSlides[item.id] || 0;
                        
                        return (
                          <>
                            {/* Page Labels */}
                            <div className="flex items-center justify-center gap-4 pt-2 pb-1">
                              <button 
                                className={`text-xs font-medium transition-colors ${activeSlide === 0 ? 'text-neutral-900 dark:text-white' : 'text-neutral-400'}`}
                                onClick={() => carouselApis[item.id]?.scrollTo(0)}
                              >
                                Tasks ({tasks.length})
                              </button>
                              <button 
                                className={`text-xs font-medium transition-colors ${activeSlide === 1 ? 'text-neutral-900 dark:text-white' : 'text-neutral-400'}`}
                                onClick={() => carouselApis[item.id]?.scrollTo(1)}
                              >
                                Projects ({propertyProjects.length})
                              </button>
                            </div>

                            {/* Page Indicators */}
                            <div className="flex items-center justify-center gap-1.5 pb-2">
                              <div className={`w-1.5 h-1.5 rounded-full transition-colors ${activeSlide === 0 ? 'bg-neutral-900 dark:bg-white' : 'bg-neutral-300 dark:bg-neutral-600'}`} />
                              <div className={`w-1.5 h-1.5 rounded-full transition-colors ${activeSlide === 1 ? 'bg-neutral-900 dark:bg-white' : 'bg-neutral-300 dark:bg-neutral-600'}`} />
                            </div>

                            <Carousel
                              className="w-full"
                              setApi={(api) => handleCarouselApi(item.id, api)}
                            >
                              <CarouselContent className="-ml-0">
                                {/* Tasks Slide */}
                                <CarouselItem className="pl-0">
                                  <div className="px-4 pb-4">
                                    {tasks.length === 0 ? (
                                      <div className="py-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
                                        No tasks for this turnover
                                      </div>
                                    ) : (
                                      <div className="space-y-2">
                                        {tasks.map((task: any) => {
                                          const taskStatus = task.status || 'not_started';
                                          const statusStyles = getTaskStatusStyles(taskStatus);
                                          const assignedUsers = task.assigned_users || [];
                                          const scheduledDate = formatScheduledDate(task.scheduled_start);
                                          const scheduledTime = formatScheduledTime(task.scheduled_start);
                                          
                                          return (
                                            <Card 
                                              key={task.task_id}
                                              className="cursor-pointer hover:shadow-md transition-all bg-white dark:bg-neutral-900 border !p-0 !gap-0"
                                              onClick={() => onTaskClick?.(task)}
                                            >
                                              <CardHeader className="p-3">
                                                <CardTitle className="text-sm font-medium">
                                                  {task.template_name || 'Unnamed Task'}
                                                </CardTitle>
                                                
                                                <div className="flex items-center gap-2 mt-2">
                                                  <Badge className={`px-2 py-0.5 text-xs border ${statusStyles}`}>
                                                    {formatStatusLabel(taskStatus)}
                                                  </Badge>
                                                  <Badge className={`px-2 py-0.5 text-xs border ${
                                                    task.type === 'maintenance' 
                                                      ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800' 
                                                      : 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800'
                                                  }`}>
                                                    {task.type === 'cleaning' ? 'Cleaning' : 'Maintenance'}
                                                  </Badge>
                                                </div>

                                                <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400 mt-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
                                                  <div className="flex items-center gap-1">
                                                    {scheduledDate ? (
                                                      <>
                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                        </svg>
                                                        <span>{scheduledDate}{scheduledTime ? `, ${scheduledTime}` : ''}</span>
                                                      </>
                                                    ) : (
                                                      <span className="text-neutral-400">No schedule</span>
                                                    )}
                                                  </div>

                                                  <div className="flex items-center gap-1">
                                                    {assignedUsers.length > 0 ? (
                                                      <>
                                                        {assignedUsers.slice(0, 3).map((u: any) => (
                                                          <span key={u.user_id} title={u.name} className="text-base">
                                                            {u.avatar || '👤'}
                                                          </span>
                                                        ))}
                                                        {assignedUsers.length > 3 && (
                                                          <span className="text-neutral-400">+{assignedUsers.length - 3}</span>
                                                        )}
                                                      </>
                                                    ) : (
                                                      <span className="text-neutral-400">Unassigned</span>
                                                    )}
                                                  </div>
                                                </div>
                                              </CardHeader>
                                            </Card>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                </CarouselItem>

                                {/* Projects Slide */}
                                <CarouselItem className="pl-0">
                                  <div className="px-4 pb-4">
                                    {propertyProjects.length === 0 ? (
                                      <div className="py-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
                                        No projects for this property
                                      </div>
                                    ) : (
                                      <div className="space-y-2">
                                        {propertyProjects.map((project: any) => {
                                          const projectStatus = project.status || 'not_started';
                                          const statusStyles = getProjectStatusStyles(projectStatus);
                                          const priorityStyles = getPriorityStyles(project.priority);
                                          const dueDate = formatScheduledDate(project.scheduled_start);
                                          
                                          return (
                                            <Card 
                                              key={project.id}
                                              className="cursor-pointer hover:shadow-md transition-all bg-white dark:bg-neutral-900 border !p-0 !gap-0"
                                              onClick={() => onProjectClick?.(project)}
                                            >
                                              <CardHeader className="p-3">
                                                <CardTitle className="text-sm font-medium">
                                                  {project.title || 'Unnamed Project'}
                                                </CardTitle>
                                                
                                                {project.description && (
                                                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-2">
                                                    {project.description}
                                                  </p>
                                                )}
                                                
                                                <div className="flex items-center gap-2 mt-2">
                                                  <Badge className={`px-2 py-0.5 text-xs border ${statusStyles}`}>
                                                    {formatStatusLabel(projectStatus)}
                                                  </Badge>
                                                  {project.priority && (
                                                    <Badge className={`px-2 py-0.5 text-xs border ${priorityStyles}`}>
                                                      {project.priority}
                                                    </Badge>
                                                  )}
                                                </div>

                                                {dueDate && (
                                                  <div className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400 mt-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
                                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                    </svg>
                                                    <span>Due: {dueDate}</span>
                                                  </div>
                                                )}
                                              </CardHeader>
                                            </Card>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                </CarouselItem>
                              </CarouselContent>
                            </Carousel>
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
