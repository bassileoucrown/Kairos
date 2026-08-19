import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// "Not available yet", said in one voice everywhere it needs saying.
//
// The alternative is each screen deciding for itself, which fails in both
// directions: a hardcoded "coming soon" keeps saying it long after the
// credential is set, and a screen that says nothing quietly offers a button
// that does nothing. Both are how a product loses the right to be believed
// about anything else — including the parts that do work.
//
// So the server answers, from the same environment the feature itself reads
// (server/lib/capabilities.js). Set MAPS_API_KEY and the notice on the
// itinerary disappears by itself, because the notice and the feature are
// asking the same question.

/** Everything not working yet on one screen. Empty once they all work. */
export function useNotYet(screen) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let live = true;
    api.get(`/capabilities?screen=${encodeURIComponent(screen)}`)
      .then((d) => { if (live) setItems(d.capabilities.filter((c) => !c.available)); })
      .catch(() => { /* a missing notice is better than a broken screen */ });
    return () => { live = false; };
  }, [screen]);
  return items;
}

/**
 * The badge itself.
 *
 * Two labels, because they are two different promises. "Coming soon" asks a
 * principal to wait for work that is ours. "Not available yet" plus the
 * variable name hands an operator something they can do this afternoon — and
 * the variable is only ever shown to somebody already inside the account.
 */
export function NotYetBadge({ item, showNeeds = false }) {
  const soon = item.state === 'soon' || !item.needs?.length;
  return (
    <span className={`notyet${soon ? '' : ' is-key'}`}>
      {soon ? 'Coming soon' : 'Not available yet'}
      {showNeeds && !soon && item.needs?.length > 0 && (
        <span className="notyet-needs">{item.needs.join(' · ')}</span>
      )}
    </span>
  );
}

/**
 * A panel listing what a screen cannot do yet.
 *
 * Placed at the foot of the screen rather than the top on purpose: somebody
 * came here to use what works, and a page that opens with an apology buries
 * it. Renders nothing at all once everything on the screen works.
 */
export default function NotYet({ screen, showNeeds = false }) {
  const items = useNotYet(screen);
  if (items.length === 0) return null;
  return (
    <section className="notyet-panel">
      <h3>Not on this screen yet</h3>
      <ul>
        {items.map((c) => (
          <li key={c.id}>
            <span className="notyet-label">{c.label}</span>
            <NotYetBadge item={c} showNeeds={showNeeds} />
            <span className="notyet-what">{c.what}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
