import { api } from './api.js';

// What was done, batched, and never what was written.
//
// EVENTS, NEVER CONTENT. "A draft was requested on the Desk" is a fact about
// the app; what the draft said is a fact about a principal. This file can only
// send a name and a route, because it is never handed anything else — the
// shape of the function is the guarantee, not a promise to be careful.
//
// BATCHED, because a request per navigation is a request per navigation: on a
// sleeping free instance that is a queue of cold starts behind somebody trying
// to read their diary. Held in memory, flushed on a timer and when the page
// goes away, and dropped entirely if the flush fails — a lost count is worth
// nothing and a retry storm costs a tester their morning.

let queue = [];
let timer = null;

const FLUSH_MS = 15000;
// Enough that a busy stretch is not clipped; small enough that nothing is
// carried around for long.
const MAX_HELD = 40;

/**
 * Send what is held.
 *
 * `leaving` is not a detail. An ordinary fetch started as the page goes away is
 * cancelled with the page — so without this, every tester's last stretch of the
 * session is lost on every tab close and every real navigation, and the
 * screens they looked at last are exactly the ones a pilot most wants to know
 * about. sendBeacon exists for this one job: the browser takes the payload and
 * promises to send it whether or not the page survives.
 */
function flush(leaving = false) {
  if (!queue.length) return;
  const sending = queue;
  queue = [];
  clearTimeout(timer);
  timer = null;

  if (leaving && typeof navigator !== 'undefined' && navigator.sendBeacon) {
    try {
      const blob = new Blob([JSON.stringify({ events: sending })], { type: 'application/json' });
      // Same origin, so the session cookie goes with it.
      if (navigator.sendBeacon('/api/usage', blob)) return;
    } catch { /* fall through to the ordinary path */ }
  }
  // Counts are not worth a retry, still less a loop.
  api.post('/usage', { events: sending }).catch(() => {});
}

/**
 * Note that something happened.
 *
 * `event` is a short name from a fixed vocabulary at the call sites — 'screen',
 * 'kept_message', 'approved_booking'. `route` is where it happened; the server
 * strips identifiers out of it before storing.
 */
export function track(event, route) {
  if (!event) return;
  queue.push({ event: String(event).slice(0, 60), route: route || window.location.pathname });
  if (queue.length >= MAX_HELD) { flush(); return; }
  if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

/**
 * Send what is held before the page goes away.
 *
 * visibilitychange rather than unload: a phone browser backgrounding a tab
 * often never fires unload at all, which on a pilot run mostly used from a
 * phone would mean losing most of the afternoon.
 */
export function startUsage() {
  if (typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
  // pagehide as well, and not merely as a belt-and-braces second listener.
  // Safari fires it when a page goes into the back-forward cache without ever
  // marking the document hidden, so on an iPhone — which is most of a PA
  // pilot — visibilitychange alone loses the whole session the moment somebody
  // taps back. Flushing twice costs an empty request; flushing never costs the
  // afternoon.
  window.addEventListener('pagehide', () => flush(true));
}
