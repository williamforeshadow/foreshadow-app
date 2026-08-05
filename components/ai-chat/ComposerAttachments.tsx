'use client';

import { FileText, Image as ImageIcon, Loader2, X } from 'lucide-react';
import type { ComposerAttachment } from './useAgentChat';

// The chip row above the composer, shared by the docked desktop panel and the
// mobile sheet so the two don't drift. Styled inline against the same CSS
// variables both surfaces already use, rather than duplicating rules into two
// CSS modules for one small row.

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageName(name: string) {
  return /\.(png|jpe?g|gif|webp|heic|heif|bmp|svg)$/i.test(name);
}

export function ComposerAttachments({
  attachments,
  onRemove,
}: {
  attachments: ComposerAttachment[];
  onRemove: (key: string) => void;
}) {
  if (attachments.length === 0) return null;

  return (
    <div
      className="flex flex-row flex-wrap gap-1.5 px-1 pb-2"
      aria-label="Attachments"
    >
      {attachments.map((a) => {
        const failed = a.status === 'error';
        const Icon = isImageName(a.name) ? ImageIcon : FileText;
        return (
          <div
            key={a.key}
            className="flex max-w-[200px] items-center gap-1.5 rounded-lg px-2 py-1 text-[11px]"
            style={{
              border: '1px solid var(--border)',
              background: 'var(--muted)',
              color: failed ? 'var(--destructive)' : 'var(--foreground)',
              borderColor: failed ? 'var(--destructive)' : 'var(--border)',
            }}
            // The failure reason lives here rather than in the chip: it can be
            // a whole sentence, and the row has to stay one line tall.
            title={failed ? a.error : `${a.name} (${formatSize(a.size)})`}
          >
            {a.status === 'uploading' ? (
              <Loader2 size={12} className="shrink-0 animate-spin" />
            ) : (
              <Icon size={12} className="shrink-0" aria-hidden />
            )}
            <span className="truncate">{a.name}</span>
            <span
              className="shrink-0 tabular-nums"
              style={{ color: 'var(--muted-foreground)' }}
            >
              {failed ? 'failed' : formatSize(a.size)}
            </span>
            <button
              type="button"
              onClick={() => onRemove(a.key)}
              className="shrink-0 cursor-pointer opacity-60 transition-opacity hover:opacity-100"
              aria-label={`Remove ${a.name}`}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Attachment names under a sent user message, so the thread records what went
 * with which message. Read-only — by this point the files are staged and the
 * message is gone.
 */
export function MessageAttachments({
  attachments,
}: {
  attachments: { id: string; name: string }[];
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-1">
      {attachments.map((a) => (
        <div
          key={a.id}
          className="flex items-center gap-1.5 text-[11px] opacity-80"
        >
          {isImageName(a.name) ? (
            <ImageIcon size={11} className="shrink-0" aria-hidden />
          ) : (
            <FileText size={11} className="shrink-0" aria-hidden />
          )}
          <span className="truncate">{a.name}</span>
        </div>
      ))}
    </div>
  );
}
