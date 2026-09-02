import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';

/**
 * Everything AI Assist does, and where each of them is.
 *
 * WHY THIS EXISTS. The asks were deliberately put where the work is rather
 * than on one AI page: the briefing note belongs on the appointment, the
 * triage belongs on the correspondence, the catch-up belongs on the screen
 * that shows what you missed. That is the right place to USE them and the
 * worst possible place to DISCOVER them — somebody opening AI Assist sees a
 * box for finding a time and concludes that is all there is.
 *
 * So this is a contents page, not a second set of controls. It says what
 * exists, where it lives, and whether it is working yet. Pressing through
 * takes you to the screen that owns the ask.
 *
 * BUILT FROM THE REGISTER, never from a list typed here. A hand-written list
 * is a list that will one day describe a feature that has moved, been renamed
 * or been switched on — and a contents page that lies about the product is
 * worse than no contents page. The server already knows every capability, the
 * screen it sits on, the control it appears as and whether it is available;
 * this only arranges what it is told.
 */

// Where each screen id actually is. Two of these are not a fixed address — an
// appointment and a room are always a PARTICULAR one — so they are named as a
// place rather than linked, which is honest about there being nothing to
// click.
const WHERE = {
  catch_up: { label: 'While you were away', to: '/catch-up' },
  mail: { label: 'Correspondence', to: '/correspondence' },
  report: { label: 'Report', to: '/report' },
  appointment: { label: 'An appointment' },
  thread: { label: 'A room' },
  ai_assist: { label: 'here, on this screen' },
};

export default function AssistCatalogue() {
  const [caps, setCaps] = useState(null);

  useEffect(() => {
    api.get('/capabilities')
      .then((d) => setCaps((d.capabilities || []).filter((c) => c.id.startsWith('ai_'))))
      .catch(() => setCaps([]));
  }, []);

  if (!caps || caps.length === 0) return null;

  const ready = caps.filter((c) => c.available).length;

  return (
    <section className="card assist-catalogue">
      <h3 style={{ marginTop: 0 }}>What else AI Assist does</h3>
      <p className="hint">
        {ready === caps.length
          ? `All ${caps.length} are working. Each one lives on the screen where the work is.`
          : `${caps.length} of them, and they live on the screen where the work is rather `
            + 'than here. Each appears there as a named control that says what it is waiting '
            + `on when pressed${ready ? `; ${ready} are working already` : ''}.`}
      </p>

      <ul className="assist-catalogue-list">
        {caps.map((c) => {
          const where = WHERE[c.screen] || { label: c.screen };
          return (
            <li key={c.id}>
              <div className="assist-catalogue-head">
                <strong>{c.label}</strong>
                {!c.available && <span className="pill">Soon</span>}
              </div>
              <p className="hint" style={{ margin: '.15rem 0 .3rem' }}>{c.what}</p>
              <p className="hint" style={{ margin: 0 }}>
                {'On '}
                {where.to ? <Link to={where.to}>{where.label}</Link> : where.label}
                {c.control && <> as <strong>{c.control}</strong></>}
                {!c.available && c.needs?.length > 0 && (
                  <>
                    {' · waiting on '}
                    {c.needs.map((n, i) => (
                      <span key={n}>{i > 0 && ', '}<code>{n}</code></span>
                    ))}
                  </>
                )}
              </p>
            </li>
          );
        })}
      </ul>

      <p className="hint">
        None of them ever sends anything or files anything on its own. What comes back is a
        draft, and it is yours to accept, change or throw away.
      </p>
    </section>
  );
}
