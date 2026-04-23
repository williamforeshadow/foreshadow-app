'use client';

import { useParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { LinkHostawayModal } from '@/components/properties/LinkHostawayModal';
import {
  usePropertyContext,
  type PropertyProfile,
} from '@/components/properties/PropertyContext';
import {
  Field,
  FieldGroup,
  FloatingSaveBar,
  Input,
  ReadonlyRow,
  SectionCaption,
  SectionHeader,
  Subheading,
  Toast,
  useToast,
} from '@/components/properties/form/FormPrimitives';

// Information tab: name, address, bed/bath, active-state toggle, and
// Hostaway linkage. Rendered inside the PropertyShell layout, so no
// header/back link/tab strip here — the shell owns those.

interface DraftFields {
  name: string;
  address_street: string;
  address_city: string;
  address_state: string;
  address_zip: string;
  address_country: string;
  latitude: string;
  longitude: string;
  bedrooms: string;
  bathrooms: string;
}

function toDraft(p: PropertyProfile): DraftFields {
  return {
    name: p.name ?? '',
    address_street: p.address_street ?? '',
    address_city: p.address_city ?? '',
    address_state: p.address_state ?? '',
    address_zip: p.address_zip ?? '',
    address_country: p.address_country ?? '',
    latitude: p.latitude == null ? '' : String(p.latitude),
    longitude: p.longitude == null ? '' : String(p.longitude),
    bedrooms: p.bedrooms == null ? '' : String(p.bedrooms),
    bathrooms: p.bathrooms == null ? '' : String(p.bathrooms),
  };
}

function formatDate(s?: string | null) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function PropertyInformationTab() {
  const params = useParams<{ id: string }>();
  const propertyId = params?.id as string;
  const { property, applyLocalPatch, refresh } = usePropertyContext();

  // Drafts are seeded from the context property but then diverge freely.
  // When refresh() lands with new values we re-seed on demand via Discard
  // so the user never loses unsaved work silently.
  const [draft, setDraft] = useState<DraftFields | null>(() =>
    property ? toDraft(property) : null
  );

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [locationOpen, setLocationOpen] = useState(false);
  const [togglingActive, setTogglingActive] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [linkageError, setLinkageError] = useState<string | null>(null);
  const { toast, showToast } = useToast();

  // Seed draft when property first arrives (on mount the shell gate may
  // already have resolved, but on slow connections it fires later).
  if (property && !draft) {
    setDraft(toDraft(property));
  }

  const isDirty = useMemo(() => {
    if (!property || !draft) return false;
    const current = toDraft(property);
    return (Object.keys(current) as (keyof DraftFields)[]).some(
      (k) => current[k] !== draft[k]
    );
  }, [property, draft]);

  const updateDraft = (key: keyof DraftFields, value: string) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleDiscard = () => {
    if (property) setDraft(toDraft(property));
    setSaveError(null);
  };

  const handleToggleActive = useCallback(
    async (next: boolean) => {
      if (!property || togglingActive) return;
      setTogglingActive(true);
      setStatusError(null);
      try {
        const res = await fetch(`/api/properties/${propertyId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_active: next }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update status');
        applyLocalPatch(data.property);
      } catch (err: any) {
        setStatusError(err.message || 'Failed to update status');
      } finally {
        setTogglingActive(false);
      }
    },
    [property, togglingActive, propertyId, applyLocalPatch]
  );

  const handleUnlink = useCallback(async () => {
    if (!property || unlinking) return;
    if (property.hostaway_listing_id == null) return;
    const proceed = window.confirm(
      `Unlink "${property.name}" from Hostaway (listing ${property.hostaway_listing_id})? Existing reservations and tasks stay, but Hostaway syncs will no longer update this property.`
    );
    if (!proceed) return;
    setUnlinking(true);
    setLinkageError(null);
    try {
      const res = await fetch(`/api/properties/${propertyId}/unlink`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unlink failed');
      applyLocalPatch(data.property);
      setDraft(toDraft(data.property));
      showToast('success', 'Unlinked from Hostaway');
    } catch (err: any) {
      setLinkageError(err.message || 'Unlink failed');
    } finally {
      setUnlinking(false);
    }
  }, [property, unlinking, propertyId, applyLocalPatch, showToast]);

  const handleSave = async () => {
    if (!draft || !property) return;
    setSaving(true);
    setSaveError(null);

    const original = toDraft(property);
    const patch: Record<string, unknown> = {};

    const diffString = (key: keyof DraftFields) => {
      if (draft[key] === original[key]) return;
      const trimmed = draft[key].trim();
      patch[key] = trimmed === '' ? null : trimmed;
    };
    const diffNumber = (key: keyof DraftFields, isInt: boolean) => {
      if (draft[key] === original[key]) return;
      const trimmed = draft[key].trim();
      if (trimmed === '') {
        patch[key] = null;
        return;
      }
      const n = isInt ? parseInt(trimmed, 10) : parseFloat(trimmed);
      if (Number.isNaN(n)) {
        throw new Error(`${key} must be a valid number`);
      }
      patch[key] = n;
    };

    try {
      if (draft.name.trim() === '') throw new Error('Name cannot be empty');
      if (draft.name !== original.name) patch.name = draft.name.trim();
      diffString('address_street');
      diffString('address_city');
      diffString('address_state');
      diffString('address_zip');
      diffString('address_country');
      diffNumber('latitude', false);
      diffNumber('longitude', false);
      diffNumber('bedrooms', true);
      diffNumber('bathrooms', false);
    } catch (err: any) {
      setSaveError(err.message || 'Invalid input');
      setSaving(false);
      return;
    }

    if (Object.keys(patch).length === 0) {
      setSaving(false);
      return;
    }

    try {
      const res = await fetch(`/api/properties/${propertyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      applyLocalPatch(data.property);
      setDraft(toDraft(data.property));
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (!property || !draft) {
    // The shell renders its own loading/error state; once it lets us
    // render, property should be present. The check stays as a belt-and-
    // suspenders guard for the "property arrives after mount" edge case.
    return null;
  }

  return (
    <>
      <div className="flex-1 overflow-auto">
        <div className="max-w-[760px] px-5 sm:px-8 pt-5 sm:pt-6 pb-32">
          <section className="mb-8">
            <SectionHeader label="Property Profile" />
            <SectionCaption>
              Basic details about the unit. Name is the internal "property code"
              you'll see across tasks, calendars, and reservations.
            </SectionCaption>

            <FieldGroup>
              <Field label="Internal name / property code">
                <Input
                  value={draft.name}
                  onChange={(e) => updateDraft('name', e.target.value)}
                  placeholder="e.g. Ocean View Suite"
                />
              </Field>
            </FieldGroup>

            <Subheading label="Address" />
            <FieldGroup>
              <Field label="Street">
                <Input
                  value={draft.address_street}
                  onChange={(e) => updateDraft('address_street', e.target.value)}
                  placeholder="123 Main St"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="City">
                  <Input
                    value={draft.address_city}
                    onChange={(e) => updateDraft('address_city', e.target.value)}
                    placeholder="Denver"
                  />
                </Field>
                <Field label="State / Region">
                  <Input
                    value={draft.address_state}
                    onChange={(e) => updateDraft('address_state', e.target.value)}
                    placeholder="CO"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Zip / Postal">
                  <Input
                    value={draft.address_zip}
                    onChange={(e) => updateDraft('address_zip', e.target.value)}
                    placeholder="80202"
                  />
                </Field>
                <Field label="Country">
                  <Input
                    value={draft.address_country}
                    onChange={(e) => updateDraft('address_country', e.target.value)}
                    placeholder="US"
                  />
                </Field>
              </div>
            </FieldGroup>

            <button
              onClick={() => setLocationOpen((v) => !v)}
              className="flex items-center gap-1.5 mt-5 mb-2 py-1 text-left"
            >
              <svg
                className={`w-3 h-3 text-neutral-400 dark:text-[#66645f] transition-transform ${locationOpen ? '' : '-rotate-90'}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              <span className="text-[10px] font-semibold text-neutral-600 dark:text-[#a09e9a] uppercase tracking-[0.08em]">
                Location (Advanced)
              </span>
            </button>
            {locationOpen && (
              <FieldGroup>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Latitude">
                    <Input
                      value={draft.latitude}
                      onChange={(e) => updateDraft('latitude', e.target.value)}
                      placeholder="39.7392"
                      inputMode="decimal"
                    />
                  </Field>
                  <Field label="Longitude">
                    <Input
                      value={draft.longitude}
                      onChange={(e) => updateDraft('longitude', e.target.value)}
                      placeholder="-104.9903"
                      inputMode="decimal"
                    />
                  </Field>
                </div>
                <p className="text-[11px] text-neutral-400 dark:text-[#66645f] mt-1">
                  Geocoding from the address will auto-populate these later. Manual entry supported for now.
                </p>
              </FieldGroup>
            )}

            <Subheading label="Layout" />
            <FieldGroup>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Bedrooms">
                  <Input
                    value={draft.bedrooms}
                    onChange={(e) => updateDraft('bedrooms', e.target.value)}
                    placeholder="3"
                    inputMode="numeric"
                  />
                </Field>
                <Field label="Bathrooms">
                  <Input
                    value={draft.bathrooms}
                    onChange={(e) => updateDraft('bathrooms', e.target.value)}
                    placeholder="2.5"
                    inputMode="decimal"
                  />
                </Field>
              </div>
            </FieldGroup>
          </section>

          <section className="mb-8">
            <SectionHeader label="Status" />
            <div className="flex items-start justify-between gap-4 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-neutral-800 dark:text-[#f0efed]">
                  {property.is_active ? 'Active' : 'Inactive'}
                </div>
                <p className="text-[12px] text-neutral-500 dark:text-[#66645f] mt-0.5 leading-snug">
                  {property.is_active
                    ? 'Receives Hostaway syncs, imports reservations, and generates tasks.'
                    : "Frozen — Hostaway won't update this property and no new tasks will be generated. Existing tasks stay untouched."}
                </p>
                {statusError && (
                  <p className="mt-1.5 text-[12px] text-red-600 dark:text-red-400">
                    {statusError}
                  </p>
                )}
              </div>
              <button
                onClick={() => handleToggleActive(!property.is_active)}
                disabled={togglingActive}
                role="switch"
                aria-checked={property.is_active}
                aria-label="Toggle active status"
                className={`relative inline-flex h-[24px] w-[44px] shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                  property.is_active
                    ? 'bg-emerald-500 dark:bg-emerald-500'
                    : 'bg-neutral-300 dark:bg-[#3e3d3a]'
                }`}
              >
                <span
                  className={`inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform ${
                    property.is_active ? 'translate-x-[23px]' : 'translate-x-[3px]'
                  }`}
                />
              </button>
            </div>
          </section>

          <section className="mb-8">
            <SectionHeader
              label="Hostaway"
              right={
                property.hostaway_listing_id != null ? (
                  <button
                    type="button"
                    onClick={handleUnlink}
                    disabled={unlinking}
                    className="text-[11px] font-medium text-neutral-500 dark:text-[#a09e9a] uppercase tracking-[0.04em] px-2 py-0.5 rounded hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] hover:text-neutral-700 dark:hover:text-[#f0efed] transition-colors disabled:opacity-50"
                  >
                    {unlinking ? 'Unlinking…' : 'Unlink'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowLinkModal(true)}
                    className="text-[11px] font-medium text-neutral-500 dark:text-[#a09e9a] uppercase tracking-[0.04em] px-2 py-0.5 rounded hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] hover:text-neutral-700 dark:hover:text-[#f0efed] transition-colors"
                  >
                    Link to Hostaway
                  </button>
                )
              }
            />
            {property.hostaway_listing_id != null ? (
              <FieldGroup>
                <ReadonlyRow
                  label="Listing ID"
                  value={String(property.hostaway_listing_id)}
                />
                <ReadonlyRow
                  label="Listing Name"
                  value={property.hostaway_name || '—'}
                />
                <ReadonlyRow label="Created" value={formatDate(property.created_at)} />
                <ReadonlyRow label="Updated" value={formatDate(property.updated_at)} />
              </FieldGroup>
            ) : (
              <div className="py-3 text-[13px] text-neutral-500 dark:text-[#66645f] leading-snug">
                Not linked to Hostaway. Link this property to a Hostaway
                listing to pull in its reservations and sync future updates.
              </div>
            )}
            {linkageError && (
              <p className="mt-2 text-[12px] text-red-600 dark:text-red-400">
                {linkageError}
              </p>
            )}
          </section>
        </div>
      </div>

      <FloatingSaveBar
        dirty={isDirty}
        saving={saving}
        error={saveError}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />

      {showLinkModal && property && (
        <LinkHostawayModal
          survivorId={property.id}
          survivorName={property.name}
          survivorIsInactive={!property.is_active}
          onClose={() => setShowLinkModal(false)}
          onLinked={async ({ chosen }) => {
            setShowLinkModal(false);
            showToast(
              'success',
              `Linked to Hostaway${chosen.hostaway_listing_id != null ? ` (ID ${chosen.hostaway_listing_id})` : ''}`
            );
            await refresh();
          }}
        />
      )}

      {toast && <Toast kind={toast.kind} message={toast.message} />}
    </>
  );
}
