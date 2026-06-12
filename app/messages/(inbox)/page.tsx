'use client';

import { MessagesSquare } from 'lucide-react';

// /messages index. The conversation list + chrome live in app/messages/layout.tsx.
// On desktop this fills the right pane until a conversation is selected; on
// mobile the layout shows the list instead and never renders this.
export default function MessagesIndexPage() {
  return (
    <div className="msg-pane flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="msg-well flex h-14 w-14 items-center justify-center rounded-2xl text-muted-foreground">
        <MessagesSquare className="h-6 w-6" />
      </span>
      <div>
        <p className="text-sm font-medium text-foreground">Select a conversation</p>
        <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
          Pick a guest from the list to read the thread and see their reservation
          and tasks alongside it.
        </p>
      </div>
    </div>
  );
}
