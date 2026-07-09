'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import {
  normalizeTags,
  type AttributeScope,
  type AttributeTag,
} from '@/lib/propertyAttributes';
import {
  Field,
  FieldGroup,
  Input,
  SectionHeader,
  Textarea,
  Toast,
  useToast,
} from '@/components/properties/form/FormPrimitives';
import { PhotoGrid, resolvePublicPhotoUrl, type Photo } from './PhotoGrid';
import { TagChip, TagChips } from './TagChip';

// Unified rooms + attributes surface shared by both the Interior and Exterior
// tabs. The parent passes scope + copy; everything else (CRUD, inline editing,
// photos) is handled here. "Attributes" are the tagged things inside a room
// (formerly "cards").

interface PropertyAttribute {
  id: string;
  property_id: string;
  room_id: string;
  scope: AttributeScope;
  tags: AttributeTag[];
  title: string;
  body: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  property_attribute_photos?: Photo[];
}

interface PropertyRoom {
  id: string;
  property_id: string;
  scope: AttributeScope;
  title: string;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  property_room_photos?: Photo[];
  property_attributes?: PropertyAttribute[];
}

interface RoomsBoardProps {
  propertyId: string;
  scope: AttributeScope;
  sectionLabel: string;
  // What users see in copy. Interior calls them "rooms"; Exterior calls
  // them "areas". Both use the same data model under the hood.
  noun: string; // "room" | "area"
  nounPlural: string; // "rooms" | "areas"
}

const ROOM_PHOTO_CAP = 50;
const ATTRIBUTE_PHOTO_CAP = 20;
const DEFAULT_ROOM_TITLE = 'New room';

export function RoomsBoard({
  propertyId,
  scope,
  sectionLabel,
  noun,
  nounPlural,
}: RoomsBoardProps) {
  const [rooms, setRooms] = useState<PropertyRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { toast, showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch(
        `/api/properties/${propertyId}/rooms?scope=${scope}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to load ${nounPlural}`);
      setRooms((data.rooms || []) as PropertyRoom[]);
    } catch (err: any) {
      setLoadError(err.message || `Failed to load ${nounPlural}`);
    } finally {
      setLoading(false);
    }
  }, [propertyId, scope, nounPlural]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreateRoom = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/properties/${propertyId}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope,
          title: DEFAULT_ROOM_TITLE,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to create ${noun}`);
      const newRoom = data.room as PropertyRoom;
      setRooms((prev) => [...prev, newRoom]);
    } catch (err: any) {
      showToast('error', err.message || `Failed to create ${noun}`);
    }
  }, [propertyId, scope, noun, showToast]);

  const handlePatchRoom = useCallback(
    async (roomId: string, patch: { title?: string; notes?: string | null }) => {
      setRooms((prev) =>
        prev.map((r) => (r.id === roomId ? { ...r, ...patch } : r))
      );
      try {
        const res = await apiFetch(
          `/api/properties/${propertyId}/rooms/${roomId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');
        setRooms((prev) =>
          prev.map((r) => (r.id === roomId ? (data.room as PropertyRoom) : r))
        );
      } catch (err: any) {
        showToast('error', err.message || 'Save failed');
      }
    },
    [propertyId, showToast]
  );

  const handleDeleteRoom = useCallback(
    async (room: PropertyRoom) => {
      const attrCount = room.property_attributes?.length ?? 0;
      const roomPhotoCount = room.property_room_photos?.length ?? 0;
      const attrPhotoCount = (room.property_attributes ?? []).reduce(
        (acc, a) => acc + (a.property_attribute_photos?.length ?? 0),
        0
      );
      const totalPhotos = roomPhotoCount + attrPhotoCount;
      const confirmLines = [
        `Delete "${room.title}"?`,
        '',
        attrCount > 0
          ? `This will also delete ${attrCount} attribute${attrCount === 1 ? '' : 's'}`
          : `This ${noun} has no attributes.`,
        totalPhotos > 0
          ? `${totalPhotos} photo${totalPhotos === 1 ? '' : 's'} will be removed.`
          : '',
      ]
        .filter(Boolean)
        .join('\n');
      if (!window.confirm(confirmLines)) return;
      const prev = rooms;
      setRooms((p) => p.filter((r) => r.id !== room.id));
      try {
        const res = await apiFetch(
          `/api/properties/${propertyId}/rooms/${room.id}`,
          { method: 'DELETE' }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Delete failed');
        }
      } catch (err: any) {
        setRooms(prev);
        showToast('error', err.message || 'Delete failed');
      }
    },
    [rooms, propertyId, noun, showToast]
  );

  const handleRoomPhotosChange = useCallback(
    (roomId: string, photos: Photo[]) => {
      setRooms((prev) =>
        prev.map((r) =>
          r.id === roomId ? { ...r, property_room_photos: photos } : r
        )
      );
    },
    []
  );

  const handleCreateAttribute = useCallback(
    async (roomId: string) => {
      try {
        const res = await apiFetch(`/api/properties/${propertyId}/attributes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            room_id: roomId,
            title: 'New item',
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create attribute');
        setRooms((prev) =>
          prev.map((r) =>
            r.id === roomId
              ? {
                  ...r,
                  property_attributes: [
                    ...(r.property_attributes ?? []),
                    data.attribute as PropertyAttribute,
                  ],
                }
              : r
          )
        );
      } catch (err: any) {
        showToast('error', err.message || 'Failed to create attribute');
      }
    },
    [propertyId, showToast]
  );

  const handlePatchAttribute = useCallback(
    async (
      roomId: string,
      attributeId: string,
      patch: Partial<Pick<PropertyAttribute, 'title' | 'body' | 'tags'>>
    ) => {
      setRooms((prev) =>
        prev.map((r) =>
          r.id !== roomId
            ? r
            : {
                ...r,
                property_attributes: (r.property_attributes ?? []).map((a) =>
                  a.id === attributeId ? { ...a, ...patch } : a
                ),
              }
        )
      );
      try {
        const res = await apiFetch(
          `/api/properties/${propertyId}/attributes/${attributeId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');
        setRooms((prev) =>
          prev.map((r) =>
            r.id !== roomId
              ? r
              : {
                  ...r,
                  property_attributes: (r.property_attributes ?? []).map((a) =>
                    a.id === attributeId ? (data.attribute as PropertyAttribute) : a
                  ),
                }
          )
        );
      } catch (err: any) {
        showToast('error', err.message || 'Save failed');
      }
    },
    [propertyId, showToast]
  );

  const handleDeleteAttribute = useCallback(
    async (roomId: string, attributeId: string) => {
      const prev = rooms;
      setRooms((p) =>
        p.map((r) =>
          r.id !== roomId
            ? r
            : {
                ...r,
                property_attributes: (r.property_attributes ?? []).filter(
                  (a) => a.id !== attributeId
                ),
              }
        )
      );
      try {
        const res = await apiFetch(
          `/api/properties/${propertyId}/attributes/${attributeId}`,
          { method: 'DELETE' }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Delete failed');
        }
      } catch (err: any) {
        setRooms(prev);
        showToast('error', err.message || 'Delete failed');
      }
    },
    [rooms, propertyId, showToast]
  );

  const handleAttributePhotosChange = useCallback(
    (roomId: string, attributeId: string, photos: Photo[]) => {
      setRooms((prev) =>
        prev.map((r) =>
          r.id !== roomId
            ? r
            : {
                ...r,
                property_attributes: (r.property_attributes ?? []).map((a) =>
                  a.id === attributeId
                    ? { ...a, property_attribute_photos: photos }
                    : a
                ),
              }
        )
      );
    },
    []
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
        <div className="px-5 sm:px-8 pt-5 sm:pt-6 pb-32">
          <section className="mb-6">
            <SectionHeader
              label={sectionLabel}
              right={
                rooms.length > 0 ? (
                  <button
                    type="button"
                    onClick={handleCreateRoom}
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
                    Add {noun}
                  </button>
                ) : null
              }
            />
          </section>

          {rooms.length === 0 && (
            <EmptyRooms noun={noun} onAdd={handleCreateRoom} />
          )}

          <div className="flex flex-col gap-4">
            {rooms.map((room) => (
              <RoomSection
                key={room.id}
                room={room}
                propertyId={propertyId}
                noun={noun}
                onPatchRoom={(patch) => handlePatchRoom(room.id, patch)}
                onDeleteRoom={() => handleDeleteRoom(room)}
                onRoomPhotosChange={(photos) =>
                  handleRoomPhotosChange(room.id, photos)
                }
                onCreateAttribute={() => handleCreateAttribute(room.id)}
                onPatchAttribute={(attributeId, patch) =>
                  handlePatchAttribute(room.id, attributeId, patch)
                }
                onDeleteAttribute={(attributeId) =>
                  handleDeleteAttribute(room.id, attributeId)
                }
                onAttributePhotosChange={(attributeId, photos) =>
                  handleAttributePhotosChange(room.id, attributeId, photos)
                }
                onError={(msg) => showToast('error', msg)}
              />
            ))}
          </div>
        </div>
      </div>

      {toast && <Toast kind={toast.kind} message={toast.message} />}
    </>
  );
}

// --- Empty state ----------------------------------------------------------

function EmptyRooms({ noun, onAdd }: { noun: string; onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6 border border-dashed border-neutral-200 dark:border-[rgba(255,255,255,0.07)] rounded-lg">
      <div className="text-[14px] font-medium text-neutral-700 dark:text-[#a09e9a] mb-1">
        No {noun}s yet
      </div>
      <div className="text-[12px] text-neutral-500 dark:text-[#66645f] mb-4 max-w-[380px]">
        Add a {noun} to start organizing notes, photos, and attributes
        (appliances, amenities, quirks).
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="px-4 py-1.5 text-[13px] font-medium bg-[var(--accent-3)] text-white rounded-md hover:bg-[var(--accent-2)] dark:hover:bg-[var(--accent-1)] transition-colors"
      >
        Add your first {noun}
      </button>
    </div>
  );
}

// --- RoomSection ----------------------------------------------------------

function RoomSection({
  room,
  propertyId,
  noun,
  onPatchRoom,
  onDeleteRoom,
  onRoomPhotosChange,
  onCreateAttribute,
  onPatchAttribute,
  onDeleteAttribute,
  onAttributePhotosChange,
  onError,
}: {
  room: PropertyRoom;
  propertyId: string;
  noun: string;
  onPatchRoom: (patch: { title?: string; notes?: string | null }) => void;
  onDeleteRoom: () => void;
  onRoomPhotosChange: (photos: Photo[]) => void;
  onCreateAttribute: () => void;
  onPatchAttribute: (
    attributeId: string,
    patch: Partial<Pick<PropertyAttribute, 'title' | 'body' | 'tags'>>
  ) => void;
  onDeleteAttribute: (attributeId: string) => void;
  onAttributePhotosChange: (attributeId: string, photos: Photo[]) => void;
  onError: (msg: string) => void;
}) {
  const attributes = room.property_attributes ?? [];
  const roomPhotos = room.property_room_photos ?? [];

  return (
    <section className="grid grid-cols-1 md:grid-cols-2 md:items-start gap-4 md:gap-6 border border-neutral-200/80 dark:border-[rgba(255,255,255,0.07)] rounded-xl p-4 sm:p-5 bg-white/40 dark:bg-[rgba(255,255,255,0.01)]">
      {/* LEFT: the room/area — title, notes, photos. Borderless; the section
          container wraps the whole room + attributes pair. */}
      <div className="min-w-0">
        <div className="mb-4">
          <RoomTitle
            value={room.title}
            onChangeTitle={(next) => onPatchRoom({ title: next })}
          />
        </div>

        {/* Notes, then photos — both remain room-level, on the left. */}
        <div className="mb-4">
          <RoomNotes
            value={room.notes ?? ''}
            noun={noun}
            onChange={(next) => onPatchRoom({ notes: next.trim() === '' ? null : next })}
          />
        </div>

        <PhotoGrid
          photos={roomPhotos}
          maxPhotos={ROOM_PHOTO_CAP}
          noun={noun}
          uploadUrl={`/api/properties/${propertyId}/rooms/${room.id}/photos`}
          deleteUrl={(photoId) =>
            `/api/properties/${propertyId}/rooms/${room.id}/photos/${photoId}`
          }
          resolveUrl={resolvePublicPhotoUrl}
          onPhotosChange={onRoomPhotosChange}
          onError={onError}
        />
      </div>

      {/* RIGHT: this room's attributes as expandable rows. When the room has
          none, the Add button centers in the section; otherwise it sits
          beneath the list. No "Attributes" header, so the first attribute
          top-aligns with the room content on the left. */}
      {attributes.length === 0 ? (
        <div className="min-w-0 md:self-stretch flex items-center justify-center py-6">
          <button
            type="button"
            onClick={onCreateAttribute}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium text-neutral-500 dark:text-[#a09e9a] border border-dashed border-neutral-200 dark:border-[rgba(255,255,255,0.09)] rounded-lg hover:text-[var(--accent-3)] dark:hover:text-[var(--accent-1)] hover:border-[var(--accent-3)]/40 dark:hover:border-[var(--accent-1)]/40 hover:bg-[rgba(30,25,20,0.02)] dark:hover:bg-[rgba(255,255,255,0.02)] transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add attribute
          </button>
        </div>
      ) : (
        <div className="min-w-0 space-y-2">
          {attributes.map((a) => (
            <AttributeRow
              key={a.id}
              attribute={a}
              propertyId={propertyId}
              onPatch={(patch) => onPatchAttribute(a.id, patch)}
              onDelete={() => onDeleteAttribute(a.id)}
              onPhotosChange={(photos) => onAttributePhotosChange(a.id, photos)}
              onError={onError}
            />
          ))}
          <button
            type="button"
            onClick={onCreateAttribute}
            className="w-full inline-flex items-center justify-center gap-1.5 py-2 text-[12px] font-medium text-neutral-500 dark:text-[#a09e9a] border border-dashed border-neutral-200 dark:border-[rgba(255,255,255,0.09)] rounded-lg hover:text-[var(--accent-3)] dark:hover:text-[var(--accent-1)] hover:border-[var(--accent-3)]/40 dark:hover:border-[var(--accent-1)]/40 hover:bg-[rgba(30,25,20,0.02)] dark:hover:bg-[rgba(255,255,255,0.02)] transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add attribute
          </button>
        </div>
      )}

      {/* Whole-section delete (room + all its attributes), bottom-right. */}
      <div className="md:col-span-2 flex justify-end">
        <button
          type="button"
          onClick={onDeleteRoom}
          aria-label={`Delete ${noun}`}
          title={`Delete ${noun}`}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-neutral-400 dark:text-[#66645f] hover:text-red-600 dark:hover:text-red-400 hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] transition-colors"
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
          Delete {noun}
        </button>
      </div>
    </section>
  );
}

// --- RoomNotes (debounced, room-level free-text) --------------------------

function RoomNotes({
  value,
  noun,
  onChange,
}: {
  value: string;
  noun: string;
  onChange: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [savedState, setSavedState] = useState<'idle' | 'saving' | 'saved'>(
    'idle'
  );
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  const handleChange = (next: string) => {
    setDraft(next);
    setSavedState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      onChange(next);
      setSavedState('saved');
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSavedState('idle'), 1500);
    }, 650);
  };

  return (
    <div>
      <label className="block text-[11px] font-semibold text-neutral-700 dark:text-[#a09e9a] uppercase tracking-[0.08em] mb-1.5">
        Notes
      </label>
      <Textarea
        value={draft}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={`Anything that's true of this whole ${noun} — quirks, layout notes, recurring issues. Attribute-specific details belong on the attribute.`}
        rows={2}
      />
      <div className="mt-1 h-4 text-[10px] font-medium text-neutral-400 dark:text-[#66645f] uppercase tracking-[0.04em]">
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

// --- RoomTitle (inline rename) --------------------------------------------

function RoomTitle({
  value,
  onChangeTitle,
}: {
  value: string;
  onChangeTitle: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [buffer, setBuffer] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) setBuffer(value);
  }, [editing, value]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    const trimmed = buffer.trim();
    if (trimmed && trimmed !== value) onChangeTitle(trimmed);
    setEditing(false);
  };

  return (
    <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
      {editing ? (
        <input
          ref={inputRef}
          value={buffer}
          onChange={(e) => setBuffer(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              setBuffer(value);
              setEditing(false);
            }
          }}
          className="flex-1 min-w-0 bg-transparent text-[17px] font-semibold text-neutral-900 dark:text-[#f0efed] border-b border-[var(--accent-3)] dark:border-[var(--accent-1)] focus:outline-none py-0.5"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="group inline-flex items-center gap-1.5 text-left min-w-0"
          title="Rename"
        >
          <span className="text-[17px] font-semibold text-neutral-900 dark:text-[#f0efed] truncate">
            {value}
          </span>
          <svg
            className="w-3.5 h-3.5 text-neutral-300 dark:text-[#3e3d3a] group-hover:text-[var(--accent-3)] dark:group-hover:text-[var(--accent-1)] transition-colors shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
            />
          </svg>
        </button>
      )}
    </div>
  );
}

// --- AttributeRow (collapsible) -------------------------------------------

interface AttributeRowProps {
  attribute: PropertyAttribute;
  propertyId: string;
  onPatch: (
    patch: Partial<Pick<PropertyAttribute, 'title' | 'body' | 'tags'>>
  ) => void;
  onDelete: () => void;
  onPhotosChange: (photos: Photo[]) => void;
  onError: (msg: string) => void;
}

function AttributeRow({
  attribute,
  propertyId,
  onPatch,
  onDelete,
  onPhotosChange,
  onError,
}: AttributeRowProps) {
  // Freshly created attributes (still titled "New item") start expanded so the
  // user can fill them in; existing ones start collapsed for a tidy list.
  const [expanded, setExpanded] = useState(
    () => !attribute.title || attribute.title === 'New item'
  );
  const [local, setLocal] = useState({
    title: attribute.title ?? '',
    body: attribute.body ?? '',
  });
  const [savedState, setSavedState] = useState<'idle' | 'saving' | 'saved'>(
    'idle'
  );
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocal({
      title: attribute.title ?? '',
      body: attribute.body ?? '',
    });
  }, [attribute.id, attribute.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleSave = useCallback(
    (patch: Parameters<AttributeRowProps['onPatch']>[0]) => {
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

  const updateText = (key: keyof typeof local, value: string) => {
    const next = { ...local, [key]: value };
    setLocal(next);
    if (key === 'title' && value.trim() === '') {
      setSavedState('idle');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      return;
    }
    scheduleSave({ [key]: value } as Partial<Pick<PropertyAttribute, 'title' | 'body'>>);
  };

  const updateTags = (tags: AttributeTag[]) => {
    // Tag changes commit immediately (no debounce) — they're discrete clicks.
    onPatch({ tags: normalizeTags(tags) });
  };

  return (
    <div className="border border-neutral-200/80 dark:border-[rgba(255,255,255,0.07)] rounded-lg">
      {!expanded ? (
        /* Collapsed — click the row to expand. */
        <div className="flex items-center gap-2 p-2.5">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex-1 min-w-0 flex items-center gap-2 text-left"
            aria-expanded={false}
          >
            <svg
              className="w-3.5 h-3.5 shrink-0 text-neutral-400 dark:text-[#66645f]"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-[14px] font-medium text-neutral-900 dark:text-[#f0efed] truncate">
              {local.title || 'Untitled attribute'}
            </span>
            <TagChips tags={attribute.tags ?? []} />
          </button>
        </div>
      ) : (
        /* Expanded — the title shows once (the input). The chevron collapses;
           delete moves to the bottom-right. */
        <div className="p-2.5 space-y-3">
          <div className="flex items-start gap-2">
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-expanded
              aria-label="Collapse attribute"
              className="shrink-0 mt-2 p-0.5 rounded text-neutral-400 dark:text-[#66645f] hover:text-neutral-700 dark:hover:text-[#a09e9a] transition-colors"
            >
              <svg
                className="w-3.5 h-3.5 rotate-90"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <div className="flex-1 min-w-0">
              <Input
                value={local.title}
                onChange={(e) => updateText('title', e.target.value)}
                placeholder="Title (required)"
                className="!py-1.5 !text-[14px] !font-medium"
              />
            </div>
            <TagChip value={attribute.tags ?? []} onChange={updateTags} />
          </div>

          <FieldGroup>
            <Field label="Notes">
              <Textarea
                value={local.body}
                onChange={(e) => updateText('body', e.target.value)}
                placeholder="Free text — quirks, instructions, history"
                rows={2}
              />
            </Field>

            <div className="mt-1 pt-3 border-t border-neutral-100 dark:border-[rgba(255,255,255,0.05)]">
              <PhotoGrid
                photos={attribute.property_attribute_photos ?? []}
                maxPhotos={ATTRIBUTE_PHOTO_CAP}
                noun="attribute"
                uploadUrl={`/api/properties/${propertyId}/attributes/${attribute.id}/photos`}
                deleteUrl={(photoId) =>
                  `/api/properties/${propertyId}/attributes/${attribute.id}/photos/${photoId}`
                }
                resolveUrl={resolvePublicPhotoUrl}
                onPhotosChange={onPhotosChange}
                onError={onError}
              />
            </div>
          </FieldGroup>

          {/* Footer: save status on the left, delete on the bottom-right. */}
          <div className="flex items-center justify-between pt-1">
            <div className="h-4 text-[10px] font-medium text-neutral-400 dark:text-[#66645f] uppercase tracking-[0.04em]">
              {savedState === 'saving' && 'Saving…'}
              {savedState === 'saved' && (
                <span className="text-[var(--accent-2)] dark:text-[var(--accent-1)]">
                  Saved
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Delete "${local.title || 'this attribute'}"?`))
                  onDelete();
              }}
              aria-label="Delete attribute"
              className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-neutral-400 dark:text-[#66645f] hover:text-red-600 dark:hover:text-red-400 hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] transition-colors"
              title="Delete attribute"
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
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
