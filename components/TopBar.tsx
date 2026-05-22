'use client';

import { SidebarToggleButton } from './SidebarToggleButton';
import { NotificationBell } from './notifications/NotificationBell';
import { AiChatLauncher } from './ai-chat/AiChatLauncher';

// Universal sticky top bar. Desktop-only — `hidden md:flex` so mobile, which
// has its own bottom nav, isn't given a top bar. Hosts the sidebar toggle and
// notification bell (relocated here from the sidebar so they stay in a fixed
// place regardless of route) plus the AI launcher.
export function TopBar() {
  return (
    <header className="hidden h-12 shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-3 dark:border-[rgba(255,255,255,0.07)] dark:bg-[#111114] md:flex">
      <div className="flex items-center gap-1">
        <SidebarToggleButton />
        <NotificationBell compact />
        <span className="ml-1.5 text-[13px] font-semibold text-neutral-900 dark:text-white">
          Foreshadow
        </span>
      </div>
      <AiChatLauncher />
    </header>
  );
}
