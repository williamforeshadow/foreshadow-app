'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';

interface TimelineProps {
  onCardClick: (card: any) => void;
}

export default function Timeline({ onCardClick }: TimelineProps) {
  const [reservations, setReservations] = useState<any[]>([]);
  const [properties, setProperties] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'week' | 'month'>('week');
  const [anchorDate, setAnchorDate] = useState<Date>(() => {
    const today = new Date();
    today.setDate(today.getDate() - 1); // Start from yesterday
    return today;
  });
  const [dateRange, setDateRange] = useState<Date[]>([]);

  useEffect(() => {
    fetchReservations();
  }, []);

  useEffect(() => {
    generateDateRange();
  }, [view, anchorDate]);

  const generateDateRange = () => {
    const dates: Date[] = [];
    const numDays = view === 'week' ? 7 : 30;
    
    for (let i = 0; i < numDays; i++) {
      const date = new Date(anchorDate);
      date.setDate(date.getDate() + i);
      dates.push(date);
    }
    
    setDateRange(dates);
  };

  const goToPrevious = () => {
    const daysToShift = view === 'week' ? 7 : 30;
    const newAnchor = new Date(anchorDate);
    newAnchor.setDate(newAnchor.getDate() - daysToShift);
    setAnchorDate(newAnchor);
  };

  const goToNext = () => {
    const daysToShift = view === 'week' ? 7 : 30;
    const newAnchor = new Date(anchorDate);
    newAnchor.setDate(newAnchor.getDate() + daysToShift);
    setAnchorDate(newAnchor);
  };

  const goToToday = () => {
    const today = new Date();
    today.setDate(today.getDate() - 1); // Start from yesterday
    setAnchorDate(today);
  };

  const fetchReservations = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .rpc('get_property_turnovers');

      if (error) throw error;

      setReservations(data || []);
      
      // Get unique properties, sorted alphabetically
      const uniqueProps = Array.from(new Set(data?.map((r: any) => r.property_name) || []))
        .filter(Boolean)
        .sort();
      setProperties(uniqueProps as string[]);
    } catch (err: any) {
      console.error('Error fetching reservations:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatHeaderDate = (date: Date) => {
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();
    const month = date.getMonth() + 1; // Get month as number (1-12)
    const day = date.getDate();
    
    return (
      <div className="text-center">
        <div className={`text-xs ${isToday ? 'font-bold text-purple-600 dark:text-purple-400' : 'text-slate-600 dark:text-slate-400'}`}>
          {date.toLocaleDateString('en-US', { weekday: 'short' })}
        </div>
        <div className={`text-sm ${isToday ? 'font-bold text-purple-600 dark:text-purple-400' : 'text-slate-900 dark:text-white'}`}>
          {month}/{day}
        </div>
      </div>
    );
  };

  const getReservationsForProperty = (propertyName: string) => {
    return reservations.filter(r => r.property_name === propertyName);
  };

  const getBlockPosition = (checkIn: string, checkOut: string) => {
    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);
    const firstVisibleDate = dateRange[0];
    const lastVisibleDate = dateRange[dateRange.length - 1];
    
    // Case 1: Reservation ends before visible range - don't show
    if (checkOutDate <= firstVisibleDate) {
      return { start: -1, span: 0 };
    }
    
    // Case 2: Reservation starts after visible range - don't show
    if (checkInDate > lastVisibleDate) {
      return { start: -1, span: 0 };
    }
    
    // Case 3: Reservation overlaps with visible range
    let startIdx = dateRange.findIndex(d => 
      d.toDateString() === checkInDate.toDateString()
    );
    
    // If check-in is before visible range, start from first visible day
    if (startIdx === -1 && checkInDate < firstVisibleDate) {
      startIdx = 0;
    }
    
    // Still not found? Don't show
    if (startIdx === -1) {
      return { start: -1, span: 0 };
    }
    
    // Calculate span from start to check-out or end of visible range
    let span = 0;
    for (let i = startIdx; i < dateRange.length; i++) {
      const currentDate = dateRange[i];
      if (currentDate < checkOutDate) {
        span++;
      } else {
        break; // Stop counting once we reach check-out
      }
    }
    
    return { start: startIdx, span };
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center py-12 text-slate-500 dark:text-slate-400">
          Loading timeline...
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header with navigation - fixed at top */}
      <div className="flex-shrink-0 p-6 pb-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Property Timeline
          </h2>
          
          <div className="flex items-center gap-4">
            {/* Navigation Controls */}
            <div className="flex items-center gap-2">
              <Button
                onClick={goToPrevious}
                variant="outline"
                size="sm"
              >
                ← Prev
              </Button>
              <Button
                onClick={goToToday}
                variant="outline"
                size="sm"
              >
                Today
              </Button>
              <Button
                onClick={goToNext}
                variant="outline"
                size="sm"
              >
                Next →
              </Button>
            </div>
            
            {/* View Toggle */}
            <div className="flex gap-2">
              <Button
                onClick={() => setView('week')}
                variant={view === 'week' ? 'default' : 'outline'}
                size="sm"
              >
                Week
              </Button>
              <Button
                onClick={() => setView('month')}
                variant={view === 'month' ? 'default' : 'outline'}
                size="sm"
              >
                Month
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable grid area */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        <div className="overflow-hidden">
          <div 
            className="grid border border-slate-200 dark:border-slate-700 w-full"
            style={{
              gridTemplateColumns: `200px repeat(${dateRange.length}, minmax(0, 1fr))`
            }}
          >
            {/* Header Row - will stick when scrolling */}
            <div className="bg-slate-200 dark:bg-slate-700 p-2 font-semibold text-slate-900 dark:text-white sticky left-0 top-0 z-20 border-b border-r border-slate-300 dark:border-slate-600">
              Property
            </div>
            {dateRange.map((date, idx) => (
              <div key={idx} className="bg-slate-100 dark:bg-slate-800 p-2 border-b border-r border-slate-200 dark:border-slate-700 sticky top-0 z-10">
                {formatHeaderDate(date)}
              </div>
            ))}

            {/* Property Rows */}
            {properties.map((property) => {
              const propertyReservations = getReservationsForProperty(property);
              
              return (
                <div
                  key={property}
                  className="contents"
                >
                  {/* Property Name */}
                  <div className="bg-slate-50 dark:bg-slate-800 p-2 font-medium text-slate-900 dark:text-white sticky left-0 z-10 border-b border-r border-slate-300 dark:border-slate-600 truncate">
                    {property}
                  </div>
                  
                  {/* Date Cells with embedded reservations */}
                  {dateRange.map((date, idx) => {
                    // Only render the block if this is the starting cell
                    const startingReservation = propertyReservations.find(res => {
                      const { start } = getBlockPosition(res.check_in, res.check_out);
                      return start === idx;
                    });
                    
                    return (
                      <div
                        key={idx}
                        className="bg-white dark:bg-slate-900 border-b border-r border-slate-200 dark:border-slate-700 h-[48px] relative overflow-visible"
                      >
                        {startingReservation && (() => {
                          const { span } = getBlockPosition(startingReservation.check_in, startingReservation.check_out);
                          return (
                            <div
                              onClick={() => onCardClick(startingReservation)}
                              className="absolute bg-rose-400 hover:bg-rose-500 border border-white dark:border-slate-800 rounded px-2 cursor-pointer transition-all duration-150 hover:shadow-lg hover:z-30 text-white text-xs font-medium flex items-center justify-center"
                              style={{
                                left: '4px',
                                width: span === 1 ? 'calc(100% - 8px)' : `calc(${span * 100}% + ${(span - 1) * 1}px - 8px)`,
                                top: '6px',
                                bottom: '6px',
                                zIndex: 15
                              }}
                              title={`${startingReservation.guest_name || 'No guest'} - ${formatDate(new Date(startingReservation.check_in))} to ${formatDate(new Date(startingReservation.check_out))}`}
                            >
                              <span className="truncate">{startingReservation.guest_name || 'No guest'}</span>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

