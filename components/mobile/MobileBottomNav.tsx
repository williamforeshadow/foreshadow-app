'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { useIsMobile } from '@/lib/useIsMobile';
import { useAiChat } from '@/components/ai-chat/AiChatProvider';

// The persistent mobile bottom cluster: an "Ask the agent…" pill stacked above
// a five-item tab bar. Mounted once in AppChrome so it survives route changes;
// renders only on the tab-root screens (the hamburger/drawer it replaces is
// gone). Detail screens (a conversation, a task, the Menu's children) hide it
// and rely on their own back arrow. Tapping the pill opens the agent chat sheet
// (MobileAgentChat, mounted separately in AppChrome so its conversation
// persists); the pill hides while the sheet is open.
//
// Three of the tabs share the "/" route via ?tab= (the workspace switcher read
// by MobileApp); Messages + Menu are real routes.

// Screens where the cluster shows. Everything else is a drill-in detail with a
// back arrow, so the cluster is hidden there.
function isTabRoot(pathname: string | null): boolean {
  if (!pathname) return false;
  return pathname === '/' || pathname === '/messages' || pathname === '/menu';
}

// The agent bubble is available more broadly than the tab bar — also on the
// Menu's destination pages. (It stays hidden inside a message conversation,
// which is in neither set.)
function isBubbleRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    pathname === '/tasks' ||
    pathname === '/properties' ||
    pathname === '/notifications'
  );
}

type TabKey = 'assignments' | 'timeline' | 'projects' | 'messages' | 'menu';

export function MobileBottomNav() {
  const isMobile = useIsMobile();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  // Tapping the pill opens the agent chat sheet; the pill hides while it's open.
  const { open: openChat, isOpen: chatOpen } = useAiChat();

  // The tab bar shows only on the tab roots; the agent bubble shows there and on
  // the Menu's destination pages. Hidden on desktop, before the viewport is
  // measured, and on every other detail screen (e.g. a message conversation).
  const showTabs = isTabRoot(pathname);
  const showBubble = showTabs || isBubbleRoute(pathname);
  if (!isMobile || !showBubble) return null;

  const tab = searchParams?.get('tab') ?? null;
  const onHome = pathname === '/';
  const active: TabKey =
    pathname === '/menu'
      ? 'menu'
      : pathname === '/messages'
        ? 'messages'
        : onHome && tab === 'timeline'
          ? 'timeline'
          : onHome && tab === 'projects'
            ? 'projects'
            : 'assignments';

  const items: { key: TabKey; label: string; href: string; icon: React.ReactNode }[] = [
    {
      key: 'assignments',
      label: 'Assignments',
      href: '/',
      icon: (
        <TabIcon>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </TabIcon>
      ),
    },
    {
      key: 'timeline',
      label: 'Schedule',
      href: '/?tab=timeline',
      icon: (
        <TabIcon>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </TabIcon>
      ),
    },
    {
      key: 'projects',
      label: 'Bins',
      href: '/?tab=projects',
      icon: (
        <TabIcon>
          <rect x="3" y="3" width="7" height="18" rx="1" />
          <rect x="14" y="3" width="7" height="11" rx="1" />
        </TabIcon>
      ),
    },
    {
      key: 'messages',
      label: 'Messages',
      href: '/messages',
      icon: (
        <TabIcon>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.8L3 20l1.3-3.9A7.96 7.96 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </TabIcon>
      ),
    },
    {
      key: 'menu',
      label: 'Menu',
      href: '/menu',
      icon: (
        <TabIcon>
          <rect x="4" y="4" width="7" height="7" rx="1.5" />
          <rect x="13" y="4" width="7" height="7" rx="1.5" />
          <rect x="4" y="13" width="7" height="7" rx="1.5" />
          <rect x="13" y="13" width="7" height="7" rx="1.5" />
        </TabIcon>
      ),
    },
  ];

  const go = (href: string) => {
    const current = pathname + (searchParams?.toString() ? `?${searchParams.toString()}` : '');
    if (current !== href) router.push(href);
  };

  return (
    <>
      {/* Transparent, click-through wrapper: only the bubble and the tab bar
          themselves capture taps, so the gap between them (and the page behind
          it) stays interactive — which makes the bubble read as floating. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col">
      {/* Floating agent bubble — a liquid-glass pill detached from the tab bar;
          opens the universal AI chat panel. `relative` anchors the sheen
          ::before; no transformed ancestor, so the backdrop blur survives. */}
      <div className={`flex justify-center px-4 ${showTabs ? 'pb-2.5' : 'pb-[calc(0.625rem_+_env(safe-area-inset-bottom))]'}`}>
        <button
          type="button"
          onClick={() => openChat()}
          aria-label="Ask the agent"
          className="agent-glass pointer-events-auto flex w-3/5 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-center transition-opacity active:opacity-90"
          style={chatOpen ? { opacity: 0, pointerEvents: 'none' } : undefined}
        >
          <Sparkles className="relative h-4 w-4 shrink-0 text-[var(--accent-3)] dark:text-[var(--accent-1)]" aria-hidden />
          <span className="relative text-[13px] text-foreground/70">Work with your agent</span>
        </button>
      </div>

      {/* Tab bar — only on the tab roots. */}
      {showTabs ? (
        <div className="pointer-events-auto safe-area-bottom border-t border-neutral-200/60 bg-white/90 backdrop-blur-xl dark:border-[rgba(255,255,255,0.07)] dark:bg-[rgba(26,26,31,0.9)]">
          <div className="grid grid-cols-5 px-1 pb-1 pt-1.5">
          {items.map((it) => {
          const isActive = active === it.key;
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => go(it.href)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex min-w-0 flex-col items-center gap-1 rounded-lg px-1 py-1 transition-colors ${
                isActive
                  ? 'text-[var(--accent-3)] dark:text-[var(--accent-1)]'
                  : 'text-neutral-500 dark:text-[#66645f]'
              }`}
            >
              {it.icon}
              <span className="max-w-full truncate text-[10.5px] font-medium leading-none tracking-tight">
                {it.label}
              </span>
            </button>
          );
        })}
          </div>
        </div>
      ) : null}
      </div>
    </>
  );
}

function TabIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      className="h-[22px] w-[22px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
      aria-hidden
    >
      {children}
    </svg>
  );
}
