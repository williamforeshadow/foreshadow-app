'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CATEGORY_LABELS,
  CATEGORY_SUB_FIELDS,
  type CardCategory,
  type CardScope,
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
import { CardPhotos } from './CardPhotos';

// Unified "tagged cards" surface shared by both the Interior and Exterior
// tabs. The parent passes scope + default group labels + copy; everything
// else (CRUD, grouping, inline editing, photos) is handled here.

export interface PropertyCard {
  id: string;
  property_id: string;
  scope: CardScope;
  group_label: string;
  category: CardCategory;
  title: string;
  location: string | null;
  body: string | null;
  category_data: Record<string, unknown> | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  property_card_photos?: Array<{
    id: string;
    storage_path: string;
    caption: string | null;
    sort_order: number;
  }>;
}

interface CardsBoardProps {
  propertyId: string;
  scope: CardScope;
  sectionLabel: string;
  sectionCaption: string;
  defaultGroups: string[];
}

export function CardsBoard({
  propertyId,
  scope,
  sectionLabel,
  sectionCaption,
  defaultGroups,
}: CardsBoardProps) {
  const [cards, setCards] = useState<PropertyCard[]>([]);
  const [customGroups, setCustomGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { toast, showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `/api/properties/${propertyId}/cards?scope=${scope}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load cards');
      setCards((data.cards || []) as PropertyCard[]);
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load cards');
    } finally {
      setLoading(false);
    }
  }, [propertyId, scope]);

  useEffect(() => {
    load();
  }, [load]);

  // Combine default groups with any custom groups the user has created
  // plus any groups that exist in saved cards (covers legacy data / hot
  // migration). De-dupes while preserving insertion order.
  const groupLabels = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const g of [...defaultGroups, ...customGroups]) {
      if (!seen.has(g)) {
        seen.add(g);
        out.push(g);
      }
    }
    for (const c of cards) {
      if (!seen.has(c.group_label)) {
        seen.add(c.group_label);
        out.push(c.group_label);
      }
    }
    return out;
  }, [defaultGroups, customGroups, cards]);

  const cardsByGroup = useMemo(() => {
    const map = new Map<string, PropertyCard[]>();
    for (const g of groupLabels) map.set(g, []);
    for (const c of cards) {
      const arr = map.get(c.group_label) ?? [];
      arr.push(c);
      map.set(c.group_label, arr);
    }
    return map;
  }, [cards, groupLabels]);

  const handleCreate = useCallback(
    async (groupLabel: string) => {
      try {
        const res = await fetch(`/api/properties/${propertyId}/cards`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scope,
            group_label: groupLabel,
            category: 'other',
            title: 'New item',
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create card');
        setCards((prev) => [...prev, data.card as PropertyCard]);
      } catch (err: any) {
        showToast('error', err.message || 'Failed to create card');
      }
    },
    [propertyId, scope, showToast]
  );

  const handlePatch = useCallback(
    async (
      cardId: string,
      patch: Partial<
        Pick<
          PropertyCard,
          'title' | 'location' | 'body' | 'group_label' | 'category' | 'category_data'
        >
      >
    ) => {
      setCards((prev) =>
        prev.map((c) => (c.id === cardId ? { ...c, ...patch } : c))
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
        setCards((prev) =>
          prev.map((c) => (c.id === cardId ? (data.card as PropertyCard) : c))
        );
      } catch (err: any) {
        showToast('error', err.message || 'Save failed');
      }
    },
    [propertyId, showToast]
  );

  const handleDelete = useCallback(
    async (cardId: string) => {
      const prev = cards;
      setCards((p) => p.filter((c) => c.id !== cardId));
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
        setCards(prev);
        showToast('error', err.message || 'Delete failed');
      }
    },
    [cards, propertyId, showToast]
  );

  const handleAddGroup = () => {
    const raw = window.prompt(
      scope === 'interior'
        ? 'Name for new room group (e.g. "Laundry Room")'
        : 'Name for new group (e.g. "Pool Deck")'
    );
    const trimmed = raw?.trim();
    if (!trimmed) return;
    if (groupLabels.includes(trimmed)) {
      showToast('error', 'That group already exists.');
      return;
    }
    setCustomGroups((prev) => [...prev, trimmed]);
  };

  const handlePhotosChange = useCallback(
    (
      cardId: string,
      photos: NonNullable<PropertyCard['property_card_photos']>
    ) => {
      setCards((prev) =>
        prev.map((c) =>
          c.id === cardId ? { ...c, property_card_photos: photos } : c
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
                <button
                  type="button"
                  onClick={handleAddGroup}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500 dark:text-[#a09e9a] hover:text-neutral-800 dark:hover:text-[#f0efed] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] rounded transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Add group
                </button>
              }
            />
            <SectionCaption>{sectionCaption}</SectionCaption>
          </section>

          {groupLabels.map((group) => {
            const items = cardsByGroup.get(group) ?? [];
            return (
              <section key={group} className="mb-8">
                <div className="flex items-center justify-between mt-5 mb-3">
                  <h3 className="text-[11px] font-semibold text-neutral-700 dark:text-[#a09e9a] uppercase tracking-[0.08em]">
                    {group}
                  </h3>
                  <button
                    type="button"
                    onClick={() => handleCreate(group)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500 dark:text-[#a09e9a] hover:text-neutral-800 dark:hover:text-[#f0efed] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] rounded transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    Add card
                  </button>
                </div>
                {items.length === 0 ? (
                  <div className="py-4 px-3 text-[12px] text-neutral-400 dark:text-[#66645f] border border-dashed border-neutral-200 dark:border-[rgba(255,255,255,0.07)] rounded-md">
                    No cards in this group yet.
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {items.map((c) => (
                      <CardEditor
                        key={c.id}
                        card={c}
                        allGroups={groupLabels}
                        onPatch={(patch) => handlePatch(c.id, patch)}
                        onDelete={() => handleDelete(c.id)}
                        onPhotosChange={(photos) =>
                          handlePhotosChange(c.id, photos)
                        }
                        propertyId={propertyId}
                        onPhotoError={(msg) => showToast('error', msg)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>

      {toast && <Toast kind={toast.kind} message={toast.message} />}
    </>
  );
}

// --- CardEditor ---

interface CardEditorProps {
  card: PropertyCard;
  allGroups: string[];
  propertyId: string;
  onPatch: (
    patch: Partial<
      Pick<
        PropertyCard,
        'title' | 'location' | 'body' | 'group_label' | 'category' | 'category_data'
      >
    >
  ) => void;
  onDelete: () => void;
  onPhotosChange: (
    photos: NonNullable<PropertyCard['property_card_photos']>
  ) => void;
  onPhotoError: (msg: string) => void;
}

function CardEditor({
  card,
  allGroups,
  propertyId,
  onPatch,
  onDelete,
  onPhotosChange,
  onPhotoError,
}: CardEditorProps) {
  // Local buffer for debounced text inputs. Structural changes (category,
  // group) save immediately since they're selects.
  const [local, setLocal] = useState({
    title: card.title ?? '',
    location: card.location ?? '',
    body: card.body ?? '',
  });
  const [categoryData, setCategoryData] = useState<Record<string, unknown>>(
    card.category_data ?? {}
  );
  const [savedState, setSavedState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocal({
      title: card.title ?? '',
      location: card.location ?? '',
      body: card.body ?? '',
    });
    setCategoryData(card.category_data ?? {});
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
      // Hold off save — title is required.
      setSavedState('idle');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      return;
    }
    scheduleSave({ [key]: value } as any);
  };

  const updateCategory = (category: CardCategory) => {
    // When category changes we preserve whatever fields in category_data
    // are still valid for the new category; the server drops the rest.
    onPatch({ category });
  };

  const updateGroup = (group: string) => {
    onPatch({ group_label: group });
  };

  const updateSubField = (key: string, value: string) => {
    const next = { ...categoryData, [key]: value };
    setCategoryData(next);
    scheduleSave({ category_data: next });
  };

  const subFields = CATEGORY_SUB_FIELDS[card.category] ?? [];

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
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Delete "${local.title || 'this card'}"?`)) onDelete();
          }}
          aria-label="Delete card"
          className="shrink-0 p-1 rounded text-neutral-400 dark:text-[#66645f] hover:text-red-600 dark:hover:text-red-400 hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M10 7V4a1 1 0 011-1h2a1 1 0 011 1v3" />
          </svg>
        </button>
      </div>

      <FieldGroup>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <Select
              value={card.category}
              onChange={(e) => updateCategory(e.target.value as CardCategory)}
            >
              {(Object.keys(CATEGORY_LABELS) as CardCategory[]).map((cat) => (
                <option key={cat} value={cat}>
                  {CATEGORY_LABELS[cat]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Group">
            <Select
              value={card.group_label}
              onChange={(e) => updateGroup(e.target.value)}
            >
              {allGroups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
              {!allGroups.includes(card.group_label) && (
                <option value={card.group_label}>{card.group_label}</option>
              )}
            </Select>
          </Field>
        </div>

        <Field label="Location">
          <Input
            value={local.location}
            onChange={(e) => updateText('location', e.target.value)}
            placeholder="e.g. Under kitchen sink, Garage south wall"
          />
        </Field>

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
              const raw = categoryData?.[field.key];
              const value = typeof raw === 'string' ? raw : raw != null ? String(raw) : '';
              return (
                <Field key={field.key} label={field.label}>
                  {field.kind === 'enum' && field.options ? (
                    <Select
                      value={value}
                      onChange={(e) => updateSubField(field.key, e.target.value)}
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
                      onChange={(e) => updateSubField(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      rows={2}
                    />
                  ) : (
                    <Input
                      value={value}
                      onChange={(e) => updateSubField(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      type={field.kind === 'date' ? 'date' : field.kind === 'url' ? 'url' : 'text'}
                    />
                  )}
                </Field>
              );
            })}
          </div>
        )}

        <CardPhotos
          propertyId={propertyId}
          cardId={card.id}
          photos={card.property_card_photos ?? []}
          onPhotosChange={onPhotosChange}
          onError={onPhotoError}
        />
      </FieldGroup>

      <div className="mt-1.5 h-4 text-[10px] font-medium text-neutral-400 dark:text-[#66645f] uppercase tracking-[0.04em]">
        {savedState === 'saving' && 'Saving…'}
        {savedState === 'saved' && 'Saved'}
      </div>
    </div>
  );
}
