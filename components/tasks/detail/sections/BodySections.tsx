'use client';

import * as React from 'react';
import { useState } from 'react';
import type { Department, ProjectBin, PropertyOption, TaskTemplate, User } from '@/lib/types';
import type { Attachment } from '@/lib/types';
import { PRIORITY_LABELS, PRIORITY_ORDER } from '@/lib/types';
import { toast } from '@/components/ui/toast';
import { TaskScheduledDatePicker } from '@/components/windows/projects/TaskScheduledDatePicker';
import { TaskScheduledTimePicker } from '@/components/windows/projects/TaskScheduledTimePicker';
import { AdaptivePicker } from '../primitives/AdaptivePicker';
import { TaskOptionRow } from '../primitives/TaskSheet';
import {
  SELECTABLE_STATUSES,
  statusColorClass,
  statusIcon,
  statusLabel,
} from '../statusConfig';
import { MonoLabel } from './HeaderSections';

/* ---------- status pill (matches kanban icons + colors) ---------- */

function StatusChip({
  status,
  isTemplated,
  isContingent,
  onSelectStatus,
}: {
  status: string;
  isTemplated: boolean;
  isContingent: boolean;
  onSelectStatus: (status: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const Icon = statusIcon(status);
  const colorCls = statusColorClass(status);
  const label = statusLabel(status);

  const pill = (interactive: boolean) => (
    <button
      type="button"
      className="flex h-[30px] shrink-0 items-center gap-1.5 rounded-lg px-[11px] font-mono text-[11px] transition-transform active:scale-95"
      style={{ background: 'var(--task-surface-2)', cursor: interactive ? 'pointer' : 'default' }}
    >
      <Icon size={13} className={colorCls} />
      <span className={colorCls}>{label}</span>
    </button>
  );

  // Contingent is a system state — display-only.
  if (isContingent) return pill(false);

  // Templated tasks: status follows the checklist actions, not a picker.
  if (isTemplated) {
    return (
      <span
        onClick={() =>
          toast.info('Status follows the checklist — use Start, Pause, Complete, or Reopen.')
        }
        className="contents"
      >
        {pill(true)}
      </span>
    );
  }

  // Non-templated: free status picker.
  return (
    <AdaptivePicker
      open={open}
      onOpenChange={setOpen}
      title="Status"
      trigger={pill(true)}
    >
      {SELECTABLE_STATUSES.map((s) => {
        const OptIcon = statusIcon(s);
        return (
          <TaskOptionRow
            key={s}
            selected={s === status}
            onSelect={() => {
              onSelectStatus(s);
              setOpen(false);
            }}
            leading={<OptIcon size={16} className={statusColorClass(s)} />}
          >
            {statusLabel(s)}
          </TaskOptionRow>
        );
      })}
    </AdaptivePicker>
  );
}

/* ---------- chips ---------- */

// forwardRef + prop spread so it can serve as a Radix Popover trigger (the
// picker needs to inject onClick + a ref to anchor the popover).
const Chip = React.forwardRef<
  HTMLButtonElement,
  {
    icon: React.ReactNode;
    children: React.ReactNode;
    set: boolean;
    locked?: boolean;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function Chip({ icon, children, set, locked, disabled, style, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      {...rest}
      className="flex h-[30px] shrink-0 items-center gap-1.5 rounded-lg px-[11px] font-mono text-[11px] transition-transform active:scale-95 disabled:active:scale-100"
      style={{
        background: set ? 'var(--task-surface-2)' : 'transparent',
        border: `1px ${set ? 'solid transparent' : 'dashed var(--task-line)'}`,
        color: set ? 'var(--task-ink-2)' : 'var(--task-ink-3)',
        cursor: disabled ? 'default' : 'pointer',
        ...style,
      }}
    >
      {icon}
      <span className="max-w-[220px] truncate">{children}</span>
      {locked && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity={0.6}>
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 018 0v3" />
        </svg>
      )}
    </button>
  );
});

const ICONS = {
  pin: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="10" r="2.5" />
      <path d="M12 21c4-5 7-8 7-11a7 7 0 1 0-14 0c0 3 3 6 7 11z" />
    </svg>
  ),
  box: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11h14V8M10 12h4" />
    </svg>
  ),
  cal: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  ),
  spark: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z" />
    </svg>
  ),
  flag: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 21V4m0 1h12l-2.5 4L17 13H5" />
    </svg>
  ),
  doc: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5M10 13h6M10 17h6" />
    </svg>
  ),
};

function formatScheduleChip(date: string, time: string): string | null {
  if (!date) return null;
  const d = new Date(`${date}T12:00:00`);
  const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (!time) return label;
  const [h, m] = time.split(':').map(Number);
  const t = new Date();
  t.setHours(h, m ?? 0);
  return `${label}, ${t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

export function ContextChips({
  isDraft,
  readOnly,
  propertyName,
  templateName,
  binId,
  binName,
  bins,
  scheduledDate,
  scheduledTime,
  departmentId,
  departments,
  priority,
  propertyId,
  allProperties,
  availableTemplates,
  onBinChange,
  onScheduleChange,
  onDepartmentChange,
  onPriorityChange,
  onDraftPropertyChange,
  onDraftTemplateChange,
  status,
  isTemplated,
  isContingent,
  onSelectStatus,
}: {
  isDraft: boolean;
  readOnly?: boolean;
  propertyName: string | null;
  templateName: string | null;
  binId: string | null;
  binName: string | null;
  bins: ProjectBin[];
  scheduledDate: string;
  scheduledTime: string;
  departmentId: string;
  departments: Department[];
  priority: string;
  propertyId: string | null;
  allProperties: PropertyOption[];
  availableTemplates: TaskTemplate[];
  onBinChange: (binId: string | null) => void;
  onScheduleChange: (date: string, time: string) => void;
  onDepartmentChange: (id: string) => void;
  onPriorityChange: (p: string) => void;
  onDraftPropertyChange?: (id: string | null, name: string | null) => void;
  onDraftTemplateChange?: (id: string | null, name: string | null) => void;
  /** Status pill (omitted in draft mode). */
  status?: string;
  isTemplated?: boolean;
  isContingent?: boolean;
  onSelectStatus?: (status: string) => void;
}) {
  const [binOpen, setBinOpen] = useState(false);
  const [schedOpen, setSchedOpen] = useState(false);
  const [deptOpen, setDeptOpen] = useState(false);
  const [prioOpen, setPrioOpen] = useState(false);
  const [propOpen, setPropOpen] = useState(false);
  const [tmplOpen, setTmplOpen] = useState(false);

  const dept = departments.find((d) => d.id === departmentId);
  const schedLabel = formatScheduleChip(scheduledDate, scheduledTime);
  const currentBinName = binName ?? bins.find((b) => b.id === binId)?.name ?? null;

  const disabled = readOnly;

  return (
    // Always a single horizontal scroll strip — never wraps to a second row.
    <div className="-mx-[18px] flex gap-1.5 overflow-x-auto px-[18px] pb-1 [scrollbar-width:none]">
      {/* Status — first pill; matches kanban icons/colors. Omitted for drafts. */}
      {!isDraft && status !== undefined && onSelectStatus && (
        <StatusChip
          status={status}
          isTemplated={!!isTemplated}
          isContingent={!!isContingent}
          onSelectStatus={onSelectStatus}
        />
      )}

      {/* Property — locked on existing tasks, picker in draft mode */}
      {isDraft && onDraftPropertyChange ? (
        <AdaptivePicker
          open={propOpen}
          onOpenChange={setPropOpen}
          title="Property"
          trigger={
            <Chip icon={ICONS.pin} set={!!propertyName}>
              {propertyName ?? 'Property'}
            </Chip>
          }
        >
          <TaskOptionRow selected={!propertyName} onSelect={() => { onDraftPropertyChange(null, null); setPropOpen(false); }}>
            No property
          </TaskOptionRow>
          {allProperties.map((p) => (
            <TaskOptionRow
              key={p.id ?? p.name}
              selected={p.name === propertyName}
              onSelect={() => { onDraftPropertyChange(p.id, p.name); setPropOpen(false); }}
            >
              {p.name}
            </TaskOptionRow>
          ))}
        </AdaptivePicker>
      ) : (
        propertyName && (
          <Chip icon={ICONS.pin} set locked disabled>
            {propertyName}
          </Chip>
        )
      )}

      {/* Template — locked on existing tasks, picker in draft mode */}
      {isDraft && onDraftTemplateChange ? (
        <AdaptivePicker
          open={tmplOpen}
          onOpenChange={setTmplOpen}
          title="Template"
          trigger={
            <Chip icon={ICONS.doc} set={!!templateName}>
              {templateName ?? 'Template'}
            </Chip>
          }
        >
          <TaskOptionRow selected={!templateName} onSelect={() => { onDraftTemplateChange(null, null); setTmplOpen(false); }}>
            No template
          </TaskOptionRow>
          {availableTemplates.map((t) => (
            <TaskOptionRow
              key={t.id}
              selected={t.id && templateName === t.name ? true : false}
              onSelect={() => { onDraftTemplateChange(t.id, t.name); setTmplOpen(false); }}
            >
              {t.name}
            </TaskOptionRow>
          ))}
        </AdaptivePicker>
      ) : (
        templateName && (
          <Chip icon={ICONS.doc} set locked disabled>
            {templateName}
          </Chip>
        )
      )}

      {/* Bin */}
      <AdaptivePicker
        open={binOpen}
        onOpenChange={setBinOpen}
        title="Bin"
        disabled={disabled}
        trigger={
          <Chip icon={ICONS.box} set={!!currentBinName} disabled={disabled}>
            {currentBinName ?? 'Bin'}
          </Chip>
        }
      >
        <TaskOptionRow selected={!binId} onSelect={() => { onBinChange(null); setBinOpen(false); }}>
          Task Bin
        </TaskOptionRow>
        {bins.map((b) => (
          <TaskOptionRow key={b.id} selected={b.id === binId} onSelect={() => { onBinChange(b.id); setBinOpen(false); }}>
            {b.name}
          </TaskOptionRow>
        ))}
      </AdaptivePicker>

      {/* Schedule */}
      <AdaptivePicker
        open={schedOpen}
        onOpenChange={setSchedOpen}
        title="Scheduled"
        contentClassName="w-auto"
        disabled={disabled}
        trigger={
          <Chip icon={ICONS.cal} set={!!schedLabel} disabled={disabled}>
            {schedLabel ?? 'Schedule'}
          </Chip>
        }
      >
        <div className="flex flex-col gap-2 p-1">
          <TaskScheduledDatePicker
            propertyId={propertyId}
            value={scheduledDate}
            onChange={(next) => onScheduleChange(next, scheduledTime)}
          />
          <TaskScheduledTimePicker
            value={scheduledTime}
            onChange={(next) => onScheduleChange(scheduledDate, next)}
          />
        </div>
      </AdaptivePicker>

      {/* Department */}
      <AdaptivePicker
        open={deptOpen}
        onOpenChange={setDeptOpen}
        title="Department"
        disabled={disabled}
        trigger={
          <Chip icon={ICONS.spark} set={!!dept} disabled={disabled}>
            {dept?.name ?? 'Department'}
          </Chip>
        }
      >
        <TaskOptionRow selected={!departmentId} onSelect={() => { onDepartmentChange(''); setDeptOpen(false); }}>
          No department
        </TaskOptionRow>
        {departments.map((d) => (
          <TaskOptionRow key={d.id} selected={d.id === departmentId} onSelect={() => { onDepartmentChange(d.id); setDeptOpen(false); }}>
            {d.name}
          </TaskOptionRow>
        ))}
      </AdaptivePicker>

      {/* Priority */}
      <AdaptivePicker
        open={prioOpen}
        onOpenChange={setPrioOpen}
        title="Priority"
        disabled={disabled}
        trigger={
          <Chip icon={ICONS.flag} set={priority !== 'medium'} disabled={disabled}>
            {PRIORITY_LABELS[priority as keyof typeof PRIORITY_LABELS] ?? priority}
          </Chip>
        }
      >
        {PRIORITY_ORDER.map((p) => (
          <TaskOptionRow key={p} selected={p === priority} onSelect={() => { onPriorityChange(p); setPrioOpen(false); }}>
            {PRIORITY_LABELS[p]}
          </TaskOptionRow>
        ))}
      </AdaptivePicker>
    </div>
  );
}

/* ---------- steps (templated tasks) ---------- */

export function StepsSection({
  completed,
  total,
  templateName,
  loading,
  onOpen,
}: {
  completed: number;
  total: number;
  templateName: string | null;
  loading: boolean;
  onOpen: () => void;
}) {
  const fraction = total > 0 ? completed / total : 0;
  const allDone = total > 0 && completed === total;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-4 w-full rounded-[10px] px-3 py-3 text-left transition-transform active:scale-[0.99]"
      style={{ background: 'var(--task-surface-1)' }}
    >
      <div className="flex items-center gap-2.5">
        <MonoLabel>Checklist</MonoLabel>
        <div className="h-[2px] flex-1 overflow-hidden rounded-[2px]" style={{ background: 'var(--task-surface-2)' }}>
          <div
            className="h-full transition-[width] duration-300"
            style={{
              width: `${fraction * 100}%`,
              background: allDone ? 'var(--task-green)' : 'var(--task-accent)',
            }}
          />
        </div>
        <MonoLabel style={{ color: 'var(--task-ink-2)' }}>
          {loading ? '…' : `${completed}/${total}`}
        </MonoLabel>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--task-ink-3)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 5l7 7-7 7" />
        </svg>
      </div>
      {templateName && (
        <div className="mt-1.5 truncate text-[13px]" style={{ color: 'var(--task-ink-2)' }}>
          {templateName}
        </div>
      )}
    </button>
  );
}

/* ---------- crew ---------- */

function initials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

const AVATAR_TONES = ['#c9b6f0', '#8fb8e8', '#9fd8c0', '#e8c39f', '#e89fb8'];

export function CrewSection({
  users,
  assignedIds,
  readOnly,
  onToggleUser,
}: {
  users: User[];
  assignedIds: string[];
  readOnly?: boolean;
  onToggleUser: (userId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const assigned = users.filter((u) => assignedIds.includes(u.id));
  return (
    <div>
      <MonoLabel className="mb-2.5">Assignees</MonoLabel>
      <div className="flex items-center">
        {assigned.map((u, i) => (
          <div
            key={u.id}
            className="flex h-7 w-7 items-center justify-center rounded-full font-mono text-[10px] font-medium"
            style={{
              marginLeft: i ? -8 : 0,
              background: AVATAR_TONES[i % AVATAR_TONES.length],
              color: '#0c0c0e',
              boxShadow: '0 0 0 2px var(--task-surface-0)',
            }}
          >
            {initials(u.name)}
          </div>
        ))}
        {!readOnly && (
          <AdaptivePicker
            open={open}
            onOpenChange={setOpen}
            title="Assignees"
            trigger={
              <button
                type="button"
                aria-label="Edit assignees"
                className="flex h-7 w-7 items-center justify-center rounded-full transition-transform active:scale-95"
                style={{
                  marginLeft: assigned.length ? -8 : 0,
                  background: 'var(--task-surface-0)',
                  border: '1.5px dashed var(--task-line)',
                  color: 'var(--task-ink-3)',
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            }
          >
            {users.map((u) => (
              <TaskOptionRow
                key={u.id}
                selected={assignedIds.includes(u.id)}
                onSelect={() => onToggleUser(u.id)}
                leading={
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[9px] font-medium"
                    style={{ background: AVATAR_TONES[users.indexOf(u) % AVATAR_TONES.length], color: '#0c0c0e' }}
                  >
                    {initials(u.name)}
                  </span>
                }
              >
                {u.name}
              </TaskOptionRow>
            ))}
          </AdaptivePicker>
        )}
        {assigned.length > 0 && (
          <span className="ml-3 font-mono text-[11px]" style={{ color: 'var(--task-ink-3)' }}>
            {assigned.map((u) => u.name.split(' ')[0]).join(' · ')}
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------- photos / attachments ---------- */

export function PhotosSection({
  attachments,
  uploading,
  inputRef,
  onUpload,
  onView,
  readOnly,
}: {
  attachments: Attachment[];
  uploading: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onView: (index: number) => void;
  readOnly?: boolean;
}) {
  return (
    <div>
      <MonoLabel className="mb-2.5">Photos</MonoLabel>
      {attachments.length > 0 && (
        <div className="mb-2 grid grid-cols-4 gap-2">
          {attachments.map((a, i) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onView(i)}
              className="aspect-square overflow-hidden rounded-lg border transition-transform active:scale-95"
              style={{ borderColor: 'var(--task-line)' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.file_url} alt={a.file_name ?? 'Attachment'} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
      {!readOnly && (
        <>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[10px] font-mono text-[11.5px] tracking-[0.04em] transition-transform active:scale-[0.99] disabled:opacity-50"
            style={{ border: '1.5px dashed var(--task-line)', color: 'var(--task-ink-3)' }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" />
              <circle cx="12" cy="13" r="3.2" />
            </svg>
            {uploading ? 'Uploading…' : 'Add photo'}
          </button>
          <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={onUpload} />
        </>
      )}
    </div>
  );
}
