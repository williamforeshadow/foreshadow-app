'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Input,
  SectionCaption,
  SectionHeader,
  Textarea,
  Toast,
  useToast,
} from '@/components/properties/form/FormPrimitives';

// Notes tab — five fixed scopes, each a collection of discrete notes.
// The agent queries `WHERE scope = X` to retrieve a scoped list rather
// than parsing one big blob. Each note autosaves with a debounce.

type NoteScope =
  | 'guest_facing'
  | 'team_facing'
  | 'owner_preferences'
  | 'known_issues'
  | 'local_tips';

interface Note {
  id: string;
  property_id: string;
  scope: NoteScope;
  title: string | null;
  body: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface ScopeDef {
  id: NoteScope;
  label: string;
  caption: string;
  placeholder: string;
}

const SCOPES: ScopeDef[] = [
  {
    id: 'guest_facing',
    label: 'Guest-Facing',
    caption:
      "What to tell guests. Check-in quirks, neighborhood tips, house rules.",
    placeholder:
      "e.g. 'The front door sometimes sticks — push firmly while turning the handle.'",
  },
  {
    id: 'team_facing',
    label: 'Team-Facing',
    caption:
      'Internal ops notes. Things your cleaners and maintenance team need to know.',
    placeholder:
      "e.g. 'Never use bleach on the kitchen counters — they stain.'",
  },
  {
    id: 'owner_preferences',
    label: 'Owner Preferences',
    caption:
      'How the owner wants things handled. Communication style, approval thresholds, preferred vendors.',
    placeholder:
      "e.g. 'Owner approves any repair under $200; above that, text first.'",
  },
  {
    id: 'known_issues',
    label: 'Known Issues',
    caption:
      "Things that are broken, quirky, or under repair. Include current status.",
    placeholder:
      "e.g. 'Master bathroom fan rattles — parts ordered, ETA 2 weeks.'",
  },
  {
    id: 'local_tips',
    label: 'Local Tips',
    caption:
      'Restaurants, beaches, transit, neighborhood context that guests and staff might ask about.',
    placeholder:
      "e.g. 'Best coffee is Blue Sparrow, 2 blocks east. Closes at 3pm.'",
  },
];

export default function PropertyNotesTab() {
  const params = useParams<{ id: string }>();
  const propertyId = params?.id as string;

  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { toast, showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/properties/${propertyId}/notes`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load notes');
      setNotes((data.notes || []) as Note[]);
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load notes');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  const notesByScope = useMemo(() => {
    const map = new Map<NoteScope, Note[]>();
    for (const s of SCOPES) map.set(s.id, []);
    for (const n of notes) {
      const arr = map.get(n.scope);
      if (arr) arr.push(n);
    }
    return map;
  }, [notes]);

  const handleCreate = useCallback(
    async (scope: NoteScope) => {
      try {
        const res = await fetch(`/api/properties/${propertyId}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope, body: ' ' }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create note');
        // Server rejects empty body; we seed with a space so the row
        // exists immediately, then the UI focuses the body field so the
        // user can replace the seed text without thinking about it.
        const seeded: Note = { ...(data.note as Note), body: '' };
        setNotes((prev) => [...prev, seeded]);
      } catch (err: any) {
        showToast('error', err.message || 'Failed to create note');
      }
    },
    [propertyId, showToast]
  );

  const handlePatch = useCallback(
    async (noteId: string, patch: Partial<Pick<Note, 'title' | 'body'>>) => {
      // Optimistic local update so typing feels responsive.
      setNotes((prev) =>
        prev.map((n) => (n.id === noteId ? { ...n, ...patch } : n))
      );
      try {
        const res = await fetch(
          `/api/properties/${propertyId}/notes/${noteId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');
        setNotes((prev) => prev.map((n) => (n.id === noteId ? data.note : n)));
      } catch (err: any) {
        showToast('error', err.message || 'Save failed');
      }
    },
    [propertyId, showToast]
  );

  const handleDelete = useCallback(
    async (noteId: string) => {
      const prev = notes;
      setNotes((p) => p.filter((n) => n.id !== noteId));
      try {
        const res = await fetch(
          `/api/properties/${propertyId}/notes/${noteId}`,
          { method: 'DELETE' }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Delete failed');
        }
      } catch (err: any) {
        setNotes(prev);
        showToast('error', err.message || 'Delete failed');
      }
    },
    [notes, propertyId, showToast]
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
          {SCOPES.map((scope) => {
            const items = notesByScope.get(scope.id) ?? [];
            return (
              <section key={scope.id} className="mb-10">
                <SectionHeader
                  label={scope.label}
                  right={
                    <button
                      type="button"
                      onClick={() => handleCreate(scope.id)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500 dark:text-[#a09e9a] hover:text-neutral-800 dark:hover:text-[#f0efed] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] rounded transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                      Add note
                    </button>
                  }
                />
                <SectionCaption>{scope.caption}</SectionCaption>
                {items.length === 0 ? (
                  <div className="py-4 px-3 text-[12px] text-neutral-400 dark:text-[#66645f] border border-dashed border-neutral-200 dark:border-[rgba(255,255,255,0.07)] rounded-md">
                    No notes yet. Click <span className="font-medium">Add note</span> to create one.
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {items.map((n) => (
                      <NoteCard
                        key={n.id}
                        note={n}
                        placeholder={scope.placeholder}
                        onPatch={(patch) => handlePatch(n.id, patch)}
                        onDelete={() => handleDelete(n.id)}
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

// --- NoteCard ---
//
// Each note is a self-contained editor that debounces its own PATCH so
// typing doesn't hammer the API. Local state is the source of truth
// while editing; the parent reconciles after the debounced save fires.

function NoteCard({
  note,
  placeholder,
  onPatch,
  onDelete,
}: {
  note: Note;
  placeholder: string;
  onPatch: (patch: Partial<Pick<Note, 'title' | 'body'>>) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(note.title ?? '');
  const [body, setBody] = useState(note.body ?? '');
  const [savedState, setSavedState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-sync if the row comes back from the server with different values
  // (e.g. via refresh) and we're not mid-edit.
  useEffect(() => {
    setTitle(note.title ?? '');
  }, [note.title]);
  useEffect(() => {
    setBody(note.body ?? '');
  }, [note.body]);

  const scheduleSave = useCallback(
    (next: Partial<Pick<Note, 'title' | 'body'>>) => {
      setSavedState('saving');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        onPatch(next);
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

  const onTitleChange = (v: string) => {
    setTitle(v);
    scheduleSave({ title: v, body });
  };

  const onBodyChange = (v: string) => {
    setBody(v);
    // Body is required server-side. If the user empties it we hold off
    // the save and let them either fill it or delete the note — prevents
    // the PATCH from 400ing while they're mid-edit.
    if (v.trim() === '') {
      setSavedState('idle');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      return;
    }
    scheduleSave({ title, body: v });
  };

  return (
    <div className="border border-neutral-200/80 dark:border-[rgba(255,255,255,0.07)] rounded-lg p-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 space-y-2">
          <Input
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Short title (optional)"
            className="!py-1.5 !text-[13px] !font-medium"
          />
          <Textarea
            value={body}
            onChange={(e) => onBodyChange(e.target.value)}
            placeholder={placeholder}
            rows={3}
          />
        </div>
        <button
          type="button"
          onClick={() => {
            if (window.confirm('Delete this note?')) onDelete();
          }}
          aria-label="Delete note"
          className="shrink-0 p-1 rounded text-neutral-400 dark:text-[#66645f] hover:text-red-600 dark:hover:text-red-400 hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M10 7V4a1 1 0 011-1h2a1 1 0 011 1v3" />
          </svg>
        </button>
      </div>
      <div className="mt-1.5 h-4 text-[10px] font-medium text-neutral-400 dark:text-[#66645f] uppercase tracking-[0.04em]">
        {savedState === 'saving' && 'Saving…'}
        {savedState === 'saved' && 'Saved'}
      </div>
    </div>
  );
}
