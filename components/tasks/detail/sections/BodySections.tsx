'use client';

import * as React from 'react';
import { useState } from 'react';
import type { Department, ProjectBin, User } from '@/lib/types';
import type { Attachment } from '@/lib/types';
import { PRIORITY_LABELS, PRIORITY_ORDER } from '@/lib/types';
import { PRIORITY_ICONS } from '@/lib/taskPriorityIcons';
import { DeptGlyph } from '../../DeptGlyph';
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
    /** Variable-length pills (bin, department) shrink + truncate to hold the
     * one-row rule; fixed pills (status, date, priority) stay full width. */
    flexible?: boolean;
    /** Show the label even when unset (labeled meta rows, where the row's own
     * label supplies context, unlike the icon-only pill row). */
    forceLabel?: boolean;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function Chip({ icon, children, set, locked, flexible, forceLabel, disabled, style, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      {...rest}
      className={`flex h-[30px] ${flexible && set ? 'min-w-[3.5rem]' : 'shrink-0'} items-center gap-1.5 rounded-lg px-[11px] font-mono text-[11px] transition-transform active:scale-95 disabled:active:scale-100`}
      style={{
        background: set ? 'var(--task-surface-2)' : 'transparent',
        border: `1px ${set ? 'solid transparent' : 'dashed var(--task-line)'}`,
        color: set ? 'var(--task-ink-2)' : 'var(--task-ink-3)',
        cursor: disabled ? 'default' : 'pointer',
        ...style,
      }}
    >
      <span className="shrink-0">{icon}</span>
      {/* Unset pills collapse to the icon alone (dashed placeholder); only a
          chosen value — or a labeled meta row — shows a label. */}
      {(set || forceLabel) && (
        <span className={flexible ? 'truncate' : 'max-w-[130px] truncate'}>{children}</span>
      )}
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
  flag: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 21V4m0 1h12l-2.5 4L17 13H5" />
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
  scheduledDate,
  scheduledTime,
  priority,
  propertyId,
  onScheduleChange,
  onPriorityChange,
  status,
  isTemplated,
  isContingent,
  onSelectStatus,
}: {
  isDraft: boolean;
  readOnly?: boolean;
  scheduledDate: string;
  scheduledTime: string;
  priority: string;
  propertyId: string | null;
  onScheduleChange: (date: string, time: string) => void;
  onPriorityChange: (p: string) => void;
  /** Status pill (omitted in draft mode). */
  status?: string;
  isTemplated?: boolean;
  isContingent?: boolean;
  onSelectStatus?: (status: string) => void;
}) {
  const [schedOpen, setSchedOpen] = useState(false);
  const [prioOpen, setPrioOpen] = useState(false);

  const schedLabel = formatScheduleChip(scheduledDate, scheduledTime);
  const PriorityIcon = PRIORITY_ICONS[priority] ?? PRIORITY_ICONS.medium;

  const disabled = readOnly;

  return (
    // Status · schedule · priority only — these three always fit one row. Bin
    // and department moved to the labeled meta rows below (TaskMetaFields).
    <div className="flex flex-nowrap gap-1.5 overflow-x-auto [scrollbar-width:none]">
      {/* Status — first pill; matches kanban icons/colors. Omitted for drafts. */}
      {!isDraft && status !== undefined && onSelectStatus && (
        <StatusChip
          status={status}
          isTemplated={!!isTemplated}
          isContingent={!!isContingent}
          onSelectStatus={onSelectStatus}
        />
      )}

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

      {/* Priority — always has a value (medium by default, no "none"), so the
          pill is always a solid/set chip, never the dashed unset style. */}
      <AdaptivePicker
        open={prioOpen}
        onOpenChange={setPrioOpen}
        title="Priority"
        disabled={disabled}
        trigger={
          <Chip icon={<PriorityIcon size={13} strokeWidth={2} aria-hidden />} set disabled={disabled}>
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

/* ---------- meta fields (bin + department as labeled rows) ---------- */

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <MonoLabel className="shrink-0">{label}</MonoLabel>
      {/* Fixed-width value column on the right, left-aligned inside — both pills
          share one left edge (first letters flush) and grow rightward. */}
      <div className="flex w-[180px] shrink-0 justify-start">{children}</div>
    </div>
  );
}

// Bin + department: single-value fields shown as full-width labeled rows (in
// the lower meta block, near Assignees/Attachments) so long names have room
// instead of crowding the top pill row.
export function TaskMetaFields({
  readOnly,
  binId,
  binName,
  isBinned,
  bins,
  departmentId,
  departments,
  onBinChange,
  onDepartmentChange,
}: {
  readOnly?: boolean;
  binId: string | null;
  binName: string | null;
  /** Distinguishes "No bin" (false) from "Task Bin" (true, null binId). */
  isBinned: boolean;
  bins: ProjectBin[];
  departmentId: string;
  departments: Department[];
  onBinChange: (binId: string | null, isBinned: boolean) => void;
  onDepartmentChange: (id: string) => void;
}) {
  const [binOpen, setBinOpen] = useState(false);
  const [deptOpen, setDeptOpen] = useState(false);

  const dept = departments.find((d) => d.id === departmentId);
  // Binned + no sub-bin ⇒ the system "Task Bin"; unbinned ⇒ "No bin".
  const currentBinName = isBinned
    ? (binName ?? bins.find((b) => b.id === binId)?.name ?? 'Task Bin')
    : null;
  const disabled = readOnly;

  return (
    <div className="flex flex-col gap-3">
      <MetaRow label="Bin">
        <AdaptivePicker
          open={binOpen}
          onOpenChange={setBinOpen}
          title="Bin"
          align="end"
          disabled={disabled}
          trigger={
            <Chip icon={ICONS.box} set={isBinned} flexible forceLabel disabled={disabled} title={currentBinName ?? undefined}>
              {currentBinName ?? 'No bin'}
            </Chip>
          }
        >
          <TaskOptionRow selected={!isBinned} onSelect={() => { onBinChange(null, false); setBinOpen(false); }}>
            No bin
          </TaskOptionRow>
          <TaskOptionRow selected={isBinned && !binId} onSelect={() => { onBinChange(null, true); setBinOpen(false); }}>
            Task Bin
          </TaskOptionRow>
          {bins.filter((b) => !b.is_system).map((b) => (
            <TaskOptionRow key={b.id} selected={isBinned && b.id === binId} onSelect={() => { onBinChange(b.id, true); setBinOpen(false); }}>
              {b.name}
            </TaskOptionRow>
          ))}
        </AdaptivePicker>
      </MetaRow>

      <MetaRow label="Department">
        <AdaptivePicker
          open={deptOpen}
          onOpenChange={setDeptOpen}
          title="Department"
          align="end"
          disabled={disabled}
          trigger={
            <Chip
              icon={dept ? <DeptGlyph iconKey={dept.icon} size={13} /> : ICONS.flag}
              set={!!dept}
              flexible
              forceLabel
              disabled={disabled}
              title={dept?.name}
            >
              {dept?.name ?? 'No department'}
            </Chip>
          }
        >
          <TaskOptionRow
            selected={!departmentId}
            onSelect={() => { onDepartmentChange(''); setDeptOpen(false); }}
            leading={<span className="flex h-4 w-4 items-center justify-center" style={{ color: 'var(--task-ink-3)' }}>{ICONS.flag}</span>}
          >
            No department
          </TaskOptionRow>
          {departments.map((d) => (
            <TaskOptionRow
              key={d.id}
              selected={d.id === departmentId}
              onSelect={() => { onDepartmentChange(d.id); setDeptOpen(false); }}
              leading={<DeptGlyph iconKey={d.icon} size={16} />}
            >
              {d.name}
            </TaskOptionRow>
          ))}
        </AdaptivePicker>
      </MetaRow>
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

/* ---------- attachments (images, PDFs, docs, video) ---------- */

function isImageAttachment(a: Attachment): boolean {
  if (a.mime_type) return a.mime_type.startsWith('image/');
  if (a.file_type) return a.file_type === 'image';
  return /\.(png|jpe?g|gif|webp|heic|avif|bmp|svg)$/i.test(a.file_name ?? '');
}

export function AttachmentsSection({
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
      <MonoLabel className="mb-2.5">Attachments</MonoLabel>
      {attachments.length > 0 && (
        <div className="mb-2 grid grid-cols-4 gap-2">
          {attachments.map((a, i) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onView(i)}
              title={a.file_name ?? undefined}
              className="aspect-square overflow-hidden rounded-lg border transition-transform active:scale-95"
              style={{ borderColor: 'var(--task-line)' }}
            >
              {isImageAttachment(a) ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={a.file_url} alt={a.file_name ?? 'Attachment'} className="h-full w-full object-cover" />
              ) : (
                // Non-image (PDF/doc/etc.) — a file tile with its extension;
                // the lightbox renders the actual file on open.
                <span
                  className="flex h-full w-full flex-col items-center justify-center gap-1 px-1"
                  style={{ background: 'var(--task-surface-2)', color: 'var(--task-ink-3)' }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 3h7l5 5v13H7z" />
                    <path d="M14 3v5h5" />
                  </svg>
                  <span className="max-w-full truncate font-mono text-[9px] tracking-[0.06em]">
                    {a.file_name?.split('.').pop()?.toUpperCase() || 'FILE'}
                  </span>
                </span>
              )}
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
            {/* paperclip — general attachment, not just photos */}
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a5 5 0 01-7.07-7.07l9.19-9.19a3 3 0 014.24 4.24l-9.2 9.19a1 1 0 01-1.41-1.41l8.49-8.49" />
            </svg>
            {uploading ? 'Uploading…' : 'Add attachment'}
          </button>
          {/* No accept filter — images, PDFs, docs, etc. are all valid. */}
          <input ref={inputRef} type="file" multiple className="hidden" onChange={onUpload} />
        </>
      )}
    </div>
  );
}
