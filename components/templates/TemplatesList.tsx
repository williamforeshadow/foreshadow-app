'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdaptivePicker } from '@/components/tasks/detail/primitives/AdaptivePicker';
import { TaskOptionRow } from '@/components/tasks/detail/primitives/TaskSheet';
import { ChipButton, MetaChip, SectionLabel } from '@/components/ui/panel/PanelForm';
import { LoadingState } from '@/components/ui/loading-state';
import { DeptGlyph } from '@/components/tasks/DeptGlyph';
import { useDepartments } from '@/lib/departmentsContext';

export interface TemplateListItem {
  id: string;
  name: string;
  department_id: string | null;
  department_name: string | null;
  description: string | null;
  fields: { id: string }[];
  created_at: string;
  updated_at: string;
}

const CHEVRON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

// Marks the button as a picker rather than an action — otherwise it reads the
// same as "+ New template" sitting next to it.
const CARET = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }} aria-hidden>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

/** Matched to the automations pages so the two line up as you move between them. */
const DETAIL_COL = 'mx-auto w-full max-w-[46rem]';

/** Bucket for templates with no department. Not a real id, so it can't collide. */
const UNCATEGORIZED = '__uncategorized__';

interface DeptOption {
  id: string;
  label: string;
  /** Icon key, or null for buckets with no department row behind them. */
  iconKey: string | null | undefined;
  count: number;
}

export default function TemplatesList({
  templates,
  loading,
}: {
  templates: TemplateListItem[];
  loading: boolean;
}) {
  const router = useRouter();
  const { departments, deptIconMap } = useDepartments();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of templates) {
      const key = t.department_id ?? UNCATEGORIZED;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [templates]);

  const options = useMemo<DeptOption[]>(() => {
    // Every department the org has, including the empty ones.
    const list: DeptOption[] = departments.map((d) => ({
      id: d.id,
      label: d.name,
      iconKey: deptIconMap[d.id],
      count: counts.get(d.id) ?? 0,
    }));

    const known = new Set(departments.map((d) => d.id));

    // A template can point at a department the context doesn't have — deleted,
    // or not yet loaded. Without an entry here those templates are unreachable,
    // so name the bucket from the template's own denormalised field.
    for (const t of templates) {
      if (!t.department_id || known.has(t.department_id)) continue;
      known.add(t.department_id);
      list.push({
        id: t.department_id,
        label: t.department_name || 'Unknown department',
        iconKey: null,
        count: counts.get(t.department_id) ?? 0,
      });
    }

    // Only worth showing when something actually landed in it.
    const orphans = counts.get(UNCATEGORIZED) ?? 0;
    if (orphans > 0) {
      list.push({ id: UNCATEGORIZED, label: 'Uncategorized', iconKey: null, count: orphans });
    }

    return list;
  }, [departments, deptIconMap, templates, counts]);

  // Derived, not synced: until the user picks — or if their pick disappears
  // because departments reloaded — fall back to the first department that has
  // something in it. Doing this in an effect would cascade a second render.
  const active =
    (selectedId && options.find((o) => o.id === selectedId)) ||
    options.find((o) => o.count > 0) ||
    options[0] ||
    null;

  const selected = active;

  const visible = useMemo(() => {
    if (!selected) return [];
    return templates
      .filter((t) => (t.department_id ?? UNCATEGORIZED) === selected.id)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [templates, selected]);

  return (
    <div className="panel-form flex h-full flex-col" style={{ background: 'var(--task-surface-0)' }}>
      <div className="flex-1 overflow-y-auto">
        <div className={DETAIL_COL}>
          <div
            className="flex items-center justify-between gap-3 border-b px-[18px] py-3"
            style={{ borderColor: 'var(--task-line-soft)' }}
          >
            {/* The button says "Department", not which one — so the heading
                carries the current selection. */}
            <SectionLabel className="!px-0 !pb-0 !pt-0 min-w-0 truncate">
              {loading
                ? 'Templates'
                : `${selected ? `${selected.label} · ` : ''}${visible.length} template${
                    visible.length === 1 ? '' : 's'
                  }`}
            </SectionLabel>
            <div className="flex shrink-0 items-center gap-1.5">
              <AdaptivePicker
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                title="Department"
                align="end"
                trigger={
                  <ChipButton set disabled={options.length === 0}>
                    <span className="flex items-center gap-1.5">
                      Department
                      {CARET}
                    </span>
                  </ChipButton>
                }
              >
                {options.map((option) => (
                  <TaskOptionRow
                    key={option.id}
                    selected={option.id === selected?.id}
                    leading={<DeptGlyph iconKey={option.iconKey} size={17} muted={option.count === 0} />}
                    onSelect={() => {
                      setSelectedId(option.id);
                      setPickerOpen(false);
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      <span
                        className="shrink-0 font-mono text-[length:var(--task-fs-label)]"
                        style={{ color: 'var(--task-ink-3)' }}
                      >
                        {option.count}
                      </span>
                    </span>
                  </TaskOptionRow>
                ))}
              </AdaptivePicker>
              <ChipButton set onClick={() => router.push('/templates/new')}>
                + New template
              </ChipButton>
            </div>
          </div>

          {loading ? (
            <div className="flex min-h-[50vh] flex-1 items-center justify-center px-[18px]">
              <LoadingState />
            </div>
          ) : visible.length === 0 ? (
            <div className="px-[18px] py-12 text-center">
              <p className="text-[length:var(--task-fs-option)]" style={{ color: 'var(--task-ink-2)' }}>
                {selected ? `No templates in ${selected.label}.` : 'No departments yet.'}
              </p>
              <p
                className="mt-1.5 text-[length:var(--task-fs-body-sm)]"
                style={{ color: 'var(--task-ink-3)' }}
              >
                {selected
                  ? 'A template is the checklist a generated task starts from.'
                  : 'Create a department before adding templates.'}
              </p>
              {selected && (
                <div className="mt-4 flex justify-center">
                  <ChipButton set onClick={() => router.push('/templates/new')}>
                    + New template
                  </ChipButton>
                </div>
              )}
            </div>
          ) : (
            visible.map((template) => {
              const fieldCount = template.fields?.length ?? 0;
              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => router.push(`/templates/${template.id}`)}
                  className="flex w-full items-center gap-2.5 border-b px-[18px] py-2.5 text-left transition-colors hover:bg-[var(--task-surface-1)]"
                  style={{ borderColor: 'var(--task-line-soft)' }}
                >
                  <span className="shrink-0">
                    <DeptGlyph iconKey={selected?.iconKey} size={17} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate text-[length:var(--task-fs-option)]"
                      style={{ color: 'var(--task-ink-1)' }}
                    >
                      {template.name}
                    </span>
                    {template.description && (
                      <span
                        className="block truncate text-[length:var(--task-fs-body-sm)]"
                        style={{ color: 'var(--task-ink-3)' }}
                      >
                        {template.description}
                      </span>
                    )}
                  </span>
                  <MetaChip>
                    {fieldCount} field{fieldCount === 1 ? '' : 's'}
                  </MetaChip>
                  <span className="shrink-0" style={{ color: 'var(--task-ink-3)' }}>
                    {CHEVRON}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
