'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import {
  KIND_CHIP_CLASSES,
  KIND_LABELS,
  TECH_ACCOUNT_KINDS,
  TECH_ACCOUNT_PRESETS,
  type TechAccountKind,
  type TechAccountPreset,
} from '@/lib/propertyTechAccounts';
import {
  Field,
  FieldGroup,
  Input,
  SectionCaption,
  SectionHeader,
  Textarea,
  Toast,
  useToast,
} from '@/components/properties/form/FormPrimitives';
import { PhotoGrid, resolvePublicPhotoUrl, type Photo } from '@/components/properties/cards/PhotoGrid';

const PHOTO_CAP = 10;

interface TechAccount {
  id: string;
  property_id: string;
  kind: TechAccountKind;
  service_name: string;
  username: string | null;
  password: string | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  property_tech_account_photos?: Photo[];
}

export function TechAccountsList({ propertyId }: { propertyId: string }) {
  const [accounts, setAccounts] = useState<TechAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { toast, showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch(`/api/properties/${propertyId}/tech-accounts`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load accounts');
      setAccounts((data.accounts || []) as TechAccount[]);
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load accounts');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = useCallback(
    async (seed?: TechAccountPreset) => {
      try {
        const res = await apiFetch(`/api/properties/${propertyId}/tech-accounts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(seed ?? {}),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create account');
        setAccounts((prev) => [...prev, data.account as TechAccount]);
      } catch (err: any) {
        showToast('error', err.message || 'Failed to create account');
      }
    },
    [propertyId, showToast]
  );

  const handlePatch = useCallback(
    async (
      accountId: string,
      patch: Partial<
        Pick<TechAccount, 'service_name' | 'username' | 'password' | 'notes' | 'kind'>
      >
    ) => {
      setAccounts((prev) =>
        prev.map((a) => (a.id === accountId ? { ...a, ...patch } : a))
      );
      try {
        const res = await apiFetch(
          `/api/properties/${propertyId}/tech-accounts/${accountId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');
        setAccounts((prev) =>
          prev.map((a) => (a.id === accountId ? (data.account as TechAccount) : a))
        );
      } catch (err: any) {
        showToast('error', err.message || 'Save failed');
      }
    },
    [propertyId, showToast]
  );

  const handleDelete = useCallback(
    async (account: TechAccount) => {
      if (!window.confirm(`Delete "${account.service_name}"?`)) return;
      const prev = accounts;
      setAccounts((p) => p.filter((a) => a.id !== account.id));
      try {
        const res = await apiFetch(
          `/api/properties/${propertyId}/tech-accounts/${account.id}`,
          { method: 'DELETE' }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Delete failed');
        }
      } catch (err: any) {
        setAccounts(prev);
        showToast('error', err.message || 'Delete failed');
      }
    },
    [accounts, propertyId, showToast]
  );

  const handlePhotosChange = useCallback(
    (accountId: string, photos: Photo[]) => {
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === accountId
            ? { ...a, property_tech_account_photos: photos }
            : a
        )
      );
    },
    []
  );

  return (
    <section>
      <SectionHeader
        label="Accounts"
        right={
          <button
            type="button"
            onClick={() => handleCreate()}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500 dark:text-[#a09e9a] hover:text-[var(--accent-3)] dark:hover:text-[var(--accent-1)] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] rounded transition-colors"
          >
            <svg
              className="w-3 h-3"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4v16m8-8H4"
              />
            </svg>
            Add account
          </button>
        }
      />
      <SectionCaption>
        Streaming, smart home, TV — any shared login. Click a preset to pre-fill, then edit.
      </SectionCaption>

      <PresetChips onPick={handleCreate} />

      {loading ? (
        <div className="py-6 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-neutral-400 dark:border-[#66645f] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : loadError ? (
        <div className="py-6 text-center text-[13px] text-neutral-500 dark:text-[#a09e9a]">
          {loadError}
        </div>
      ) : accounts.length === 0 ? (
        <EmptyAccounts onAdd={() => handleCreate()} />
      ) : (
        <div className="flex flex-col gap-3">
          {accounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              propertyId={propertyId}
              onPatch={(patch) => handlePatch(account.id, patch)}
              onDelete={() => handleDelete(account)}
              onPhotosChange={(photos) => handlePhotosChange(account.id, photos)}
              onError={(msg) => showToast('error', msg)}
            />
          ))}
        </div>
      )}

      {toast && <Toast kind={toast.kind} message={toast.message} />}
    </section>
  );
}

// --- Preset chips --------------------------------------------------------

function PresetChips({
  onPick,
}: {
  onPick: (preset: TechAccountPreset) => void;
}) {
  return (
    <div className="mb-4 -mx-1 flex flex-wrap gap-1.5">
      {TECH_ACCOUNT_PRESETS.map((preset) => (
        <button
          key={preset.service_name}
          type="button"
          onClick={() => onPick(preset)}
          className={`inline-flex items-center gap-1 px-2.5 py-1 text-[12px] font-medium rounded-full border transition-opacity ${KIND_CHIP_CLASSES[preset.kind]} hover:opacity-80`}
          title={`Add ${preset.service_name}`}
        >
          <svg
            className="w-3 h-3"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4v16m8-8H4"
            />
          </svg>
          {preset.service_name}
        </button>
      ))}
    </div>
  );
}

// --- Empty state ---------------------------------------------------------

function EmptyAccounts({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6 border border-dashed border-neutral-200 dark:border-[rgba(255,255,255,0.07)] rounded-lg">
      <div className="text-[14px] font-medium text-neutral-700 dark:text-[#a09e9a] mb-1">
        No accounts yet
      </div>
      <div className="text-[12px] text-neutral-500 dark:text-[#66645f] mb-4 max-w-[380px]">
        Add streaming logins, smart-home accounts, or anything else guests
        and cleaners need to sign into.
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="px-4 py-1.5 text-[13px] font-medium bg-[var(--accent-3)] text-white rounded-md hover:bg-[var(--accent-2)] dark:hover:bg-[var(--accent-1)] transition-colors"
      >
        Add your first account
      </button>
    </div>
  );
}

// --- AccountCard ---------------------------------------------------------

function AccountCard({
  account,
  propertyId,
  onPatch,
  onDelete,
  onPhotosChange,
  onError,
}: {
  account: TechAccount;
  propertyId: string;
  onPatch: (
    patch: Partial<
      Pick<TechAccount, 'service_name' | 'username' | 'password' | 'notes' | 'kind'>
    >
  ) => void;
  onDelete: () => void;
  onPhotosChange: (photos: Photo[]) => void;
  onError: (msg: string) => void;
}) {
  const [local, setLocal] = useState({
    service_name: account.service_name,
    username: account.username ?? '',
    password: account.password ?? '',
    notes: account.notes ?? '',
  });
  const [savedState, setSavedState] = useState<'idle' | 'saving' | 'saved'>(
    'idle'
  );
  const [showPwd, setShowPwd] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Re-sync when the upstream row changes (e.g. after kind change or
    // initial server response replaces the optimistic record).
    setLocal({
      service_name: account.service_name,
      username: account.username ?? '',
      password: account.password ?? '',
      notes: account.notes ?? '',
    });
  }, [account.id, account.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleSave = useCallback(
    (patch: Parameters<typeof onPatch>[0]) => {
      setSavedState('saving');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        onPatch(patch);
        setSavedState('saved');
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSavedState('idle'), 1500);
      }, 650);
    },
    [onPatch]
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  const updateField = (key: keyof typeof local, value: string) => {
    const next = { ...local, [key]: value };
    setLocal(next);
    // service_name is required; don't schedule a save for an empty one
    // but keep the local state so the user sees their typing.
    if (key === 'service_name' && value.trim() === '') {
      setSavedState('idle');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      return;
    }
    scheduleSave({ [key]: value } as any);
  };

  const updateKind = (kind: TechAccountKind) => {
    onPatch({ kind });
  };

  return (
    <div className="border border-neutral-200/80 dark:border-[rgba(255,255,255,0.07)] rounded-lg p-3">
      <div className="flex items-start gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <Input
            value={local.service_name}
            onChange={(e) => updateField('service_name', e.target.value)}
            placeholder="Service name (required)"
            className="!py-1.5 !text-[14px] !font-medium"
          />
        </div>
        <KindChip value={account.kind} onChange={updateKind} />
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete account"
          className="shrink-0 p-1 rounded text-neutral-400 dark:text-[#66645f] hover:text-red-600 dark:hover:text-red-400 hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] transition-colors"
          title={`${KIND_LABELS[account.kind]} · delete account`}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M10 7V4a1 1 0 011-1h2a1 1 0 011 1v3"
            />
          </svg>
        </button>
      </div>

      <FieldGroup>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Username / email">
            <Input
              value={local.username}
              onChange={(e) => updateField('username', e.target.value)}
              placeholder="e.g. guest@property.com"
              autoComplete="off"
            />
          </Field>
          <Field label="Password">
            <div className="relative">
              <Input
                value={local.password}
                onChange={(e) => updateField('password', e.target.value)}
                placeholder="Account password"
                type={showPwd ? 'text' : 'password'}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-neutral-500 dark:text-[#66645f] hover:text-neutral-800 dark:hover:text-[#f0efed] transition-colors"
                tabIndex={-1}
              >
                {showPwd ? 'Hide' : 'Show'}
              </button>
            </div>
          </Field>
        </div>
        <Field label="Notes">
          <Textarea
            value={local.notes}
            onChange={(e) => updateField('notes', e.target.value)}
            placeholder="Which profile to use, plan tier, what's included, etc."
            rows={2}
          />
        </Field>

        <div className="pt-3 border-t border-neutral-100 dark:border-[rgba(255,255,255,0.05)]">
          <PhotoGrid
            photos={account.property_tech_account_photos ?? []}
            maxPhotos={PHOTO_CAP}
            noun="account"
            uploadUrl={`/api/properties/${propertyId}/tech-accounts/${account.id}/photos`}
            deleteUrl={(photoId) =>
              `/api/properties/${propertyId}/tech-accounts/${account.id}/photos/${photoId}`
            }
            resolveUrl={resolvePublicPhotoUrl}
            onPhotosChange={onPhotosChange}
            onError={onError}
          />
        </div>
      </FieldGroup>

      <div className="mt-1.5 h-4 text-[10px] font-medium text-neutral-400 dark:text-[#66645f] uppercase tracking-[0.04em]">
        {savedState === 'saving' && 'Saving…'}
        {savedState === 'saved' && (
          <span className="text-[var(--accent-2)] dark:text-[var(--accent-1)]">
            Saved
          </span>
        )}
      </div>
    </div>
  );
}

// --- KindChip ------------------------------------------------------------

function KindChip({
  value,
  onChange,
}: {
  value: TechAccountKind;
  onChange: (next: TechAccountKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const chipClasses = KIND_CHIP_CLASSES[value];

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-full border transition-colors ${chipClasses} hover:opacity-80`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Change kind"
      >
        <span className="uppercase tracking-[0.04em]">{KIND_LABELS[value]}</span>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-30 mt-1 w-44 rounded-md border border-neutral-200 dark:border-[rgba(255,255,255,0.08)] bg-white dark:bg-[#141312] shadow-lg overflow-hidden"
        >
          {TECH_ACCOUNT_KINDS.map((k) => {
            const isActive = k === value;
            return (
              <button
                key={k}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  onChange(k);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-[12px] flex items-center gap-2 transition-colors ${
                  isActive
                    ? 'bg-[rgba(99,102,241,0.08)] dark:bg-[rgba(167,139,250,0.1)] text-neutral-900 dark:text-[#f0efed]'
                    : 'text-neutral-700 dark:text-[#a09e9a] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)]'
                }`}
              >
                <span
                  className={`inline-block w-2 h-2 rounded-full border ${KIND_CHIP_CLASSES[k]}`}
                />
                {KIND_LABELS[k]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
