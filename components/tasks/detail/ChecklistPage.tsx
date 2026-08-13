'use client';

import * as React from 'react';
import DynamicCleaningForm, { type Template, type FieldDefinition } from '@/components/DynamicCleaningForm';
import { isFieldSatisfied, unwrapValue } from '@/lib/tasks/templateProgress';
import { MonoLabel, IconButton, TitleSection } from './sections/HeaderSections';
import { TimerRail } from './sections/StatusSections';
import { LoadingState } from '@/components/ui/loading-state';

// A checklist section: the fields between two separators. Separators don't
// render as inline dividers anymore — they carve the checklist into
// horizontally-switchable sections under the header.
interface Section {
  key: string;
  label: string;
  fields: FieldDefinition[];
}

function splitSections(fields: FieldDefinition[]): Section[] {
  const sections: Section[] = [];
  let current: Section = { key: '__lead', label: 'General', fields: [] };
  for (const f of fields) {
    if (f.type === 'separator') {
      if (current.fields.length > 0) sections.push(current);
      current = { key: f.id, label: f.label || `Section ${sections.length + 1}`, fields: [] };
    } else {
      current.fields.push(f);
    }
  }
  if (current.fields.length > 0) sections.push(current);
  return sections;
}

// The checklist as its own page, headed exactly like the main task view:
// property micro-label, task title + address, timer rail, then progress.
// It overlays only the panel's content area — the ActionBar stays visible
// beneath it, so Start/Pause/Complete work without leaving the checklist.
// The caller must flush window.__currentFormSave when this closes (the
// controller's openView does).
export function ChecklistPage({
  taskId,
  propertyName,
  propertyAddress,
  template,
  formMetadata,
  onSaveForm,
  readOnly,
  loading,
  completed,
  total,
  onBack,
  title,
  onTitleChange,
  onTitleBlur,
  titleReadOnly,
  timerRunning,
  displaySeconds,
  formatTime,
  onTimerToggle,
  timerToggleDisabled,
}: {
  taskId: string;
  propertyName: string | null;
  propertyAddress: string | null;
  template: Template | null;
  formMetadata: Record<string, unknown> | null;
  onSaveForm: (formData: Record<string, unknown>) => Promise<void>;
  readOnly: boolean;
  loading: boolean;
  completed: number;
  total: number;
  onBack: () => void;
  title: string;
  onTitleChange: (v: string) => void;
  onTitleBlur: () => void;
  titleReadOnly?: boolean;
  timerRunning: boolean;
  displaySeconds: number;
  formatTime: (s: number) => string;
  onTimerToggle?: () => void;
  timerToggleDisabled?: boolean;
}) {
  const allDone = total > 0 && completed === total;

  const sections = React.useMemo(
    () => splitSections(template?.fields ?? []),
    [template]
  );
  const [activeKey, setActiveKey] = React.useState<string | null>(null);
  const active =
    (activeKey && sections.find((s) => s.key === activeKey)) || sections[0] || null;

  // Per-section progress for the tab counts.
  const sectionDone = React.useCallback(
    (s: Section) =>
      s.fields.filter((f) => isFieldSatisfied(f.type, unwrapValue(formMetadata?.[f.id]))).length,
    [formMetadata]
  );

  // New section, fresh scroll.
  const scrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [active?.key]);

  return (
    <div className="absolute inset-0 z-10 flex flex-col" style={{ background: 'var(--task-surface-0)' }}>
      <div
        className="shrink-0 border-b px-[18px] pb-3 pt-2"
        style={{ borderColor: 'var(--task-line-soft)' }}
      >
        {/* Same grammar as the main HeaderBar: back · property · trailing slot */}
        <div className="flex h-9 items-center justify-between">
          <div className="-ml-2">
            <IconButton label="Back" onClick={onBack}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </IconButton>
          </div>
          <MonoLabel>{propertyName ?? ''}</MonoLabel>
          <div className="flex w-[26px] justify-end">
            {readOnly && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--task-ink-3)" strokeWidth="1.6" strokeLinecap="round">
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path d="M8 11V8a4 4 0 018 0v3" />
              </svg>
            )}
          </div>
        </div>

        <TitleSection
          title={title}
          onTitleChange={onTitleChange}
          onTitleBlur={onTitleBlur}
          readOnly={titleReadOnly}
        />
        {propertyAddress && (
          <div
            className="mt-0.5 truncate text-[length:var(--task-fs-body-sm)]"
            style={{ color: 'var(--task-ink-3)' }}
          >
            {propertyAddress}
          </div>
        )}

        <TimerRail
          running={timerRunning}
          displaySeconds={displaySeconds}
          formatTime={formatTime}
          onToggle={onTimerToggle}
          toggleDisabled={timerToggleDisabled}
        />

        <div className="mt-3 flex items-center gap-2.5">
          <div className="h-[2px] flex-1 overflow-hidden rounded-[2px]" style={{ background: 'var(--task-surface-2)' }}>
            <div
              className="h-full transition-[width] duration-300"
              style={{
                width: total > 0 ? `${(completed / total) * 100}%` : '0%',
                background: allDone ? 'var(--task-green)' : 'var(--task-accent)',
              }}
            />
          </div>
          <MonoLabel style={{ color: 'var(--task-ink-2)' }}>{`${completed}/${total}`}</MonoLabel>
        </div>

        {/* Section tabs — separators carve the checklist into these. */}
        {sections.length > 1 && (
          <div
            className="-mx-[18px] mt-3 flex gap-1.5 overflow-x-auto px-[18px]"
            style={{ scrollbarWidth: 'none' }}
          >
            {sections.map((s) => {
              const done = sectionDone(s);
              const isActive = s.key === active?.key;
              const sectionComplete = done === s.fields.length && s.fields.length > 0;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setActiveKey(s.key)}
                  className="flex h-[var(--task-ctl-h)] shrink-0 items-center gap-1.5 rounded-lg px-[11px] font-mono text-[length:var(--task-fs-chip)] uppercase tracking-[0.08em] transition-transform active:scale-95"
                  style={{
                    background: isActive ? 'var(--task-surface-2)' : 'transparent',
                    border: `1px solid ${isActive ? 'var(--task-line)' : 'transparent'}`,
                    color: isActive ? 'var(--task-ink-1)' : 'var(--task-ink-3)',
                  }}
                >
                  <span>{s.label}</span>
                  {/* Complete = the app-wide "complete" violet, not green. */}
                  <span
                    className={sectionComplete ? 'text-[#4C4869] dark:text-[#6e6a8a]' : ''}
                    style={sectionComplete ? undefined : { color: 'var(--task-ink-3)' }}
                  >
                    {done}/{s.fields.length}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-[18px] py-4 pb-6">
        {loading ? (
          <div className="flex justify-center py-8">
            <LoadingState size={4} />
          </div>
        ) : template ? (
          <DynamicCleaningForm
            cleaningId={taskId}
            propertyName={propertyName ?? ''}
            template={template}
            formMetadata={formMetadata}
            onSave={onSaveForm}
            readOnly={readOnly}
            visibleFieldIds={active ? active.fields.map((f) => f.id) : undefined}
          />
        ) : (
          <MonoLabel>Checklist unavailable</MonoLabel>
        )}
      </div>
    </div>
  );
}
