import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

/**
 * What this feature does, and how to use it — on the feature itself.
 *
 * REPLACES THE SINGLE NOTE ON TODAY. One orientation panel on the landing
 * screen was read once, on the screen that needed it least, and said nothing
 * at all on the twenty-nine other screens where somebody actually had a
 * question. See lib/guide.js on the server for the reasoning; this is only the
 * arrangement of what it is told.
 *
 * OPEN THE FIRST TIME, FOLDED AFTERWARDS. A panel that is always open becomes
 * furniture by the third visit and is scrolled past; one that is always folded
 * is never opened at all. So the first arrival at a feature gets the whole
 * thing without asking, and every arrival after that gets one line with the
 * heading on it, which is enough to find again and small enough to ignore.
 *
 * Remembered in the browser rather than on the account, deliberately. This is
 * a reading state, not a fact about the person: it is worth nothing on another
 * device, it should never be a row in a database, and the cost of it opening
 * once more on a new machine is one tap.
 *
 * NEVER FAILS THE SCREEN IT IS ON. A guidance panel that can take down the
 * feature it describes is worse than no guidance, so a failed fetch renders
 * nothing and the screen stands exactly as it did.
 */

const KEY = 'kairos_guide_seen';

function seen() {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return new Set(); }
}

function markSeen(id) {
  try {
    const s = seen();
    s.add(id);
    localStorage.setItem(KEY, JSON.stringify([...s]));
  } catch { /* private window: it simply opens again next time */ }
}

export default function WhatThisDoes({ id }) {
  const [f, setF] = useState(null);
  // Read once at mount rather than on every render: the moment this component
  // marks itself seen, the answer changes, and a panel that folded itself shut
  // while somebody was reading it would be the one bug this cannot afford.
  const [open, setOpen] = useState(() => !seen().has(id));

  useEffect(() => {
    let live = true;
    api.get(`/guide/${id}`)
      .then((d) => { if (live) setF(d.feature); })
      .catch(() => { /* guidance must not be able to break a screen */ });
    return () => { live = false; };
  }, [id]);

  useEffect(() => { if (f && open) markSeen(id); }, [f, open, id]);

  if (!f) return null;

  return (
    <section className={'what-this-does' + (open ? ' is-open' : '')}>
      <button
        className="what-this-head"
        type="button"
        aria-expanded={open}
        onClick={() => { setOpen((v) => !v); markSeen(id); }}
      >
        <span className="what-this-mark" aria-hidden="true">{open ? '−' : '+'}</span>
        <span className="what-this-title">What {f.title} does</span>
        {!open && <span className="what-this-peek">{f.does}</span>}
      </button>

      {open && (
        <div className="what-this-body">
          <p className="what-this-does-line">{f.does}</p>

          <ol className="what-this-steps">
            {f.how.map((step) => <li key={step}>{step}</li>)}
          </ol>

          {f.note && <p className="hint what-this-note">{f.note}</p>}

          {/* Anything on this screen that is not working yet, answered from the
              same register the feature itself reads — so guidance can never
              tell a tester to try something that is switched off. */}
          {f.notYet.length > 0 && (
            <p className="hint what-this-note">
              {'Not working here yet: '}
              {f.notYet.map((c, i) => (
                <span key={c.id}>
                  {i > 0 && ', '}
                  <strong>{c.control}</strong>
                  {c.state === 'needs_key' ? ' (waiting on this deployment)' : ' (coming)'}
                </span>
              ))}
              .
            </p>
          )}

          <p className="hint what-this-note">
            Something confusing or wrong? Press <strong>Tell us</strong> at the bottom of any
            screen. It sends your name and which screen you were on — never anything you have
            written, and nothing from Essentials, ever.
          </p>
        </div>
      )}
    </section>
  );
}
