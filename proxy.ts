import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { updateSupabaseSession } from '@/lib/supabaseSession';

const PUBLIC_PATHS = ['/login', '/auth/callback', '/auth/confirm'];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSupabaseSession(request);
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith('/api')) {
    return response;
  }

  if (!user && !isPublicPath(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.search = '';
    redirectUrl.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && pathname === '/login') {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/';
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
