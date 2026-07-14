'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCheck } from 'lucide-react';
import MobileRouteShell from '@/components/mobile/MobileRouteShell';
import { useIsMobile } from '@/lib/useIsMobile';
import { useNotificationFeed } from '@/components/notifications/useNotificationFeed';
import {
  NotificationRows,
  NotificationViewTabs,
} from '@/components/notifications/NotificationList';
import type { NotificationRecord } from '@/lib/notifications';

/**
 * /notifications — the dedicated mobile notifications page. Desktop keeps the
 * bell dropdown, so desktop visitors are redirected back to the workspace.
 */
export default function NotificationsPage() {
  const isMobile = useIsMobile();
  const router = useRouter();

  useEffect(() => {
    if (isMobile === false) router.replace('/');
  }, [isMobile, router]);

  if (isMobile !== true) return null;

  return <MobileNotifications />;
}

function MobileNotifications() {
  const router = useRouter();
  const { view, setView, notifications, unreadCount, loading, markRead } =
    useNotificationFeed();

  const openNotification = async (notification: NotificationRecord) => {
    if (!notification.read_at) {
      await markRead([notification.id]);
    }
    if (notification.href) router.push(notification.href);
  };

  const markAllButton = (
    <button
      type="button"
      onClick={() => markRead('all')}
      disabled={unreadCount === 0}
      className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-[rgba(30,25,20,0.04)] disabled:opacity-40 dark:text-[#a09e9a] dark:hover:bg-[rgba(255,255,255,0.04)]"
      aria-label="Mark all read"
    >
      <CheckCheck className="h-5 w-5" />
    </button>
  );

  return (
    <MobileRouteShell backHref="/menu" title="Notifications" rightSlot={markAllButton}>
      <div className="flex h-full flex-col">
        <div className="shrink-0 px-2 pb-1">
          <NotificationViewTabs view={view} onChange={setView} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto hide-scrollbar">
          <NotificationRows
            notifications={notifications}
            loading={loading}
            onOpen={openNotification}
            ringClassName="ring-white dark:ring-card"
          />
        </div>
      </div>
    </MobileRouteShell>
  );
}
