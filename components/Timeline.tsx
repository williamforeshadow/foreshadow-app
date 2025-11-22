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
  const [dateRange, setDateRange] = useState<Date[]>([]);

  useEffect(() => {
    fetchReservations();
  }, []);

  useEffect(() => {
    generateDateRange();
  }, [view]);

  const generateDateRange = () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const dates: Date[] = [];
    const numDays = view === 'week' ? 7 : 30;
    
    for (let i = 0; i < numDays; i++) {
      const date = new Date(yesterday);
      date.setDate(date.getDate() + i);
      dates.push(date);
    }
    
    setDateRange(dates);
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
    
    return (
      <div className="text-center">
        <div className={`text-xs ${isToday ? 'font-bold text-purple-600 dark:text-purple-400' : 'text-slate-600 dark:text-slate-400'}`}>
          {date.toLocaleDateString('en-US', { weekday: 'short' })}
        </div>
        <div className={`text-sm ${isToday ? 'font-bold text-purple-600 dark:text-purple-400' : 'text-slate-900 dark:text-white'}`}>
          {date.getDate()}
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
    
    const startIdx = dateRange.findIndex(d => 
      d.toDateString() === checkInDate.toDateString()
    );
    
    let span = 0;
    for (let i = 0; i < dateRange.length; i++) {
      const currentDate = dateRange[i];
      if (currentDate >= checkInDate && currentDate < checkOutDate) {
        span++;
      }
    }
    
    return { start: startIdx, span };
  };

  const renderReservationBlock = (reservation: any) => {
    const { start, span } = getBlockPosition(reservation.check_in, reservation.check_out);
    
    if (start === -1 || span === 0) return null;

    return (
      <div
        key={reservation.id}
        onClick={() => onCardClick(reservation)}
        style={{
          gridColumnStart: start + 2, // +2 because first column is property name
          gridColumnEnd: `span ${span}`
        }}
        className="bg-rose-400 hover:bg-rose-500 border-2 border-white dark:border-slate-900 rounded px-2 py-1 cursor-pointer transition-all duration-150 hover:shadow-lg hover:z-10 text-white text-xs font-medium truncate"
        title={`${reservation.guest_name || 'No guest'} - ${formatDate(new Date(reservation.check_in))} to ${formatDate(new Date(reservation.check_out))}`}
      >
        {reservation.guest_name || 'No guest'}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="mt-8 bg-white dark:bg-slate-900 p-6 rounded-lg border border-slate-200 dark:border-slate-800">
        <div className="text-center py-12 text-slate-500 dark:text-slate-400">
          Loading timeline...
        </div>
      </div>
    );
  }

  return (
    <div className="mt-8 bg-white dark:bg-slate-900 p-6 rounded-lg border border-slate-200 dark:border-slate-800">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          Property Timeline
        </h2>
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

      <div className="overflow-x-auto">
        <div 
          className="grid gap-px bg-slate-200 dark:bg-slate-700 border border-slate-200 dark:border-slate-700"
          style={{
            gridTemplateColumns: `200px repeat(${dateRange.length}, minmax(80px, 1fr))`,
            minWidth: `${200 + dateRange.length * 80}px`
          }}
        >
          {/* Header Row */}
          <div className="bg-slate-100 dark:bg-slate-800 p-2 font-semibold text-slate-900 dark:text-white sticky left-0 z-10">
            Property
          </div>
          {dateRange.map((date, idx) => (
            <div key={idx} className="bg-slate-100 dark:bg-slate-800 p-2">
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
                <div className="bg-white dark:bg-slate-900 p-2 font-medium text-slate-900 dark:text-white sticky left-0 z-10 border-r border-slate-200 dark:border-slate-700">
                  {property}
                </div>
                
                {/* Date Cells */}
                {dateRange.map((_, idx) => (
                  <div
                    key={idx}
                    className="bg-white dark:bg-slate-900 relative min-h-[40px]"
                  />
                ))}
                
                {/* Reservation Blocks (overlay on grid) */}
                <div
                  className="contents"
                  style={{
                    display: 'grid',
                    gridColumn: '1 / -1',
                    gridTemplateColumns: `200px repeat(${dateRange.length}, minmax(80px, 1fr))`
                  }}
                >
                  <div />
                  {propertyReservations.map((reservation) => renderReservationBlock(reservation))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

