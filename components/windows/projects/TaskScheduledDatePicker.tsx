'use client';

import { useEffect, useMemo, useState } from 'react';
import { parseISO } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toDateOnly } from '@/components/properties/schedule/scheduleDates';

interface Reservation {
  id: string;
  check_in: string;
  check_out: string;
}

interface ScheduleResponse {
  reservations?: Reservation[];
}

interface TaskScheduledDatePickerProps {
  propertyId: string | null;
  value: string; // YYYY-MM-DD or ''
  onChange: (next: string) => void;
}

function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDisplay(value: string): string {
  if (!value) return '';
  const d = parseISO(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString();
}

export function TaskScheduledDatePicker({
  propertyId,
  value,
  onChange,
}: TaskScheduledDatePickerProps) {
  const selectedDate = useMemo(() => {
    if (!value) return undefined;
    const d = parseISO(`${value.slice(0, 10)}T00:00:00`);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }, [value]);

  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState<Date>(selectedDate ?? new Date());
  const [reservations, setReservations] = useState<Reservation[]>([]);

  // Keep the visible month tracking the value when it changes externally.
  useEffect(() => {
    if (selectedDate) setVisibleMonth(selectedDate);
  }, [selectedDate]);

  useEffect(() => {
    if (!propertyId || !open) return;
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth() + 1;
    const controller = new AbortController();
    fetch(`/api/properties/${propertyId}/schedule?year=${year}&month=${month}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? (r.json() as Promise<ScheduleResponse>) : { reservations: [] }))
      .then((data) => setReservations(data.reservations ?? []))
      .catch((err) => {
        if (err?.name !== 'AbortError') setReservations([]);
      });
    return () => controller.abort();
  }, [propertyId, open, visibleMonth]);

  const { reservedDays, checkInDays, checkOutDays } = useMemo(() => {
    const reserved: Date[] = [];
    const checkIn: Date[] = [];
    const checkOut: Date[] = [];
    for (const r of reservations) {
      const start = toDateOnly(r.check_in);
      const end = toDateOnly(r.check_out);
      checkIn.push(start);
      checkOut.push(end);
      const cursor = new Date(start);
      cursor.setDate(cursor.getDate() + 1);
      while (cursor < end) {
        reserved.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return { reservedDays: reserved, checkInDays: checkIn, checkOutDays: checkOut };
  }, [reservations]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="bg-transparent border-none outline-none text-left text-[13px] text-muted-foreground hover:text-foreground focus:text-foreground p-0 w-full min-w-0 cursor-pointer"
        >
          {value ? formatDisplay(value) : <span className="opacity-60">Set date</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        // z-[80] sits above the mobile detail sheet (z-60) and the
        // mobile InlineDropdown (z-70); desktop baseline is z-50 so
        // this is safe everywhere.
        className="w-auto p-0 z-[80]"
        data-task-scheduled-date-picker
      >
        <Calendar
          mode="single"
          selected={selectedDate}
          month={visibleMonth}
          onMonthChange={setVisibleMonth}
          onSelect={(date) => {
            if (!date) return;
            onChange(toYMD(date));
            setOpen(false);
          }}
          modifiers={{
            reserved: reservedDays,
            checkIn: checkInDays,
            checkOut: checkOutDays,
          }}
          modifiersClassNames={{
            reserved: 'tsdp-day-reserved',
            checkIn: 'tsdp-day-check-in',
            checkOut: 'tsdp-day-check-out',
          }}
          captionLayout="dropdown"
        />
        {value && (
          <div className="flex justify-end border-t border-[rgba(30,25,20,0.06)] dark:border-white/10 p-2">
            <button
              type="button"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
              className="text-[12px] text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-white/[0.06]"
            >
              Clear
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
