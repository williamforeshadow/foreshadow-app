'use client';

// =============================================================================
// PUBLIC MARKETING DEMO — fully isolated, fully mocked.
//
// Renders the REAL <AiChatPanel/> (unmodified) so the website always shows the
// live UI/animations, but:
//   - supplies a fake auth + always-open chat context (the panel needs a user
//     and an open state), so it never touches Supabase auth;
//   - intercepts every /api/agent* fetch and returns a canned marketing reply,
//     so typing in it NEVER reaches the backend / LLM / real data.
// Embedded into the marketing site via <iframe>. Nothing here runs in the
// authenticated app — it's a separate route under the public allowlist.
// =============================================================================

import { useEffect } from 'react';
import { AuthContext, type AppUser, type Role } from '@/lib/authContext';
import { AiChatContext } from '@/components/ai-chat/AiChatProvider';
import { AiChatPanel } from '@/components/ai-chat/AiChatPanel';

const DEMO_USER = {
  id: 'demo-user',
  name: 'You',
  email: 'you@example.com',
  role: 'manager' as Role,
} satisfies AppUser;

const AUTH_VALUE = {
  user: DEMO_USER,
  allUsers: [DEMO_USER],
  role: 'manager' as Role,
  loading: false,
  error: null,
  signOut: async () => {},
  refreshUser: async () => {},
  canManageUsers: false,
  canEditTemplates: true,
  canViewAllTasks: true,
  canEditTasks: true,
  canViewAllProperties: true,
  canEditProperties: false,
  canManageProjects: true,
};

const CHAT_VALUE = {
  isOpen: true,
  isFullscreen: false,
  open: () => {},
  close: () => {},
  toggle: () => {},
  toggleFullscreen: () => {},
  pendingPrompt: null,
  clearPendingPrompt: () => {},
};

const CANNED_ANSWER = [
  'Thanks for asking! If you like the feel of this, you should onboard with **Foreshadow** — I can help you and your operations with:',
  '',
  '- coordinating tasks',
  '- analyzing operations',
  '- fetching property knowledge',
  '',
  'How does that sound?',
].join('\n');

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export default function DemoAgentPage() {
  // Intercept the agent endpoints with a canned reply. Installed on mount,
  // before any user interaction, and restored on unmount.
  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (urlOf(input).includes('/api/agent')) {
        // Mimic the real "thinking" pause so the loading animation shows.
        await new Promise((r) => setTimeout(r, 850));
        return new Response(JSON.stringify({ answer: CANNED_ANSWER }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return original(input, init);
    };
    return () => {
      window.fetch = original;
    };
  }, []);

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--background)' }}>
      <AuthContext.Provider value={AUTH_VALUE}>
        <AiChatContext.Provider value={CHAT_VALUE}>
          <AiChatPanel />
        </AiChatContext.Provider>
      </AuthContext.Provider>
    </div>
  );
}
