import { NextResponse } from 'next/server';
import { runDueTodayNotifications } from '@/src/server/notifications/notify';

export const maxDuration = 60;

export async function POST() {
  const result = await runDueTodayNotifications();
  return NextResponse.json(result);
}

export async function GET() {
  return POST();
}
