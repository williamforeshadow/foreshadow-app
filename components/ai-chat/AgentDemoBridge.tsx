'use client';

import { useEffect } from 'react';
import { useAiChat } from './AiChatProvider';

// Public-demo bridge: lets the parent landing page open the agent from a
// Ctrl/Cmd+K pressed ANYWHERE on the page (not just when the demo iframe has
// focus). The landing posts a `foreshadow-open-agent` message to the active
// demo iframe; this listens for it and opens the chat. Renders nothing.
export function AgentDemoBridge() {
  const { open, toggle } = useAiChat();
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const t = (e.data && (e.data as { type?: string }).type) || '';
      if (t === 'foreshadow-open-agent') open();
      else if (t === 'foreshadow-toggle-agent') toggle();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [open, toggle]);
  return null;
}
