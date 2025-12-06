'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface MobileTimelineViewProps {
  onCardClick: (card: any) => void;
}

export default function MobileTimelineView({ onCardClick }: MobileTimelineViewProps) {
  const [reservations, setReservations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [view, setView] = useState<'day' | 'list'>('list');

  useEffect(() => {
    fetchReservations();
  }, []);

  const fetchReservations = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_property_turnovers');
      if (error) throw error;
      setReservations(data || []);
    } catch (err) {
      console.error('Error fetching reservations:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      weekday: 'short',
      month: 'short', 
      day: 'numeric' 
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'not_started':
        return 'bg-red-500';
      case 'in_progress':
        return 'bg-yellow-500';
      case 'complete':
        return 'bg-green-500';
      case 'no_tasks':
        return 'bg-neutral-400';
      default:
        return 'bg-neutral-400';
    }
  };

  const getStatusBadgeStyle = (status: string) => {
    switch (status) {
      case 'not_started':
        return 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800';
      case 'in_progress':
        return 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800';
      case 'complete':
        return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800';
      default:
        return 'bg-neutral-500/10 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700';
    }
  };

  // Get reservations for a specific date
  const getReservationsForDate = (date: Date) => {
    return reservations.filter(res => {
      const checkIn = new Date(res.check_in);
      const checkOut = new Date(res.check_out);
      checkIn.setHours(0, 0, 0, 0);
      checkOut.setHours(0, 0, 0, 0);
      const compareDate = new Date(date);
      compareDate.setHours(0, 0, 0, 0);
      return compareDate >= checkIn && compareDate < checkOut;
    });
  };

  // Get upcoming turnovers (check-outs in the next 7 days)
  const getUpcomingTurnovers = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);

    return reservations
      .filter(res => {
        const checkOut = new Date(res.check_out);
        checkOut.setHours(0, 0, 0, 0);
        return checkOut >= today && checkOut <= nextWeek;
      })
      .sort((a, b) => new Date(a.check_out).getTime() - new Date(b.check_out).getTime());
  };

  // Group reservations by date for list view
  const groupReservationsByDate = () => {
    const upcoming = getUpcomingTurnovers();
    const grouped: { [key: string]: any[] } = {};

    upcoming.forEach(res => {
      const dateKey = new Date(res.check_out).toDateString();
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(res);
    });

    return grouped;
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
        <div className="text-neutral-500 dark:text-neutral-400">Loading timeline...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* View Toggle */}
      <div className="sticky top-14 z-30 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 px-4 py-2">
        <div className="flex gap-2">
          <Button
            variant={view === 'list' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setView('list')}
            className="flex-1"
          >
            Upcoming
          </Button>
          <Button
            variant={view === 'day' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setView('day')}
            className="flex-1"
          >
            Day View
          </Button>
        </div>
      </div>

      {/* Content */}
      {view === 'list' ? (
        // List View - Upcoming Turnovers
        <div className="flex-1 overflow-auto">
          {Object.entries(groupReservationsByDate()).length === 0 ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-neutral-500 dark:text-neutral-400">
                No upcoming turnovers in the next 7 days
              </div>
            </div>
          ) : (
            Object.entries(groupReservationsByDate()).map(([dateStr, items]) => (
              <div key={dateStr} className="border-b border-neutral-200 dark:border-neutral-800">
                {/* Date Header */}
                <div className="sticky top-[7.5rem] bg-neutral-100 dark:bg-neutral-800 px-4 py-2 z-10">
                  <span className="text-sm font-semibold text-neutral-900 dark:text-white">
                    {formatDate(dateStr)}
                  </span>
                  <span className="text-xs text-neutral-500 dark:text-neutral-400 ml-2">
                    {items.length} turnover{items.length > 1 ? 's' : ''}
                  </span>
                </div>
                
                {/* Items for this date */}
                {items.map((item, idx) => (
                  <div
                    key={item.cleaning_id || idx}
                    onClick={() => onCardClick(item)}
                    className="flex items-center gap-3 px-4 py-3 border-b border-neutral-100 dark:border-neutral-800 last:border-b-0 active:bg-neutral-50 dark:active:bg-neutral-800/50 cursor-pointer"
                  >
                    {/* Status Indicator */}
                    <div className={`w-2 h-2 rounded-full shrink-0 ${getStatusColor(item.turnover_status)}`} />
                    
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-neutral-900 dark:text-white truncate">
                        {item.property_name}
                      </div>
                      <div className="text-sm text-neutral-500 dark:text-neutral-400 truncate">
                        {item.guest_name || 'No guest'}
                      </div>
                    </div>
                    
                    {/* Status Badge */}
                    <Badge className={`shrink-0 text-xs ${getStatusBadgeStyle(item.turnover_status)}`}>
                      {item.turnover_status === 'complete' ? 'Done' :
                       item.turnover_status === 'in_progress' ? 'Active' :
                       item.turnover_status === 'not_started' ? 'Pending' :
                       'No Tasks'}
                    </Badge>
                    
                    {/* Arrow */}
                    <svg className="w-4 h-4 text-neutral-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      ) : (
        // Day View
        <>
          {/* Date Navigation */}
          <div className="sticky top-[7.5rem] z-20 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 px-4 py-3 flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => navigateDay(-1)}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Button>
            
            <div className="text-center">
              <button onClick={goToToday} className="text-sm font-semibold text-neutral-900 dark:text-white">
                {selectedDate.toDateString() === new Date().toDateString() ? 'Today' : ''}
              </button>
              <div className="text-base font-bold text-neutral-900 dark:text-white">
                {selectedDate.toLocaleDateString('en-US', { 
                  weekday: 'long',
                  month: 'long', 
                  day: 'numeric' 
                })}
              </div>
            </div>
            
            <Button variant="ghost" size="sm" onClick={() => navigateDay(1)}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Button>
          </div>

          {/* Reservations for selected date */}
          <div className="flex-1 overflow-auto">
            {(() => {
              const dayReservations = getReservationsForDate(selectedDate);
              
              if (dayReservations.length === 0) {
                return (
                  <div className="flex items-center justify-center h-64">
                    <div className="text-neutral-500 dark:text-neutral-400">
                      No reservations on this date
                    </div>
                  </div>
                );
              }

              return (
                <div className="p-4 space-y-3">
                  {dayReservations.map((item, idx) => (
                    <div
                      key={item.cleaning_id || idx}
                      onClick={() => onCardClick(item)}
                      className="bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 p-4 active:bg-neutral-50 dark:active:bg-neutral-700/50 cursor-pointer"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="font-semibold text-neutral-900 dark:text-white">
                          {item.property_name}
                        </div>
                        <Badge className={`text-xs ${getStatusBadgeStyle(item.turnover_status)}`}>
                          {item.turnover_status?.replace('_', ' ') || 'unknown'}
                        </Badge>
                      </div>
                      
                      <div className="text-sm text-neutral-600 dark:text-neutral-400 mb-3">
                        Guest: {item.guest_name || 'No guest'}
                      </div>
                      
                      <div className="flex items-center gap-4 text-xs text-neutral-500 dark:text-neutral-400">
                        <div className="flex items-center gap-1">
                          <svg className="w-3.5 h-3.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                          </svg>
                          Out: {formatDate(item.check_out)}
                        </div>
                        <div className="flex items-center gap-1">
                          <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                          </svg>
                          In: {formatDate(item.next_check_in) || 'None'}
                        </div>
                      </div>
                      
                      {item.total_tasks > 0 && (
                        <div className="mt-3 pt-3 border-t border-neutral-100 dark:border-neutral-700">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-neutral-500 dark:text-neutral-400">Tasks</span>
                            <span className="font-medium text-neutral-900 dark:text-white">
                              {item.completed_tasks || 0} / {item.total_tasks} complete
                            </span>
                          </div>
                          <div className="mt-2 h-2 bg-neutral-100 dark:bg-neutral-700 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-emerald-500 rounded-full transition-all"
                              style={{ 
                                width: `${((item.completed_tasks || 0) / item.total_tasks) * 100}%` 
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </>
      )}
    </div>
  );
}

