import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api.js';

// The card the person driving holds, on their phone, with no account.
//
// DESIGNED FOR A WINDSCREEN, NOT A DESK. Everything on it is thumb-sized and
// there are four things to do, because somebody at a kerb in Lagos traffic
// will not scroll a page or read a paragraph. Anything that needed explaining
// is not here.
//
// IT NAMES NOBODY. No principal, no escort, no notes — see cardFor in
// lib/enRoute.js. This link has no password and can be forwarded, so it shows
// a journey between two places in a car with a plate and nothing that says
// whose journey it is. That is the same decision the arrivals-hall card makes,
// and for the same reason: a card that publishes a name is a targeting notice.
//
// THE POINT OF IT IS THE TWO BUTTONS. The office's alarm fires because nobody
// pressed arrived; the person who actually knows is the driver, and until this
// page existed they had no way to say so. The other button is the one nobody
// wants to need.

function clock(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

export default function DriveCard() {
  const { token } = useParams();
  const [card, setCard] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Two presses for the alarm. A single button that raises duress is a button
  // that gets raised by a phone in a pocket, and a false alarm on this teaches
  // an office to distrust the real one.
  const [arming, setArming] = useState(false);

  function load() {
    return api.get(`/drive/${token}`)
      .then((d) => setCard(d.card))
      .catch((e) => setError(e.message));
  }
  useEffect(() => { load(); }, [token]);

  async function act(path, body) {
    setBusy(true);
    setError('');
    try {
      const d = await api.post(`/drive/${token}${path}`, body);
      if (d.card) setCard(d.card);
      else await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  if (error && !card) {
    return (
      <div className="drive-card">
        <h1>This card is not live</h1>
        <p>It may have been taken down, or the journey may be over. Ring the office.</p>
      </div>
    );
  }
  if (!card) return <div className="drive-card"><p>Loading…</p></div>;

  return (
    <div className="drive-card">
      {error && <div className="alert alert-error">{error}</div>}

      <div className="drive-when">{clock(card.departsAt)}</div>
      <div className="drive-leg">
        <div>{card.departsFrom || '—'}</div>
        <div className="drive-arrow">↓</div>
        <div>{card.destination || '—'}</div>
      </div>
      {card.car && (
        <p className="drive-car">
          {[card.car.plate, card.car.description].filter(Boolean).join(' · ')}
        </p>
      )}

      {card.duressAt && (
        <div className="alert alert-error">
          The office has been told something is wrong. They are ringing.
        </div>
      )}

      {/* Check calls, as a list of things to press when they come due. */}
      {card.checks.length > 0 && (
        <div className="drive-checks">
          <h2>Check in</h2>
          {card.checks.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`btn drive-check${c.checkedAt ? ' is-done' : ''}${c.missed ? ' is-missed' : ''}`}
              disabled={!!c.checkedAt || busy}
              onClick={() => act(`/checks/${c.id}`)}
            >
              {clock(c.dueAt)}
              {c.checkedAt ? ' — done' : c.missed ? ' — missed, tap now' : ' — tap when due'}
            </button>
          ))}
        </div>
      )}

      {card.arrivedAt ? (
        <p className="drive-arrived">Arrived at {clock(card.arrivedAt)}. Nothing else to do.</p>
      ) : (
        <button
          className="btn btn-primary drive-big" type="button" disabled={busy}
          onClick={() => act('/arrived')}
        >
          We have arrived
        </button>
      )}

      {/* Last, smallest, and two presses away. It has to be reachable in a
          hurry and impossible to hit by accident, which are opposite
          requirements — the compromise is that it is always on screen but
          asks once. */}
      {!card.duressAt && (
        arming ? (
          <div className="drive-duress-confirm">
            <p>This tells the office at once that something is wrong.</p>
            <button
              className="btn btn-danger drive-big" type="button" disabled={busy}
              onClick={() => { setArming(false); act('/duress'); }}
            >
              Yes — tell them now
            </button>
            <button className="btn" type="button" onClick={() => setArming(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="btn drive-duress" type="button" onClick={() => setArming(true)}>
            Something is wrong
          </button>
        )
      )}
    </div>
  );
}
