'use client';

import { useState, useRef } from 'react';
import Image from 'next/image';

interface PhotoUploadProps {
  cleaningId: string;
  fieldId: string;
  value: string | string[]; // URL or array of URLs
  onChange: (url: string | string[]) => void;
  multiple?: boolean;
  maxPhotos?: number;
  required?: boolean;
}

export default function PhotoUpload({
  cleaningId,
  fieldId,
  value,
  onChange,
  multiple = false,
  maxPhotos = 10,
}: PhotoUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentPhotos = Array.isArray(value) ? value : value ? [value] : [];

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Check max photos limit
    if (multiple && currentPhotos.length + files.length > maxPhotos) {
      setError(`Maximum ${maxPhotos} photos allowed`);
      return;
    }

    if (!multiple && files.length > 1) {
      setError('Only one photo allowed');
      return;
    }

    setError(null);
    setUploading(true);

    try {
      const uploadedUrls: string[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const formData = new FormData();
        formData.append('file', file);
        formData.append('cleaningId', cleaningId);
        formData.append('fieldId', fieldId);

        const res = await fetch('/api/upload-photo', {
          method: 'POST',
          body: formData
        });

        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || 'Upload failed');
        }

        const data = await res.json();
        uploadedUrls.push(data.url);
      }

      if (multiple) {
        onChange([...currentPhotos, ...uploadedUrls]);
      } else {
        onChange(uploadedUrls[0]);
      }

      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err: any) {
      setError(err.message || 'Failed to upload photo');
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async (urlToRemove: string) => {
    try {
      // Extract fileName from URL
      const urlParts = urlToRemove.split('/');
      const fileName = urlParts.slice(-2).join('/'); // Get 'cleaningId/filename.jpg'

      // Delete from storage
      await fetch(`/api/upload-photo?fileName=${encodeURIComponent(fileName)}`, {
        method: 'DELETE'
      });

      // Update state
      if (multiple) {
        onChange(currentPhotos.filter(url => url !== urlToRemove));
      } else {
        onChange('');
      }
    } catch (err) {
      console.error('Failed to delete photo:', err);
      setError('Failed to delete photo');
    }
  };

  const canAdd = multiple ? currentPhotos.length < maxPhotos : currentPhotos.length < 1;

  return (
    <div className="w-full space-y-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        multiple={multiple}
        onChange={handleFileSelect}
        className="hidden"
        id={`photo-upload-${fieldId}`}
      />

      {/* Photos + add tile share one centered row; the tile IS the button. */}
      <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
        {currentPhotos.map((url, index) => (
          <div key={index} className="relative group h-20 w-20 bg-neutral-100 dark:bg-neutral-800 rounded-lg overflow-hidden border border-neutral-300 dark:border-neutral-600">
            <Image
              src={url}
              alt={`Photo ${index + 1}`}
              fill
              className="object-cover"
            />
            <button
              type="button"
              onClick={() => handleRemove(url)}
              className="absolute top-1.5 right-1.5 bg-red-500 hover:bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              title="Remove photo"
            >
              ×
            </button>
          </div>
        ))}

        {canAdd && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            aria-label={multiple ? 'Add photos' : 'Add photo'}
            className="flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-neutral-300 dark:border-neutral-600 text-neutral-400 dark:text-neutral-500 transition-colors hover:border-[#A78BFA] hover:text-[#A78BFA] active:scale-95 disabled:opacity-50"
          >
            {uploading ? (
              <span className="text-xs">…</span>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="7" width="15" height="12" rx="2.5" />
                <circle cx="8" cy="11.5" r="1.4" />
                <path d="M4 18l4-3.6a1.6 1.6 0 012.1 0L14 18" />
                <path d="M19 3v6M16 6h6" />
              </svg>
            )}
            {multiple && !uploading && (
              <span className="text-[9px] font-medium leading-none">
                {currentPhotos.length}/{maxPhotos}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <p className="text-center text-sm text-red-500">{error}</p>
      )}
    </div>
  );
}

