'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
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

// Shape overlay painted inside each day cell. Diagonal corner cuts:
//
//   check-in  → top-left corner cut out, purple fills the bottom-right
//   check-out → bottom-right corner cut out, purple fills the top-left
//   reserved  → full rectangle
//
// Solo check-in/check-out cells use a true corner-to-corner diagonal
// so the cut triangle's right/bottom (check-in) or left/top
// (check-out) edges run flush to the cell border — they tile
// seamlessly against the adjacent full reserved rectangles with no
// "step" / upward jog in the purple band.
//
// When a single cell carries BOTH check-in and check-out (a same-day
// turnover), splitGap pulls each diagonal 20% off the corner so the
// two triangles sit apart with a constant-width gap between them.
function DayShape({
  variant,
  splitGap,
}: {
  variant: 'reserved' | 'check-in' | 'check-out';
  splitGap?: boolean;
}) {
  let clipPath: string | undefined;
  if (variant === 'check-in') {
    clipPath = splitGap
      ? 'polygon(100% 20%, 100% 100%, 20% 100%)'
      : 'polygon(100% 0, 100% 100%, 0 100%)';
  } else if (variant === 'check-out') {
    clipPath = splitGap
      ? 'polygon(0 0, 80% 0, 0 80%)'
      : 'polygon(0 0, 100% 0, 0 100%)';
  }
  // reserved → clipPath undefined → full rectangle fill
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundColor: 'rgba(167, 139, 250, 0.18)',
        clipPath,
        zIndex: 0,
      }}
    />
  );
}

interface DayMarks {
  checkIn: boolean;
  checkOut: boolean;
  reserved: boolean;
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

  // Index reservations into a Map<YYYY-MM-DD, DayMarks>. A single day
  // can carry multiple flags — most importantly, a same-day turnover
  // (one reservation's checkOut on the same day as another's checkIn)
  // gets BOTH the checkIn and checkOut flags so DayCell can render
  // both half-cell parallelograms with a gap between them.
  const dayMarks = useMemo(() => {
    const map = new Map<string, DayMarks>();
    const getOrInit = (key: string): DayMarks => {
      let m = map.get(key);
      if (!m) {
        m = { checkIn: false, checkOut: false, reserved: false };
        map.set(key, m);
      }
      return m;
    };
    for (const r of reservations) {
      const start = toDateOnly(r.check_in);
      const end = toDateOnly(r.check_out);
      getOrInit(toYMD(start)).checkIn = true;
      getOrInit(toYMD(end)).checkOut = true;
      const cursor = new Date(start);
      cursor.setDate(cursor.getDate() + 1);
      while (cursor < end) {
        getOrInit(toYMD(cursor)).reserved = true;
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return map;
  }, [reservations]);

  // Custom Day cell. Wraps the normal day button in a <td> with our
  // shape overlay sibling. react-day-picker forwards day + style +
  // className + ARIA props here; we keep them all (so selection,
  // focus, today, outside-month dimming, etc. still work) and add
  // the reservation backdrop.
  function DayCell(props: {
    day: { date: Date };
    modifiers: Record<string, boolean>;
    className?: string;
    style?: React.CSSProperties;
    children?: ReactNode;
    [k: string]: unknown;
  }) {
    const { day, modifiers, className, style, children, ...rest } = props;
    const marks = dayMarks.get(toYMD(day.date));
    // Don't paint reservation overlays on the selected day — the
    // button's primary background should read cleanly.
    const showShapes = !!marks && !modifiers.selected;
    // Same-day turnover: this cell is both a check-out and a check-in.
    // Only then do the diagonals offset to leave a gap between them.
    const splitGap = !!marks && marks.checkIn && marks.checkOut;
    return (
      <td className={className} style={style} {...rest}>
        {showShapes && marks!.reserved && <DayShape variant="reserved" />}
        {showShapes && marks!.checkOut && (
          <DayShape variant="check-out" splitGap={splitGap} />
        )}
        {showShapes && marks!.checkIn && (
          <DayShape variant="check-in" splitGap={splitGap} />
        )}
        {children}
      </td>
    );
  }

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
        collisionPadding={12}
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
          // Plain month-name label (e.g. "April 2026") flanked by the
          // built-in prev/next chevrons — no month/year dropdowns.
          captionLayout="label"
          components={{ Day: DayCell as never }}
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
