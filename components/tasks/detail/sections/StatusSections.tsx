'use client';

import * as React from 'react';
import { useState } from 'react';
import { toast } from '@/components/ui/toast';
import { PIP_STAGES, SELECTABLE_STATUSES, railColor, statusVisual } from '../statusConfig';
import { AdaptivePicker } from '../primitives/AdaptivePicker';
import { TaskOptionRow } from '../primitives/TaskSheet';
import { MonoLabel } from './HeaderSections';

// The timer rail: pulsing state bar + play/pause + elapsed. For templated
// tasks the timer is action-driven (display-only here); non-templated tasks
// toggle it freely with no status side effects.
export function TimerRail({
  status,
  running,
  displaySeconds,
  formatTime,
  onToggle,
  toggleDisabled,
}: {
  status: string;
  running: boolean;
  displaySeconds: number;
  formatTime: (s: number) => string;
  onToggle?: () => void;
  toggleDisabled?: boolean;
}) {
  const rail = railColor(status, running);
  return (
    <div
      className="mt-3 flex items-center gap-2.5 rounded-[10px] px-2.5 py-[9px]"
      style={{ background: 'var(--task-surface-1)' }}
    >
      <div
        className="h-[30px] w-[3px] shrink-0 rounded-[2px]"
        style={{
          background: rail,
          animation: running ? 'task-pulse 2.4s ease-in-out infinite' : 'none',
        }}
      />
      <button
        type="button"
        onClick={onToggle}
        disabled={toggleDisabled || !onToggle}
        aria-label={running ? 'Pause timer' : 'Start timer'}
        className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border transition-all active:scale-95 disabled:opacity-45"
        style={{
          background: running ? 'var(--task-accent-soft)' : 'var(--task-surface-2)',
          borderColor: running ? 'var(--task-accent)' : 'var(--task-line)',
          color: running ? 'var(--task-accent)' : 'var(--task-ink-2)',
        }}
      >
        {running ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <rect x="7" y="5.5" width="3.5" height="13" rx="1" />
            <rect x="13.5" y="5.5" width="3.5" height="13" rx="1" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5.5v13l11-6.5z" />
          </svg>
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div
          className="font-mono text-[15px] leading-[1.2] tracking-[0.03em]"
          style={{ color: running ? 'var(--task-ink-1)' : 'var(--task-ink-3)' }}
        >
          {formatTime(displaySeconds)}
        </div>
        <MonoLabel className="mt-0.5 !text-[9px]">{running ? 'Tracking' : 'Paused'}</MonoLabel>
      </div>
    </div>
  );
}

// Status pips + label. Non-templated: opens the status picker. Templated:
// display-only (tap explains the action buttons). Contingent: locked notice.
export function StatusPips({
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
  const visual = statusVisual(status);

  if (isContingent) {
    return (
      <div
        className="mt-2 flex h-[38px] w-full items-center gap-2.5 rounded-[10px] px-3"
        style={{ background: 'var(--task-surface-1)' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--task-accent-dim)" strokeWidth="1.6" strokeLinecap="round">
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 018 0v3" />
        </svg>
        <span
          className="font-mono text-[11px] uppercase tracking-[0.1em]"
          style={{ color: 'var(--task-accent-dim)' }}
        >
          Contingent — awaiting approval
        </span>
      </div>
    );
  }

  const pips = (
    <div className="flex gap-[3px]">
      {PIP_STAGES.map((stage, i) => {
        const active = i === visual.pipIndex;
        const done = i < visual.pipIndex;
        return (
          <div
            key={stage}
            className="h-[5px] rounded-[3px] transition-all duration-300"
            style={{
              width: active ? 16 : 5,
              background: active
                ? visual.color
                : done
                  ? 'var(--task-accent-dim)'
                  : 'var(--task-surface-2)',
            }}
          />
        );
      })}
    </div>
  );

  const label = (
    <span
      className="flex-1 text-left font-mono text-[11px] uppercase tracking-[0.1em]"
      style={{ color: visual.color }}
    >
      {visual.label}
    </span>
  );

  if (isTemplated) {
    return (
      <button
        type="button"
        onClick={() =>
          toast.info('Status follows the checklist — use Start, Pause, Complete, or Reopen.')
        }
        className="mt-2 flex h-[38px] w-full items-center gap-2.5 rounded-[10px] px-3"
        style={{ background: 'var(--task-surface-1)' }}
      >
        {pips}
        {label}
      </button>
    );
  }

  return (
    <AdaptivePicker
      open={open}
      onOpenChange={setOpen}
      title="Status"
      trigger={
        <button
          type="button"
          className="mt-2 flex h-[38px] w-full items-center gap-2.5 rounded-[10px] px-3 transition-transform active:scale-[0.99]"
          style={{ background: 'var(--task-surface-1)' }}
        >
          {pips}
          {label}
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--task-ink-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 10l5 5 5-5" />
          </svg>
        </button>
      }
    >
      {SELECTABLE_STATUSES.map((s) => {
        const v = statusVisual(s);
        return (
          <TaskOptionRow
            key={s}
            selected={s === status}
            onSelect={() => {
              onSelectStatus(s);
              setOpen(false);
            }}
            leading={
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: s === status ? v.color : 'var(--task-surface-2)' }}
              />
            }
          >
            {v.label}
          </TaskOptionRow>
        );
      })}
    </AdaptivePicker>
  );
}

// Thumb-zone action bar: comments button + the primary CTA.
export function ActionBar({
  isMobile,
  isDraft,
  isContingent,
  isTemplated,
  status,
  checklistComplete,
  unreadDot,
  creating,
  onOpenComments,
  onStart,
  onPause,
  onComplete,
  onReopen,
  onWriteStatus,
  onCreate,
}: {
  isMobile: boolean;
  isDraft: boolean;
  isContingent: boolean;
  isTemplated: boolean;
  status: string;
  checklistComplete: boolean;
  unreadDot: boolean;
  creating?: boolean;
  onOpenComments: () => void;
  onStart: () => void;
  onPause: () => void;
  onComplete: () => void;
  onReopen: () => void;
  onWriteStatus: (s: string) => void;
  onCreate?: () => void;
}) {
  const ctaBase =
    'flex-1 h-[46px] rounded-xl font-mono text-[12px] uppercase tracking-[0.1em] transition-all active:scale-[0.98] disabled:opacity-50';

  let cta: React.ReactNode = null;
  if (isDraft) {
    cta = (
      <button
        type="button"
        onClick={onCreate}
        disabled={creating}
        className={ctaBase}
        style={{ background: 'var(--task-accent)', color: '#0c0c0e' }}
      >
        {creating ? 'Creating…' : 'Create task'}
      </button>
    );
  } else if (isContingent) {
    cta = (
      <div
        className="flex h-[46px] flex-1 items-center justify-center rounded-xl font-mono text-[11px] uppercase tracking-[0.1em]"
        style={{ background: 'var(--task-surface-2)', color: 'var(--task-ink-3)' }}
      >
        Awaiting approval
      </div>
    );
  } else {
    const start = isTemplated ? onStart : () => onWriteStatus('in_progress');
    const pause = isTemplated ? onPause : () => onWriteStatus('paused');
    const complete = isTemplated ? onComplete : () => onWriteStatus('complete');
    const reopen = isTemplated ? onReopen : () => onWriteStatus('paused');
    if (status === 'not_started') {
      cta = (
        <button type="button" onClick={start} className={ctaBase} style={{ background: 'var(--task-accent)', color: '#0c0c0e' }}>
          Start
        </button>
      );
    } else if (status === 'in_progress') {
      cta = (
        <>
          <button
            type="button"
            onClick={pause}
            className="h-[46px] rounded-xl border px-5 font-mono text-[12px] uppercase tracking-[0.1em] transition-all active:scale-[0.98]"
            style={{ background: 'var(--task-surface-2)', borderColor: 'var(--task-line)', color: 'var(--task-ink-2)' }}
          >
            Pause
          </button>
          <button
            type="button"
            onClick={complete}
            className={ctaBase}
            style={{
              background: checklistComplete || !isTemplated ? 'var(--task-green)' : 'var(--task-surface-2)',
              color: checklistComplete || !isTemplated ? '#0c0c0e' : 'var(--task-ink-2)',
            }}
          >
            Complete
          </button>
        </>
      );
    } else if (status === 'paused') {
      cta = (
        <>
          <button type="button" onClick={start} className={ctaBase} style={{ background: 'var(--task-accent)', color: '#0c0c0e' }}>
            Resume
          </button>
          <button
            type="button"
            onClick={complete}
            className="h-[46px] rounded-xl border px-5 font-mono text-[12px] uppercase tracking-[0.1em] transition-all active:scale-[0.98]"
            style={{ background: 'var(--task-surface-2)', borderColor: 'var(--task-line)', color: 'var(--task-ink-2)' }}
          >
            Complete
          </button>
        </>
      );
    } else {
      // complete
      cta = (
        <button
          type="button"
          onClick={reopen}
          className={ctaBase}
          style={{ background: 'var(--task-surface-2)', color: 'var(--task-ink-2)' }}
        >
          Reopen
        </button>
      );
    }
  }

  return (
    <div
      className="flex shrink-0 items-center gap-2 border-t px-[18px] pt-2.5"
      style={{
        borderColor: 'var(--task-line-soft)',
        background: 'var(--task-surface-1)',
        paddingBottom: isMobile ? 'calc(0.75rem + env(safe-area-inset-bottom))' : '0.625rem',
      }}
    >
      {!isDraft && (
        <button
          type="button"
          aria-label="Comments"
          onClick={onOpenComments}
          className="relative flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl border transition-transform active:scale-95"
          style={{ background: 'var(--task-surface-2)', borderColor: 'var(--task-line)', color: 'var(--task-ink-2)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
          </svg>
          {unreadDot && (
            <span
              className="absolute right-2.5 top-2.5 h-1.5 w-1.5 rounded-full"
              style={{ background: 'var(--task-accent)', boxShadow: '0 0 0 2px var(--task-surface-2)' }}
            />
          )}
        </button>
      )}
      {cta}
    </div>
  );
}
