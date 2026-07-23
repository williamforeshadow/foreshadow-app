'use client';

import { useState } from 'react';
import { AttachmentLightbox } from '@/components/windows/projects/AttachmentLightbox';
import type { Attachment } from '@/lib/types';
import type { MessageAttachment } from '@/lib/messages';

// Renders the photos/files on one message: images as inline thumbnails, other
// files as a chip. Both open the shared AttachmentLightbox (image/video/pdf
// inline, everything else an "open in tab" affordance). Lightbox state is owned
// here, so the thread just drops <MessageAttachments> into the bubble — no
// per-message state threaded through the render.
//
// `url` is a short-lived signed URL minted by the read route; it can be absent
// if signing failed, in which case the attachment still shows as a named chip
// rather than vanishing.

function formatSize(bytes: number | null): string | null {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Map our stored shape onto the lightbox's Attachment contract.
function toLightbox(a: MessageAttachment): Attachment {
  return {
    id: a.hostaway_attachment_id,
    project_id: null,
    file_name: a.name,
    url: a.url,
    file_type: a.file_type,
    mime_type: a.mime_type,
    created_at: '',
  };
}

export function MessageAttachments({
  attachments,
}: {
  attachments: MessageAttachment[];
}) {
  const [viewingIndex, setViewingIndex] = useState<number | null>(null);
  if (attachments.length === 0) return null;

  const lightboxItems = attachments.map(toLightbox);

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {attachments.map((a, i) => {
          const isImage = a.file_type === 'image';
          if (isImage && a.url) {
            return (
              <button
                key={a.hostaway_attachment_id}
                type="button"
                onClick={() => setViewingIndex(i)}
                className="block overflow-hidden rounded-lg border border-black/[0.06] dark:border-white/[0.08] transition-opacity hover:opacity-90"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={a.url}
                  alt={a.name}
                  loading="lazy"
                  className="h-40 max-w-[220px] object-cover"
                />
              </button>
            );
          }
          // Non-image, or an image whose signed URL is missing: file chip.
          const size = formatSize(a.size_bytes);
          return (
            <button
              key={a.hostaway_attachment_id}
              type="button"
              onClick={() => setViewingIndex(i)}
              className="flex items-center gap-2 rounded-lg border border-black/[0.08] bg-black/[0.02] px-2.5 py-2 text-left transition-colors hover:bg-black/[0.04] dark:border-white/[0.1] dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
            >
              <svg className="h-4 w-4 shrink-0 text-muted-foreground" viewBox="0 0 20 20" fill="none" aria-hidden>
                <path d="M4 2h8l4 4v12H4V2z" stroke="currentColor" strokeWidth="1.2" />
                <path d="M12 2v4h4" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              <span className="min-w-0">
                <span className="block max-w-[180px] truncate text-xs font-medium text-foreground">
                  {a.name}
                </span>
                {size && <span className="block text-[10px] text-muted-foreground">{size}</span>}
              </span>
            </button>
          );
        })}
      </div>

      <AttachmentLightbox
        attachments={lightboxItems}
        viewingIndex={viewingIndex}
        onClose={() => setViewingIndex(null)}
        onNavigate={setViewingIndex}
      />
    </div>
  );
}
