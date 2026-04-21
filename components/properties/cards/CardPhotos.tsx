'use client';

import Image from 'next/image';
import { useRef, useState } from 'react';

interface Photo {
  id: string;
  storage_path: string;
  caption: string | null;
  sort_order: number;
}

const MAX_PHOTOS = 20;
const MAX_BYTES = 10 * 1024 * 1024; // 10MB per photo

export function CardPhotos({
  propertyId,
  cardId,
  photos,
  onPhotosChange,
  onError,
}: {
  propertyId: string;
  cardId: string;
  photos: Photo[];
  onPhotosChange: (photos: Photo[]) => void;
  onError: (msg: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const sorted = [...photos].sort(
    (a, b) => a.sort_order - b.sort_order
  );

  const resolvePhotoUrl = (storagePath: string) => {
    // Public bucket — we can construct the URL directly from the storage
    // path. If an env var isn't configured we fall back to the proxy
    // endpoint which resolves server-side.
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (base) {
      return `${base}/storage/v1/object/public/property-photos/${storagePath}`;
    }
    return `/api/properties/${propertyId}/cards/${cardId}/photos/${encodeURIComponent(
      storagePath
    )}`;
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) {
      onError(`Photo limit reached (${MAX_PHOTOS} per card).`);
      return;
    }
    const toUpload = Array.from(files).slice(0, remaining);
    if (toUpload.length < files.length) {
      onError(
        `Only uploaded the first ${toUpload.length} — ${MAX_PHOTOS}-photo cap per card.`
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
        const res = await fetch(
          `/api/properties/${propertyId}/cards/${cardId}/photos`,
          { method: 'POST', body: form }
        );
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
      const res = await fetch(
        `/api/properties/${propertyId}/cards/${cardId}/photos/${photo.id}`,
        { method: 'DELETE' }
      );
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
    <div className="mt-1 pt-3 border-t border-neutral-100 dark:border-[rgba(255,255,255,0.05)]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-medium text-neutral-500 dark:text-[#66645f] uppercase tracking-[0.04em]">
          Photos ({photos.length}/{MAX_PHOTOS})
        </span>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading || photos.length >= MAX_PHOTOS}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-neutral-500 dark:text-[#a09e9a] hover:text-neutral-800 dark:hover:text-[#f0efed] hover:bg-[rgba(30,25,20,0.04)] dark:hover:bg-[rgba(255,255,255,0.04)] rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
                src={resolvePhotoUrl(photo.storage_path)}
                alt={photo.caption ?? 'Card photo'}
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => handleDelete(photo)}
                aria-label="Delete photo"
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 hover:bg-red-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
