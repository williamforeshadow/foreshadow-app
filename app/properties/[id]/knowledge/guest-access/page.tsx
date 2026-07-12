'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { apiFetch } from '@/lib/apiFetch';
import {
  LOCKABLE_CONNECTIVITY_FIELDS,
  RESOURCE_FIELD_SETS,
  visibilityKey,
  encodeFieldResourceId,
  type VisibilityResourceType,
} from '@/lib/propertyKnowledgeVisibility';
import { type AttributeTag } from '@/lib/propertyAttributes';
import { TagChips } from '@/components/properties/cards/TagChip';
import { resolvePublicPhotoUrl } from '@/components/properties/cards/PhotoGrid';

// Guest Visibility tab — control over what the Concierge (the guest-facing
// sub-agent) may see for this property. Everything is LOCKED by default; unlock
// only what the team is comfortable sharing. The operator-facing ops agent is
// unaffected — it always sees everything.
//
// Granularity is per-item where a single decision is natural (a whole room, a
// whole attribute — its title/notes/tags/photos travel together as a package)
// and per-field where a record mixes shareable + sensitive data (access codes,
// wifi, contacts, tech accounts, documents). Storage stays per-field either
// way: a package toggle just writes/removes that item's field rows in one call.

type Rec = Record<string, unknown>;

interface Brief {
  access: Rec[];
  connectivity: Rec | null;
  tech_accounts: Rec[];
  contacts: Rec[];
  rooms: Rec[];
  documents: Rec[];
}

const CONNECTIVITY_LABELS: Record<string, string> = {
  wifi_ssid: 'Wi-Fi network (SSID)',
  wifi_password: 'Wi-Fi password',
  wifi_router_location: 'Router location',
};

function hasContent(value: unknown): boolean {
  return value != null && String(value).trim() !== '';
}

function preview(value: unknown): string {
  if (value == null) return '';
  const s = String(value).trim();
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

interface PhotoLike {
  id: string;
  storage_path: string;
  sort_order?: number;
}

// Pull a record's nested photo array into a sorted, thumbnail-ready list.
function photosOf(value: unknown): PhotoLike[] {
  if (!Array.isArray(value)) return [];
  return (value as PhotoLike[])
    .filter((p) => p && typeof p.storage_path === 'string')
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

// --- Field-level sections (access / connectivity / tech / contacts / docs) --

interface FieldRow {
  type: VisibilityResourceType;
  resourceId: string;
  label: string;
  sub?: string;
  photos?: PhotoLike[];
}

interface FieldItem {
  key: string;
  header?: string;
  subtitle?: string;
  rows: FieldRow[];
}

interface FieldsGroup {
  kind: 'fields';
  key: string;
  title: string;
  items: FieldItem[];
}

// Build per-field rows for a collection item. A field is shown only when it has
// content (so empty fields aren't togglable noise).
function buildRows(
  type: VisibilityResourceType,
  id: string,
  specs: Array<{ field: string; label: string; value: unknown; photos?: PhotoLike[] }>,
): FieldRow[] {
  const rows: FieldRow[] = [];
  for (const s of specs) {
    const present = s.photos ? s.photos.length > 0 : hasContent(s.value);
    if (!present) continue;
    rows.push({
      type,
      resourceId: encodeFieldResourceId(id, s.field),
      label: s.label,
      sub: s.photos ? undefined : preview(s.value),
      photos: s.photos,
    });
  }
  return rows;
}

// --- Package sections (rooms + their attributes) ---------------------------
// A "package" is one toggle that controls all of an item's content-bearing
// fields at once.

interface Package {
  key: string;
  type: VisibilityResourceType; // 'room_field' | 'attribute_field'
  // The item's FULL field set — a package is all-or-nothing, so unlocking it
  // covers every field (incl. ones with no content yet, like photos added later).
  resourceIds: string[];
  label: string;
  notesPreview?: string; // room notes / attribute body preview
  tags: AttributeTag[]; // attribute tags (empty for rooms)
  photos: PhotoLike[];
}

interface RoomBlock {
  key: string;
  room: Package;
  scope?: string;
  attributes: Package[];
}

interface RoomsGroup {
  kind: 'rooms';
  key: 'rooms';
  title: string;
  blocks: RoomBlock[];
}

interface AccessGroup {
  kind: 'access';
  key: 'access';
  title: string;
  packages: Package[];
}

type Group = FieldsGroup | RoomsGroup | AccessGroup;

function roomPackage(room: Rec): Package {
  const id = String(room.id);
  return {
    key: id,
    type: 'room_field',
    resourceIds: RESOURCE_FIELD_SETS.room_field.map((f) => encodeFieldResourceId(id, f)),
    label: (room.title as string) || 'Room',
    notesPreview: hasContent(room.notes) ? preview(room.notes) : undefined,
    tags: [],
    photos: photosOf(room.property_room_photos),
  };
}

function attributePackage(attr: Rec): Package {
  const id = String(attr.id);
  return {
    key: id,
    type: 'attribute_field',
    resourceIds: RESOURCE_FIELD_SETS.attribute_field.map((f) => encodeFieldResourceId(id, f)),
    label: (attr.title as string) || 'Attribute',
    notesPreview: hasContent(attr.body) ? preview(attr.body) : undefined,
    tags: Array.isArray(attr.tags) ? (attr.tags as AttributeTag[]) : [],
    photos: photosOf(attr.property_attribute_photos),
  };
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

  // Set visibility for one or more field resource_ids of a single resource
  // type at once (one id = a field row; many ids = a room/attribute package).
  const setVisibility = useCallback(
    async (resourceType: VisibilityResourceType, resourceIds: string[], nextVisible: boolean) => {
      if (resourceIds.length === 0) return;
      const keys = resourceIds.map((rid) => visibilityKey(resourceType, rid));
      setUnlocked((prev) => {
        const next = new Set(prev);
        for (const k of keys) {
          if (nextVisible) next.add(k);
          else next.delete(k);
        }
        return next;
      });
      try {
        const res = await apiFetch(`/api/properties/${propertyId}/guest-visibility`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resource_type: resourceType, resource_ids: resourceIds, visible: nextVisible }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to update');
        }
      } catch (err) {
        setUnlocked((prev) => {
          const next = new Set(prev);
          for (const k of keys) {
            if (nextVisible) next.delete(k);
            else next.add(k);
          }
          return next;
        });
        setError(err instanceof Error ? err.message : 'Failed to update');
      }
    },
    [propertyId],
  );

  const isPackageVisible = useCallback(
    (pkg: Package) => pkg.resourceIds.some((rid) => unlocked.has(visibilityKey(pkg.type, rid))),
    [unlocked],
  );

  const groups = useMemo<Group[]>(() => {
    if (!brief) return [];
    const out: Group[] = [];

    // Access — a collection of value+notes packages (property_access_items).
    const accessPkgs: Package[] = [];
    for (const raw of brief.access) {
      const a = raw as Rec;
      const id = String(a.id);
      const ids: string[] = [];
      if (hasContent(a.value)) ids.push(encodeFieldResourceId(id, 'value'));
      if (hasContent(a.notes)) ids.push(encodeFieldResourceId(id, 'notes'));
      if (ids.length === 0) continue;
      const bits: string[] = [];
      if (hasContent(a.value)) bits.push(String(a.value));
      if (hasContent(a.notes)) bits.push(String(a.notes));
      accessPkgs.push({
        key: id,
        type: 'access_field',
        resourceIds: ids,
        label: (a.label as string) || 'Access item',
        notesPreview: bits.length ? preview(bits.join(' — ')) : undefined,
        tags: [],
        photos: [],
      });
    }
    if (accessPkgs.length) out.push({ kind: 'access', key: 'access', title: 'Access', packages: accessPkgs });

    // Connectivity (singleton)
    if (brief.connectivity) {
      const rows: FieldRow[] = [];
      for (const f of LOCKABLE_CONNECTIVITY_FIELDS) {
        const v = brief.connectivity[f];
        if (hasContent(v)) {
          rows.push({ type: 'connectivity_field', resourceId: f, label: CONNECTIVITY_LABELS[f] ?? f, sub: preview(v) });
        }
      }
      if (rows.length) out.push({ kind: 'fields', key: 'connectivity', title: 'Connectivity', items: [{ key: 'connectivity', rows }] });
    }

    // Tech accounts
    const techItems: FieldItem[] = [];
    for (const t of brief.tech_accounts) {
      const id = String(t.id);
      const rows = buildRows('tech_account_field', id, [
        { field: 'service_name', label: 'Service', value: t.service_name },
        { field: 'username', label: 'Username', value: t.username },
        { field: 'password', label: 'Password', value: t.password },
        { field: 'notes', label: 'Notes', value: t.notes },
        { field: 'photos', label: 'Photos', value: null, photos: photosOf(t.property_tech_account_photos) },
      ]);
      if (rows.length) {
        techItems.push({ key: id, header: (t.service_name as string) || (t.kind as string) || 'Tech account', rows });
      }
    }
    if (techItems.length) out.push({ kind: 'fields', key: 'tech', title: 'Tech accounts', items: techItems });

    // Contacts
    const contactItems: FieldItem[] = [];
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
    if (contactItems.length) out.push({ kind: 'fields', key: 'contacts', title: 'Vendors & contacts', items: contactItems });

    // Rooms & areas — each room is a package toggle, with its attributes nested
    // underneath as their own package toggles (mirrors the Interior/Exterior
    // editing layout). Each toggle is all-or-nothing over the item's fields.
    const blocks: RoomBlock[] = brief.rooms.map((room) => ({
      key: String(room.id),
      room: roomPackage(room),
      scope: (room.scope as string) || undefined,
      attributes: (Array.isArray(room.property_attributes) ? (room.property_attributes as Rec[]) : []).map(
        attributePackage,
      ),
    }));
    if (blocks.length) out.push({ kind: 'rooms', key: 'rooms', title: 'Rooms & areas', blocks });

    // Documents
    const docItems: FieldItem[] = [];
    for (const d of brief.documents) {
      const id = String(d.id);
      const rows = buildRows('document_field', id, [
        { field: 'title', label: 'Title', value: (d.title as string) || (d.original_filename as string) },
        { field: 'notes', label: 'Notes', value: d.notes },
        { field: 'file', label: 'File', value: (d.original_filename as string) || 'file' },
      ]);
      if (rows.length) docItems.push({ key: id, header: (d.title as string) || (d.original_filename as string) || 'Document', subtitle: (d.tag as string) || undefined, rows });
    }
    if (docItems.length) out.push({ kind: 'fields', key: 'documents', title: 'Documents', items: docItems });

    return out;
  }, [brief]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-neutral-400 dark:border-[#66645f] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-[760px] px-5 sm:px-8 pt-5 sm:pt-6 pb-32">
        <div className="mb-5 rounded-lg border border-neutral-200/80 dark:border-[rgba(255,255,255,0.07)] bg-[var(--accent-bg-soft)] dark:bg-[var(--accent-bg-soft-dark)] p-3.5">
          <div className="flex items-start gap-2.5">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-3)] dark:text-[var(--accent-1)]" aria-hidden />
            <p className="text-[13px] leading-relaxed text-neutral-700 dark:text-[#cbc9c4]">
              Everything is <span className="font-medium">hidden from the Concierge by default</span>. Unlock only what
              you’re comfortable the guest-facing AI relaying to guests. Rooms and attributes toggle as a whole; access,
              wifi, contacts, and documents unlock field by field. The operator-facing assistant still sees everything
              regardless.
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
            then unlock what guests can see here.
          </div>
        ) : (
          groups.map((group) =>
            group.kind === 'rooms' ? (
              <section key={group.key} className="mb-8">
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-neutral-500 dark:text-[#66645f]">
                  {group.title}
                </h2>
                <div className="flex flex-col gap-3">
                  {group.blocks.map((block) => (
                    <div
                      key={block.key}
                      className="rounded-lg border border-neutral-200/80 dark:border-[rgba(255,255,255,0.07)] overflow-hidden"
                    >
                      {/* Room package toggle (header) */}
                      <div className="flex items-start gap-3 px-3.5 py-2.5 bg-[rgba(30,25,20,0.02)] dark:bg-[rgba(255,255,255,0.02)] border-b border-neutral-100 dark:border-[rgba(255,255,255,0.05)]">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="truncate text-[12.5px] font-semibold text-neutral-800 dark:text-[#f0efed]">{block.room.label}</span>
                            {block.scope && (
                              <span className="text-[11px] text-neutral-400 dark:text-[#66645f] capitalize">{block.scope}</span>
                            )}
                          </div>
                          <PackageMeta pkg={block.room} />
                        </div>
                        <VisibilityToggle
                          visible={isPackageVisible(block.room)}
                          onClick={() =>
                            setVisibility(block.room.type, block.room.resourceIds, !isPackageVisible(block.room))
                          }
                        />
                      </div>

                      {/* Nested attributes, each its own package toggle */}
                      {block.attributes.length === 0 ? (
                        <div className="px-3.5 py-2.5 text-[11.5px] text-neutral-400 dark:text-[#66645f]">
                          No attributes in this room.
                        </div>
                      ) : (
                        <div className="flex flex-col divide-y divide-neutral-100 dark:divide-[rgba(255,255,255,0.05)]">
                          {block.attributes.map((attr) => (
                            <div key={attr.key} className="flex items-start gap-3 py-2.5 pl-6 pr-3.5">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[12.5px] font-medium text-neutral-700 dark:text-[#cbc9c4]">{attr.label}</p>
                                <PackageMeta pkg={attr} />
                              </div>
                              <VisibilityToggle
                                visible={isPackageVisible(attr)}
                                onClick={() => setVisibility(attr.type, attr.resourceIds, !isPackageVisible(attr))}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            ) : group.kind === 'access' ? (
              <section key={group.key} className="mb-8">
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-neutral-500 dark:text-[#66645f]">
                  {group.title}
                </h2>
                <div className="flex flex-col gap-2">
                  {group.packages.map((pkg) => (
                    <div
                      key={pkg.key}
                      className="flex items-start gap-3 rounded-lg border border-neutral-200/80 dark:border-[rgba(255,255,255,0.07)] px-3.5 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-medium text-neutral-700 dark:text-[#cbc9c4]">{pkg.label}</p>
                        <PackageMeta pkg={pkg} />
                      </div>
                      <VisibilityToggle
                        visible={isPackageVisible(pkg)}
                        onClick={() => setVisibility(pkg.type, pkg.resourceIds, !isPackageVisible(pkg))}
                      />
                    </div>
                  ))}
                </div>
              </section>
            ) : (
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
                            <div key={key} className="flex items-start gap-3 px-3.5 py-2">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[12.5px] font-medium text-neutral-700 dark:text-[#cbc9c4]">{row.label}</p>
                                {row.photos && row.photos.length > 0 ? (
                                  <div className="mt-1">
                                    <PhotoThumbs photos={row.photos} />
                                  </div>
                                ) : (
                                  row.sub && (
                                    <p className="truncate text-[11.5px] text-neutral-400 dark:text-[#66645f]">{row.sub}</p>
                                  )
                                )}
                              </div>
                              <VisibilityToggle
                                visible={isUnlocked}
                                onClick={() => setVisibility(row.type, [row.resourceId], !isUnlocked)}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ),
          )
        )}
      </div>
    </div>
  );
}

// A compact strip of photo thumbnails (with a "+N" overflow chip) so the
// operator can see the actual images a toggle would share.
function PhotoThumbs({ photos, max = 6 }: { photos: PhotoLike[]; max?: number }) {
  if (photos.length === 0) return null;
  const shown = photos.slice(0, max);
  const extra = photos.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((p) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={p.id}
          src={resolvePublicPhotoUrl(p.storage_path)}
          alt=""
          loading="lazy"
          className="h-11 w-11 rounded-md border border-neutral-200/80 object-cover dark:border-[rgba(255,255,255,0.08)] bg-neutral-100 dark:bg-[#1a1918]"
        />
      ))}
      {extra > 0 && (
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-neutral-200/80 text-[11px] font-medium text-neutral-500 dark:border-[rgba(255,255,255,0.08)] dark:text-[#a09e9a]">
          +{extra}
        </span>
      )}
    </div>
  );
}

// Context under a room/attribute label — a notes/body preview, tag chips, and
// photo thumbnails — so the operator sees exactly what flipping the toggle shares.
function PackageMeta({ pkg }: { pkg: Package }) {
  const hasMeta = !!pkg.notesPreview || pkg.tags.length > 0 || pkg.photos.length > 0;
  if (!hasMeta) return null;
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      {pkg.notesPreview && (
        <p className="text-[11.5px] leading-snug text-neutral-500 dark:text-[#8a8884] line-clamp-2">
          {pkg.notesPreview}
        </p>
      )}
      {pkg.tags.length > 0 && <TagChips tags={pkg.tags} />}
      {pkg.photos.length > 0 && <PhotoThumbs photos={pkg.photos} />}
    </div>
  );
}

// Shared Visible/Hidden pill used by both field rows and package (room /
// attribute) toggles.
function VisibilityToggle({
  visible,
  onClick,
  disabled = false,
}: {
  visible: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={visible}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        visible
          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20'
          : 'bg-neutral-100 dark:bg-[rgba(255,255,255,0.05)] text-neutral-500 dark:text-[#a09e9a] hover:bg-neutral-200 dark:hover:bg-[rgba(255,255,255,0.08)]'
      }`}
    >
      {visible ? (
        <>
          <Eye className="h-3 w-3" aria-hidden /> Visible
        </>
      ) : (
        <>
          <EyeOff className="h-3 w-3" aria-hidden /> Hidden
        </>
      )}
    </button>
  );
}
