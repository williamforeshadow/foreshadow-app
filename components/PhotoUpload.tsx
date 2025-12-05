'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
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
  maxPhotos = 5,
  required = false
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

  return (
    <div className="space-y-3">
      {/* Upload Button */}
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          multiple={multiple}
          onChange={handleFileSelect}
          className="hidden"
          id={`photo-upload-${fieldId}`}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || (!multiple && currentPhotos.length >= 1) || (multiple && currentPhotos.length >= maxPhotos)}
        >
          {uploading ? 'Uploading...' : multiple ? `Upload Photos (${currentPhotos.length}/${maxPhotos})` : 'Upload Photo'}
        </Button>
        {required && currentPhotos.length === 0 && (
          <span className="text-xs text-red-500 ml-2">Required</span>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}

      {/* Photo Grid */}
      {currentPhotos.length > 0 && (
        <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
          {currentPhotos.map((url, index) => (
            <div key={index} className="relative group aspect-square bg-neutral-100 dark:bg-neutral-800 rounded-lg overflow-hidden border border-neutral-300 dark:border-neutral-600">
              <Image
                src={url}
                alt={`Photo ${index + 1}`}
                fill
                className="object-cover"
              />
              <button
                type="button"
                onClick={() => handleRemove(url)}
                className="absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                title="Remove photo"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

