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
