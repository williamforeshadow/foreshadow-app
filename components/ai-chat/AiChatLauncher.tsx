'use client';

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useAiChat } from './AiChatProvider';

// The "Ask AI" button shown in the top bar. Opens the chat panel; the
// keycap hint reflects the platform (⌘K on macOS, Ctrl K elsewhere).
export function AiChatLauncher() {
  const { open } = useAiChat();
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(/mac/i.test(navigator.platform));
  }, []);

  return (
    <button
      type="button"
      onClick={open}
      className="group flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-[12.5px] font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:border-[rgba(255,255,255,0.08)] dark:bg-[rgba(255,255,255,0.04)] dark:text-neutral-300 dark:hover:bg-[rgba(255,255,255,0.08)] dark:hover:text-white"
    >
      <Sparkles size={14} className="text-[var(--accent-3)]" />
      <span>Ask AI</span>
      <kbd className="ml-1 rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 dark:border-[rgba(255,255,255,0.1)] dark:bg-[rgba(255,255,255,0.04)] dark:text-neutral-400">
        {isMac ? '⌘K' : 'Ctrl K'}
      </kbd>
    </button>
  );
}
