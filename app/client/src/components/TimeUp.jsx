import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

// Saying that a meeting is nearly over, and then that it is.
//
// The count happens here rather than on the server. A server that pushed
// "eight minutes left" would have to be asked every minute by every open tab
// and would still be wrong for whoever's clock had drifted; two timestamps and
// a local tick are both cheaper and more accurate. The server is asked once a
// minute for *what is running*, which changes rarely.
//
// TWO MOMENTS, NOT A COUNTDOWN THAT NAGS. One warning at the point the
// principal chose, one when the time is actually up, and nothing in between.
// A banner that pulses for the last ten minutes of every meeting is a banner
// people learn to look past, and then the one that matters goes past too.
//
// WHO HEARS IT. Whoever is looking at that principal — the principal
// themselves, and any assistant with them selected in the switcher. It follows
// the same principal the rest of the shell does, so a PA with three principals
// is never chimed at about a meeting they are not sitting in.

const POLL_MS = 60000;
const SEEN_KEY = 'kairos_timeup_seen';

/** A short, soft two-tone chime, synthesised so there is no asset to ship. */
function chime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    // A browser that has never been clicked in will not make a sound, and
    // says so by staying suspended. Nothing to be done about it, and nothing
    // that should throw.
    const at = ctx.currentTime;
    for (const [i, freq] of [880, 1174].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.16, at + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + i * 0.18 + 0.34);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at + i * 0.18);
      osc.stop(at + i * 0.18 + 0.36);
    }
    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch {
    // No sound is a degraded alert, not a broken screen.
  }
}

// What has already been chimed for, so a page reload at 10:56 does not chime
// again for a warning heard at 10:55. Per browser, which is right: the alert
// is about the person sitting there.
function loadSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); }
}
function saveSeen(set) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...set].slice(-40))); } catch { /* private window */ }
}

function minutesLeft(endAt, now) {
  return Math.round((new Date(endAt).getTime() - now) / 60000);
}

export default function TimeUp({ principalId }) {
  const [state, setState] = useState(null);
  const [alert, setAlert] = useState(null);
  const seen = useRef(loadSeen());

  // What is running, refreshed slowly. This is the only network traffic the
  // feature makes.
  useEffect(() => {
    if (!principalId) return undefined;
    let live = true;
    const pull = () => {
      api.get(`/rhythm/${principalId}/now`)
        .then((d) => { if (live) setState(d); })
        .catch(() => { /* a rail that cannot fail a page */ });
    };
    pull();
    const t = setInterval(pull, POLL_MS);
    return () => { live = false; clearInterval(t); };
  }, [principalId]);

  // The tick. Every fifteen seconds is close enough to the minute for a
  // warning about minutes, and cheap enough to leave running.
  useEffect(() => {
    if (!state?.running?.length) return undefined;
    const check = () => {
      const now = Date.now();
      for (const item of state.running) {
        const left = minutesLeft(item.endAt, now);
        const started = new Date(item.startAt).getTime() <= now;
        if (!started) continue;

        // Time is up: fires once, from the minute it ends until fifteen
        // minutes after, so somebody who looks up late is still told.
        if (left <= 0 && left > -15) {
          const key = `${item.id}:over`;
          if (!seen.current.has(key)) {
            seen.current.add(key); saveSeen(seen.current);
            chime();
            setAlert({ item, kind: 'over' });
          }
          continue;
        }
        // Nearly up, at the point the principal chose. Skipped entirely when
        // they set the warning to zero.
        if (state.warnMinutes > 0 && left > 0 && left <= state.warnMinutes) {
          const key = `${item.id}:soon`;
          if (!seen.current.has(key)) {
            seen.current.add(key); saveSeen(seen.current);
            chime();
            setAlert({ item, kind: 'soon', left });
          }
        }
      }
    };
    check();
    const t = setInterval(check, 15000);
    return () => clearInterval(t);
  }, [state]);

  if (!alert) return null;
  const { item, kind } = alert;
  const left = minutesLeft(item.endAt, Date.now());

  return (
    <div className="timeup" role="alertdialog" aria-live="assertive" aria-labelledby="timeup-head">
      <div className="timeup-card">
        <div className={'timeup-mark' + (kind === 'over' ? ' is-over' : '')} aria-hidden="true">
          {kind === 'over' ? '■' : '●'}
        </div>
        <div className="timeup-body">
          <strong id="timeup-head">
            {kind === 'over'
              ? 'Time is up'
              : `${left} minute${left === 1 ? '' : 's'} left`}
          </strong>
          <span className="timeup-what">
            {item.title}
            {item.withWhom ? ` with ${item.withWhom}` : ''}
          </span>
          {kind === 'over' && state?.gapMinutes > 0 && (
            <span className="timeup-what">
              You have {state.gapMinutes} minutes before anything else can start.
            </span>
          )}
        </div>
        <button className="btn btn-secondary btn-sm" type="button" onClick={() => setAlert(null)}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
