import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/requireCronAuth';
import {
  cleanupOldNotifications,
  runDueTodayNotifications,
} from '@/src/server/notifications/notify';

export const maxDuration = 60;

export async function POST(request: Request) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  const result = await runDueTodayNotifications();
  const cleanup = await cleanupOldNotifications();
  return NextResponse.json({ ...result, cleanup });
}

export async function GET(request: Request) {
  return POST(request);
}
