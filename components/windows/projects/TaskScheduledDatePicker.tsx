'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { parseISO } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toDateOnly } from '@/components/properties/schedule/scheduleDates';
import {
  usePropertyAvailabilityMonth,
  type AvailabilityBlock,
  type AvailabilityReservation,
} from '@/lib/queries/usePropertyAvailability';

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

// Fill per occupancy kind. Values mirror the property Schedule month grid so a
// day reads the same whichever surface you meet it on:
//   guest booking → purple (the picker's long-standing occupied color)
//   owner stay    → amber
//   calendar block→ slate
//
// Slate for blocks is deliberate: the task row's occupancy column already
// spends red on "blocked", and red is now the current-day ring. Two different
// meanings in one calendar cell would be worse than a quieter block.
type OccupancyKind = 'guest' | 'owner' | 'block';

const FILL_CLASS: Record<OccupancyKind, string> = {
  guest: 'bg-[rgba(167,139,250,0.18)] dark:bg-[rgba(167,139,250,0.22)]',
  owner: 'bg-[rgba(180,130,60,0.26)] dark:bg-[rgba(214,158,74,0.22)]',
  block: 'bg-[rgba(88,90,102,0.30)] dark:bg-[rgba(138,140,152,0.24)]',
};

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
//
// Calendar blocks always use the 'reserved' full rectangle — a block has no
// check-in/check-out ceremony, and a one-day block should read as a solid
// cell rather than a collapsed sliver (same call the month grid makes).
function DayShape({
  variant,
  kind,
  splitGap,
  elevated,
}: {
  variant: 'reserved' | 'check-in' | 'check-out';
  kind: OccupancyKind;
  splitGap?: boolean;
  /**
   * Paint above the day button instead of behind it. Used on the selected day,
   * whose button carries a solid fill that would otherwise hide the occupancy
   * underneath it entirely. These fills are translucent (0.18–0.30), so riding
   * on top tints the selection rather than replacing it — you can still read
   * both "this is the scheduled date" and "someone is in the unit".
   */
  elevated?: boolean;
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
      className={`pointer-events-none absolute inset-0 ${FILL_CLASS[kind]}`}
      style={{ clipPath, zIndex: elevated ? 1 : 0 }}
    />
  );
}

// Per-day occupancy. checkIn/checkOut/reserved carry the reservation kind that
// produced them (null = absent) so each band can be colored independently — a
// guest checking out the morning an owner checks in paints purple and amber in
// the same cell.
interface DayMarks {
  checkIn: OccupancyKind | null;
  checkOut: OccupancyKind | null;
  reserved: OccupancyKind | null;
  blocked: boolean;
}

function emptyMarks(): DayMarks {
  return { checkIn: null, checkOut: null, reserved: null, blocked: false };
}

/**
 * Index reservations and blocks into a Map<YYYY-MM-DD, DayMarks>.
 *
 * A single day can carry several flags at once — most importantly a same-day
 * turnover (one reservation's checkOut on the same day as another's checkIn)
 * gets BOTH checkIn and checkOut so the cell renders two half-cell
 * parallelograms with a gap between them.
 */
function buildDayMarks(
  reservations: AvailabilityReservation[],
  blocks: AvailabilityBlock[]
): Map<string, DayMarks> {
  const map = new Map<string, DayMarks>();
  const getOrInit = (key: string): DayMarks => {
    let m = map.get(key);
    if (!m) {
      m = emptyMarks();
      map.set(key, m);
    }
    return m;
  };

  for (const r of reservations) {
    const kind: OccupancyKind = r.kind === 'owner_stay' ? 'owner' : 'guest';
    const start = toDateOnly(r.check_in);
    const end = toDateOnly(r.check_out);
    getOrInit(toYMD(start)).checkIn = kind;
    getOrInit(toYMD(end)).checkOut = kind;
    const cursor = new Date(start);
    cursor.setDate(cursor.getDate() + 1);
    while (cursor < end) {
      getOrInit(toYMD(cursor)).reserved = kind;
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  // Blocks span start_date .. end_date INCLUSIVE — unlike a reservation, the
  // last day is still unavailable (nobody checks out of a maintenance hold).
  for (const b of blocks) {
    const start = toDateOnly(b.start_date);
    const end = toDateOnly(b.end_date);
    const cursor = new Date(start);
    while (cursor <= end) {
      getOrInit(toYMD(cursor)).blocked = true;
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return map;
}

// Custom Day cell. Wraps the normal day button in a <td> with our shape
// overlay siblings. react-day-picker forwards day + style + className + ARIA
// props here; we keep them all (so selection, focus, today, outside-month
// dimming, etc. still work) and add the occupancy backdrop.
//
// Built by a factory rather than declared inside the picker body: a component
// defined inline would be a fresh type on every render, remounting all 42
// cells each time. This identity only changes when the marks do.
function makeDayCell(dayMarks: Map<string, DayMarks>) {
  return function DayCell(props: {
    day: { date: Date };
    modifiers: Record<string, boolean>;
    className?: string;
    style?: React.CSSProperties;
    children?: ReactNode;
    [k: string]: unknown;
  }) {
    const { day, modifiers, className, style, children, ...rest } = props;
    const marks = dayMarks.get(toYMD(day.date));
    const showShapes = !!marks;
    // The selected day's button paints a solid fill. Occupancy still shows on
    // it — the bands just move above the button so they tint that fill instead
    // of being buried under it. Picking an occupied date shouldn't erase the
    // reason you might not want to.
    const elevated = !!modifiers.selected;
    // Same-day turnover: this cell is both a check-out and a check-in.
    // Only then do the diagonals offset to leave a gap between them.
    const splitGap = !!marks && !!marks.checkIn && !!marks.checkOut;
    return (
      <td className={className} style={style} {...rest}>
        {showShapes && marks!.blocked && (
          <DayShape variant="reserved" kind="block" elevated={elevated} />
        )}
        {showShapes && marks!.reserved && (
          <DayShape variant="reserved" kind={marks!.reserved} elevated={elevated} />
        )}
        {showShapes && marks!.checkOut && (
          <DayShape
            variant="check-out"
            kind={marks!.checkOut}
            splitGap={splitGap}
            elevated={elevated}
          />
        )}
        {showShapes && marks!.checkIn && (
          <DayShape
            variant="check-in"
            kind={marks!.checkIn}
            splitGap={splitGap}
            elevated={elevated}
          />
        )}
        {children}
      </td>
    );
  };
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

  useEffect(() => {
    if (selectedDate) setVisibleMonth(selectedDate);
  }, [selectedDate]);

  // Not gated on `open`. The surface that owns the Schedule chip warms this
  // same cache key on mount, so the first paint is normally a cache hit and
  // the occupancy is there with the grid rather than a beat after it.
  const { availability } = usePropertyAvailabilityMonth(propertyId, visibleMonth);

  const dayMarks = useMemo(
    () => buildDayMarks(availability.reservations, availability.blocks),
    [availability]
  );
  const DayCell = useMemo(() => makeDayCell(dayMarks), [dayMarks]);

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
