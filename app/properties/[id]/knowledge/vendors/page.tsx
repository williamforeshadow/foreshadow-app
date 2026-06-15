'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import {
  CONTACT_TAGS,
  CONTACT_TAG_LABELS,
  CONTACT_TAG_CHIP_CLASSES,
  normalizeContactTags,
  type ContactTag,
} from '@/lib/propertyAttributes';
import {
  Field,
  FieldGroup,
  Input,
  SectionCaption,
  SectionHeader,
  Textarea,
  Toast,
  useToast,
} from '@/components/properties/form/FormPrimitives';

// Vendors & Contacts tab — a flat list of contacts, each with multi-select
// tags, schedule, and (for owner contacts) a preferences field. A tag-filter
// row narrows the list. Autosave per-field with a debounce.

interface Contact {
  id: string;
  property_id: string;
  tags: ContactTag[];
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  schedule: string | null;
  preferences: string | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

type ContactPatch = Partial<
  Pick<Contact, 'name' | 'role' | 'phone' | 'email' | 'schedule' | 'preferences' | 'notes' | 'tags'>
>;

export default function PropertyVendorsTab() {
  const params = useParams<{ id: string }>();
  const propertyId = params?.id as string;

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ContactTag | 'all'>('all');
  const { toast, showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch(`/api/properties/${propertyId}/contacts`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load contacts');
      setContacts(
        ((data.contacts || []) as Contact[]).map((c) => ({
          ...c,
          tags: normalizeContactTags(c.tags),
        })),
      );
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load contacts');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(
    () => (filter === 'all' ? contacts : contacts.filter((c) => c.tags.includes(filter))),
    [contacts, filter],
  );

  const handleCreate = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/properties/${propertyId}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New contact',
          tags: filter === 'all' ? [] : [filter],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create contact');
      setContacts((prev) => [
        ...prev,
        { ...(data.contact as Contact), tags: normalizeContactTags(data.contact.tags) },
      ]);
    } catch (err: any) {
      showToast('error', err.message || 'Failed to create contact');
    }
  }, [propertyId, filter, showToast]);

  const handlePatch = useCallback(
    async (contactId: string, patch: ContactPatch) => {
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
          prev.map((c) =>
            c.id === contactId
              ? { ...(data.contact as Contact), tags: normalizeContactTags(data.contact.tags) }
              : c
          )
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
          <section className="mb-5">
            <SectionHeader
              label="Vendors & Contacts"
              right={
                <button
                  type="button"
                  onClick={handleCreate}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500 dark:text-[#a09e9a] hover:text-[var(--accent-3)] dark:hover:text-[var(--accent-1)] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] rounded transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Add contact
                </button>
              }
            />
            <SectionCaption>
              People you call for this property — cleaners, repair pros, contractors,
              owners, after-hours emergencies. Tag each contact; owners get a
              preferences field.
            </SectionCaption>
          </section>

          {/* Tag filter row */}
          <div className="flex flex-wrap items-center gap-1.5 mb-5">
            <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
              All
            </FilterChip>
            {CONTACT_TAGS.map((t) => (
              <FilterChip key={t} active={filter === t} onClick={() => setFilter(t)}>
                {CONTACT_TAG_LABELS[t]}
              </FilterChip>
            ))}
          </div>

          {visible.length === 0 ? (
            <div className="py-6 px-3 text-[12px] text-neutral-400 dark:text-[#66645f] border border-dashed border-neutral-200 dark:border-[rgba(255,255,255,0.07)] rounded-md text-center">
              {filter === 'all'
                ? 'No contacts yet. Add your first one.'
                : `No contacts tagged "${CONTACT_TAG_LABELS[filter as ContactTag]}".`}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {visible.map((c) => (
                <ContactCard
                  key={c.id}
                  contact={c}
                  onPatch={(patch) => handlePatch(c.id, patch)}
                  onDelete={() => handleDelete(c.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {toast && <Toast kind={toast.kind} message={toast.message} />}
    </>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 text-[11px] font-medium rounded-full border transition-colors ${
        active
          ? 'bg-[var(--accent-3)] text-white border-[var(--accent-3)] dark:bg-[var(--accent-1)] dark:border-[var(--accent-1)] dark:text-[#1a1410]'
          : 'border-neutral-200 dark:border-[rgba(255,255,255,0.1)] text-neutral-600 dark:text-[#a09e9a] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)]'
      }`}
    >
      {children}
    </button>
  );
}

// --- ContactTagEditor: multi-select tag chips for a contact ---

function ContactTagEditor({
  value,
  onChange,
}: {
  value: ContactTag[];
  onChange: (next: ContactTag[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = (t: ContactTag) =>
    onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t]);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => toggle(t)}
          title={`Remove ${CONTACT_TAG_LABELS[t]}`}
          className={`group inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-full border uppercase tracking-[0.04em] transition-opacity hover:opacity-80 ${CONTACT_TAG_CHIP_CLASSES[t]}`}
        >
          {CONTACT_TAG_LABELS[t]}
          <svg className="w-2.5 h-2.5 opacity-60 group-hover:opacity-100" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      ))}
      <div className="relative" ref={rootRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full border border-dashed border-neutral-300 dark:border-[rgba(255,255,255,0.15)] text-neutral-500 dark:text-[#a09e9a] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] transition-colors"
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Tag
        </button>
        {open && (
          <div
            role="listbox"
            aria-multiselectable
            className="absolute left-0 z-30 mt-1 w-44 rounded-md border border-neutral-200 dark:border-[rgba(255,255,255,0.08)] bg-white dark:bg-[#141312] shadow-lg overflow-hidden"
          >
            {CONTACT_TAGS.map((t) => {
              const isActive = value.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => toggle(t)}
                  className={`w-full text-left px-3 py-1.5 text-[12px] flex items-center gap-2 transition-colors ${
                    isActive
                      ? 'bg-[rgba(99,102,241,0.08)] dark:bg-[rgba(167,139,250,0.1)] text-neutral-900 dark:text-[#f0efed]'
                      : 'text-neutral-700 dark:text-[#a09e9a] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)]'
                  }`}
                >
                  <span className={`inline-block w-2 h-2 rounded-full border ${CONTACT_TAG_CHIP_CLASSES[t]}`} />
                  <span className="flex-1">{CONTACT_TAG_LABELS[t]}</span>
                  {isActive && (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// --- ContactCard ---

function ContactCard({
  contact,
  onPatch,
  onDelete,
}: {
  contact: Contact;
  onPatch: (patch: ContactPatch) => void;
  onDelete: () => void;
}) {
  const [local, setLocal] = useState({
    name: contact.name ?? '',
    role: contact.role ?? '',
    phone: contact.phone ?? '',
    email: contact.email ?? '',
    schedule: contact.schedule ?? '',
    preferences: contact.preferences ?? '',
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
      schedule: contact.schedule ?? '',
      preferences: contact.preferences ?? '',
      notes: contact.notes ?? '',
    });
  }, [contact.id, contact.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleSave = useCallback(
    (next: typeof local) => {
      if (next.name.trim() === '') {
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
          schedule: next.schedule,
          preferences: next.preferences,
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

  const isOwner = (contact.tags ?? []).includes('owners');

  return (
    <div className="border border-neutral-200/80 dark:border-[rgba(255,255,255,0.07)] rounded-lg p-3">
      <div className="flex items-start justify-between gap-2 mb-2.5">
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

      <div className="mb-3">
        <ContactTagEditor
          value={contact.tags ?? []}
          onChange={(tags) => onPatch({ tags: normalizeContactTags(tags) })}
        />
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Email">
            <Input
              value={local.email}
              onChange={(e) => update('email', e.target.value)}
              placeholder="name@domain.com"
              type="email"
            />
          </Field>
          <Field label="Schedule">
            <Input
              value={local.schedule}
              onChange={(e) => update('schedule', e.target.value)}
              placeholder="e.g. Every other Friday"
            />
          </Field>
        </div>
        {isOwner && (
          <Field label="Preferences">
            <Textarea
              value={local.preferences}
              onChange={(e) => update('preferences', e.target.value)}
              placeholder="How the owner wants things handled — e.g. 'Approve any repair under $200; above that, text first.'"
              rows={2}
            />
          </Field>
        )}
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
