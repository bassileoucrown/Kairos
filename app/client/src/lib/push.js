import { api } from './api.js';

/**
 * Saying yes to being interrupted.
 *
 * THE BROWSER'S PERMISSION IS THE SETTING. There is no "notifications on"
 * switch stored in Kairos, deliberately: the browser already holds that answer,
 * a person can change it there without telling us, and a second copy would be
 * free to disagree with the first. So every question here is asked of the
 * browser, and the server only ever records what the browser handed back.
 *
 * WHY THIS CANNOT JUST BE ASKED ON ARRIVAL. A permission prompt shown to
 * somebody in their first ten seconds is denied, and a denial is close to
 * permanent — the browser stops asking, and the only way back is a settings
 * screen most people will never find. So it is behind a button, on a screen
 * about notifications, pressed by somebody who has decided they want them.
 */

/** The three states worth telling apart, plus "this browser cannot at all". */
export function pushState() {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported';
  }
  // 'denied' is the one that needs different words: nothing this app does can
  // undo it, and offering the button again would be offering something that
  // cannot work.
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

const toBytes = (base64url) => {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** The subscription this browser already has for Kairos, if any. */
export async function currentSubscription() {
  if (pushState() === 'unsupported') return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) || null;
}

/**
 * Ask, subscribe, and tell the server.
 *
 * Answers with a word rather than throwing, because every failure here is
 * something to say on the screen: the deployment has no keys, the browser said
 * no, the page is not on https.
 */
export async function enablePush() {
  if (pushState() === 'unsupported') return { ok: false, reason: 'unsupported' };

  const config = await api.get('/push/config');
  if (!config.configured) return { ok: false, reason: 'unconfigured', problem: config.problem };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: permission };

  // ready rather than getRegistration: the worker may still be installing on a
  // first visit, and subscribing against a registration that is not active yet
  // fails in a way that reads as a refusal.
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    // Required by every browser worth supporting, and honest: every push this
    // app sends does show something. See public/sw.js.
    userVisibleOnly: true,
    applicationServerKey: toBytes(config.publicKey),
  });

  const json = sub.toJSON();
  await api.post('/push/subscribe', { endpoint: json.endpoint, keys: json.keys });
  return { ok: true };
}

/**
 * Not on this device any more.
 *
 * Both halves, in this order: the browser's subscription is cancelled and the
 * server's row is removed. Dropping only the row would leave a live
 * subscription the browser keeps honouring; cancelling only the subscription
 * would leave a row Kairos pushes to forever and counts as a device.
 */
export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return { ok: true };
  const { endpoint } = sub.toJSON();
  await sub.unsubscribe().catch(() => {});
  await api.del('/push/subscribe', { endpoint }).catch(() => {});
  return { ok: true };
}
