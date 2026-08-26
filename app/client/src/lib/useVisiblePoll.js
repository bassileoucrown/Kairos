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
 *
 * `ms` MAY BE A FUNCTION, asked before each wait rather than once at the start.
 * That is what lets a screen be quick when it matters and quiet when it does
 * not — a conversation somebody is having asks every couple of seconds, and
 * the same conversation twenty minutes later asks every thirty. A fixed
 * interval cannot do both, and picking one number meant picking which half to
 * get wrong. Chained timeouts rather than setInterval for the same reason:
 * each wait is decided when it begins.
 *
 * FOCUS AS WELL AS VISIBILITY. visibilitychange covers switching tabs and
 * locking a phone. It does NOT fire for clicking from another window back onto
 * this one, which on a laptop is the commonest way of returning to something
 * you left open — so that is listened for too, and both lead to the same
 * place: ask now, then resume the rhythm.
 */
export function useVisiblePoll(fn, ms) {
  // Held in a ref so a caller can pass an inline arrow without restarting the
  // timer on every render — which would mean it never actually fired.
  const saved = useRef(fn);
  useEffect(() => { saved.current = fn; }, [fn]);
  // Same for the interval, so passing `() => something` does not re-arm on
  // every render either.
  const every = useRef(ms);
  useEffect(() => { every.current = ms; }, [ms]);

  useEffect(() => {
    let timer = null;
    let stopped = false;

    const wait = () => {
      const next = typeof every.current === 'function' ? every.current() : every.current;
      if (!next || stopped) return;
      timer = setTimeout(() => { saved.current?.(); wait(); }, next);
    };
    const stop = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const start = () => { stop(); wait(); };

    // Coming back is the moment the screen is most likely to be stale, so the
    // question is asked immediately rather than after another full wait.
    const resume = () => {
      if (document.visibilityState !== 'visible') { stop(); return; }
      saved.current?.();
      start();
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    return () => {
      stopped = true;
      stop();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
    };
  }, []);
}

export default useVisiblePoll;
