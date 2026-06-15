'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { apiFetch } from '@/lib/apiFetch';
import {
  LOCKABLE_ACCESS_FIELDS,
  LOCKABLE_CONNECTIVITY_FIELDS,
  visibilityKey,
  encodeFieldResourceId,
  type VisibilityResourceType,
} from '@/lib/propertyKnowledgeVisibility';
import { TAG_LABELS, type AttributeTag } from '@/lib/propertyAttributes';

// Guest Visibility tab — PER-FIELD control over what the Concierge (the
// guest-facing sub-agent) may see for this property. Everything is LOCKED by
// default; unlock only individual fields the team is comfortable sharing. The
// operator-facing ops agent is unaffected — it always sees everything.

type Rec = Record<string, unknown>;

interface Brief {
  access: Rec | null;
  connectivity: Rec | null;
  tech_accounts: Rec[];
  contacts: Rec[];
  rooms: Rec[];
  documents: Rec[];
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

interface FieldRow {
  type: VisibilityResourceType;
  resourceId: string;
  label: string;
  sub?: string;
}

interface Item {
  key: string;
  header?: string;
  subtitle?: string;
  rows: FieldRow[];
}

interface Group {
  key: string;
  title: string;
  items: Item[];
}

// Build per-field rows for a collection item from a field spec. A field is
// shown only when it has content (so empty fields aren't togglable noise).
function buildRows(
  type: VisibilityResourceType,
  id: string,
  specs: Array<{ field: string; label: string; value: unknown; count?: number }>,
): FieldRow[] {
  const rows: FieldRow[] = [];
  for (const s of specs) {
    const hasValue =
      s.count != null ? s.count > 0 : s.value != null && String(s.value).trim() !== '';
    if (!hasValue) continue;
    rows.push({
      type,
      resourceId: encodeFieldResourceId(id, s.field),
      label: s.label,
      sub: s.count != null ? `${s.count} photo${s.count === 1 ? '' : 's'}` : preview(s.value),
    });
  }
  return rows;
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

  const groups = useMemo<Group[]>(() => {
    if (!brief) return [];
    const out: Group[] = [];

    // Access (singleton, bare column names)
    if (brief.access) {
      const rows: FieldRow[] = [];
      for (const f of LOCKABLE_ACCESS_FIELDS) {
        const v = brief.access[f];
        if (v != null && String(v).trim() !== '') {
          rows.push({ type: 'access_field', resourceId: f, label: ACCESS_LABELS[f] ?? f, sub: preview(v) });
        }
      }
      if (rows.length) out.push({ key: 'access', title: 'Access', items: [{ key: 'access', rows }] });
    }

    // Connectivity (singleton)
    if (brief.connectivity) {
      const rows: FieldRow[] = [];
      for (const f of LOCKABLE_CONNECTIVITY_FIELDS) {
        const v = brief.connectivity[f];
        if (v != null && String(v).trim() !== '') {
          rows.push({ type: 'connectivity_field', resourceId: f, label: CONNECTIVITY_LABELS[f] ?? f, sub: preview(v) });
        }
      }
      if (rows.length) out.push({ key: 'connectivity', title: 'Connectivity', items: [{ key: 'connectivity', rows }] });
    }

    // Tech accounts
    const techItems: Item[] = [];
    for (const t of brief.tech_accounts) {
      const id = String(t.id);
      const rows = buildRows('tech_account_field', id, [
        { field: 'service_name', label: 'Service', value: t.service_name },
        { field: 'username', label: 'Username', value: t.username },
        { field: 'password', label: 'Password', value: t.password },
        { field: 'notes', label: 'Notes', value: t.notes },
        { field: 'photos', label: 'Photos', value: null, count: Array.isArray(t.property_tech_account_photos) ? t.property_tech_account_photos.length : 0 },
      ]);
      if (rows.length) {
        techItems.push({ key: id, header: (t.service_name as string) || (t.kind as string) || 'Tech account', rows });
      }
    }
    if (techItems.length) out.push({ key: 'tech', title: 'Tech accounts', items: techItems });

    // Contacts
    const contactItems: Item[] = [];
    for (const c of brief.contacts) {
      const id = String(c.id);
      const rows = buildRows('contact_field', id, [
        { field: 'name', label: 'Name', value: c.name },
        { field: 'role', label: 'Role', value: c.role },
        { field: 'phone', label: 'Phone', value: c.phone },
        { field: 'email', label: 'Email', value: c.email },
        { field: 'schedule', label: 'Schedule', value: c.schedule },
        { field: 'preferences', label: 'Preferences', value: c.preferences },
        { field: 'notes', label: 'Notes', value: c.notes },
      ]);
      if (rows.length) contactItems.push({ key: id, header: (c.name as string) || 'Contact', rows });
    }
    if (contactItems.length) out.push({ key: 'contacts', title: 'Vendors & contacts', items: contactItems });

    // Rooms
    const roomItems: Item[] = [];
    for (const room of brief.rooms) {
      const id = String(room.id);
      const rows = buildRows('room_field', id, [
        { field: 'title', label: 'Title', value: room.title },
        { field: 'notes', label: 'Notes', value: room.notes },
        { field: 'photos', label: 'Photos', value: null, count: Array.isArray(room.property_room_photos) ? room.property_room_photos.length : 0 },
      ]);
      if (rows.length) roomItems.push({ key: id, header: (room.title as string) || 'Room', subtitle: (room.scope as string) || undefined, rows });
    }
    if (roomItems.length) out.push({ key: 'rooms', title: 'Rooms & areas', items: roomItems });

    // Attributes (flattened out of rooms, tagged with room title)
    const attrItems: Item[] = [];
    for (const room of brief.rooms) {
      const attrs = Array.isArray(room.property_attributes)
        ? (room.property_attributes as Rec[])
        : [];
      for (const a of attrs) {
        const id = String(a.id);
        const tags = Array.isArray(a.tags) ? (a.tags as AttributeTag[]) : [];
        const rows = buildRows('attribute_field', id, [
          { field: 'title', label: 'Title', value: a.title },
          { field: 'body', label: 'Notes', value: a.body },
          { field: 'tags', label: 'Tags', value: tags.map((t) => TAG_LABELS[t] ?? t).join(', ') },
          { field: 'photos', label: 'Photos', value: null, count: Array.isArray(a.property_attribute_photos) ? a.property_attribute_photos.length : 0 },
        ]);
        if (rows.length) {
          attrItems.push({
            key: id,
            header: (a.title as string) || 'Attribute',
            subtitle: (room.title as string) || undefined,
            rows,
          });
        }
      }
    }
    if (attrItems.length) out.push({ key: 'attributes', title: 'Attributes', items: attrItems });

    // Documents
    const docItems: Item[] = [];
    for (const d of brief.documents) {
      const id = String(d.id);
      const rows = buildRows('document_field', id, [
        { field: 'title', label: 'Title', value: (d.title as string) || (d.original_filename as string) },
        { field: 'notes', label: 'Notes', value: d.notes },
        { field: 'file', label: 'File', value: (d.original_filename as string) || 'file' },
      ]);
      if (rows.length) docItems.push({ key: id, header: (d.title as string) || (d.original_filename as string) || 'Document', subtitle: (d.tag as string) || undefined, rows });
    }
    if (docItems.length) out.push({ key: 'documents', title: 'Documents', items: docItems });

    return out;
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
              Every field is <span className="font-medium">hidden from the Concierge by default</span>. Unlock only the
              individual fields you’re comfortable the guest-facing AI relaying to guests. The operator-facing assistant
              still sees everything regardless. <span className="font-medium">{unlockedCount}</span> field{unlockedCount === 1 ? '' : 's'} unlocked.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-center justify-between rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-[13px] text-red-700 dark:text-red-300">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-2 text-red-500 hover:text-red-700">✕</button>
          </div>
        )}

        {groups.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-neutral-400 dark:text-[#66645f]">
            No property knowledge has been added yet. Add access, wifi, rooms, attributes, or documents in the other tabs,
            then unlock fields here.
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.key} className="mb-8">
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-neutral-500 dark:text-[#66645f]">
                {group.title}
              </h2>
              <div className="flex flex-col gap-3">
                {group.items.map((item) => (
                  <div
                    key={item.key}
                    className="rounded-lg border border-neutral-200/80 dark:border-[rgba(255,255,255,0.07)] overflow-hidden"
                  >
                    {item.header && (
                      <div className="flex items-baseline gap-2 px-3.5 py-2 bg-[rgba(30,25,20,0.02)] dark:bg-[rgba(255,255,255,0.02)] border-b border-neutral-100 dark:border-[rgba(255,255,255,0.05)]">
                        <span className="text-[12px] font-semibold text-neutral-800 dark:text-[#f0efed] truncate">{item.header}</span>
                        {item.subtitle && (
                          <span className="text-[11px] text-neutral-400 dark:text-[#66645f] truncate">{item.subtitle}</span>
                        )}
                      </div>
                    )}
                    <div className="flex flex-col divide-y divide-neutral-100 dark:divide-[rgba(255,255,255,0.05)]">
                      {item.rows.map((row) => {
                        const key = visibilityKey(row.type, row.resourceId);
                        const isUnlocked = unlocked.has(key);
                        return (
                          <div key={key} className="flex items-center gap-3 px-3.5 py-2">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[12.5px] font-medium text-neutral-700 dark:text-[#cbc9c4]">{row.label}</p>
                              {row.sub && (
                                <p className="truncate text-[11.5px] text-neutral-400 dark:text-[#66645f]">{row.sub}</p>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => toggle(row.type, row.resourceId, !isUnlocked)}
                              aria-pressed={isUnlocked}
                              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                isUnlocked
                                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20'
                                  : 'bg-neutral-100 dark:bg-[rgba(255,255,255,0.05)] text-neutral-500 dark:text-[#a09e9a] hover:bg-neutral-200 dark:hover:bg-[rgba(255,255,255,0.08)]'
                              }`}
                            >
                              {isUnlocked ? (
                                <>
                                  <Eye className="h-3 w-3" aria-hidden /> Visible
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
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
