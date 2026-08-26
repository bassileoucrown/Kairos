import { useEffect, useRef } from 'react';

/**
 * Ask again, but only while somebody is looking.
 *
 * WHY VISIBILITY IS THE WHOLE POINT. A phone in a pocket with the screen off
 * should not be asking a server anything, and a laptop with fifteen tabs open
 * should not have Kairos waking up in one of them every half minute. So the
 * timer runs while the document is visible and stops when it is not — and it
 * fires ONCE IMMEDIATELY on coming back, because the moment somebody returns
 * to the tab is exactly the moment the screen is most likely to be stale.
 *
 * That last part matters more than the interval. Somebody glancing back at
 * Kairos after an hour cares about what changed; somebody staring at it for a
 * minute mostly does not.
 *
 * Deliberately not a socket. The thing being answered — "has anything arrived
 * for me" — is cheap, tolerates being a few seconds late, and works through
 * every proxy and captive portal a principal's phone will meet in an airport.
 * A live connection would be more elegant and less reliable, and would have to
 * be reconnected on exactly the transitions this handles for free.
 */
export function useVisiblePoll(fn, ms) {
  // Held in a ref so a caller can pass an inline arrow without restarting the
  // timer on every render — which would mean it never actually fired.
  const saved = useRef(fn);
  useEffect(() => { saved.current = fn; }, [fn]);

  useEffect(() => {
    if (!ms) return undefined;
    let timer = null;

    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const start = () => {
      stop();
      timer = setInterval(() => saved.current?.(), ms);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        saved.current?.();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ms]);
}

export default useVisiblePoll;
