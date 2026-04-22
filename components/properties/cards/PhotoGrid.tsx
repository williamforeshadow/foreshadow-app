'use client';

import { useRef, useState } from 'react';

export interface Photo {
  id: string;
  storage_path: string;
  caption: string | null;
  sort_order: number;
}

const MAX_BYTES = 10 * 1024 * 1024; // 10MB per photo

// Generic photo grid used by both rooms and cards. Parent supplies the
// upload/delete endpoints and URL resolution; this component handles
// file selection, client-side validation, and optimistic state.
export function PhotoGrid({
  photos,
  uploadUrl,
  deleteUrl,
  resolveUrl,
  maxPhotos,
  noun,
  onPhotosChange,
  onError,
}: {
  photos: Photo[];
  uploadUrl: string;
  deleteUrl: (photoId: string) => string;
  resolveUrl: (storagePath: string) => string;
  maxPhotos: number;
  // Used in placeholder / error copy ("card" or "room").
  noun: string;
  onPhotosChange: (photos: Photo[]) => void;
  onError: (msg: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const sorted = [...photos].sort((a, b) => a.sort_order - b.sort_order);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const remaining = maxPhotos - photos.length;
    if (remaining <= 0) {
      onError(`Photo limit reached (${maxPhotos} per ${noun}).`);
      return;
    }
    const toUpload = Array.from(files).slice(0, remaining);
    if (toUpload.length < files.length) {
      onError(
        `Only uploaded the first ${toUpload.length} — ${maxPhotos}-photo cap per ${noun}.`
      );
    }

    setUploading(true);
    try {
      const next: Photo[] = [...photos];
      for (const file of toUpload) {
        if (!file.type.startsWith('image/')) {
          onError(`"${file.name}" isn't an image.`);
          continue;
        }
        if (file.size > MAX_BYTES) {
          onError(`"${file.name}" is larger than 10MB.`);
          continue;
        }
        const form = new FormData();
        form.append('file', file);
        const res = await fetch(uploadUrl, { method: 'POST', body: form });
        const data = await res.json();
        if (!res.ok) {
          onError(data.error || `Upload failed for ${file.name}`);
          continue;
        }
        next.push(data.photo as Photo);
      }
      onPhotosChange(next);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleDelete = async (photo: Photo) => {
    if (!window.confirm('Delete this photo?')) return;
    try {
      const res = await fetch(deleteUrl(photo.id), { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Delete failed');
      }
      onPhotosChange(photos.filter((p) => p.id !== photo.id));
    } catch (err: any) {
      onError(err.message || 'Delete failed');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-medium text-neutral-500 dark:text-[#66645f] uppercase tracking-[0.04em]">
          Photos ({photos.length}/{maxPhotos})
        </span>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading || photos.length >= maxPhotos}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500 dark:text-[#a09e9a] hover:text-[var(--accent-3)] dark:hover:text-[var(--accent-1)] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {uploading ? 'Uploading…' : 'Add photo'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
      {sorted.length === 0 ? (
        <div className="py-3 px-3 text-[12px] text-neutral-400 dark:text-[#66645f] border border-dashed border-neutral-200 dark:border-[rgba(255,255,255,0.07)] rounded-md">
          No photos yet.
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {sorted.map((photo) => (
            <div
              key={photo.id}
              className="relative aspect-square rounded-md overflow-hidden bg-neutral-100 dark:bg-[#1a1918] group"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resolveUrl(photo.storage_path)}
                alt={photo.caption ?? `${noun} photo`}
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => handleDelete(photo)}
                aria-label="Delete photo"
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 hover:bg-red-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Public Supabase URL resolver shared across photo consumers.
export function resolvePublicPhotoUrl(storagePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (base) {
    return `${base}/storage/v1/object/public/property-photos/${storagePath}`;
  }
  // Dev fallback: try the raw path — Next.js won't proxy it but browsers
  // may resolve same-origin. Consumers should always set the env var.
  return `/${storagePath}`;
}
