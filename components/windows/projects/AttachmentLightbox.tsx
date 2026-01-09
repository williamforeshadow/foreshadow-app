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
            {currentAttachment.file_type === 'image' ? (
              <img
                src={attachmentUrl}
                alt=""
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <video
                src={attachmentUrl}
                controls
                autoPlay
                className="max-h-full max-w-full"
              />
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

