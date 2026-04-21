'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Field,
  FieldGroup,
  FloatingSaveBar,
  Input,
  SectionCaption,
  SectionHeader,
  Select,
  Subheading,
  Textarea,
  Toast,
  useToast,
} from '@/components/properties/form/FormPrimitives';

// Access & Connectivity tab.
//
// Singleton-style: one row per property in `property_access`. Explicit
// Save semantics (we kept autosave off for secrets-ish fields so users
// get visible confirmation). Empty strings are persisted as NULL.

type AccessDraft = {
  guest_code: string;
  cleaner_code: string;
  backup_code: string;
  code_rotation_notes: string;
  outer_door_code: string;
  gate_code: string;
  elevator_notes: string;
  parking_entry_instructions: string;
  unit_door_code: string;
  key_location: string;
  lockbox_code: string;
  wifi_ssid: string;
  wifi_password: string;
  wifi_router_location: string;
  parking_spot_number: string;
  parking_type: string;
  parking_instructions: string;
  parking_owner_vs_guest_notes: string;
};

const EMPTY_DRAFT: AccessDraft = {
  guest_code: '',
  cleaner_code: '',
  backup_code: '',
  code_rotation_notes: '',
  outer_door_code: '',
  gate_code: '',
  elevator_notes: '',
  parking_entry_instructions: '',
  unit_door_code: '',
  key_location: '',
  lockbox_code: '',
  wifi_ssid: '',
  wifi_password: '',
  wifi_router_location: '',
  parking_spot_number: '',
  parking_type: '',
  parking_instructions: '',
  parking_owner_vs_guest_notes: '',
};

function fromServer(row: any | null | undefined): AccessDraft {
  if (!row) return { ...EMPTY_DRAFT };
  const d: AccessDraft = { ...EMPTY_DRAFT };
  (Object.keys(EMPTY_DRAFT) as (keyof AccessDraft)[]).forEach((k) => {
    d[k] = row[k] ?? '';
  });
  return d;
}

export default function PropertyAccessTab() {
  const params = useParams<{ id: string }>();
  const propertyId = params?.id as string;

  const [baseline, setBaseline] = useState<AccessDraft | null>(null);
  const [draft, setDraft] = useState<AccessDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showWifiPwd, setShowWifiPwd] = useState(false);
  const { toast, showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/properties/${propertyId}/access`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load access details');
      const d = fromServer(data.access);
      setBaseline(d);
      setDraft(d);
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load access details');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  const isDirty = useMemo(() => {
    if (!baseline || !draft) return false;
    return (Object.keys(baseline) as (keyof AccessDraft)[]).some(
      (k) => baseline[k] !== draft[k]
    );
  }, [baseline, draft]);

  const update = (key: keyof AccessDraft, value: string) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleDiscard = () => {
    if (baseline) setDraft(baseline);
    setSaveError(null);
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/properties/${propertyId}/access`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      const d = fromServer(data.access);
      setBaseline(d);
      setDraft(d);
      showToast('success', 'Access details saved');
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-neutral-400 dark:border-[#66645f] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (loadError || !draft) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center">
        <p className="text-neutral-500 dark:text-[#a09e9a] text-sm">
          {loadError || 'Access details not available'}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 overflow-auto">
        <div className="max-w-[760px] mx-auto px-5 sm:px-8 pt-5 sm:pt-6 pb-32">
          <section className="mb-8">
            <SectionHeader label="Access & Connectivity" />
            <SectionCaption>
              Codes, passwords, and anything needed to get in and get connected.
            </SectionCaption>
          </section>

          <section className="mb-8">
            <Subheading label="Smart Locks" />
            <FieldGroup>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Guest code">
                  <Input
                    value={draft.guest_code}
                    onChange={(e) => update('guest_code', e.target.value)}
                    placeholder="4–8 digits"
                    autoComplete="off"
                  />
                </Field>
                <Field label="Cleaner code">
                  <Input
                    value={draft.cleaner_code}
                    onChange={(e) => update('cleaner_code', e.target.value)}
                    placeholder="4–8 digits"
                    autoComplete="off"
                  />
                </Field>
                <Field label="Backup code">
                  <Input
                    value={draft.backup_code}
                    onChange={(e) => update('backup_code', e.target.value)}
                    placeholder="Emergency / admin"
                    autoComplete="off"
                  />
                </Field>
              </div>
              <Field
                label="Rotation schedule"
                hint="When / how codes rotate, e.g. 'Guest code changes every booking', 'Cleaner code rotates monthly'."
              >
                <Textarea
                  value={draft.code_rotation_notes}
                  onChange={(e) => update('code_rotation_notes', e.target.value)}
                  placeholder="Free text"
                  rows={2}
                />
              </Field>
            </FieldGroup>
          </section>

          <section className="mb-8">
            <Subheading label="Building Access" />
            <FieldGroup>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Outer door code">
                  <Input
                    value={draft.outer_door_code}
                    onChange={(e) => update('outer_door_code', e.target.value)}
                    placeholder="Lobby / main door"
                    autoComplete="off"
                  />
                </Field>
                <Field label="Gate code">
                  <Input
                    value={draft.gate_code}
                    onChange={(e) => update('gate_code', e.target.value)}
                    placeholder="Community / parking gate"
                    autoComplete="off"
                  />
                </Field>
              </div>
              <Field label="Elevator notes">
                <Textarea
                  value={draft.elevator_notes}
                  onChange={(e) => update('elevator_notes', e.target.value)}
                  placeholder="Key fob required, floor button behavior, etc."
                  rows={2}
                />
              </Field>
              <Field label="Parking entry instructions">
                <Textarea
                  value={draft.parking_entry_instructions}
                  onChange={(e) =>
                    update('parking_entry_instructions', e.target.value)
                  }
                  placeholder="How to get into the garage/lot"
                  rows={2}
                />
              </Field>
            </FieldGroup>
          </section>

          <section className="mb-8">
            <Subheading label="Unit Access" />
            <FieldGroup>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Unit door code">
                  <Input
                    value={draft.unit_door_code}
                    onChange={(e) => update('unit_door_code', e.target.value)}
                    placeholder="Primary smart lock"
                    autoComplete="off"
                  />
                </Field>
                <Field label="Lockbox code">
                  <Input
                    value={draft.lockbox_code}
                    onChange={(e) => update('lockbox_code', e.target.value)}
                    placeholder="Physical key lockbox"
                    autoComplete="off"
                  />
                </Field>
              </div>
              <Field
                label="Key location"
                hint="Where the physical key lives — lockbox, concierge, hidden spot."
              >
                <Input
                  value={draft.key_location}
                  onChange={(e) => update('key_location', e.target.value)}
                  placeholder="e.g. Lockbox on left railing"
                />
              </Field>
            </FieldGroup>
          </section>

          <section className="mb-8">
            <Subheading label="WiFi" />
            <FieldGroup>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="SSID">
                  <Input
                    value={draft.wifi_ssid}
                    onChange={(e) => update('wifi_ssid', e.target.value)}
                    placeholder="Network name"
                    autoComplete="off"
                  />
                </Field>
                <Field label="Password">
                  <div className="relative">
                    <Input
                      value={draft.wifi_password}
                      onChange={(e) => update('wifi_password', e.target.value)}
                      placeholder="WiFi password"
                      type={showWifiPwd ? 'text' : 'password'}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowWifiPwd((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-neutral-500 dark:text-[#66645f] hover:text-neutral-800 dark:hover:text-[#f0efed] transition-colors"
                      tabIndex={-1}
                    >
                      {showWifiPwd ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </Field>
              </div>
              <Field label="Router location">
                <Input
                  value={draft.wifi_router_location}
                  onChange={(e) => update('wifi_router_location', e.target.value)}
                  placeholder="Hallway closet, kitchen cabinet, etc."
                />
              </Field>
            </FieldGroup>
          </section>

          <section className="mb-8">
            <Subheading label="Parking" />
            <FieldGroup>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Spot number">
                  <Input
                    value={draft.parking_spot_number}
                    onChange={(e) => update('parking_spot_number', e.target.value)}
                    placeholder="e.g. G-14"
                  />
                </Field>
                <Field label="Type">
                  <Select
                    value={draft.parking_type}
                    onChange={(e) => update('parking_type', e.target.value)}
                  >
                    <option value="">—</option>
                    <option value="assigned">Assigned</option>
                    <option value="street">Street</option>
                    <option value="garage">Garage</option>
                    <option value="other">Other</option>
                  </Select>
                </Field>
              </div>
              <Field label="Instructions">
                <Textarea
                  value={draft.parking_instructions}
                  onChange={(e) => update('parking_instructions', e.target.value)}
                  placeholder="How to use the spot, permits required, etc."
                  rows={2}
                />
              </Field>
              <Field
                label="Guest vs. owner spot notes"
                hint="Which spots are for guests, which are owner-only, overflow options."
              >
                <Textarea
                  value={draft.parking_owner_vs_guest_notes}
                  onChange={(e) =>
                    update('parking_owner_vs_guest_notes', e.target.value)
                  }
                  placeholder="Free text"
                  rows={2}
                />
              </Field>
            </FieldGroup>
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

      {toast && <Toast kind={toast.kind} message={toast.message} />}
    </>
  );
}
