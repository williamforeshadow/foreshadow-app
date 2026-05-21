'use client';

import { useMemo } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface TaskScheduledTimePickerProps {
  value: string; // HH:MM (24h) or ''
  onChange: (next: string) => void;
}

function formatDisplay(value: string): string {
  if (!value) return '';
  const [hStr, mStr] = value.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return value;
  const period = h >= 12 ? 'PM' : 'AM';
  const display = h % 12 === 0 ? 12 : h % 12;
  const mm = String(m).padStart(2, '0');
  return `${display}:${mm} ${period}`;
}

// 30-min increments, 6:00 AM through 9:30 PM — covers the realistic
// turnover-ops scheduling window. The native <input type="time"> remains
// available behind the scenes since this is the same data shape.
function buildSlots(): string[] {
  const slots: string[] = [];
  for (let h = 6; h <= 21; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
    slots.push(`${String(h).padStart(2, '0')}:30`);
  }
  return slots;
}

export function TaskScheduledTimePicker({
  value,
  onChange,
}: TaskScheduledTimePickerProps) {
  const slots = useMemo(buildSlots, []);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="bg-transparent border-none outline-none text-left text-[13px] text-muted-foreground hover:text-foreground focus:text-foreground p-0 w-full min-w-0 cursor-pointer"
        >
          {value ? formatDisplay(value) : <span className="opacity-60">Set time</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        collisionPadding={12}
        // Match the date picker's z-index so it sits above the mobile
        // sheet and any inline dropdowns.
        className="w-auto p-0 z-[80]"
      >
        <div className="max-h-[260px] overflow-y-auto py-1 min-w-[120px]">
          {slots.map((slot) => {
            const selected = slot === value;
            return (
              <button
                key={slot}
                type="button"
                onClick={() => onChange(slot)}
                className={`w-full px-3 py-1.5 text-left text-[13px] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-white/[0.06] ${
                  selected
                    ? 'text-foreground font-medium'
                    : 'text-muted-foreground'
                }`}
              >
                {formatDisplay(slot)}
              </button>
            );
          })}
        </div>
        {value && (
          <div className="flex justify-end border-t border-[rgba(30,25,20,0.06)] dark:border-white/10 p-2">
            <button
              type="button"
              onClick={() => onChange('')}
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
