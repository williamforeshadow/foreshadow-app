'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';

interface TimelineProps {
  onCardClick?: (card: any) => void; // Optional - for external handling
}

export default function Timeline({ onCardClick }: TimelineProps) {
  const [reservations, setReservations] = useState<any[]>([]);
  const [properties, setProperties] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReservation, setSelectedReservation] = useState<any>(null); // Internal selection state
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

  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const formatHeaderDate = (date: Date, isTodayDate: boolean) => {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    
    return (
      <div className="text-center">
        <div className={`text-[11px] ${isTodayDate ? 'text-white/80' : 'text-neutral-600 dark:text-neutral-400'}`}>
          {date.toLocaleDateString('en-US', { weekday: 'short' })}
        </div>
        <div className={`text-xs ${isTodayDate ? 'text-white font-semibold' : 'text-neutral-900 dark:text-white'}`}>
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
    
    // Helper to compare just the date portion (ignoring time/timezone issues)
    // This is only for grid cell calculations - actual time data is preserved in reservations
    const toDateString = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    const compareDates = (d1: Date, d2: Date) => toDateString(d1).localeCompare(toDateString(d2));
    
    // Case 1: Reservation ends before visible range - don't show
    if (compareDates(checkOutDate, firstVisibleDate) <= 0) {
      return { start: -1, span: 0, startsBeforeRange: false, endsAfterRange: false };
    }
    
    // Case 2: Reservation starts after visible range - don't show
    if (compareDates(checkInDate, lastVisibleDate) > 0) {
      return { start: -1, span: 0, startsBeforeRange: false, endsAfterRange: false };
    }
    
    // Track if reservation extends beyond visible range
    const startsBeforeRange = compareDates(checkInDate, firstVisibleDate) < 0;
    const endsAfterRange = compareDates(checkOutDate, lastVisibleDate) > 0;
    
    // Case 3: Reservation overlaps with visible range
    let startIdx = dateRange.findIndex(d => 
      toDateString(d) === toDateString(checkInDate)
    );
    
    // If check-in is before visible range, start from first visible day
    if (startIdx === -1 && startsBeforeRange) {
      startIdx = 0;
    }
    
    // Still not found? Don't show
    if (startIdx === -1) {
      return { start: -1, span: 0, startsBeforeRange: false, endsAfterRange: false };
    }
    
    // Calculate span from start to check-out (inclusive) or end of visible range
    let span = 0;
    for (let i = startIdx; i < dateRange.length; i++) {
      const currentDate = dateRange[i];
      // Include the check-out day - compare by date string to avoid timezone issues
      if (compareDates(currentDate, checkOutDate) <= 0) {
        span++;
      } else {
        break; // Stop counting after check-out
      }
    }
    
    return { start: startIdx, span, startsBeforeRange, endsAfterRange };
  };

  // Use turnover_status for reservation block colors
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'not_started':
        return 'bg-red-400 hover:bg-red-500';
      case 'in_progress':
        return 'bg-yellow-400 hover:bg-yellow-500';
      case 'complete':
        return 'bg-green-400 hover:bg-green-500';
      case 'no_tasks':
        return 'bg-neutral-400 hover:bg-neutral-500';
      default:
        return 'bg-rose-400 hover:bg-rose-500'; // Fallback
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center py-12 text-neutral-500 dark:text-neutral-400">
          Loading timeline...
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header with navigation - fixed at top */}
      <div className="flex-shrink-0 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">
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
      <div className="flex-1 overflow-auto px-4 pb-4">
        <div className="overflow-hidden">
          <div 
            className="grid border border-neutral-200 dark:border-neutral-700 w-full"
            style={{
              gridTemplateColumns: `170px repeat(${dateRange.length}, minmax(0, 1fr))`
            }}
          >
            {/* Header Row - will stick when scrolling */}
            <div className="bg-neutral-200 dark:bg-neutral-700 px-2 py-1 text-xs font-semibold text-neutral-900 dark:text-white sticky left-0 top-0 z-20 border-b border-r border-neutral-300 dark:border-neutral-600">
              Property
            </div>
            {dateRange.map((date, idx) => {
              const isTodayDate = isToday(date);
              return (
                <div key={idx} className={`px-1 py-1 border-b border-r border-neutral-200 dark:border-neutral-700 sticky top-0 z-10 ${isTodayDate ? 'bg-emerald-700' : 'bg-neutral-100 dark:bg-neutral-800'}`}>
                  {formatHeaderDate(date, isTodayDate)}
                </div>
              );
            })}

            {/* Property Rows */}
            {properties.map((property) => {
              const propertyReservations = getReservationsForProperty(property);
              
              return (
                <div
                  key={property}
                  className="contents"
                >
                  {/* Property Name */}
                  <div className="bg-neutral-50 dark:bg-neutral-800 px-2 py-1 text-xs font-medium text-neutral-900 dark:text-white sticky left-0 z-10 border-b border-r border-neutral-300 dark:border-neutral-600 truncate flex items-center">
                    {property}
                  </div>
                  
                  {/* Date Cells with embedded reservations */}
                  {dateRange.map((date, idx) => {
                    const isTodayDate = isToday(date);
                    // Only render the block if this is the starting cell
                    const startingReservation = propertyReservations.find(res => {
                      const { start } = getBlockPosition(res.check_in, res.check_out);
                      return start === idx;
                    });
                    
                    return (
                      <div
                        key={idx}
                        className={`border-b border-r border-neutral-200 dark:border-neutral-700 h-[38px] relative overflow-visible ${isTodayDate ? 'bg-emerald-700/20' : 'bg-white dark:bg-neutral-900'}`}
                      >
                        {startingReservation && (() => {
                          const { span, startsBeforeRange, endsAfterRange } = getBlockPosition(startingReservation.check_in, startingReservation.check_out);
                          
                          // Calculate actual position and width to create gaps between same-day turnovers
                          // Check-in: starts 50% into the first cell
                          // Check-out: ends 50% into the last cell
                          const leftOffset = startsBeforeRange ? 0 : 50;  // 50% of one cell
                          const rightOffset = endsAfterRange ? 0 : 50;    // 50% from end of last cell
                          const totalWidth = (span * 100) - leftOffset - rightOffset;
                          
                          // Fixed pixel diagonal for consistent rhombus shape across all reservations
                          const diagonalPx = 12; // Fixed 12px diagonal - same angle for all
                          const leftDiagonal = startsBeforeRange ? '0px' : `${diagonalPx}px`;
                          const rightDiagonal = endsAfterRange ? '0px' : `${diagonalPx}px`;
                          const clipPath = `polygon(${leftDiagonal} 0%, 100% 0%, calc(100% - ${rightDiagonal}) 100%, 0% 100%)`;
                          
                          return (
                            <div
                              onClick={() => {
                                setSelectedReservation(selectedReservation?.id === startingReservation.id ? null : startingReservation);
                                // Only call external handler if provided
                                if (onCardClick) onCardClick(startingReservation);
                              }}
                              className={`absolute cursor-pointer transition-all duration-150 hover:brightness-110 hover:z-30 text-white text-[11px] font-medium flex items-center ${getStatusColor(startingReservation.turnover_status)} ${selectedReservation?.id === startingReservation.id ? 'ring-2 ring-white shadow-lg z-30' : ''}`}
                              style={{
                                left: `${leftOffset}%`,
                                top: 0,
                                bottom: 0,
                                width: `${totalWidth}%`,
                                zIndex: 15,
                                clipPath,
                              }}
                              title={`${startingReservation.guest_name || 'No guest'} - ${formatDate(new Date(startingReservation.check_in))} to ${formatDate(new Date(startingReservation.check_out))}`}
                            >
                              {/* Only show name if this is the start of the reservation (not a continuation) */}
                              {!startsBeforeRange && (
                                <span className="truncate" style={{ paddingLeft: `${diagonalPx + 6}px`, paddingRight: `${diagonalPx + 6}px` }}>{startingReservation.guest_name || 'No guest'}</span>
                              )}
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

