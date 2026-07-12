'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import {
  ACCESS_TYPE_GROUPS,
  accessValueKind,
  defaultAccessLabel,
  PARKING_TYPES,
} from '@/lib/propertyAccess';
import {
  Input,
  SectionCaption,
  SectionHeader,
  Select,
  Textarea,
  Toast,
  useToast,
} from '@/components/properties/form/FormPrimitives';

// Access tab — a configurable list of access items. Each item is a value + an
// optional note; the operator adds only the ones that apply from a curated type
// picker (or "Other" for a custom label). Per-item debounced autosave.

interface AccessItem {
  id: string;
  property_id: string;
  type: string;
  label: string;
  value: string | null;
  notes: string | null;
  sort_order: number;
}

export default function PropertyAccessTab() {
  const params = useParams<{ id: string }>();
  const propertyId = params?.id as string;

  const [items, setItems] = useState<AccessItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { toast, showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch(`/api/properties/${propertyId}/access`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load access');
      setItems((data.items || []) as AccessItem[]);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load access');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = useCallback(
    async (typeKey: string) => {
      const label = defaultAccessLabel(typeKey) || 'Custom access';
      try {
        const res = await apiFetch(`/api/properties/${propertyId}/access`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: typeKey, label, sort_order: items.length }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to add item');
        setItems((prev) => [...prev, data.item as AccessItem]);
      } catch (err) {
        showToast('error', err instanceof Error ? err.message : 'Failed to add item');
      }
    },
    [propertyId, items.length, showToast],
  );

  const handlePatch = useCallback(
    async (id: string, patch: Partial<Pick<AccessItem, 'label' | 'value' | 'notes'>>) => {
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
      try {
        const res = await apiFetch(`/api/properties/${propertyId}/access/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');
        setItems((prev) => prev.map((it) => (it.id === id ? (data.item as AccessItem) : it)));
      } catch (err) {
        showToast('error', err instanceof Error ? err.message : 'Save failed');
      }
    },
    [propertyId, showToast],
  );

  const handleDelete = useCallback(
    async (item: AccessItem) => {
      if (!window.confirm(`Delete "${item.label}"?`)) return;
      const prev = items;
      setItems((p) => p.filter((it) => it.id !== item.id));
      try {
        const res = await apiFetch(`/api/properties/${propertyId}/access/${item.id}`, {
          method: 'DELETE',
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Delete failed');
        }
      } catch (err) {
        setItems(prev);
        showToast('error', err instanceof Error ? err.message : 'Delete failed');
      }
    },
    [items, propertyId, showToast],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-neutral-400 dark:border-[#66645f] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center">
        <p className="text-neutral-500 dark:text-[#a09e9a] text-sm">{loadError}</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 overflow-auto">
        <div className="max-w-[760px] px-5 sm:px-8 pt-5 sm:pt-6 pb-32">
          <section className="mb-5">
            <SectionHeader label="Access" right={<AddAccessItem onPick={handleCreate} />} />
            <SectionCaption>
              Entry codes, keys, and parking — add only what applies. Each item can carry an
              optional note. Nothing here is shared with guests until you unlock it in Guest
              Visibility.
            </SectionCaption>
          </section>

          {items.length === 0 ? (
            <EmptyAccess onPick={handleCreate} />
          ) : (
            <div className="flex flex-col gap-2.5">
              {items.map((item) => (
                <AccessItemCard
                  key={item.id}
                  item={item}
                  onPatch={(patch) => handlePatch(item.id, patch)}
                  onDelete={() => handleDelete(item)}
                />
              ))}
              <div className="pt-1">
                <AddAccessItem onPick={handleCreate} block />
              </div>
            </div>
          )}
        </div>
      </div>
      {toast && <Toast kind={toast.kind} message={toast.message} />}
    </>
  );
}

// --- Add-item type picker --------------------------------------------------

function AddAccessItem({
  onPick,
  block = false,
}: {
  onPick: (typeKey: string) => void;
  block?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const plus = (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  );

  return (
    <div className={`relative ${block ? 'w-full' : ''}`} ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          block
            ? 'w-full inline-flex items-center justify-center gap-1.5 py-2 text-[12px] font-medium text-neutral-500 dark:text-[#a09e9a] border border-dashed border-neutral-200 dark:border-[rgba(255,255,255,0.09)] rounded-lg hover:text-[var(--accent-3)] dark:hover:text-[var(--accent-1)] hover:border-[var(--accent-3)]/40 dark:hover:border-[var(--accent-1)]/40 transition-colors'
            : 'inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500 dark:text-[#a09e9a] hover:text-[var(--accent-3)] dark:hover:text-[var(--accent-1)] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] rounded transition-colors'
        }
      >
        {plus}
        Add access item
      </button>

      {open && (
        <div
          className={`absolute z-30 mt-1 max-h-[320px] w-64 overflow-y-auto rounded-md border border-neutral-200 dark:border-[rgba(255,255,255,0.08)] bg-white dark:bg-[#141312] shadow-lg ${
            block ? 'left-0' : 'right-0'
          }`}
        >
          {ACCESS_TYPE_GROUPS.map((group) => (
            <div key={group.title} className="py-1">
              <div className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-400 dark:text-[#66645f]">
                {group.title}
              </div>
              {group.types.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    onPick(t.key);
                    setOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-[13px] text-neutral-700 dark:text-[#cbc9c4] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                >
                  {t.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Empty state -----------------------------------------------------------

function EmptyAccess({ onPick }: { onPick: (typeKey: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6 border border-dashed border-neutral-200 dark:border-[rgba(255,255,255,0.07)] rounded-lg">
      <div className="text-[14px] font-medium text-neutral-700 dark:text-[#a09e9a] mb-1">
        No access items yet
      </div>
      <div className="text-[12px] text-neutral-500 dark:text-[#66645f] mb-4 max-w-[380px]">
        Add entry codes, keys, or parking details — only the ones this property has.
      </div>
      <AddAccessItem onPick={onPick} />
    </div>
  );
}

// --- Access item card ------------------------------------------------------

function AccessItemCard({
  item,
  onPatch,
  onDelete,
}: {
  item: AccessItem;
  onPatch: (patch: Partial<Pick<AccessItem, 'label' | 'value' | 'notes'>>) => void;
  onDelete: () => void;
}) {
  const isParking = accessValueKind(item.type) === 'parking_type';
  const [label, setLabel] = useState(item.label);
  const [value, setValue] = useState(item.value ?? '');
  const [notes, setNotes] = useState(item.notes ?? '');
  const [showNotes, setShowNotes] = useState((item.notes ?? '').trim() !== '');
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLabel(item.label);
    setValue(item.value ?? '');
    setNotes(item.notes ?? '');
  }, [item.id, item.label, item.value, item.notes]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  const scheduleSave = useCallback(
    (patch: Partial<Pick<AccessItem, 'label' | 'value' | 'notes'>>) => {
      setSaved('saving');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        onPatch(patch);
        setSaved('saved');
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaved('idle'), 1500);
      }, 600);
    },
    [onPatch],
  );

  return (
    <section className="rounded-lg border border-neutral-200/80 dark:border-[rgba(255,255,255,0.07)] bg-white/40 dark:bg-[rgba(255,255,255,0.01)] p-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <input
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              if (e.target.value.trim() !== '') scheduleSave({ label: e.target.value });
            }}
            placeholder="Label"
            className="w-full bg-transparent text-[13px] font-semibold text-neutral-900 dark:text-[#f0efed] outline-none placeholder:text-neutral-400 dark:placeholder:text-[#66645f]"
          />
          {isParking ? (
            <Select
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                scheduleSave({ value: e.target.value });
              }}
              className="!py-1.5 !text-[14px]"
            >
              <option value="">Select…</option>
              {PARKING_TYPES.map((p) => (
                <option key={p} value={p}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                scheduleSave({ value: e.target.value });
              }}
              placeholder="Value (code, number, location…)"
              autoComplete="off"
              className="!py-1.5"
            />
          )}

          {showNotes ? (
            <Textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                scheduleSave({ notes: e.target.value });
              }}
              placeholder="Notes — instructions, quirks, rotation schedule…"
              rows={2}
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowNotes(true)}
              className="text-[11px] font-medium text-neutral-500 dark:text-[#66645f] hover:text-[var(--accent-3)] dark:hover:text-[var(--accent-1)] transition-colors"
            >
              + Add note
            </button>
          )}

          <div className="h-3 text-[10px] font-medium text-neutral-400 dark:text-[#66645f] uppercase tracking-[0.04em]">
            {saved === 'saving' && 'Saving…'}
            {saved === 'saved' && (
              <span className="text-[var(--accent-2)] dark:text-[var(--accent-1)]">Saved</span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete access item"
          title="Delete access item"
          className="shrink-0 p-1.5 rounded text-neutral-400 dark:text-[#66645f] hover:text-red-600 dark:hover:text-red-400 hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M10 7V4a1 1 0 011-1h2a1 1 0 011 1v3"
            />
          </svg>
        </button>
      </div>
    </section>
  );
}
