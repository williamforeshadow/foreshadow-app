'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import {
  Field,
  FieldGroup,
  FloatingSaveBar,
  Input,
  Subheading,
  Toast,
  useToast,
} from '@/components/properties/form/FormPrimitives';

// Singleton WiFi block. Same explicit-save shape as the Access tab —
// one row in property_connectivity per property, edited as a whole,
// persisted on a user-triggered Save.

type WifiDraft = {
  wifi_ssid: string;
  wifi_password: string;
  wifi_router_location: string;
};

const EMPTY_DRAFT: WifiDraft = {
  wifi_ssid: '',
  wifi_password: '',
  wifi_router_location: '',
};

function fromServer(row: any | null | undefined): WifiDraft {
  if (!row) return { ...EMPTY_DRAFT };
  const d: WifiDraft = { ...EMPTY_DRAFT };
  (Object.keys(EMPTY_DRAFT) as (keyof WifiDraft)[]).forEach((k) => {
    d[k] = row[k] ?? '';
  });
  return d;
}

export function WifiSection({ propertyId }: { propertyId: string }) {
  const [baseline, setBaseline] = useState<WifiDraft | null>(null);
  const [draft, setDraft] = useState<WifiDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showPwd, setShowPwd] = useState(false);
  const { toast, showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch(`/api/properties/${propertyId}/connectivity`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load WiFi');
      const d = fromServer(data.connectivity);
      setBaseline(d);
      setDraft(d);
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load WiFi');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  const isDirty = useMemo(() => {
    if (!baseline || !draft) return false;
    return (Object.keys(baseline) as (keyof WifiDraft)[]).some(
      (k) => baseline[k] !== draft[k]
    );
  }, [baseline, draft]);

  const update = (key: keyof WifiDraft, value: string) => {
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
      const res = await apiFetch(`/api/properties/${propertyId}/connectivity`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      const d = fromServer(data.connectivity);
      setBaseline(d);
      setDraft(d);
      showToast('success', 'WiFi saved');
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="py-8 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-neutral-400 dark:border-[#66645f] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (loadError || !draft) {
    return (
      <div className="py-6 text-center text-[13px] text-neutral-500 dark:text-[#a09e9a]">
        {loadError || 'WiFi details not available'}
      </div>
    );
  }

  return (
    <section>
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
                type={showPwd ? 'text' : 'password'}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-neutral-500 dark:text-[#66645f] hover:text-neutral-800 dark:hover:text-[#f0efed] transition-colors"
                tabIndex={-1}
              >
                {showPwd ? 'Hide' : 'Show'}
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

      <FloatingSaveBar
        dirty={isDirty}
        saving={saving}
        error={saveError}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />

      {toast && <Toast kind={toast.kind} message={toast.message} />}
    </section>
  );
}
