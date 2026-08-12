'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/apiFetch';
import { qk } from '@/lib/queries/keys';
import { fetchJson } from '@/lib/queries/fetchJson';
import { LoadingState } from '@/components/ui/loading-state';
import {
  SectionCaption,
  SectionHeader,
  Textarea,
  Toast,
  useToast,
} from '@/components/properties/form/FormPrimitives';

// Policies & Instructions tab — a flat list of the rules and standing
// instructions that apply to the STAY or the WHOLE property: checkout time and
// departure steps, quiet hours, parties, smoking, pets, trash day, parking
// policy. Anything that governs one specific object or area belongs on that
// object as an Interior/Exterior attribute instead.
//
// Same shape as the Access tab: per-item debounced autosave, optimistic cache
// patches, no save bar.

interface Policy {
  id: string;
  property_id: string;
  title: string;
  body: string | null;
  sort_order: number;
}

const EMPTY_POLICIES: Policy[] = [];
const NEW_POLICY_TITLE = 'New policy';

export default function PropertyPoliciesTab() {
  const params = useParams<{ id: string }>();
  const propertyId = params?.id as string;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: qk.propertyKnowledge(propertyId, 'policies'),
    queryFn: async () => {
      const data = await fetchJson<{ policies?: Policy[] }>(
        `/api/properties/${propertyId}/policies`,
      );
      return (data.policies || []) as Policy[];
    },
  });
  const policies = query.data ?? EMPTY_POLICIES;
  const loading = query.isLoading;
  const loadError = query.error?.message ?? null;

  const { toast, showToast } = useToast();
  // The row to autofocus after a create, so "Add policy" lands the cursor in the
  // title rather than making the user aim at a row that says "New policy".
  const [focusId, setFocusId] = useState<string | null>(null);

  const patchPolicies = useCallback(
    (action: SetStateAction<Policy[]>) => {
      const key = qk.propertyKnowledge(propertyId, 'policies');
      queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<Policy[]>(key, (old) => {
        const prev = old ?? [];
        return typeof action === 'function' ? (action as (p: Policy[]) => Policy[])(prev) : action;
      });
    },
    [queryClient, propertyId],
  );

  const handleCreate = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/properties/${propertyId}/policies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: NEW_POLICY_TITLE, sort_order: policies.length }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add policy');
      const created = data.policy as Policy;
      patchPolicies((prev) => [...prev, created]);
      setFocusId(created.id);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to add policy');
    }
  }, [propertyId, policies.length, showToast, patchPolicies]);

  const handlePatch = useCallback(
    async (id: string, patch: Partial<Pick<Policy, 'title' | 'body'>>) => {
      patchPolicies((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
      try {
        const res = await apiFetch(`/api/properties/${propertyId}/policies/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');
        patchPolicies((prev) => prev.map((p) => (p.id === id ? (data.policy as Policy) : p)));
      } catch (err) {
        showToast('error', err instanceof Error ? err.message : 'Save failed');
      }
    },
    [propertyId, showToast, patchPolicies],
  );

  const handleDelete = useCallback(
    async (policy: Policy) => {
      if (!window.confirm(`Delete "${policy.title}"?`)) return;
      const key = qk.propertyKnowledge(propertyId, 'policies');
      const snapshot = queryClient.getQueryData<Policy[]>(key) ?? EMPTY_POLICIES;
      patchPolicies((p) => p.filter((it) => it.id !== policy.id));
      try {
        const res = await apiFetch(`/api/properties/${propertyId}/policies/${policy.id}`, {
          method: 'DELETE',
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Delete failed');
        }
      } catch (err) {
        patchPolicies(snapshot);
        showToast('error', err instanceof Error ? err.message : 'Delete failed');
      }
    },
    [propertyId, queryClient, patchPolicies, showToast],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <LoadingState />
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
            <SectionHeader
              label="Policies & Instructions"
              right={<AddPolicy onAdd={handleCreate} />}
            />
            <SectionCaption>
              Rules and standing instructions for the stay or the whole property — checkout time
              and departure steps, quiet hours, parties, smoking, pets, trash day. Something that
              governs one specific object or area belongs on that object in Interior or Exterior
              instead. Nothing here is shared with guests until you unlock it in Guest Visibility.
            </SectionCaption>
          </section>

          {policies.length === 0 ? (
            <EmptyPolicies onAdd={handleCreate} />
          ) : (
            <div className="flex flex-col gap-2.5">
              {policies.map((policy) => (
                <PolicyCard
                  key={policy.id}
                  policy={policy}
                  autoFocus={policy.id === focusId}
                  onPatch={(patch) => handlePatch(policy.id, patch)}
                  onDelete={() => handleDelete(policy)}
                />
              ))}
              <div className="pt-1">
                <AddPolicy onAdd={handleCreate} block />
              </div>
            </div>
          )}
        </div>
      </div>
      {toast && <Toast kind={toast.kind} message={toast.message} />}
    </>
  );
}

// --- Add button ------------------------------------------------------------

function AddPolicy({ onAdd, block = false }: { onAdd: () => void; block?: boolean }) {
  const plus = (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  );

  return (
    <button
      type="button"
      onClick={onAdd}
      className={
        block
          ? 'w-full inline-flex items-center justify-center gap-1.5 py-2 text-[12px] font-medium text-neutral-500 dark:text-[#a09e9a] border border-dashed border-neutral-200 dark:border-[rgba(255,255,255,0.09)] rounded-lg hover:text-[var(--accent-3)] dark:hover:text-[var(--accent-1)] hover:border-[var(--accent-3)]/40 dark:hover:border-[var(--accent-1)]/40 transition-colors'
          : 'inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500 dark:text-[#a09e9a] hover:text-[var(--accent-3)] dark:hover:text-[var(--accent-1)] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] rounded transition-colors'
      }
    >
      {plus}
      Add policy
    </button>
  );
}

// --- Empty state -----------------------------------------------------------

function EmptyPolicies({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6 border border-dashed border-neutral-200 dark:border-[rgba(255,255,255,0.07)] rounded-lg">
      <div className="text-[14px] font-medium text-neutral-700 dark:text-[#a09e9a] mb-1">
        No policies yet
      </div>
      <div className="text-[12px] text-neutral-500 dark:text-[#66645f] mb-4 max-w-[380px]">
        Add the rules and instructions that apply across the whole stay — checkout time, quiet
        hours, no parties, what to do on departure.
      </div>
      <AddPolicy onAdd={onAdd} />
    </div>
  );
}

// --- Policy card -----------------------------------------------------------

function PolicyCard({
  policy,
  autoFocus,
  onPatch,
  onDelete,
}: {
  policy: Policy;
  autoFocus: boolean;
  onPatch: (patch: Partial<Pick<Policy, 'title' | 'body'>>) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(policy.title);
  const [body, setBody] = useState(policy.body ?? '');
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const titleRef = useRef<HTMLInputElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTitle(policy.title);
    setBody(policy.body ?? '');
  }, [policy.id, policy.title, policy.body]);

  // A freshly created row arrives titled "New policy" — select it so typing
  // replaces the placeholder instead of appending to it.
  useEffect(() => {
    if (autoFocus) titleRef.current?.select();
  }, [autoFocus]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  const scheduleSave = useCallback(
    (patch: Partial<Pick<Policy, 'title' | 'body'>>) => {
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
            ref={titleRef}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              // An empty title is rejected server-side (it is the agent's match
              // key), so hold the save until there's something to save.
              if (e.target.value.trim() !== '') scheduleSave({ title: e.target.value });
            }}
            placeholder="Title — e.g. Checkout, Quiet hours, No parties"
            className="w-full bg-transparent text-[13px] font-semibold text-neutral-900 dark:text-[#f0efed] outline-none placeholder:text-neutral-400 dark:placeholder:text-[#66645f]"
          />
          <Textarea
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              scheduleSave({ body: e.target.value });
            }}
            placeholder="The rule or instruction in full — what applies, and anything a guest or the team needs to do about it."
            rows={2}
          />

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
          aria-label="Delete policy"
          title="Delete policy"
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
