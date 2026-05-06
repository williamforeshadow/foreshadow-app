// Client-side fetch wrapper that auto-injects the acting user's id as
// a header (`x-actor-user-id`) on every request. Server routes that
// care about attribution read it via lib/getActorFromRequest.ts; routes
// that don't care simply ignore it.
//
// Usage:
//   import { apiFetch } from '@/lib/apiFetch';
//   const res = await apiFetch('/api/...', { method: 'POST', body: ... });
//
// The actor is published by AuthProvider into a module-level singleton
// when the user logs in / switches users. Until then, requests go out
// without the header and the server logs as "unattributed". This is
// equivalent to using window.fetch directly — no behavior change for
// routes that don't read the header.

let currentActorUserId: string | null = null;

/**
 * Set the actor for subsequent apiFetch calls. Called by AuthProvider
 * whenever the active user changes (login, switch-user, etc.). Pass
 * null to clear (logout).
 */
export function setActorUserId(userId: string | null): void {
  currentActorUserId = userId;
}

export function getCurrentActorUserId(): string | null {
  return currentActorUserId;
}

/**
 * Drop-in replacement for window.fetch that adds the actor header.
 * Headers passed by the caller take precedence over the auto-injected
 * one in case a specific call needs to override (e.g. server-to-server
 * proxying with a different identity).
 */
export function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (currentActorUserId && !headers.has('x-actor-user-id')) {
    headers.set('x-actor-user-id', currentActorUserId);
  }
  return fetch(input, { ...init, headers });
}
