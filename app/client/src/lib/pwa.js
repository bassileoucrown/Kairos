/**
 * Installing Kairos onto a phone, and keeping the installed copy current.
 *
 * WHY INSTALL AT ALL. A principal opens their day forty times a week. Through a
 * browser that is a tab among thirty, behind an address bar, with the URL to
 * remember. Installed it is an icon on the home screen that opens on Today —
 * and on iOS, being installed is also the ONLY way the app is ever allowed to
 * send a push notification, so this is the foundation of that too.
 */

let deferred = null;
const listeners = new Set();

function announce() {
  for (const fn of listeners) fn();
}

/** Whether the app is already running as an installed app rather than a tab. */
export function isInstalled() {
  return window.matchMedia?.('(display-mode: standalone)').matches
    // iOS says it its own way and always has.
    || window.navigator.standalone === true;
}

/** iOS offers no install prompt, so it has to be explained rather than offered. */
export function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    // iPadOS reports itself as a Mac; a touch point is what gives it away.
    || (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

export function canPrompt() {
  return !!deferred;
}

export function onInstallability(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Ask, once, at a moment the person chose.
 *
 * Chrome fires beforeinstallprompt when IT thinks the app is worth installing
 * and lets the page hold the event to use later. Held rather than fired on
 * arrival on purpose: an install dialog thrown at somebody in their first ten
 * seconds is the reason people have learned to dismiss them unread.
 */
export async function promptInstall() {
  if (!deferred) return 'unavailable';
  const event = deferred;
  deferred = null;
  announce();
  event.prompt();
  const { outcome } = await event.userChoice;
  return outcome; // 'accepted' | 'dismissed'
}

export function register() {
  if (typeof window === 'undefined') return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    announce();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    announce();
  });

  if (!('serviceWorker' in navigator)) return;
  // After load, so registering never competes with the first paint for
  // bandwidth on a phone that is already struggling.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // A worker that will not register means no offline shell and no install
      // prompt. Everything else works exactly as before, so this is not worth
      // a message to somebody trying to read their day.
    });
  });
}

/**
 * Told when somebody signs out, so a shared device does not keep the last
 * person's shell. Nothing private is in the cache — see public/sw.js — but a
 * laptop passed between two assistants is an ordinary thing here.
 */
export function signedOut() {
  navigator.serviceWorker?.controller?.postMessage('kairos-signed-out');
}
