'use client';

import * as React from 'react';
import { useRef, useState } from 'react';
import type { JSONContent } from '@tiptap/react';
import { useIsMobile } from '@/lib/useIsMobile';
import { useAuth } from '@/lib/authContext';
import { useDepartments } from '@/lib/departmentsContext';
import { useProjectBins } from '@/lib/hooks/useProjectBins';
import { useProperties, useTaskTemplates } from '@/lib/queries';
import { PRIORITY_LABELS, PRIORITY_ORDER, type User } from '@/lib/types';
import { PRIORITY_ICONS } from '@/lib/taskPriorityIcons';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { DeptGlyph } from '../DeptGlyph';
import { TaskScheduledDatePicker } from '@/components/windows/projects/TaskScheduledDatePicker';
import { TaskScheduledTimePicker } from '@/components/windows/projects/TaskScheduledTimePicker';
import { AdaptivePicker } from '../detail/primitives/AdaptivePicker';
import { TaskOptionRow } from '../detail/primitives/TaskSheet';
import { useTaskCreate, type CreatedTaskRow, type TaskCreateSeed } from './useTaskCreate';

// The one create-task interface, used everywhere a task can be made. Unlike
// the detail panel (built for scanning an existing task), this is a plain
// vertical list of labelled fields so it's obvious what needs filling in.
// Only the title is required; property and template are fixed at creation.

const ICONS = {
  template: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" />
    </svg>
  ),
  text: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M4 6h16M4 12h12M4 18h8" />
    </svg>
  ),
  property: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" />
    </svg>
  ),
  flag: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 21V4m0 1h12l-2.5 4L17 13H5" />
    </svg>
  ),
  people: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5" /><path d="M16 5.5a3.2 3.2 0 010 5.4M17.5 20c0-2.3-.8-3.9-2-4.8" />
    </svg>
  ),
  cal: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  ),
  box: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11h14V8M10 12h4" />
    </svg>
  ),
  clip: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05l-9.19 9.19a5 5 0 01-7.07-7.07l9.19-9.19a3 3 0 014.24 4.24l-9.2 9.19a1 1 0 01-1.41-1.41l8.49-8.49" />
    </svg>
  ),
  alert: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.5" />
    </svg>
  ),
};

const CHEVRON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="px-[18px] pb-1.5 pt-4 font-mono text-[10px] uppercase tracking-[0.14em]"
      style={{ color: 'var(--task-ink-3)' }}
    >
      {children}
    </div>
  );
}

/** One list row: leading icon, value (or muted placeholder), trailing chevron.
 *  `asChild` lets a picker own the click via its own trigger. */
const FieldRow = React.forwardRef<
  HTMLButtonElement,
  {
    icon: React.ReactNode;
    value?: string | null;
    placeholder: string;
    error?: string;
    chevron?: boolean;
    children?: React.ReactNode;
    // `value` here is the row's display text, not the button's HTML value.
  } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'value'>
>(function FieldRow({ icon, value, placeholder, error, chevron = true, children, ...rest }, ref) {
  return (
    <div className="border-b" style={{ borderColor: 'var(--task-line-soft)' }}>
      <button
        ref={ref}
        type="button"
        {...rest}
        className="flex w-full items-center gap-3 px-[18px] py-3.5 text-left transition-colors hover:bg-[var(--task-surface-1)] active:bg-[var(--task-surface-2)]"
      >
        <span className="shrink-0" style={{ color: error ? '#d97757' : 'var(--task-ink-3)' }}>
          {error ? ICONS.alert : icon}
        </span>
        <span className="min-w-0 flex-1 truncate text-[15px]" style={{ color: value ? 'var(--task-ink-1)' : 'var(--task-ink-3)' }}>
          {value || placeholder}
        </span>
        {children}
        {chevron && <span className="shrink-0" style={{ color: 'var(--task-ink-3)' }}>{CHEVRON}</span>}
      </button>
      {error && (
        <div className="px-[18px] pb-2.5 -mt-1 text-[13px]" style={{ color: '#d97757' }}>
          {error}
        </div>
      )}
    </div>
  );
});

export interface CreateTaskPanelProps {
  seed?: TaskCreateSeed;
  onClose: () => void;
  onCreated?: (task: CreatedTaskRow) => void;
  /** Alternate submit target (see useTaskCreate) — the proposed-task flow. */
  submitOverride?: (body: Record<string, unknown>) => Promise<CreatedTaskRow | null>;
  /** Label for the confirm button when "Create task" isn't right. */
  submitLabel?: string;
}

export function CreateTaskPanel({
  seed = {},
  onClose,
  onCreated,
  submitOverride,
  submitLabel = 'Create task',
}: CreateTaskPanelProps) {
  const isMobile = useIsMobile() ?? false;
  const { allUsers } = useAuth();
  const users = (allUsers as unknown as User[]) ?? [];
  const { departments } = useDepartments();
  const { properties } = useProperties();
  const { templates } = useTaskTemplates();
  const { user: authUser } = useAuth();
  const binsHook = useProjectBins({ currentUser: authUser as unknown as User | null });

  const c = useTaskCreate({ seed, onCreated, submitOverride });

  const [templateOpen, setTemplateOpen] = useState(false);
  const [propertyOpen, setPropertyOpen] = useState(false);
  const [deptOpen, setDeptOpen] = useState(false);
  const [assigneesOpen, setAssigneesOpen] = useState(false);
  const [schedOpen, setSchedOpen] = useState(false);
  const [binOpen, setBinOpen] = useState(false);
  const [descOpen, setDescOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Seeded property/template are the opening context (e.g. creating from
  // inside a property) — shown, but not re-pickable.
  const propertyLocked = !!seed.property_id;
  const templateLocked = !!seed.template_id;

  const dept = departments.find((d) => d.id === c.draft.department_id);
  const assignedNames = users
    .filter((u) => c.draft.assigned_staff.includes(u.id))
    .map((u) => u.name)
    .join(', ');
  const schedLabel = c.draft.scheduled_date
    ? `${c.draft.scheduled_date}${c.draft.scheduled_time ? ` · ${c.draft.scheduled_time}` : ''}`
    : null;
  const binLabel = c.draft.is_binned
    ? (binsHook.bins.find((b) => b.id === c.draft.bin_id)?.name ?? 'Task Bin')
    : null;

  const body = (
    <div
      className="task-detail relative flex h-full w-full flex-col overflow-hidden"
      style={{ background: 'var(--task-surface-0)' }}
    >
      {/* Header */}
      <div
        className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-[18px]"
        style={{ borderColor: 'var(--task-line-soft)' }}
      >
        <button
          type="button"
          onClick={onClose}
          className="-ml-2 flex h-9 w-9 items-center justify-center rounded-lg transition-transform active:scale-95"
          style={{ color: 'var(--task-ink-2)' }}
          aria-label="Cancel"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <div className="min-w-0 flex-1 text-center">
          <div className="truncate text-[15px] font-medium" style={{ color: 'var(--task-ink-1)' }}>
            New task
          </div>
          {c.draft.property_name && (
            <div className="truncate font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--task-ink-3)' }}>
              {c.draft.property_name}
            </div>
          )}
        </div>
        <div className="h-9 w-9" />
      </div>

      {/* Fields */}
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        <SectionLabel>Task</SectionLabel>

        {/* Template — sets the default title */}
        <AdaptivePicker
          open={templateOpen}
          onOpenChange={setTemplateOpen}
          title="Template"
          disabled={templateLocked}
          trigger={
            <FieldRow
              icon={ICONS.template}
              value={c.draft.template_name}
              placeholder="Select template"
              chevron={!templateLocked}
            />
          }
        >
          <TaskOptionRow
            selected={!c.draft.template_id}
            onSelect={() => { c.setTemplate(null, null); setTemplateOpen(false); }}
          >
            No template
          </TaskOptionRow>
          {templates.map((t) => (
            <TaskOptionRow
              key={t.id}
              selected={t.id === c.draft.template_id}
              onSelect={() => { c.setTemplate(t.id, t.name); setTemplateOpen(false); }}
            >
              {t.name}
            </TaskOptionRow>
          ))}
        </AdaptivePicker>

        {/* Title — the only required field */}
        <div className="border-b" style={{ borderColor: 'var(--task-line-soft)' }}>
          <div className="flex items-center gap-3 px-[18px] py-3.5">
            <span className="shrink-0" style={{ color: c.errors.title ? '#d97757' : 'var(--task-ink-3)' }}>
              {c.errors.title ? ICONS.alert : ICONS.text}
            </span>
            <input
              value={c.draft.title}
              onChange={(e) => c.updateField('title', e.target.value)}
              placeholder="Title (required)"
              className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--task-ink-3)]"
              style={{ color: 'var(--task-ink-1)' }}
            />
          </div>
          {c.errors.title && (
            <div className="-mt-1 px-[18px] pb-2.5 text-[13px]" style={{ color: '#d97757' }}>
              {c.errors.title}
            </div>
          )}
        </div>

        {/* Description */}
        {descOpen || c.draft.description ? (
          <div className="border-b px-[18px] py-3" style={{ borderColor: 'var(--task-line-soft)' }}>
            <RichTextEditor
              content={c.draft.description}
              onChange={(json) => c.updateField('description', json as JSONContent)}
              placeholder="Description"
              className="text-[14px]"
            />
          </div>
        ) : (
          <FieldRow
            icon={ICONS.text}
            placeholder="Description"
            chevron={false}
            onClick={() => setDescOpen(true)}
          />
        )}

        <SectionLabel>Assignment</SectionLabel>

        {/* Department */}
        <AdaptivePicker
          open={deptOpen}
          onOpenChange={setDeptOpen}
          title="Department"
          trigger={
            <FieldRow
              icon={dept ? <DeptGlyph iconKey={dept.icon} size={17} /> : ICONS.flag}
              value={dept?.name}
              placeholder="Select department"
            />
          }
        >
          <TaskOptionRow
            selected={!c.draft.department_id}
            onSelect={() => { c.updateField('department_id', null); setDeptOpen(false); }}
            leading={<span className="flex h-4 w-4 items-center justify-center" style={{ color: 'var(--task-ink-3)' }}>{ICONS.flag}</span>}
          >
            No department
          </TaskOptionRow>
          {departments.map((d) => (
            <TaskOptionRow
              key={d.id}
              selected={d.id === c.draft.department_id}
              onSelect={() => { c.updateField('department_id', d.id); setDeptOpen(false); }}
              leading={<DeptGlyph iconKey={d.icon} size={16} />}
            >
              {d.name}
            </TaskOptionRow>
          ))}
        </AdaptivePicker>

        {/* Assignees (multi-select — stays open) */}
        <AdaptivePicker
          open={assigneesOpen}
          onOpenChange={setAssigneesOpen}
          title="Assignees"
          trigger={
            <FieldRow icon={ICONS.people} value={assignedNames || null} placeholder="Assign people" />
          }
        >
          {users.map((u) => (
            <TaskOptionRow
              key={u.id}
              selected={c.draft.assigned_staff.includes(u.id)}
              onSelect={() => {
                const current = c.draft.assigned_staff;
                c.updateField(
                  'assigned_staff',
                  current.includes(u.id) ? current.filter((id) => id !== u.id) : [...current, u.id]
                );
              }}
            >
              {u.name}
            </TaskOptionRow>
          ))}
        </AdaptivePicker>

        <SectionLabel>Scheduling</SectionLabel>

        {/* Schedule */}
        <AdaptivePicker
          open={schedOpen}
          onOpenChange={setSchedOpen}
          title="Scheduled"
          contentClassName="w-auto"
          trigger={<FieldRow icon={ICONS.cal} value={schedLabel} placeholder="Schedule" />}
        >
          <div className="flex flex-col gap-2 p-1">
            <TaskScheduledDatePicker
              propertyId={c.draft.property_id}
              value={c.draft.scheduled_date ?? ''}
              onChange={(next) => c.updateField('scheduled_date', next || null)}
            />
            <TaskScheduledTimePicker
              value={c.draft.scheduled_time ?? ''}
              onChange={(next) => c.updateField('scheduled_time', next || null)}
            />
          </div>
        </AdaptivePicker>

        {/* Priority — options laid out inline so the scale is visible */}
        <div className="border-b px-[18px] py-3" style={{ borderColor: 'var(--task-line-soft)' }}>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--task-ink-3)' }}>
            Priority
          </div>
          <div className="flex gap-1.5">
            {PRIORITY_ORDER.map((p) => {
              const Icon = PRIORITY_ICONS[p] ?? PRIORITY_ICONS.medium;
              const active = c.draft.priority === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => c.updateField('priority', p)}
                  className="flex h-[32px] flex-1 items-center justify-center gap-1.5 rounded-lg font-mono text-[11px] transition-transform active:scale-95"
                  style={{
                    background: active ? 'var(--task-surface-2)' : 'transparent',
                    border: `1px ${active ? 'solid transparent' : 'dashed var(--task-line)'}`,
                    color: active ? 'var(--task-ink-1)' : 'var(--task-ink-3)',
                  }}
                >
                  <Icon size={13} strokeWidth={2} aria-hidden />
                  {PRIORITY_LABELS[p]}
                </button>
              );
            })}
          </div>
        </div>

        <SectionLabel>Location</SectionLabel>

        {/* Property — locked once seeded by the opening surface */}
        <AdaptivePicker
          open={propertyOpen}
          onOpenChange={setPropertyOpen}
          title="Property"
          disabled={propertyLocked}
          trigger={
            <FieldRow
              icon={ICONS.property}
              value={c.draft.property_name}
              placeholder="Select property"
              chevron={!propertyLocked}
            />
          }
        >
          <TaskOptionRow
            selected={!c.draft.property_id}
            onSelect={() => {
              c.updateField('property_id', null);
              c.updateField('property_name', null);
              setPropertyOpen(false);
            }}
          >
            No property
          </TaskOptionRow>
          {properties.map((p) => (
            <TaskOptionRow
              key={p.id ?? p.name}
              selected={p.id === c.draft.property_id}
              onSelect={() => {
                c.updateField('property_id', p.id);
                c.updateField('property_name', p.name);
                setPropertyOpen(false);
              }}
            >
              {p.name}
            </TaskOptionRow>
          ))}
        </AdaptivePicker>

        {/* Bin */}
        <AdaptivePicker
          open={binOpen}
          onOpenChange={setBinOpen}
          title="Bin"
          trigger={<FieldRow icon={ICONS.box} value={binLabel} placeholder="No bin" />}
        >
          <TaskOptionRow
            selected={!c.draft.is_binned}
            onSelect={() => { c.setBin(null, false); setBinOpen(false); }}
          >
            No bin
          </TaskOptionRow>
          <TaskOptionRow
            selected={c.draft.is_binned && !c.draft.bin_id}
            onSelect={() => { c.setBin(null, true); setBinOpen(false); }}
          >
            Task Bin
          </TaskOptionRow>
          {binsHook.bins.filter((b) => !b.is_system).map((b) => (
            <TaskOptionRow
              key={b.id}
              selected={c.draft.is_binned && b.id === c.draft.bin_id}
              onSelect={() => { c.setBin(b.id, true); setBinOpen(false); }}
            >
              {b.name}
            </TaskOptionRow>
          ))}
        </AdaptivePicker>

        <SectionLabel>Attachments</SectionLabel>

        {c.attachments.length > 0 && (
          <div className="flex flex-col">
            {c.attachments.map((f, i) => (
              <div
                key={`${f.name}-${i}`}
                className="flex items-center gap-3 border-b px-[18px] py-2.5"
                style={{ borderColor: 'var(--task-line-soft)' }}
              >
                <span className="shrink-0" style={{ color: 'var(--task-ink-3)' }}>{ICONS.clip}</span>
                <span className="min-w-0 flex-1 truncate text-[14px]" style={{ color: 'var(--task-ink-2)' }}>
                  {f.name}
                </span>
                <button
                  type="button"
                  onClick={() => c.removeAttachment(i)}
                  aria-label={`Remove ${f.name}`}
                  className="shrink-0 rounded-md p-1 transition-transform active:scale-95"
                  style={{ color: 'var(--task-ink-3)' }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
        <FieldRow
          icon={ICONS.clip}
          placeholder="Add attachment"
          chevron={false}
          onClick={() => fileRef.current?.click()}
        />
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            c.addAttachments(Array.from(e.target.files ?? []));
            if (fileRef.current) fileRef.current.value = '';
          }}
        />

        <div style={{ height: '1.5rem' }} />
      </div>

      {/* Action bar */}
      <div
        className="shrink-0 border-t px-[18px] pt-3"
        style={{
          borderColor: 'var(--task-line-soft)',
          paddingBottom: isMobile ? 'calc(0.75rem + env(safe-area-inset-bottom))' : '0.75rem',
        }}
      >
        <button
          type="button"
          onClick={() => void c.submit()}
          disabled={c.creating}
          className="flex h-[46px] w-full items-center justify-center rounded-xl font-mono text-[12px] uppercase tracking-[0.1em] transition-transform active:scale-[0.99] disabled:opacity-50"
          style={{ background: 'var(--task-accent)', color: '#fff' }}
        >
          {c.creating ? 'Creating…' : submitLabel}
        </button>
      </div>
    </div>
  );

  if (isMobile) {
    // Same status-bar inset as the detail panel — full-screen covers the notch.
    return (
      <div
        className="task-detail safe-area-top fixed inset-0 z-50"
        style={{ background: 'var(--task-surface-0)' }}
      >
        {body}
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/40" style={{ pointerEvents: 'auto' }} onClick={onClose} />
      <div
        className="pointer-events-auto relative flex h-full max-h-[680px] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl"
        style={{ boxShadow: '0 24px 70px -12px rgba(0,0,0,0.55), 0 8px 24px -8px rgba(0,0,0,0.4)' }}
      >
        {body}
      </div>
    </div>
  );
}
