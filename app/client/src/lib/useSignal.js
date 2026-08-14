import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';

// Keeping two phones showing the same thing.
//
// The server decides what the signal is and when it next changes, so neither
// phone's clock is trusted and neither can drift. What is left is scheduling:
// both sides refetch at the instant the server named, rather than whenever
// their own polling interval happens to come round. Without that, a driver on
// a five-second poll and a principal on a five-second poll can be up to five
// seconds apart on either side of a change — which, in the twenty seconds
// somebody spends scanning a hall, is long enough to look for the wrong thing.
//
// The heartbeat underneath it exists for one fact the schedule cannot predict:
// the principal tapping "that is them". Nothing tells the driver's phone that
// has happened, so it asks — quickly, because that tap is the whole handshake.
// The principal's own screen has nothing to learn this way (their tap updates
// it from the reply) and asks far less often.
const HEARTBEAT_MS = 5000;
const SETTLED_HEARTBEAT_MS = 15000;

// A moment past the change, not on it, so a fast phone does not ask for the
// next window a few milliseconds before the server agrees there is one.
const SETTLE_MS = 400;

export function useSignal(path, { enabled = true, heartbeatMs = HEARTBEAT_MS } = {}) {
  const [signal, setSignal] = useState(null);
  const [error, setError] = useState('');
  const timer = useRef(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (!enabled || !path) return undefined;

    async function tick() {
      try {
        const d = await api.get(path);
        if (!alive.current) return;
        setSignal(d.signal);
        setError('');
        schedule(d.signal);
      } catch (e) {
        if (!alive.current) return;
        setError(e.message);
        // A network blip in an airport is ordinary and not worth surrendering
        // to; keep asking at the slow rate until it comes back.
        timer.current = setTimeout(tick, SETTLED_HEARTBEAT_MS);
      }
    }

    function schedule(s) {
      const heartbeat = s?.found ? Math.max(heartbeatMs, SETTLED_HEARTBEAT_MS) : heartbeatMs;
      const untilChange = s?.changesAt
        ? Date.parse(s.changesAt) + SETTLE_MS - Date.now()
        : Infinity;
      const wait = Math.max(500, Math.min(heartbeat, untilChange));
      timer.current = setTimeout(tick, wait);
    }

    tick();
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, [path, enabled, heartbeatMs]);

  return { signal, error, setSignal };
}

/**
 * Keeps the screen on while a phone is being held up.
 *
 * A driver holds his phone out at arm's length and does not touch it again;
 * thirty seconds later the display sleeps and he is holding a black rectangle
 * while the principal walks past him. The permission is best-effort — Safari
 * and older Android simply do not have it — so this never reports a failure,
 * it just does what it can.
 */
export function useAwakeScreen(active) {
  useEffect(() => {
    if (!active || !navigator.wakeLock) return undefined;
    let lock = null;
    let live = true;

    const take = () => navigator.wakeLock.request('screen')
      .then((l) => { if (live) lock = l; else l.release().catch(() => {}); })
      .catch(() => {});

    // Re-taken on return, because the lock is dropped whenever the tab is
    // hidden — including the moment the driver answers the phone.
    const onVisible = () => { if (document.visibilityState === 'visible') take(); };
    take();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch(() => {});
    };
  }, [active]);
}
