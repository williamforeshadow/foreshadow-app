'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';

interface MobileTimelineViewProps {
  onCardClick?: (card: any) => void; // Optional, not used yet
}

export default function MobileTimelineView({ onCardClick }: MobileTimelineViewProps) {
  const [reservations, setReservations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

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

  // Helper to compare just date portion
  const toDateString = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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
            {checkIns.map((item, idx) => (
              <div
                key={item.id || idx}
                className="flex items-center px-4 py-3"
              >
                {/* Property Name */}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-neutral-900 dark:text-white truncate">
                    {item.property_name}
                  </div>
                  <div className="text-sm text-neutral-500 dark:text-neutral-400 truncate">
                    {item.guest_name || 'No guest'}
                  </div>
                </div>

                {/* Rhombus Check-in Visual - neutral color */}
                <div className="w-12 h-6 relative ml-3 shrink-0">
                  <div 
                    className="absolute inset-0 bg-neutral-400 dark:bg-neutral-500"
                    style={{
                      clipPath: 'polygon(40% 0%, 100% 0%, 100% 100%, 0% 100%)',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
