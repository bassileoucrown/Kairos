/**
 * The browser telling the server it broke.
 *
 * A white screen is the worst kind of fault: the person sees nothing, so they
 * report nothing, and the only trace is in a console nobody opened. This sends
 * the message and the stack — no more than that, and never what was on the
 * page — so an operator can find out that a screen is failing without waiting
 * to be told.
 *
 * Deliberately hand-rolled rather than a vendor SDK. It is thirty lines, it
 * adds no dependency to a client that displays passport numbers, and nothing
 * about the fault leaves this deployment.
 */

// Two guards against a broken page reporting itself into a loop: the same
// fault is only sent once per session, and there is a hard ceiling.
const seen = new Set();
let sent = 0;
const MAX_PER_SESSION = 10;

export function reportError(message, stack) {
  try {
    if (!message) return;
    const key = String(message).slice(0, 200);
    if (seen.has(key) || sent >= MAX_PER_SESSION) return;
    seen.add(key);
    sent += 1;

    const body = JSON.stringify({
      message: String(message).slice(0, 500),
      stack: String(stack || '').slice(0, 4000),
      // The path only. A query string here can carry a booking's manage
      // token, which is that booking's key.
      url: window.location.pathname,
    });

    // keepalive so a fault thrown during navigation still gets out.
    fetch('/api/errors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Reporting a fault must never raise one.
  }
}

/** Catch what the app does not catch itself. */
export function installErrorReporting() {
  window.addEventListener('error', (e) => {
    reportError(e.message, e.error?.stack);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    reportError(r?.message || String(r), r?.stack);
  });
}
