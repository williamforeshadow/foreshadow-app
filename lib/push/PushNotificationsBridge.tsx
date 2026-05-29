'use client';

// Capacitor push-notification bridge. Mounted once (in AppChrome) under
// AuthProvider so it runs on every route. This is the only Capacitor JS in the
// app: it asks for notification permission, registers the device's APNs token
// with our backend, and deep-links into the tapped task.
//
// The whole thing is inert outside the native iOS shell:
//   - Capacitor + the push plugin are dynamically imported inside the effect,
//     so they never touch the SSR/web bundle's execution path.
//   - Every native call is guarded by Capacitor.isNativePlatform(), so running
//     the same web app in a desktop browser does nothing.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { apiFetch } from '@/lib/apiFetch';

interface ListenerHandle {
  remove: () => Promise<void>;
}

export function PushNotificationsBridge() {
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!user?.id) return;

    let cancelled = false;
    const handles: ListenerHandle[] = [];

    (async () => {
      let Capacitor: typeof import('@capacitor/core').Capacitor;
      let PushNotifications: typeof import('@capacitor/push-notifications').PushNotifications;
      try {
        ({ Capacitor } = await import('@capacitor/core'));
        ({ PushNotifications } = await import('@capacitor/push-notifications'));
      } catch {
        // Plugin unavailable (e.g. plain web build) — nothing to do.
        return;
      }
      if (cancelled || !Capacitor.isNativePlatform()) return;

      // Token issued by APNs → store it against the signed-in user. We always
      // report the production environment; the server falls back to sandbox on
      // BadDeviceToken so Xcode-debug devices still work without us needing to
      // detect the build type from JS.
      const registration = await PushNotifications.addListener(
        'registration',
        async (token) => {
          try {
            await apiFetch('/api/device-tokens', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: token.value, platform: 'ios' }),
            });
          } catch {
            // Best-effort — re-registration on next launch retries.
          }
        },
      );
      handles.push(registration);

      const registrationError = await PushNotifications.addListener(
        'registrationError',
        (err) => {
          console.warn('[push] registration error', err);
        },
      );
      handles.push(registrationError);

      // Tapping the push opens the related task. `href` is the in-app path the
      // server attached to the payload (taskPath()).
      const actionPerformed = await PushNotifications.addListener(
        'pushNotificationActionPerformed',
        (action) => {
          const href = (action?.notification?.data as { href?: unknown } | undefined)
            ?.href;
          if (typeof href === 'string' && href.startsWith('/')) {
            router.push(href);
          }
        },
      );
      handles.push(actionPerformed);

      try {
        let perm = await PushNotifications.checkPermissions();
        if (
          perm.receive === 'prompt' ||
          perm.receive === 'prompt-with-rationale'
        ) {
          perm = await PushNotifications.requestPermissions();
        }
        if (perm.receive === 'granted') {
          await PushNotifications.register();
        }
      } catch (err) {
        console.warn('[push] register failed', err);
      }
    })();

    return () => {
      cancelled = true;
      for (const handle of handles) {
        handle.remove().catch(() => {});
      }
    };
  }, [user?.id, router]);

  return null;
}
