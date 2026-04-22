'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ROOM_TYPE_LABELS,
  TAG_LABELS,
  TAG_SUB_FIELDS,
  type CardScope,
  type CardTag,
  type RoomType,
} from '@/lib/propertyCards';
import {
  Field,
  FieldGroup,
  Input,
  SectionCaption,
  SectionHeader,
  Select,
  Textarea,
  Toast,
  useToast,
} from '@/components/properties/form/FormPrimitives';
import { PhotoGrid, resolvePublicPhotoUrl, type Photo } from './PhotoGrid';
import { TagChip } from './TagChip';

// Unified rooms + cards surface shared by both the Interior and Exterior
// tabs. The parent passes scope + copy; everything else (CRUD, inline
// editing, photos) is handled here.

interface PropertyCard {
  id: string;
  property_id: string;
  room_id: string;
  scope: CardScope;
  tag: CardTag;
  title: string;
  body: string | null;
  tag_data: Record<string, unknown> | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  property_card_photos?: Photo[];
}

interface PropertyRoom {
  id: string;
  property_id: string;
  scope: CardScope;
  type: RoomType;
  title: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  property_room_photos?: Photo[];
  property_cards?: PropertyCard[];
}

interface RoomsBoardProps {
  propertyId: string;
  scope: CardScope;
  sectionLabel: string;
  sectionCaption: string;
  // What users see in copy. Interior calls them "rooms"; Exterior calls
  // them "areas". Both use the same data model under the hood.
  noun: string; // "room" | "area"
  nounPlural: string; // "rooms" | "areas"
  // Room types shown in the type dropdown. The scope decides whether
  // interior- or exterior-flavored options are presented; the DB enum
  // still accepts any value from the full union.
  roomTypes: RoomType[];
}

const ROOM_PHOTO_CAP = 50;
const CARD_PHOTO_CAP = 20;
// Defaults used when a user hits "Add room/area" — type is generic and the
// title is a placeholder-ish label the user is expected to overwrite.
const DEFAULT_ROOM_TYPE: RoomType = 'other';
const DEFAULT_ROOM_TITLE = 'Room name';

export function RoomsBoard({
  propertyId,
  scope,
  sectionLabel,
  sectionCaption,
  noun,
  nounPlural,
  roomTypes,
}: RoomsBoardProps) {
  const [rooms, setRooms] = useState<PropertyRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { toast, showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(
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
      const res = await fetch(`/api/properties/${propertyId}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope,
          type: DEFAULT_ROOM_TYPE,
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
    async (roomId: string, patch: { title?: string; type?: RoomType }) => {
      setRooms((prev) =>
        prev.map((r) => (r.id === roomId ? { ...r, ...patch } : r))
      );
      try {
        const res = await fetch(
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
      const cardCount = room.property_cards?.length ?? 0;
      const roomPhotoCount = room.property_room_photos?.length ?? 0;
      const cardPhotoCount = (room.property_cards ?? []).reduce(
        (acc, c) => acc + (c.property_card_photos?.length ?? 0),
        0
      );
      const totalPhotos = roomPhotoCount + cardPhotoCount;
      const confirmLines = [
        `Delete "${room.title}"?`,
        '',
        cardCount > 0
          ? `This will also delete ${cardCount} card${cardCount === 1 ? '' : 's'}`
          : `This ${noun} has no cards.`,
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
        const res = await fetch(
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

  const handleCreateCard = useCallback(
    async (roomId: string) => {
      try {
        const res = await fetch(`/api/properties/${propertyId}/cards`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            room_id: roomId,
            tag: 'other',
            title: 'New item',
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create card');
        setRooms((prev) =>
          prev.map((r) =>
            r.id === roomId
              ? {
                  ...r,
                  property_cards: [
                    ...(r.property_cards ?? []),
                    data.card as PropertyCard,
                  ],
                }
              : r
          )
        );
      } catch (err: any) {
        showToast('error', err.message || 'Failed to create card');
      }
    },
    [propertyId, showToast]
  );

  const handlePatchCard = useCallback(
    async (
      roomId: string,
      cardId: string,
      patch: Partial<
        Pick<PropertyCard, 'title' | 'body' | 'tag' | 'tag_data'>
      >
    ) => {
      setRooms((prev) =>
        prev.map((r) =>
          r.id !== roomId
            ? r
            : {
                ...r,
                property_cards: (r.property_cards ?? []).map((c) =>
                  c.id === cardId ? { ...c, ...patch } : c
                ),
              }
        )
      );
      try {
        const res = await fetch(
          `/api/properties/${propertyId}/cards/${cardId}`,
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
                  property_cards: (r.property_cards ?? []).map((c) =>
                    c.id === cardId ? (data.card as PropertyCard) : c
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

  const handleDeleteCard = useCallback(
    async (roomId: string, cardId: string) => {
      const prev = rooms;
      setRooms((p) =>
        p.map((r) =>
          r.id !== roomId
            ? r
            : {
                ...r,
                property_cards: (r.property_cards ?? []).filter(
                  (c) => c.id !== cardId
                ),
              }
        )
      );
      try {
        const res = await fetch(
          `/api/properties/${propertyId}/cards/${cardId}`,
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

  const handleCardPhotosChange = useCallback(
    (roomId: string, cardId: string, photos: Photo[]) => {
      setRooms((prev) =>
        prev.map((r) =>
          r.id !== roomId
            ? r
            : {
                ...r,
                property_cards: (r.property_cards ?? []).map((c) =>
                  c.id === cardId
                    ? { ...c, property_card_photos: photos }
                    : c
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
        <div className="max-w-[760px] mx-auto px-5 sm:px-8 pt-5 sm:pt-6 pb-32">
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
            <SectionCaption>{sectionCaption}</SectionCaption>
          </section>

          {rooms.length === 0 && (
            <EmptyRooms noun={noun} onAdd={handleCreateRoom} />
          )}

          <div className="flex flex-col gap-6">
            {rooms.map((room) => (
              <RoomSection
                key={room.id}
                room={room}
                propertyId={propertyId}
                noun={noun}
                roomTypes={roomTypes}
                onPatchRoom={(patch) => handlePatchRoom(room.id, patch)}
                onDeleteRoom={() => handleDeleteRoom(room)}
                onRoomPhotosChange={(photos) =>
                  handleRoomPhotosChange(room.id, photos)
                }
                onCreateCard={() => handleCreateCard(room.id)}
                onPatchCard={(cardId, patch) =>
                  handlePatchCard(room.id, cardId, patch)
                }
                onDeleteCard={(cardId) => handleDeleteCard(room.id, cardId)}
                onCardPhotosChange={(cardId, photos) =>
                  handleCardPhotosChange(room.id, cardId, photos)
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

function EmptyRooms({
  noun,
  onAdd,
}: {
  noun: string;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6 border border-dashed border-neutral-200 dark:border-[rgba(255,255,255,0.07)] rounded-lg">
      <div className="text-[14px] font-medium text-neutral-700 dark:text-[#a09e9a] mb-1">
        No {noun}s yet
      </div>
      <div className="text-[12px] text-neutral-500 dark:text-[#66645f] mb-4 max-w-[380px]">
        Add a {noun} to start organizing photos, appliances, amenities, and
        quirks.
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
  roomTypes,
  onPatchRoom,
  onDeleteRoom,
  onRoomPhotosChange,
  onCreateCard,
  onPatchCard,
  onDeleteCard,
  onCardPhotosChange,
  onError,
}: {
  room: PropertyRoom;
  propertyId: string;
  noun: string;
  roomTypes: RoomType[];
  onPatchRoom: (patch: { title?: string; type?: RoomType }) => void;
  onDeleteRoom: () => void;
  onRoomPhotosChange: (photos: Photo[]) => void;
  onCreateCard: () => void;
  onPatchCard: (
    cardId: string,
    patch: Partial<Pick<PropertyCard, 'title' | 'body' | 'tag' | 'tag_data'>>
  ) => void;
  onDeleteCard: (cardId: string) => void;
  onCardPhotosChange: (cardId: string, photos: Photo[]) => void;
  onError: (msg: string) => void;
}) {
  const cards = room.property_cards ?? [];
  const roomPhotos = room.property_room_photos ?? [];

  return (
    <section className="border border-neutral-200/80 dark:border-[rgba(255,255,255,0.07)] rounded-lg p-4 sm:p-5 bg-white/40 dark:bg-[rgba(255,255,255,0.01)]">
      <div className="flex items-start justify-between gap-3 mb-4">
        <RoomTitle
          value={room.title}
          type={room.type}
          roomTypes={roomTypes}
          onChangeTitle={(next) => onPatchRoom({ title: next })}
          onChangeType={(next) => onPatchRoom({ type: next })}
        />
        <button
          type="button"
          onClick={onDeleteRoom}
          aria-label={`Delete ${noun}`}
          className="shrink-0 p-1.5 rounded text-neutral-400 dark:text-[#66645f] hover:text-red-600 dark:hover:text-red-400 hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] transition-colors"
          title={`Delete ${noun}`}
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

      <div className="mb-5">
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

      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[11px] font-semibold text-neutral-700 dark:text-[#a09e9a] uppercase tracking-[0.08em]">
          Cards
        </h4>
        <button
          type="button"
          onClick={onCreateCard}
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
          Add card
        </button>
      </div>

      {cards.length === 0 ? (
        <div className="py-4 px-3 text-[12px] text-neutral-400 dark:text-[#66645f] border border-dashed border-neutral-200 dark:border-[rgba(255,255,255,0.07)] rounded-md">
          No cards in this {noun} yet.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {cards.map((c) => (
            <CardEditor
              key={c.id}
              card={c}
              propertyId={propertyId}
              onPatch={(patch) => onPatchCard(c.id, patch)}
              onDelete={() => onDeleteCard(c.id)}
              onPhotosChange={(photos) => onCardPhotosChange(c.id, photos)}
              onError={onError}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// --- RoomTitle (inline rename + type select) ------------------------------

function RoomTitle({
  value,
  type,
  roomTypes,
  onChangeTitle,
  onChangeType,
}: {
  value: string;
  type: RoomType;
  roomTypes: RoomType[];
  onChangeTitle: (next: string) => void;
  onChangeType: (next: RoomType) => void;
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
      <select
        value={type}
        onChange={(e) => onChangeType(e.target.value as RoomType)}
        className="shrink-0 text-[11px] font-medium uppercase tracking-[0.04em] text-neutral-500 dark:text-[#a09e9a] bg-transparent border border-neutral-200 dark:border-[rgba(255,255,255,0.08)] rounded-full px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)] dark:focus:ring-[var(--accent-ring-dark)] transition-colors"
        title="Change type"
      >
        {roomTypes.map((t) => (
          <option key={t} value={t}>
            {ROOM_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
    </div>
  );
}

// --- CardEditor -----------------------------------------------------------

interface CardEditorProps {
  card: PropertyCard;
  propertyId: string;
  onPatch: (
    patch: Partial<Pick<PropertyCard, 'title' | 'body' | 'tag' | 'tag_data'>>
  ) => void;
  onDelete: () => void;
  onPhotosChange: (photos: Photo[]) => void;
  onError: (msg: string) => void;
}

function CardEditor({
  card,
  propertyId,
  onPatch,
  onDelete,
  onPhotosChange,
  onError,
}: CardEditorProps) {
  const [local, setLocal] = useState({
    title: card.title ?? '',
    body: card.body ?? '',
  });
  const [tagData, setTagData] = useState<Record<string, unknown>>(
    card.tag_data ?? {}
  );
  const [savedState, setSavedState] = useState<'idle' | 'saving' | 'saved'>(
    'idle'
  );
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocal({
      title: card.title ?? '',
      body: card.body ?? '',
    });
    setTagData(card.tag_data ?? {});
  }, [card.id, card.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleSave = useCallback(
    (patch: Parameters<CardEditorProps['onPatch']>[0]) => {
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
    scheduleSave({ [key]: value } as any);
  };

  const updateTag = (tag: CardTag) => {
    // Preserve whatever sub-field keys are still valid for the new tag —
    // the server drops the rest on write.
    onPatch({ tag });
  };

  const updateSubField = (key: string, value: string) => {
    const next = { ...tagData, [key]: value };
    setTagData(next);
    scheduleSave({ tag_data: next });
  };

  const subFields = TAG_SUB_FIELDS[card.tag] ?? [];

  return (
    <div className="border border-neutral-200/80 dark:border-[rgba(255,255,255,0.07)] rounded-lg p-3">
      <div className="flex items-start gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <Input
            value={local.title}
            onChange={(e) => updateText('title', e.target.value)}
            placeholder="Title (required)"
            className="!py-1.5 !text-[14px] !font-medium"
          />
        </div>
        <TagChip value={card.tag} onChange={updateTag} />
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Delete "${local.title || 'this card'}"?`))
              onDelete();
          }}
          aria-label="Delete card"
          className="shrink-0 p-1 rounded text-neutral-400 dark:text-[#66645f] hover:text-red-600 dark:hover:text-red-400 hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] transition-colors"
          title={`${TAG_LABELS[card.tag]} · delete card`}
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
        <Field label="Notes">
          <Textarea
            value={local.body}
            onChange={(e) => updateText('body', e.target.value)}
            placeholder="Free text — quirks, instructions, history"
            rows={2}
          />
        </Field>

        {subFields.length > 0 && (
          <div className="mt-1 pt-3 border-t border-neutral-100 dark:border-[rgba(255,255,255,0.05)] space-y-3">
            {subFields.map((field) => {
              const raw = tagData?.[field.key];
              const value =
                typeof raw === 'string'
                  ? raw
                  : raw != null
                    ? String(raw)
                    : '';
              return (
                <Field key={field.key} label={field.label}>
                  {field.kind === 'enum' && field.options ? (
                    <Select
                      value={value}
                      onChange={(e) =>
                        updateSubField(field.key, e.target.value)
                      }
                    >
                      <option value="">—</option>
                      {field.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </Select>
                  ) : field.multiline ? (
                    <Textarea
                      value={value}
                      onChange={(e) =>
                        updateSubField(field.key, e.target.value)
                      }
                      placeholder={field.placeholder}
                      rows={2}
                    />
                  ) : (
                    <Input
                      value={value}
                      onChange={(e) =>
                        updateSubField(field.key, e.target.value)
                      }
                      placeholder={field.placeholder}
                      type={
                        field.kind === 'date'
                          ? 'date'
                          : field.kind === 'url'
                            ? 'url'
                            : 'text'
                      }
                    />
                  )}
                </Field>
              );
            })}
          </div>
        )}

        <div className="mt-1 pt-3 border-t border-neutral-100 dark:border-[rgba(255,255,255,0.05)]">
          <PhotoGrid
            photos={card.property_card_photos ?? []}
            maxPhotos={CARD_PHOTO_CAP}
            noun="card"
            uploadUrl={`/api/properties/${propertyId}/cards/${card.id}/photos`}
            deleteUrl={(photoId) =>
              `/api/properties/${propertyId}/cards/${card.id}/photos/${photoId}`
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
