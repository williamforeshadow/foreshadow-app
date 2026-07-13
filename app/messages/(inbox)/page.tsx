'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MessagesSquare } from 'lucide-react';
import { useMessages } from '@/components/messages/MessagesProvider';

// /messages index. The conversation list + chrome live in app/messages/layout.tsx.
// On desktop this fills the right pane until a conversation is selected; on
// mobile the layout shows the list instead and never renders this.
//
// Auto-opens the first conversation in the list (its top — most recent / unread)
// so the pane is never empty when there's something to read. Only falls back to
// the placeholder while the list is still loading or when the inbox is empty.
export default function MessagesIndexPage() {
  const router = useRouter();
  const { visible } = useMessages();

  // Key off the id (a stable value) rather than the `visible` array, which is a
  // new reference each render — so this only fires when the top conversation
  // actually changes. `replace` keeps the empty /messages out of history.
  const firstId = visible[0]?.id ?? null;
  useEffect(() => {
    if (firstId) router.replace(`/messages/${firstId}`);
  }, [firstId, router]);

  // Redirecting — render nothing so the placeholder never flashes underneath.
  if (firstId) return null;

  return (
    <div className="msg-pane flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="msg-well flex h-14 w-14 items-center justify-center rounded-2xl text-muted-foreground">
        <MessagesSquare className="h-6 w-6" />
      </span>
      <div>
        <p className="text-sm font-medium text-foreground">No conversation selected</p>
        <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
          Guest conversations from your channels appear in the list on the left.
        </p>
      </div>
    </div>
  );
}
