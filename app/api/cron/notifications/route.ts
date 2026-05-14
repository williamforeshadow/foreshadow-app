import { NextResponse } from 'next/server';
import {
  cleanupOldNotifications,
  runDueTodayNotifications,
} from '@/src/server/notifications/notify';

export const maxDuration = 60;

export async function POST() {
  const result = await runDueTodayNotifications();
  const cleanup = await cleanupOldNotifications();
  return NextResponse.json({ ...result, cleanup });
}

export async function GET() {
  return POST();
}
