'use client';

import { useState } from 'react';
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

/** Where the browser fetches a staged attachment's renderable bytes. The route
 *  transcodes HEIC and serves from the private bucket the client can't reach. */
function attachmentSrc(id: string) {
  return `/api/agent/attachments/${encodeURIComponent(id)}`;
}

// A sent image, shown as a fixed square thumbnail that opens full-size in a new
// tab. Square + object-cover so a row of them stays tidy and several fit without
// eating the thread; the tap target opens the full photo. Falls back to the
// plain filename row if the bytes can't be fetched or painted (deleted staging
// copy, a format that didn't normalise) so a broken image icon never lands in
// the thread.
function SentImage({ id, name }: { id: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] opacity-80">
        <ImageIcon size={11} className="shrink-0" aria-hidden />
        <span className="truncate">{name}</span>
      </div>
    );
  }
  return (
    <a
      href={attachmentSrc(id)}
      target="_blank"
      rel="noopener noreferrer"
      className="block h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-[var(--border)]"
      title={name}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- staged bytes from
          our own auth'd route, not a static asset Next can optimise. */}
      <img
        src={attachmentSrc(id)}
        alt={name}
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    </a>
  );
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
        // A staged image previews as a thumbnail tile with a remove badge —
        // the same bytes the sent bubble will show, so the composer matches
        // the thread. Anything still uploading, failed, or non-image keeps the
        // compact text chip below.
        if (a.status === 'ready' && a.id && isImageName(a.name)) {
          return (
            <div
              key={a.key}
              className="group relative h-16 w-16 overflow-hidden rounded-lg"
              style={{ border: '1px solid var(--border)' }}
              title={`${a.name} (${formatSize(a.size)})`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- staged
                  bytes from our own auth'd route. */}
              <img
                src={attachmentSrc(a.id)}
                alt={a.name}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => onRemove(a.key)}
                className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full text-white opacity-90 transition-opacity hover:opacity-100"
                style={{ background: 'rgba(0,0,0,0.55)' }}
                aria-label={`Remove ${a.name}`}
              >
                <X size={11} />
              </button>
            </div>
          );
        }
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
 * Attachments under a sent user message, so the thread records what went with
 * which message. Images render as thumbnails (opening full-size in a new tab);
 * everything else stays a filename row. Read-only — by this point the files are
 * staged and the composer is clear.
 *
 * The row sits in a right-aligned user bubble, so items align to the end.
 */
export function MessageAttachments({
  attachments,
}: {
  attachments: { id: string; name: string }[];
}) {
  if (attachments.length === 0) return null;
  // Images wrap into a right-aligned row of square thumbnails so a batch stays
  // compact; non-image files keep their own filename rows underneath.
  const images = attachments.filter((a) => isImageName(a.name));
  const files = attachments.filter((a) => !isImageName(a.name));
  return (
    <div className="mt-1.5 flex flex-col items-end gap-1.5">
      {images.length > 0 && (
        <div className="flex flex-row flex-wrap justify-end gap-1.5">
          {images.map((a) => (
            <SentImage key={a.id} id={a.id} name={a.name} />
          ))}
        </div>
      )}
      {files.map((a) => (
        <div
          key={a.id}
          className="flex items-center gap-1.5 text-[11px] opacity-80"
        >
          <FileText size={11} className="shrink-0" aria-hidden />
          <span className="truncate">{a.name}</span>
        </div>
      ))}
    </div>
  );
}
