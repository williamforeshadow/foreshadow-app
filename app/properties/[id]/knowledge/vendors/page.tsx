'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import {
  Field,
  FieldGroup,
  Input,
  SectionCaption,
  SectionHeader,
  Subheading,
  Textarea,
  Toast,
  useToast,
} from '@/components/properties/form/FormPrimitives';

// Vendors & Contacts tab — four fixed categories, each a collection of
// structured contact cards (name, role, phone, email, notes). Autosave
// per-field with a debounce; explicit Add / Delete via buttons.

type ContactCategory = 'cleaning' | 'maintenance' | 'stakeholder' | 'emergency';

interface Contact {
  id: string;
  property_id: string;
  category: ContactCategory;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface CategoryDef {
  id: ContactCategory;
  label: string;
  caption: string;
}

const CATEGORIES: CategoryDef[] = [
  {
    id: 'cleaning',
    label: 'Cleaning',
    caption: 'Turnover crews, deep-clean vendors, laundry services.',
  },
  {
    id: 'maintenance',
    label: 'Maintenance',
    caption: 'Handyman, plumber, electrician, HVAC, appliance repair.',
  },
  {
    id: 'stakeholder',
    label: 'Property Stakeholders',
    caption: 'Owner, co-host, HOA contact, leasing agent, property manager.',
  },
  {
    id: 'emergency',
    label: 'Emergency',
    caption: '24/7 or after-hours contacts. Fire, water, lockout, security.',
  },
];

export default function PropertyVendorsTab() {
  const params = useParams<{ id: string }>();
  const propertyId = params?.id as string;

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { toast, showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch(`/api/properties/${propertyId}/contacts`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load contacts');
      setContacts((data.contacts || []) as Contact[]);
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load contacts');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  const byCategory = useMemo(() => {
    const map = new Map<ContactCategory, Contact[]>();
    for (const c of CATEGORIES) map.set(c.id, []);
    for (const ct of contacts) {
      const arr = map.get(ct.category);
      if (arr) arr.push(ct);
    }
    return map;
  }, [contacts]);

  const handleCreate = useCallback(
    async (category: ContactCategory) => {
      try {
        const res = await apiFetch(`/api/properties/${propertyId}/contacts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category, name: 'New contact' }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create contact');
        setContacts((prev) => [...prev, data.contact as Contact]);
      } catch (err: any) {
        showToast('error', err.message || 'Failed to create contact');
      }
    },
    [propertyId, showToast]
  );

  const handlePatch = useCallback(
    async (
      contactId: string,
      patch: Partial<Pick<Contact, 'name' | 'role' | 'phone' | 'email' | 'notes'>>
    ) => {
      setContacts((prev) =>
        prev.map((c) => (c.id === contactId ? { ...c, ...patch } : c))
      );
      try {
        const res = await apiFetch(
          `/api/properties/${propertyId}/contacts/${contactId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');
        setContacts((prev) =>
          prev.map((c) => (c.id === contactId ? data.contact : c))
        );
      } catch (err: any) {
        showToast('error', err.message || 'Save failed');
      }
    },
    [propertyId, showToast]
  );

  const handleDelete = useCallback(
    async (contactId: string) => {
      const prev = contacts;
      setContacts((p) => p.filter((c) => c.id !== contactId));
      try {
        const res = await apiFetch(
          `/api/properties/${propertyId}/contacts/${contactId}`,
          { method: 'DELETE' }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Delete failed');
        }
      } catch (err: any) {
        setContacts(prev);
        showToast('error', err.message || 'Delete failed');
      }
    },
    [contacts, propertyId, showToast]
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
        <div className="max-w-[760px] px-5 sm:px-8 pt-5 sm:pt-6 pb-32">
          <section className="mb-8">
            <SectionHeader label="Vendors & Contacts" />
            <SectionCaption>
              People you call for this property — cleaners, repair pros, the
              owner, after-hours emergencies.
            </SectionCaption>
          </section>

          {CATEGORIES.map((cat) => {
            const items = byCategory.get(cat.id) ?? [];
            return (
              <section key={cat.id} className="mb-8">
                <div className="flex items-center justify-between mt-5 mb-2">
                  <h3 className="text-[10px] font-semibold text-neutral-500 dark:text-[#66645f] uppercase tracking-[0.08em]">
                    {cat.label}
                  </h3>
                  <button
                    type="button"
                    onClick={() => handleCreate(cat.id)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500 dark:text-[#a09e9a] hover:text-[var(--accent-3)] dark:hover:text-[var(--accent-1)] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] rounded transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    Add contact
                  </button>
                </div>
                <p className="text-[12px] text-neutral-500 dark:text-[#66645f] leading-snug mb-3">
                  {cat.caption}
                </p>
                {items.length === 0 ? (
                  <div className="py-4 px-3 text-[12px] text-neutral-400 dark:text-[#66645f] border border-dashed border-neutral-200 dark:border-[rgba(255,255,255,0.07)] rounded-md">
                    No contacts yet.
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {items.map((c) => (
                      <ContactCard
                        key={c.id}
                        contact={c}
                        onPatch={(patch) => handlePatch(c.id, patch)}
                        onDelete={() => handleDelete(c.id)}
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

// --- ContactCard ---
//
// Each contact is an inline editable card. Fields autosave with a
// debounce. Name is required server-side; we guard here so an empty
// name doesn't trigger a 400 until the user fills it.

function ContactCard({
  contact,
  onPatch,
  onDelete,
}: {
  contact: Contact;
  onPatch: (
    patch: Partial<Pick<Contact, 'name' | 'role' | 'phone' | 'email' | 'notes'>>
  ) => void;
  onDelete: () => void;
}) {
  const [local, setLocal] = useState({
    name: contact.name ?? '',
    role: contact.role ?? '',
    phone: contact.phone ?? '',
    email: contact.email ?? '',
    notes: contact.notes ?? '',
  });
  const [savedState, setSavedState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocal({
      name: contact.name ?? '',
      role: contact.role ?? '',
      phone: contact.phone ?? '',
      email: contact.email ?? '',
      notes: contact.notes ?? '',
    });
  }, [contact.id, contact.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleSave = useCallback(
    (next: typeof local) => {
      if (next.name.trim() === '') {
        // Hold off — server requires name.
        setSavedState('idle');
        if (saveTimer.current) clearTimeout(saveTimer.current);
        return;
      }
      setSavedState('saving');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        onPatch({
          name: next.name,
          role: next.role,
          phone: next.phone,
          email: next.email,
          notes: next.notes,
        });
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

  const update = (key: keyof typeof local, value: string) => {
    const next = { ...local, [key]: value };
    setLocal(next);
    scheduleSave(next);
  };

  return (
    <div className="border border-neutral-200/80 dark:border-[rgba(255,255,255,0.07)] rounded-lg p-3">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <Input
            value={local.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="Name (required)"
            className="!py-1.5 !text-[13px] !font-medium"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Delete ${local.name || 'this contact'}?`)) onDelete();
          }}
          aria-label="Delete contact"
          className="shrink-0 p-1 rounded text-neutral-400 dark:text-[#66645f] hover:text-red-600 dark:hover:text-red-400 hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M10 7V4a1 1 0 011-1h2a1 1 0 011 1v3" />
          </svg>
        </button>
      </div>

      <FieldGroup>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Role">
            <Input
              value={local.role}
              onChange={(e) => update('role', e.target.value)}
              placeholder="e.g. Lead cleaner"
            />
          </Field>
          <Field label="Phone">
            <Input
              value={local.phone}
              onChange={(e) => update('phone', e.target.value)}
              placeholder="+1 555 123 4567"
              type="tel"
            />
          </Field>
        </div>
        <Field label="Email">
          <Input
            value={local.email}
            onChange={(e) => update('email', e.target.value)}
            placeholder="name@domain.com"
            type="email"
          />
        </Field>
        <Field label="Notes">
          <Textarea
            value={local.notes}
            onChange={(e) => update('notes', e.target.value)}
            placeholder="Anything useful — availability, rates, quirks"
            rows={2}
          />
        </Field>
      </FieldGroup>

      <div className="mt-1.5 h-4 text-[10px] font-medium text-neutral-400 dark:text-[#66645f] uppercase tracking-[0.04em]">
        {savedState === 'saving' && 'Saving…'}
        {savedState === 'saved' && (
          <span className="text-[var(--accent-2)] dark:text-[var(--accent-1)]">Saved</span>
        )}
      </div>
    </div>
  );
}
