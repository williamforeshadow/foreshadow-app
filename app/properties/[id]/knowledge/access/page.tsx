'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
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

// Access tab. Singleton row in `property_access`. Explicit Save (no
// autosave) so secret-ish fields get visible confirmation. Empty strings
// are persisted as NULL. WiFi lives on the Connectivity tab now.

type AccessDraft = {
  guest_code: string;
  cleaner_code: string;
  backup_code: string;
  code_rotation_notes: string;
  outer_door_code: string;
  gate_code: string;
  elevator_notes: string;
  unit_door_code: string;
  key_location: string;
  lockbox_code: string;
  parking_spot_number: string;
  parking_type: string;
  parking_instructions: string;
};

const EMPTY_DRAFT: AccessDraft = {
  guest_code: '',
  cleaner_code: '',
  backup_code: '',
  code_rotation_notes: '',
  outer_door_code: '',
  gate_code: '',
  elevator_notes: '',
  unit_door_code: '',
  key_location: '',
  lockbox_code: '',
  parking_spot_number: '',
  parking_type: '',
  parking_instructions: '',
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
  const { toast, showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch(`/api/properties/${propertyId}/access`);
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
      const res = await apiFetch(`/api/properties/${propertyId}/access`, {
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
        <div className="max-w-[760px] px-5 sm:px-8 pt-5 sm:pt-6 pb-32">
          <section className="mb-8">
            <SectionHeader label="Access" />
            <SectionCaption>
              Codes and entry instructions — how guests, cleaners, and vendors
              get in the door.
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
