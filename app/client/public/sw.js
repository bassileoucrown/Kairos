/* eslint-env serviceworker */

/**
 * What Kairos keeps on the device, and — much more importantly — what it does
 * not.
 *
 * THE ONE RULE: /api IS NEVER TOUCHED. Not cached, not intercepted, not read.
 * This product holds identity documents, a principal's whereabouts, and the
 * office's private notes about people. A service worker is code that sits in
 * front of every request the app makes, and a cached API response is a copy of
 * somebody's private diary sitting in a store that outlives the session,
 * survives signing out, and is readable by anything else that ever runs on
 * that origin. There is no cache policy careful enough to be worth that; the
 * safe amount of private data in the cache is none.
 *
 * A stale answer would be its own hazard even without the privacy one. "Where
 * is the principal at three" answered from a cache written yesterday is worse
 * than no answer, because it looks like an answer.
 *
 * So this caches exactly two things, and both are public:
 *
 *   1. The build's own static files — JS, CSS, fonts, icons. Vite stamps a
 *      content hash into every filename, so a given URL's contents can never
 *      change. Cache-first is safe by construction: a new build means new
 *      names, not new contents at old names.
 *
 *   2. The shell — index.html — network first, falling back to the last good
 *      copy. Network first because its job is to point at the current build's
 *      hashed files, and a stale shell asks for files that have been swept
 *      away. The fallback exists so an installed app opens on a plane and can
 *      say so in its own words rather than showing the browser's dinosaur.
 */

const VERSION = 'kairos-v1';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;

// Everything this worker is allowed to hold. Anything from an older version,
// or a store this file no longer knows about, is swept on activation.
const MINE = new Set([SHELL, ASSETS]);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // Only the shell, and failure to fetch it is not failure to install: an
    // install that dies because the network blinked leaves no worker at all.
    await cache.add(new Request('/', { cache: 'reload' })).catch(() => {});
    // A new worker should take over rather than wait for every tab to close.
    // Safe here BECAUSE nothing dynamic is cached: the worst a mid-session
    // takeover can do is serve a fresher shell.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (!MINE.has(name)) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

/**
 * Signing out empties the store.
 *
 * Nothing private is in it, so this is belt and braces rather than the wall —
 * but a shared device is a real thing in this product's world (an assistant's
 * laptop, a driver's phone), and "the previous person's app shell" is a small
 * confusion worth not leaving behind.
 */
self.addEventListener('message', (event) => {
  if (event.data === 'kairos-signed-out') {
    event.waitUntil(Promise.all([...MINE].map((n) => caches.delete(n))));
  }
});

const isAsset = (url) => /\/assets\/|\/icons\/|\.(?:js|css|woff2?|png|svg|jpg|jpeg|webp|ico)$/.test(url.pathname);

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Another origin's business is not ours to cache or to touch.
  if (url.origin !== self.location.origin) return;

  // THE RULE. Left entirely alone — no respondWith, so the browser does what
  // it would have done with no worker installed at all. Listed before
  // everything else so no later branch can ever claim one of these.
  if (url.pathname.startsWith('/api/')) return;

  // Nor anything a person is meant to hold rather than the app: a booker's
  // manage link and a driver's card are bearer URLs, and a copy of either
  // sitting in a cache is a copy of the credential.
  if (url.pathname.startsWith('/book/') || url.pathname.startsWith('/pickup/')) return;

  if (isAsset(url)) {
    // Immutable by hash: if it is here, it is right.
    event.respondWith((async () => {
      const hit = await caches.match(request);
      if (hit) return hit;
      const res = await fetch(request);
      if (res.ok && res.type === 'basic') {
        const cache = await caches.open(ASSETS);
        cache.put(request, res.clone());
      }
      return res;
    })());
    return;
  }

  // Navigations: the current shell if the network can give one, the last good
  // one if it cannot.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(request);
        if (res.ok) {
          const cache = await caches.open(SHELL);
          cache.put('/', res.clone());
        }
        return res;
      } catch {
        return (await caches.match('/')) || Response.error();
      }
    })());
  }
});

/* --- Reaching a phone that is not open ------------------------------------
 *
 * Everything above is about not keeping things. This is the opposite job and
 * obeys the same rule: the notification is DISPLAYED and nothing is stored.
 *
 * WHAT ARRIVES IS ALREADY DECIDED. The server sends a title, a line, and a
 * URL — never the message. See lib/webPush.js for why: a notification is read
 * by whoever is holding the phone, and in this product the message is quite
 * likely to be where a principal will be at three o'clock. So this worker does
 * not need to be careful about what it shows, because there is nothing careless
 * in what it is given.
 *
 * A push with no readable payload still has to show SOMETHING. Every browser
 * that grants permission does so on the promise that a push is user-visible,
 * and one that displays nothing gets the permission revoked wholesale — so the
 * fallback is a real notification, not a silent return.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || 'Kairos';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || 'Something is waiting for you.',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    // One line per conversation rather than a stack of twenty. A phone that has
    // been in a pocket should light up saying the latest, not the backlog.
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || '/' },
  }));
});

/**
 * Tapping it goes to the thing, not to the front door.
 *
 * An already-open Kairos is focused and navigated rather than a second window
 * being opened beside it — somebody who taps a notification means "show me
 * that", and being given a duplicate tab is a small daily annoyance that adds
 * up on a phone.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      await client.focus();
      if ('navigate' in client) await client.navigate(target);
      return;
    }
    await self.clients.openWindow(target);
  })());
});
