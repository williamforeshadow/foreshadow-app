'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { apiFetch } from '@/lib/apiFetch';
import {
  LOCKABLE_ACCESS_FIELDS,
  LOCKABLE_CONNECTIVITY_FIELDS,
  visibilityKey,
  type VisibilityResourceType,
} from '@/lib/propertyKnowledgeVisibility';

// Guest Visibility tab — the single per-item control for what the Concierge
// (the guest-facing sub-agent) is allowed to see for this property, and may
// therefore relay to a guest. Everything is LOCKED by default; unlock only what
// the team is comfortable sharing. The operator-facing ops agent is unaffected —
// it always sees everything.

interface Brief {
  access: Record<string, unknown> | null;
  connectivity: Record<string, unknown> | null;
  tech_accounts: Array<Record<string, unknown>>;
  notes: Array<Record<string, unknown>>;
  contacts: Array<Record<string, unknown>>;
  rooms: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
}

const ACCESS_LABELS: Record<string, string> = {
  guest_code: 'Guest door code',
  cleaner_code: 'Cleaner code',
  backup_code: 'Backup code',
  code_rotation_notes: 'Code rotation notes',
  outer_door_code: 'Outer door code',
  gate_code: 'Gate code',
  elevator_notes: 'Elevator notes',
  unit_door_code: 'Unit door code',
  key_location: 'Key location',
  lockbox_code: 'Lockbox code',
  parking_spot_number: 'Parking spot number',
  parking_type: 'Parking type',
  parking_instructions: 'Parking instructions',
};

const CONNECTIVITY_LABELS: Record<string, string> = {
  wifi_ssid: 'Wi-Fi network (SSID)',
  wifi_password: 'Wi-Fi password',
  wifi_router_location: 'Router location',
};

function preview(value: unknown): string {
  if (value == null) return '';
  const s = String(value).trim();
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

export default function GuestAccessTab() {
  const params = useParams<{ id: string }>();
  const propertyId = params?.id as string;

  const [brief, setBrief] = useState<Brief | null>(null);
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [briefRes, visRes] = await Promise.all([
        apiFetch(`/api/properties/${propertyId}/brief`),
        apiFetch(`/api/properties/${propertyId}/guest-visibility`),
      ]);
      const briefData = await briefRes.json();
      if (!briefRes.ok) throw new Error(briefData.error || 'Failed to load property');
      const visData = await visRes.json();
      if (!visRes.ok) throw new Error(visData.error || 'Failed to load visibility');

      setBrief(briefData as Brief);
      const set = new Set<string>();
      for (const r of (visData.unlocked ?? []) as Array<{ resource_type: VisibilityResourceType; resource_id: string }>) {
        set.add(visibilityKey(r.resource_type, r.resource_id));
      }
      setUnlocked(set);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = useCallback(
    async (resourceType: VisibilityResourceType, resourceId: string, nextVisible: boolean) => {
      const key = visibilityKey(resourceType, resourceId);
      // Optimistic.
      setUnlocked((prev) => {
        const next = new Set(prev);
        if (nextVisible) next.add(key);
        else next.delete(key);
        return next;
      });
      try {
        const res = await apiFetch(`/api/properties/${propertyId}/guest-visibility`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resource_type: resourceType, resource_id: resourceId, visible: nextVisible }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to update');
        }
      } catch (err) {
        // Revert.
        setUnlocked((prev) => {
          const next = new Set(prev);
          if (nextVisible) next.delete(key);
          else next.add(key);
          return next;
        });
        setError(err instanceof Error ? err.message : 'Failed to update');
      }
    },
    [propertyId],
  );

  const items = useMemo(() => {
    if (!brief) return [];
    type Row = { type: VisibilityResourceType; id: string; label: string; sub?: string };
    type Group = { key: string; title: string; rows: Row[] };
    const groups: Group[] = [];

    // Access fields
    const accessRows: Row[] = [];
    if (brief.access) {
      for (const f of LOCKABLE_ACCESS_FIELDS) {
        const v = brief.access[f];
        if (v != null && String(v).trim() !== '') {
          accessRows.push({ type: 'access_field', id: f, label: ACCESS_LABELS[f] ?? f, sub: preview(v) });
        }
      }
    }
    if (accessRows.length) groups.push({ key: 'access', title: 'Access', rows: accessRows });

    // Connectivity fields
    const connRows: Row[] = [];
    if (brief.connectivity) {
      for (const f of LOCKABLE_CONNECTIVITY_FIELDS) {
        const v = brief.connectivity[f];
        if (v != null && String(v).trim() !== '') {
          connRows.push({ type: 'connectivity_field', id: f, label: CONNECTIVITY_LABELS[f] ?? f, sub: preview(v) });
        }
      }
    }
    if (connRows.length) groups.push({ key: 'connectivity', title: 'Connectivity', rows: connRows });

    // Tech accounts
    const techRows: Row[] = brief.tech_accounts.map((t) => ({
      type: 'tech_account' as const,
      id: String(t.id),
      label: (t.service_name as string) || (t.kind as string) || 'Tech account',
      sub: (t.username as string) || undefined,
    }));
    if (techRows.length) groups.push({ key: 'tech', title: 'Tech accounts', rows: techRows });

    // Notes
    const noteRows: Row[] = brief.notes.map((n) => ({
      type: 'note' as const,
      id: String(n.id),
      label: (n.title as string) || preview(n.body) || 'Note',
      sub: n.title ? preview(n.body) : (n.scope as string) || undefined,
    }));
    if (noteRows.length) groups.push({ key: 'notes', title: 'Notes', rows: noteRows });

    // Contacts
    const contactRows: Row[] = brief.contacts.map((c) => ({
      type: 'contact' as const,
      id: String(c.id),
      label: (c.name as string) || 'Contact',
      sub: [c.role, c.category].filter(Boolean).join(' · ') || undefined,
    }));
    if (contactRows.length) groups.push({ key: 'contacts', title: 'Vendors & contacts', rows: contactRows });

    // Rooms + nested cards
    const roomRows: Row[] = [];
    for (const room of brief.rooms) {
      roomRows.push({
        type: 'room',
        id: String(room.id),
        label: (room.title as string) || (room.type as string) || 'Room',
        sub: (room.scope as string) || undefined,
      });
      const cards = Array.isArray(room.property_cards) ? (room.property_cards as Array<Record<string, unknown>>) : [];
      for (const card of cards) {
        roomRows.push({
          type: 'card',
          id: String(card.id),
          label: `   ↳ ${(card.title as string) || (card.tag as string) || 'Card'}`,
          sub: preview(card.body),
        });
      }
    }
    if (roomRows.length) groups.push({ key: 'rooms', title: 'Rooms & cards', rows: roomRows });

    // Documents
    const docRows: Row[] = brief.documents.map((d) => ({
      type: 'document' as const,
      id: String(d.id),
      label: (d.title as string) || (d.original_filename as string) || 'Document',
      sub: (d.tag as string) || undefined,
    }));
    if (docRows.length) groups.push({ key: 'documents', title: 'Documents', rows: docRows });

    return groups;
  }, [brief]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-neutral-400 dark:border-[#66645f] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const unlockedCount = unlocked.size;

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-[760px] px-5 sm:px-8 pt-5 sm:pt-6 pb-32">
        <div className="mb-5 rounded-lg border border-neutral-200/80 dark:border-[rgba(255,255,255,0.07)] bg-[var(--accent-bg-soft)] dark:bg-[var(--accent-bg-soft-dark)] p-3.5">
          <div className="flex items-start gap-2.5">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-3)] dark:text-[var(--accent-1)]" aria-hidden />
            <p className="text-[13px] leading-relaxed text-neutral-700 dark:text-[#cbc9c4]">
              Everything is <span className="font-medium">hidden from the Concierge by default</span>. Unlock only what
              you’re comfortable the guest-facing AI relaying to guests. The operator-facing assistant still sees
              everything regardless. <span className="font-medium">{unlockedCount}</span> item{unlockedCount === 1 ? '' : 's'} unlocked.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-center justify-between rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-[13px] text-red-700 dark:text-red-300">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-2 text-red-500 hover:text-red-700">✕</button>
          </div>
        )}

        {items.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-neutral-400 dark:text-[#66645f]">
            No property knowledge has been added yet. Add access, wifi, notes, rooms, or documents in the other tabs,
            then unlock items here.
          </div>
        ) : (
          items.map((group) => (
            <section key={group.key} className="mb-8">
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-neutral-500 dark:text-[#66645f]">
                {group.title}
              </h2>
              <div className="flex flex-col divide-y divide-neutral-100 dark:divide-[rgba(255,255,255,0.05)] rounded-lg border border-neutral-200/80 dark:border-[rgba(255,255,255,0.07)]">
                {group.rows.map((row) => {
                  const key = visibilityKey(row.type, row.id);
                  const isUnlocked = unlocked.has(key);
                  return (
                    <div key={key} className="flex items-center gap-3 px-3.5 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-neutral-800 dark:text-[#f0efed]">{row.label}</p>
                        {row.sub && (
                          <p className="truncate text-[12px] text-neutral-400 dark:text-[#66645f]">{row.sub}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => toggle(row.type, row.id, !isUnlocked)}
                        aria-pressed={isUnlocked}
                        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                          isUnlocked
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20'
                            : 'bg-neutral-100 dark:bg-[rgba(255,255,255,0.05)] text-neutral-500 dark:text-[#a09e9a] hover:bg-neutral-200 dark:hover:bg-[rgba(255,255,255,0.08)]'
                        }`}
                      >
                        {isUnlocked ? (
                          <>
                            <Eye className="h-3 w-3" aria-hidden /> Visible to guests
                          </>
                        ) : (
                          <>
                            <EyeOff className="h-3 w-3" aria-hidden /> Hidden
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
