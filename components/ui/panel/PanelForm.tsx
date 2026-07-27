'use client';

import * as React from 'react';

// Panel form primitives — the visual vocabulary introduced by the create-task
// panel, extracted so other config surfaces (Configure Automation) can be
// built from the same parts instead of re-inventing them.
//
// Everything here reads the `--task-*` token scope, so a host must carry
// either `.task-detail` or `.panel-form` on an ancestor.

/* ---------- section label ---------- */

// Groups rows into labelled bands (TASK / ASSIGNMENT / SCHEDULING …). The
// grouping layer is what keeps a long form scannable without boxing every
// section.
export function SectionLabel({
  children,
  className = '',
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`px-[18px] pb-1.5 pt-4 font-mono text-[length:var(--task-fs-label)] uppercase tracking-[0.14em] ${className}`}
      style={{ color: 'var(--task-ink-3)', ...style }}
    >
      {children}
    </div>
  );
}

/* ---------- field row ---------- */

const CHEVRON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

const ALERT_ICON = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.5" />
  </svg>
);

export const ERROR_TONE = '#d97757';

/** One list row: leading icon, value (or muted placeholder), trailing chevron.
 *  forwardRef + prop spread so a picker can own the click via its own trigger. */
export const FieldRow = React.forwardRef<
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
        <span className="shrink-0" style={{ color: error ? ERROR_TONE : 'var(--task-ink-3)' }}>
          {error ? ALERT_ICON : icon}
        </span>
        <span
          className="min-w-0 flex-1 truncate text-[length:var(--task-fs-option)]"
          style={{ color: value ? 'var(--task-ink-1)' : 'var(--task-ink-3)' }}
        >
          {value || placeholder}
        </span>
        {children}
        {chevron && <span className="shrink-0" style={{ color: 'var(--task-ink-3)' }}>{CHEVRON}</span>}
      </button>
      {error && (
        <div className="-mt-1 px-[18px] pb-2.5 text-[length:var(--task-fs-body-sm)]" style={{ color: ERROR_TONE }}>
          {error}
        </div>
      )}
    </div>
  );
});

/* ---------- toggle ---------- */

// On-brand switch: accent when live, panel surfaces when not (the app's other
// hand-rolled toggles used the raw neutral ramp and never picked up a theme).
export function ToggleSwitch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className="relative inline-flex h-[26px] w-[44px] shrink-0 items-center rounded-full border transition-colors disabled:opacity-45"
      style={{
        background: checked ? 'var(--task-accent)' : 'var(--task-surface-2)',
        borderColor: checked ? 'var(--task-accent)' : 'var(--task-line)',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      <span
        className="inline-block h-[18px] w-[18px] rounded-full transition-transform"
        style={{
          background: checked ? '#fff' : 'var(--task-ink-3)',
          transform: checked ? 'translateX(22px)' : 'translateX(4px)',
        }}
      />
    </button>
  );
}

/** A labelled row whose control is a switch. `hint` renders inline after the
 *  label (an InfoTooltip, typically). */
export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
  bare,
}: {
  label: string;
  hint?: React.ReactNode;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  /** Drop the hairline — for a row that ends a group. */
  bare?: boolean;
}) {
  return (
    <div
      className={bare ? '' : 'border-b'}
      style={bare ? undefined : { borderColor: 'var(--task-line-soft)' }}
    >
      <div className="flex items-center justify-between gap-3 px-[18px] py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="truncate text-[length:var(--task-fs-option)]"
            style={{ color: 'var(--task-ink-1)' }}
          >
            {label}
          </span>
          {hint}
        </div>
        <ToggleSwitch checked={checked} onChange={onChange} label={label} disabled={disabled} />
      </div>
    </div>
  );
}

/* ---------- inline sentence composition ---------- */

// Rules read better as sentences than as stacked labelled fields — "if
// occupancy period is [>=] [3] days" says what it does. SentenceRow is the
// wrapper; the tokens below are the editable words inside it.

export function SentenceRow({
  children,
  bordered = true,
  className = '',
}: {
  children: React.ReactNode;
  /** Hairline below, matching the surrounding rows. */
  bordered?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-2 px-[18px] py-3 ${bordered ? 'border-b' : ''} ${className}`}
      style={bordered ? { borderColor: 'var(--task-line-soft)' } : undefined}
    >
      {children}
    </div>
  );
}

/** Static words between the editable tokens. */
export function SentenceText({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[length:var(--task-fs-body-sm)]" style={{ color: 'var(--task-ink-2)' }}>
      {children}
    </span>
  );
}

const TOKEN_CLASS =
  'flex h-[var(--task-ctl-h)] shrink-0 items-center gap-1.5 rounded-lg px-[10px] font-mono text-[length:var(--task-fs-chip)] transition-transform active:scale-95 disabled:active:scale-100';

const tokenStyle = (interactive: boolean): React.CSSProperties => ({
  background: 'var(--task-surface-2)',
  border: '1px solid transparent',
  color: 'var(--task-ink-1)',
  cursor: interactive ? 'pointer' : 'default',
});

const TOKEN_CARET = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

/** A choice inside a sentence. Renders as a chip; pair it with an
 *  AdaptivePicker as the trigger (forwardRef + spread for the popover anchor). */
export const TokenSelect = React.forwardRef<
  HTMLButtonElement,
  { children: React.ReactNode; disabled?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function TokenSelect({ children, disabled, style, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      {...rest}
      className={TOKEN_CLASS}
      style={{ ...tokenStyle(!disabled), ...style }}
    >
      <span className="truncate">{children}</span>
      {TOKEN_CARET}
    </button>
  );
});

/** A number inside a sentence (day counts, offsets, intervals). */
export function TokenNumber({
  value,
  onChange,
  min,
  width = '3.5rem',
  ariaLabel,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  width?: string;
  ariaLabel: string;
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(parseInt(e.target.value, 10))}
      className={`${TOKEN_CLASS} text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
      style={{ ...tokenStyle(true), width }}
    />
  );
}

/** A time or date inside a sentence — native pickers, chip clothing. */
export function TokenDateTime({
  type,
  value,
  onChange,
  ariaLabel,
  width,
}: {
  type: 'time' | 'date';
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
  width?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      className={`${TOKEN_CLASS} outline-none`}
      style={{ ...tokenStyle(true), width: width ?? (type === 'date' ? '9.5rem' : '7.5rem') }}
    />
  );
}

/* ---------- chips ---------- */

/** A small read-only marker (field type, "Edited"). */
export function MetaChip({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'accent';
  className?: string;
}) {
  return (
    <span
      className={`flex h-[22px] shrink-0 items-center rounded-md px-[7px] font-mono text-[length:var(--task-fs-label)] uppercase tracking-[0.1em] ${className}`}
      style={
        tone === 'accent'
          ? { background: 'var(--task-accent-soft)', color: 'var(--task-accent)' }
          : { background: 'var(--task-surface-2)', color: 'var(--task-ink-3)' }
      }
    >
      {children}
    </span>
  );
}

/** A two-state chip: solid when set, dashed outline when not.
 *  forwardRef + prop spread so it can also serve as a picker trigger. */
export const ChipButton = React.forwardRef<
  HTMLButtonElement,
  { children: React.ReactNode; set: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function ChipButton({ children, set, style, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={set}
      {...rest}
      className="flex h-[var(--task-ctl-h)] shrink-0 items-center rounded-lg px-[10px] font-mono text-[length:var(--task-fs-chip)] transition-transform active:scale-95"
      style={{
        background: set ? 'var(--task-surface-2)' : 'transparent',
        border: `1px ${set ? 'solid transparent' : 'dashed var(--task-line)'}`,
        color: set ? 'var(--task-ink-1)' : 'var(--task-ink-3)',
        ...style,
      }}
    >
      {children}
    </button>
  );
});

/** A muted icon affordance inside a row; `danger` tints on hover only. */
export function RowIconButton({
  label,
  onClick,
  children,
  danger,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[var(--task-surface-2)]"
      style={{ color: danger && hover ? ERROR_TONE : 'var(--task-ink-3)' }}
    >
      {children}
    </button>
  );
}

/* ---------- inline editable text ---------- */

// Reads as text until clicked, then becomes a borderless input in place. Keeps
// a long list of renameable rows from looking like a wall of form fields —
// onChange still fires per keystroke, so callers see identical events.
export function InlineEditText({
  value,
  placeholder,
  onChange,
  ariaLabel,
}: {
  value: string;
  placeholder?: string;
  onChange: (next: string) => void;
  ariaLabel: string;
}) {
  const [editing, setEditing] = React.useState(false);
  const ref = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editing]);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={ariaLabel}
        title="Click to rename"
        className="block w-full truncate rounded-md px-1 py-0.5 text-left text-[length:var(--task-fs-option)] transition-colors hover:bg-[var(--task-surface-2)]"
        style={{ color: value ? 'var(--task-ink-1)' : 'var(--task-ink-3)' }}
      >
        {value || placeholder}
      </button>
    );
  }

  return (
    <input
      ref={ref}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
      }}
      className="block w-full rounded-md px-1 py-0.5 text-[length:var(--task-fs-option)] outline-none"
      style={{
        background: 'var(--task-surface-2)',
        color: 'var(--task-ink-1)',
        boxShadow: 'inset 0 0 0 1px var(--task-accent)',
      }}
    />
  );
}

/* ---------- segmented control ---------- */

// The create-task priority row, generalised: a small fixed set of options laid
// out inline so the whole scale is visible rather than hidden behind a picker.
export function SegmentedRow<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; icon?: React.ReactNode }[];
  value: T;
  onChange: (next: T) => void;
  label?: string;
}) {
  return (
    <div className="border-b px-[18px] py-3" style={{ borderColor: 'var(--task-line-soft)' }}>
      {label && (
        <div
          className="mb-2 font-mono text-[length:var(--task-fs-label)] uppercase tracking-[0.14em]"
          style={{ color: 'var(--task-ink-3)' }}
        >
          {label}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(o.value)}
              className="flex h-[var(--task-ctl-h)] flex-1 items-center justify-center gap-1.5 rounded-lg px-2 font-mono text-[length:var(--task-fs-chip)] transition-transform active:scale-95"
              style={{
                background: active ? 'var(--task-surface-2)' : 'transparent',
                border: `1px ${active ? 'solid transparent' : 'dashed var(--task-line)'}`,
                color: active ? 'var(--task-ink-1)' : 'var(--task-ink-3)',
                minWidth: '5.5rem',
              }}
            >
              {o.icon}
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- person row ---------- */

const AVATAR_TONES = ['#c9b6f0', '#8fb8e8', '#9fd8c0', '#e8c39f', '#e89fb8'];

export function personTone(index: number): string {
  return AVATAR_TONES[index % AVATAR_TONES.length];
}

export function personInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/** A selectable person: avatar, name + role, accent check when selected. */
export function PersonRow({
  name,
  role,
  avatarUrl,
  tone,
  selected,
  onToggle,
}: {
  name: string;
  role?: string | null;
  avatarUrl?: string | null;
  tone: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className="flex w-full items-center gap-3 border-b px-[18px] py-2.5 text-left transition-colors hover:bg-[var(--task-surface-1)] active:bg-[var(--task-surface-2)]"
      style={{ borderColor: 'var(--task-line-soft)' }}
    >
      {avatarUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
      ) : (
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-medium"
          style={{ background: tone, color: '#0c0c0e' }}
        >
          {personInitials(name)}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span
          className="block truncate text-[length:var(--task-fs-body-sm)]"
          style={{ color: 'var(--task-ink-1)' }}
        >
          {name}
        </span>
        {role && (
          <span
            className="block truncate font-mono text-[length:var(--task-fs-label)] uppercase tracking-[0.1em]"
            style={{ color: 'var(--task-ink-3)' }}
          >
            {role}
          </span>
        )}
      </span>
      {selected && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--task-accent)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <path d="M5 12.5l4.5 4.5L19 7" />
        </svg>
      )}
    </button>
  );
}
