'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface PropertyProfile {
  id: string;
  name: string;
  hostaway_name: string | null;
  hostaway_listing_id: number | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  address_country: string | null;
  latitude: number | null;
  longitude: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  created_at: string;
  updated_at: string;
}

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

export default function PropertyProfilePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const propertyId = params?.id as string;

  const [property, setProperty] = useState<PropertyProfile | null>(null);
  const [draft, setDraft] = useState<DraftFields | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [locationOpen, setLocationOpen] = useState(false);

  // Fetch
  const fetchProperty = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/properties/${propertyId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch property');
      setProperty(data.property);
      setDraft(toDraft(data.property));
    } catch (err: any) {
      setError(err.message || 'Failed to fetch property');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    if (propertyId) fetchProperty();
  }, [propertyId, fetchProperty]);

  // Dirty detection
  const isDirty = useMemo(() => {
    if (!property || !draft) return false;
    const current = toDraft(property);
    return (Object.keys(current) as (keyof DraftFields)[]).some((k) => current[k] !== draft[k]);
  }, [property, draft]);

  const updateDraft = (key: keyof DraftFields, value: string) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleDiscard = () => {
    if (property) setDraft(toDraft(property));
    setSaveError(null);
  };

  const handleSave = async () => {
    if (!draft || !property) return;
    setSaving(true);
    setSaveError(null);

    // Build PATCH body: only include changed fields; cast numerics.
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
      // Name is special — validated server-side too, but surface early
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
      setProperty(data.property);
      setDraft(toDraft(data.property));
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-7 h-7 border-2 border-neutral-400 dark:border-[#66645f] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !property || !draft) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center">
        <p className="text-neutral-500 dark:text-[#a09e9a] text-sm mb-4">
          {error || 'Property not found'}
        </p>
        <button
          onClick={() => router.push('/properties')}
          className="text-[13px] text-neutral-700 dark:text-[#f0efed] underline"
        >
          ← Back to Properties
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-[760px] mx-auto px-5 sm:px-8 pt-4 sm:pt-6 pb-32">
          {/* Back link — hidden on mobile (the shell's top-bar back arrow handles this). */}
          <Link
            href="/properties"
            className="hidden sm:inline-flex items-center gap-1.5 text-[12px] text-neutral-500 dark:text-[#66645f] hover:text-neutral-800 dark:hover:text-[#f0efed] uppercase tracking-[0.04em] font-medium mb-4 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            All Properties
          </Link>

          {/* Header: property name as h1 and hostaway ID */}
          <div className="mb-6">
            <h1 className="text-[24px] sm:text-[28px] font-semibold tracking-tight text-neutral-900 dark:text-[#f0efed] leading-tight">
              {property.name}
            </h1>
            <div className="flex items-center gap-3 mt-1.5 text-[11px] text-neutral-500 dark:text-[#66645f] uppercase tracking-[0.04em] font-medium">
              {property.hostaway_listing_id != null ? (
                <>
                  <span className="tabular-nums">Hostaway ID · {property.hostaway_listing_id}</span>
                  {property.hostaway_name && property.hostaway_name !== property.name && (
                    <>
                      <span className="w-[3px] h-[3px] rounded-full bg-neutral-300 dark:bg-[#3e3d3a]" />
                      <span className="normal-case tracking-normal text-neutral-500 dark:text-[#66645f]">
                        Hostaway: {property.hostaway_name}
                      </span>
                    </>
                  )}
                </>
              ) : (
                <span>Not linked to Hostaway</span>
              )}
            </div>
          </div>

          {/* Property Profile */}
          <section className="mb-8">
            <SectionHeader label="Property Profile" />

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

            {/* Location (collapsed by default — lat/lng is rarely typed manually) */}
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

          {/* Hostaway (readonly) */}
          <section className="mb-8">
            <SectionHeader label="Hostaway" />
            <FieldGroup>
              <ReadonlyRow
                label="Listing ID"
                value={property.hostaway_listing_id != null ? String(property.hostaway_listing_id) : '—'}
              />
              <ReadonlyRow
                label="Listing Name"
                value={property.hostaway_name || '—'}
              />
              <ReadonlyRow label="Created" value={formatDate(property.created_at)} />
              <ReadonlyRow label="Updated" value={formatDate(property.updated_at)} />
            </FieldGroup>
            <p className="text-[11px] text-neutral-400 dark:text-[#66645f] mt-2">
              Hostaway fields are read-only. Linking / unlinking will be editable in Phase 2.3.
            </p>
          </section>
        </div>
      </div>

      {/* Floating save bar */}
      {isDirty && (
        <div className="flex-shrink-0 border-t border-neutral-200/60 dark:border-[rgba(255,255,255,0.07)] bg-white/95 dark:bg-[#0b0b0c]/95 backdrop-blur-sm">
          <div className="max-w-[760px] mx-auto px-5 sm:px-8 py-3 flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1 text-[13px]">
              {saveError ? (
                <span className="text-red-600 dark:text-red-400">{saveError}</span>
              ) : (
                <span className="text-neutral-600 dark:text-[#a09e9a]">Unsaved changes</span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleDiscard}
                disabled={saving}
                className="px-3 py-1.5 text-[13px] font-medium text-neutral-700 dark:text-[#a09e9a] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] rounded-md transition-colors disabled:opacity-50"
              >
                Discard
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-1.5 text-[13px] font-medium bg-neutral-900 dark:bg-[#f0efed] text-white dark:text-[#0b0b0c] rounded-md hover:bg-neutral-800 dark:hover:bg-white transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Small reusable building blocks (local to this page) ---

function SectionHeader({ label }: { label: string }) {
  return (
    <h2 className="text-[11px] font-semibold text-neutral-600 dark:text-[#a09e9a] uppercase tracking-[0.08em] mb-3">
      {label}
    </h2>
  );
}

function Subheading({ label }: { label: string }) {
  return (
    <h3 className="text-[10px] font-semibold text-neutral-500 dark:text-[#66645f] uppercase tracking-[0.08em] mt-5 mb-2">
      {label}
    </h3>
  );
}

function FieldGroup({ children }: { children: React.ReactNode }) {
  return <div className="space-y-3">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-neutral-500 dark:text-[#66645f] uppercase tracking-[0.04em] mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full px-3 py-2 text-[14px] bg-white dark:bg-[rgba(255,255,255,0.02)] text-neutral-900 dark:text-[#f0efed] placeholder:text-neutral-400 dark:placeholder:text-[#66645f] border border-neutral-200 dark:border-[rgba(255,255,255,0.07)] rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-[rgba(255,255,255,0.15)] focus:border-transparent transition-colors"
    />
  );
}

function ReadonlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-neutral-100 dark:border-[rgba(255,255,255,0.05)] last:border-b-0">
      <span className="text-[11px] font-medium text-neutral-500 dark:text-[#66645f] uppercase tracking-[0.04em]">
        {label}
      </span>
      <span className="text-[13px] text-neutral-800 dark:text-[#f0efed] tabular-nums">
        {value}
      </span>
    </div>
  );
}
