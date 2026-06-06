'use client';

// /messages index. The conversation list + chrome live in app/messages/layout.tsx.
// On desktop this fills the right pane until a conversation is selected; on
// mobile the layout shows the list instead and never renders this.
export default function MessagesIndexPage() {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-sm text-neutral-400">
      Select a conversation
    </div>
  );
}
