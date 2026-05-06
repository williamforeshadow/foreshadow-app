'use client';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { Attachment } from '@/lib/types';

interface AttachmentLightboxProps {
  attachments: Attachment[];
  viewingIndex: number | null;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export function AttachmentLightbox({
  attachments,
  viewingIndex,
  onClose,
  onNavigate,
}: AttachmentLightboxProps) {
  if (viewingIndex === null || !attachments[viewingIndex]) {
    return null;
  }

  const currentAttachment = attachments[viewingIndex];
  const attachmentUrl = currentAttachment.url || currentAttachment.file_url;
  const isImage =
    currentAttachment.mime_type?.startsWith('image/') ||
    (!currentAttachment.mime_type && currentAttachment.file_type === 'image');
  const isVideo =
    currentAttachment.mime_type?.startsWith('video/') ||
    (!currentAttachment.mime_type && currentAttachment.file_type === 'video');
  const extension =
    currentAttachment.file_name?.split('.').pop()?.toUpperCase() || 'FILE';

  const handlePrev = () => {
    onNavigate((viewingIndex - 1 + attachments.length) % attachments.length);
  };

  const handleNext = () => {
    onNavigate((viewingIndex + 1) % attachments.length);
  };

  return (
    <Dialog
      open={viewingIndex !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-none sm:max-w-none w-screen h-screen p-0 border-0 bg-black/95 [&>button]:hidden rounded-none">
        <DialogTitle className="sr-only">Attachment Viewer</DialogTitle>

        <div className="relative w-full h-full">
          {/* Header */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-4 z-20">
            <span className="text-white/70 text-sm">
              {viewingIndex + 1} / {attachments.length}
            </span>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Left Arrow */}
          {attachments.length > 1 && (
            <button
              onClick={handlePrev}
              className="absolute left-4 top-1/2 -translate-y-1/2 z-20 p-3 hover:bg-white/10 rounded-full transition-colors"
            >
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}

          {/* Content */}
          <div className="absolute inset-0 flex items-center justify-center px-20 py-20">
            {isImage ? (
              <img
                src={attachmentUrl}
                alt=""
                className="max-h-full max-w-full object-contain"
              />
            ) : isVideo ? (
              <video
                src={attachmentUrl}
                controls
                autoPlay
                className="max-h-full max-w-full"
              />
            ) : (
              <div className="flex flex-col items-center gap-4 text-center text-white">
                <div className="w-20 h-20 rounded-xl border border-white/15 bg-white/10 flex flex-col items-center justify-center">
                  <svg className="w-8 h-8 text-white/80" viewBox="0 0 20 20" fill="none">
                    <path d="M4 2h8l4 4v12H4V2z" stroke="currentColor" strokeWidth="1.2" fill="none" />
                    <path d="M12 2v4h4" stroke="currentColor" strokeWidth="1.2" fill="none" />
                  </svg>
                  <span className="mt-1 text-[10px] font-medium text-white/70">
                    {extension}
                  </span>
                </div>
                <div>
                  <p className="max-w-[420px] truncate text-sm font-medium">
                    {currentAttachment.file_name || 'Attachment'}
                  </p>
                  <p className="mt-1 text-xs text-white/50">
                    Documents open in a browser tab.
                  </p>
                </div>
                {attachmentUrl && (
                  <a
                    href={attachmentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90"
                  >
                    Open document
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Right Arrow */}
          {attachments.length > 1 && (
            <button
              onClick={handleNext}
              className="absolute right-4 top-1/2 -translate-y-1/2 z-20 p-3 hover:bg-white/10 rounded-full transition-colors"
            >
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

