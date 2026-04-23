'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Field,
  Input,
  SectionCaption,
  SectionHeader,
  Select,
  Textarea,
  Toast,
  useToast,
} from '@/components/properties/form/FormPrimitives';

// Documents tab. Simple one-doc-per-row surface with a file picker, tag
// selector, and inline metadata editing. Files are pushed to the
// property-documents Supabase Storage bucket under an unguessable path.

type DocTag = 'lease' | 'appliance_manual' | 'inspection' | 'insurance' | 'other';

interface PropertyDocument {
  id: string;
  property_id: string;
  tag: DocTag;
  title: string;
  notes: string | null;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  original_filename: string | null;
  created_at: string;
  updated_at: string;
}

const TAGS: Array<{ id: DocTag; label: string }> = [
  { id: 'lease', label: 'Lease' },
  { id: 'appliance_manual', label: 'Appliance Manual' },
  { id: 'inspection', label: 'Inspection Report' },
  { id: 'insurance', label: 'Insurance' },
  { id: 'other', label: 'Other' },
];

function formatSize(bytes: number | null) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function resolveDocUrl(storagePath: string) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (base) {
    return `${base}/storage/v1/object/public/property-documents/${storagePath}`;
  }
  return '#';
}

export default function PropertyDocumentsTab() {
  const params = useParams<{ id: string }>();
  const propertyId = params?.id as string;

  const [docs, setDocs] = useState<PropertyDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pendingTag, setPendingTag] = useState<DocTag>('other');
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast, showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/properties/${propertyId}/documents`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load documents');
      setDocs((data.documents || []) as PropertyDocument[]);
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  const docsByTag = useMemo(() => {
    const map = new Map<DocTag, PropertyDocument[]>();
    for (const t of TAGS) map.set(t.id, []);
    for (const d of docs) {
      const arr = map.get(d.tag);
      if (arr) arr.push(d);
    }
    return map;
  }, [docs]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const next = [...docs];
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append('file', file);
        form.append('tag', pendingTag);
        const res = await fetch(`/api/properties/${propertyId}/documents`, {
          method: 'POST',
          body: form,
        });
        const data = await res.json();
        if (!res.ok) {
          showToast('error', data.error || `Upload failed for ${file.name}`);
          continue;
        }
        next.unshift(data.document as PropertyDocument);
      }
      setDocs(next);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handlePatch = useCallback(
    async (docId: string, patch: Partial<Pick<PropertyDocument, 'title' | 'notes' | 'tag'>>) => {
      setDocs((prev) => prev.map((d) => (d.id === docId ? { ...d, ...patch } : d)));
      try {
        const res = await fetch(
          `/api/properties/${propertyId}/documents/${docId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');
        setDocs((prev) =>
          prev.map((d) => (d.id === docId ? (data.document as PropertyDocument) : d))
        );
      } catch (err: any) {
        showToast('error', err.message || 'Save failed');
      }
    },
    [propertyId, showToast]
  );

  const handleDelete = useCallback(
    async (doc: PropertyDocument) => {
      if (!window.confirm(`Delete "${doc.title}"?`)) return;
      const prev = docs;
      setDocs((p) => p.filter((d) => d.id !== doc.id));
      try {
        const res = await fetch(
          `/api/properties/${propertyId}/documents/${doc.id}`,
          { method: 'DELETE' }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Delete failed');
        }
      } catch (err: any) {
        setDocs(prev);
        showToast('error', err.message || 'Delete failed');
      }
    },
    [docs, propertyId, showToast]
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
          <section className="mb-6">
            <SectionHeader label="Documents" />
            <SectionCaption>
              Leases, inspection reports, insurance, appliance manuals, and
              anything else worth keeping alongside this property.
            </SectionCaption>

            <div className="flex items-center gap-2 p-3 border border-neutral-200/80 dark:border-[rgba(255,255,255,0.07)] rounded-lg">
              <Select
                value={pendingTag}
                onChange={(e) => setPendingTag(e.target.value as DocTag)}
                className="!w-auto"
              >
                {TAGS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </Select>
              <input
                ref={inputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => handleFiles(e.target.files)}
              />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
                className="px-3 py-2 text-[13px] font-medium bg-[var(--accent-3)] text-white rounded-md hover:bg-[var(--accent-2)] dark:hover:bg-[var(--accent-1)] transition-colors disabled:opacity-50"
              >
                {uploading ? 'Uploading…' : 'Upload file'}
              </button>
              <span className="text-[11px] text-neutral-400 dark:text-[#66645f] ml-auto">
                Max 25 MB
              </span>
            </div>
          </section>

          {TAGS.map((tag) => {
            const items = docsByTag.get(tag.id) ?? [];
            if (items.length === 0) return null;
            return (
              <section key={tag.id} className="mb-6">
                <h3 className="text-[11px] font-semibold text-neutral-700 dark:text-[#a09e9a] uppercase tracking-[0.08em] mb-3">
                  {tag.label}
                </h3>
                <div className="flex flex-col gap-2">
                  {items.map((d) => (
                    <DocumentRow
                      key={d.id}
                      doc={d}
                      onPatch={(p) => handlePatch(d.id, p)}
                      onDelete={() => handleDelete(d)}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          {docs.length === 0 && (
            <div className="py-6 px-4 text-[13px] text-neutral-400 dark:text-[#66645f] text-center border border-dashed border-neutral-200 dark:border-[rgba(255,255,255,0.07)] rounded-md">
              No documents yet. Pick a tag and upload your first file above.
            </div>
          )}
        </div>
      </div>

      {toast && <Toast kind={toast.kind} message={toast.message} />}
    </>
  );
}

// --- DocumentRow ---
//
// Inline-edited title + notes + tag selector, with download and delete
// affordances. Text edits autosave with a debounce; tag changes save
// immediately since they're select events.

function DocumentRow({
  doc,
  onPatch,
  onDelete,
}: {
  doc: PropertyDocument;
  onPatch: (patch: Partial<Pick<PropertyDocument, 'title' | 'notes' | 'tag'>>) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(doc.title);
  const [notes, setNotes] = useState(doc.notes ?? '');
  const [expanded, setExpanded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTitle(doc.title);
    setNotes(doc.notes ?? '');
  }, [doc.id, doc.updated_at]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const scheduleSave = (patch: Partial<Pick<PropertyDocument, 'title' | 'notes'>>) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => onPatch(patch), 650);
  };

  const handleTitleChange = (v: string) => {
    setTitle(v);
    if (v.trim() === '') return;
    scheduleSave({ title: v });
  };

  const handleNotesChange = (v: string) => {
    setNotes(v);
    scheduleSave({ notes: v });
  };

  return (
    <div className="border border-neutral-200/80 dark:border-[rgba(255,255,255,0.07)] rounded-lg p-3">
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 text-neutral-400 dark:text-[#66645f] shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <Input
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Title"
          className="!py-1.5 !text-[13px] !font-medium"
        />
        <a
          href={resolveDocUrl(doc.storage_path)}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-600 dark:text-[#a09e9a] hover:text-neutral-900 dark:hover:text-[#f0efed] rounded transition-colors"
        >
          Open
        </a>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 p-1 rounded text-neutral-400 dark:text-[#66645f] hover:text-neutral-700 dark:hover:text-[#f0efed] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] transition-colors"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          <svg
            className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete document"
          className="shrink-0 p-1 rounded text-neutral-400 dark:text-[#66645f] hover:text-red-600 dark:hover:text-red-400 hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M10 7V4a1 1 0 011-1h2a1 1 0 011 1v3" />
          </svg>
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-neutral-400 dark:text-[#66645f]">
        {doc.original_filename && <span className="truncate">{doc.original_filename}</span>}
        {doc.size_bytes != null && (
          <>
            <span className="w-[3px] h-[3px] rounded-full bg-neutral-300 dark:bg-[#3e3d3a]" />
            <span className="tabular-nums">{formatSize(doc.size_bytes)}</span>
          </>
        )}
      </div>
      {expanded && (
        <div className="mt-3 pt-3 border-t border-neutral-100 dark:border-[rgba(255,255,255,0.05)] space-y-3">
          <Field label="Tag">
            <Select
              value={doc.tag}
              onChange={(e) => onPatch({ tag: e.target.value as DocTag })}
            >
              {TAGS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notes">
            <Textarea
              value={notes}
              onChange={(e) => handleNotesChange(e.target.value)}
              placeholder="Why this matters, when it expires, etc."
              rows={2}
            />
          </Field>
        </div>
      )}
    </div>
  );
}
