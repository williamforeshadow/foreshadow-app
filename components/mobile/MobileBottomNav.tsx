'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { useIsMobile } from '@/lib/useIsMobile';
import { useAiChat } from '@/components/ai-chat/AiChatProvider';

// The persistent mobile bottom cluster: a faux "Ask the agent…" bar stacked
// above a five-item tab bar. Mounted once in AppChrome so it survives route
// changes; renders only on the tab-root screens (the hamburger/drawer it
// replaces is gone). Detail screens (a conversation, a task, the Menu's
// children) hide it and rely on their own back arrow.
//
// Three of the tabs share the "/" route via ?tab= (the workspace switcher read
// by MobileApp); Messages + Menu are real routes.

// Screens where the cluster shows. Everything else is a drill-in detail with a
// back arrow, so the cluster is hidden there.
function isTabRoot(pathname: string | null): boolean {
  if (!pathname) return false;
  return pathname === '/' || pathname === '/messages' || pathname === '/menu';
}

type TabKey = 'assignments' | 'timeline' | 'projects' | 'messages' | 'menu';

export function MobileBottomNav() {
  const isMobile = useIsMobile();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { open: openAiChat } = useAiChat();

  // Hide on desktop, before the viewport is measured, and on every detail
  // screen. (AppChrome already excludes /login and /demo.)
  if (!isMobile || !isTabRoot(pathname)) return null;

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
    <div className="safe-area-bottom fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200/60 bg-white/90 backdrop-blur-xl dark:border-[rgba(255,255,255,0.07)] dark:bg-[rgba(26,26,31,0.9)]">
      {/* Faux agent input — opens the universal AI chat panel. */}
      <div className="px-3 pt-2">
        <button
          type="button"
          onClick={openAiChat}
          aria-label="Ask the agent"
          className="flex w-full items-center gap-2.5 rounded-full border border-[var(--surface-elevated-line)] bg-black/[0.03] px-4 py-2.5 text-left transition-colors active:bg-black/[0.06] dark:bg-white/[0.05] dark:active:bg-white/[0.08]"
        >
          <Sparkles className="h-[18px] w-[18px] shrink-0 text-[var(--accent-3)] dark:text-[var(--accent-1)]" aria-hidden />
          <span className="text-[13px] text-muted-foreground">Ask the agent…</span>
        </button>
      </div>

      {/* Tabs */}
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
