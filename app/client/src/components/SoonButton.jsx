import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// A feature that is here by name, and not yet by function.
//
// The version of this that came before put a list at the foot of each screen.
// That is a footnote, and a footnote is not the same as seeing the feature: it
// tells somebody a thing is planned without ever showing them where it will
// live or what it will be called. So each unbuilt capability now stands in the
// place the working one will occupy, named the way it will be named, and
// visibly inert.
//
// PRESSING IT DOES SOMETHING, which is the part worth getting right. A control
// that is merely greyed out and swallows clicks reads as broken, and somebody
// being shown the product cannot tell a disabled button from a bug. This one
// answers: it opens a line saying it is not ready and what it is waiting on.
// Nobody has to guess whether they did something wrong.
//
// It disappears entirely once the capability reports itself available, so the
// real control can take the same spot without a second decision anywhere.

// One fetch for the whole page, however many placeholders are on it — these
// cluster (a trip has three) and a request each would be silly.
let cache = null;
function capabilities() {
  if (!cache) {
    cache = api.get('/capabilities')
      .then((d) => d.capabilities)
      .catch(() => { cache = null; return []; });
  }
  return cache;
}

export function useCapability(id) {
  const [cap, setCap] = useState(null);
  useEffect(() => {
    let live = true;
    capabilities().then((all) => { if (live) setCap(all.find((c) => c.id === id) || null); });
    return () => { live = false; };
  }, [id]);
  return cap;
}

/**
 * @param feature  capability id from server/lib/capabilities.js
 * @param label    overrides the registry's own control name, where a screen
 *                 has a better word for it in context
 * @param size     'sm' to sit among other small buttons
 */
export default function SoonButton({ feature, label, size = 'sm' }) {
  const cap = useCapability(feature);
  const [open, setOpen] = useState(false);

  // Nothing at all until we know, and nothing ever once it works — so the real
  // control drops into exactly this position with no other change.
  if (!cap || cap.available) return null;

  const soon = cap.state === 'soon' || !cap.needs?.length;

  return (
    <span className="soon-control">
      <button
        type="button"
        className={`btn btn-secondary${size === 'sm' ? ' btn-sm' : ''} is-soon`}
        // NOT aria-disabled. The button is genuinely operable — it is a
        // disclosure, and what is unavailable is the feature behind it. Marking
        // it disabled and then having it respond is the worst of both: a screen
        // reader announces "dimmed" and the thing reacts anyway. The tag says
        // Soon, the accessible name says it is not available, and pressing it
        // explains — all three agree.
        aria-expanded={open}
        aria-label={`${cap.label} — not available yet. Press for details.`}
        onClick={() => setOpen((o) => !o)}
      >
        {label || cap.control || cap.label}
        <span className="soon-tag">{soon ? 'Soon' : 'Not yet'}</span>
      </button>

      {open && (
        <span className="soon-why">
          <strong>{cap.label} is not available yet.</strong> {cap.what}
          {!soon && cap.needs?.length > 0 && (
            <>
              {' '}This deployment is waiting on{' '}
              {cap.needs.map((n, i) => (
                <span key={n}>{i > 0 ? ', ' : ''}<code>{n}</code></span>
              ))}.
            </>
          )}
        </span>
      )}
    </span>
  );
}
