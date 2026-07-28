'use client';

// The department icon chooser, shared by the list page's inline edit, the
// create dialog, and the detail page's edit dialog — all three used to carry
// their own copy of the same grid.

import { AdaptivePicker } from '@/components/tasks/detail/primitives/AdaptivePicker';
import { ChipButton } from '@/components/ui/panel/PanelForm';
import { DeptGlyph } from '@/components/tasks/DeptGlyph';
import { DEPARTMENT_ICON_OPTIONS, DEPARTMENT_ICON_MAP } from '@/lib/departmentIcons';

export default function DeptIconPicker({
  open,
  onOpenChange,
  value,
  onSelect,
  disabled,
  align = 'start',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onSelect: (key: string) => void;
  disabled?: boolean;
  align?: 'start' | 'center' | 'end';
}) {
  return (
    <AdaptivePicker
      open={open}
      onOpenChange={onOpenChange}
      title="Icon"
      align={align}
      disabled={disabled}
      trigger={
        <ChipButton set aria-label="Choose icon" title="Choose icon">
          <DeptGlyph iconKey={value} size={17} />
        </ChipButton>
      }
    >
      <div className="grid grid-cols-5 gap-1 p-1">
        {DEPARTMENT_ICON_OPTIONS.map((opt) => {
          const Icon = DEPARTMENT_ICON_MAP[opt.key];
          if (!Icon) return null;
          const active = value === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              title={opt.label}
              aria-label={opt.label}
              aria-pressed={active}
              onClick={() => {
                onSelect(opt.key);
                onOpenChange(false);
              }}
              className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
              style={{
                background: active ? 'var(--task-accent-soft)' : 'transparent',
                color: active ? 'var(--task-accent)' : 'var(--task-ink-2)',
              }}
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </button>
          );
        })}
      </div>
    </AdaptivePicker>
  );
}
