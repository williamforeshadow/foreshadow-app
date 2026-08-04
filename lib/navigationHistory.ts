// In-app navigation depth, so a back affordance can mean "where you came from"
// instead of a destination hard-coded at build time.
//
// ---- The problem ----------------------------------------------------
//
// Every back arrow in this app used to be a static parent link. That is wrong
// far more often than it is right: `/tasks/[id]` alone is reachable from eleven
// places (the four dashboard windows, a property's schedule and task ledger, a
// guest message thread, the global context overlay, a push notification, and
// Slack), and all eleven exited to `/tasks`.
//
// Plain `router.back()` is not the fix either — on a cold entry from Slack there
// is no in-app history, and back() either does nothing or leaves the app. What
// we need is one question answered honestly: *did the user arrive here from
// another screen inside this document?*
//
// ---- How the depth is tracked ---------------------------------------
//
// We stamp a monotonic index into `window.history.state` on each entry. Next
// preserves custom keys in history state in exactly the two cases we depend on:
// back/forward traversal (`restore-reducer` sets `preserveCustomHistoryState`)
// and a full reload (`create-initial-router-state` does the same). So an entry
// we stamped once still knows its own depth when the user traverses back onto
// it, or reloads on top of it.
//
// Incrementing is the subtle part. `window.history.length` cannot tell a push
// from a replace, because a push *prunes* forward entries:
//
//     open /              length 1
//     push /tasks/<a>     length 2
//     back to /           length 2
//     push /tasks/<b>     length 2   <-- grew by nothing, but it IS a push
//
// A length-delta heuristic reads that last step as a replace and concludes the
// user cannot go back — i.e. it breaks on "open a task, close it, open another
// one", which is the single most common flow in the app. So instead we wrap
// `window.history.pushState` and count the pushes directly. A push is always
// exactly one step deeper than the entry it was made from, pruning or not.
//
// Wrapping is safe and order-independent. app-router.js patches pushState too,
// short-circuiting to the native implementation when the payload carries its
// `__NA` marker. Whichever of us patches first, the other ends up in the same
// call chain, so our wrapper observes every push either way.
//
// ---- Failure behaviour ----------------------------------------------
//
// Under-counting is safe: the caller falls back to its hierarchical parent,
// which is the behaviour this module replaced. Over-counting would give a dead
// back button, so nothing here ever guesses upward — the index only moves on an
// observed pushState or a stamp we previously wrote ourselves. If the wrapper
// cannot be installed at all, `canGoBack()` stays false forever and every
// affordance quietly reverts to its old static destination.

/**
 * Key stamped into `window.history.state`. Prefixed and shortened in the same
 * spirit as Next's own `__NA` — it shares the object with the router's private
 * state, so it needs to be unmistakably ours and cheap to serialise.
 */
const NAV_INDEX_KEY = '__fsNavIdx';

/**
 * How long to wait for `history.back()` to actually move before giving up and
 * pushing the fallback instead. Generous enough for a same-document traversal
 * (which is synchronous-ish) without being perceptible as a stall.
 */
const BACK_TIMEOUT_MS = 150;

// Module scope rather than React refs: these numbers describe the *document's*
// history, not any component's lifecycle. Refs would also be double-counted by
// StrictMode's double-invoked effects in dev.
let index = 0;
let patched = false;

function readStamp(): number | null {
  if (typeof window === 'undefined') return null;
  const state = window.history.state as Record<string, unknown> | null;
  const raw = state?.[NAV_INDEX_KEY];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function writeStamp(value: number): void {
  if (typeof window === 'undefined') return;
  try {
    // Spreading the current state is load-bearing, not tidiness. It carries
    // Next's `__NA` marker, and app-router's patched replaceState short-circuits
    // straight to the native implementation whenever `__NA` is present. Drop the
    // spread and the patch instead treats this as an external history mutation
    // and dispatches ACTION_RESTORE — re-rendering the tree on every stamp.
    const current = (window.history.state as Record<string, unknown> | null) ?? {};
    window.history.replaceState({ ...current, [NAV_INDEX_KEY]: value }, '');
  } catch {
    // Some embedded webviews rate-limit replaceState. A lost stamp is
    // recoverable — the next commit re-stamps — so degrade quietly.
  }
}

/**
 * Wrap `window.history.pushState` so every push bumps the depth, and adopt the
 * current entry's stamp if it already has one (reload / restored session).
 *
 * Idempotent, and safe to call from an effect that React may invoke twice.
 */
export function installNavigationTracking(): void {
  if (typeof window === 'undefined' || patched) return;

  try {
    const nativePush = window.history.pushState.bind(window.history);
    window.history.pushState = function stampedPushState(
      data: unknown,
      unused: string,
      url?: string | URL | null,
    ) {
      const result = nativePush(data, unused, url);
      // The push has landed and the new entry is current. Stamp it now rather
      // than waiting for the route effect: a push that only changes the hash
      // never produces a pathname/search commit, and would otherwise leave the
      // new entry unstamped.
      index += 1;
      writeStamp(index);
      return result;
    };
    patched = true;
  } catch {
    // Leave `patched` false. canGoBack() then stays pessimistic and every back
    // affordance falls back to its hierarchical parent.
    return;
  }

  const stamped = readStamp();
  if (stamped === null) writeStamp(index);
  else index = stamped;
}

/**
 * Reconcile the depth with the entry the user is now on. Call once per
 * committed navigation.
 *
 * Pushes are already handled inside the pushState wrapper, so in practice this
 * covers traversal, reload, and replaces.
 */
export function commitNavigation(): void {
  if (typeof window === 'undefined' || !patched) return;

  const stamped = readStamp();
  if (stamped !== null) {
    // Authoritative: this entry was stamped when it was created, and Next
    // preserved the stamp through the traversal or reload that brought us back
    // onto it.
    index = stamped;
    return;
  }

  // No stamp means something wiped it — a `replace` navigation (navigate-reducer
  // clears preserveCustomHistoryState), or a raw window.history.replaceState
  // elsewhere in the app, as app/messages/concierge-training/page.tsx does when
  // it syncs a selection into the URL. None of those create an entry, so the
  // depth is unchanged; re-stamp so this entry is authoritative again if the
  // user later traverses back onto it.
  writeStamp(index);
}

/** Current in-app depth. 0 means this entry is where the document started. */
export function getNavIndex(): number {
  return index;
}

/**
 * Whether `history.back()` would land on another screen of this app.
 *
 * True only when at least one push has been observed in this document, which
 * means the previous entry is necessarily one of ours — arriving from Slack, a
 * push notification, or a bookmark all start at 0 and report false.
 */
export function canGoBack(): boolean {
  return patched && index > 0;
}

/**
 * Go back if that stays inside the app; otherwise run `onFallback`.
 *
 * The timeout is belt-and-braces: if `back()` somehow doesn't move (a stale
 * index, a webview that swallows the traversal), we run the fallback rather
 * than leaving the user on a screen whose back button did nothing. A
 * cross-document traversal unloads the page and takes the timer with it, so
 * there is no risk of navigating twice.
 */
export function attemptBack(onFallback: () => void): void {
  if (typeof window === 'undefined') return;

  if (!canGoBack()) {
    onFallback();
    return;
  }

  const before = window.location.href;
  let timer = 0;
  const cancel = () => window.clearTimeout(timer);

  timer = window.setTimeout(() => {
    window.removeEventListener('popstate', cancel);
    if (window.location.href === before) onFallback();
  }, BACK_TIMEOUT_MS);

  window.addEventListener('popstate', cancel, { once: true });
  window.history.back();
}
