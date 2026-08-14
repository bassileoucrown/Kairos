import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import SignalPanel from '../components/SignalPanel.jsx';
import { useSignal, useAwakeScreen } from '../lib/useSignal.js';

// The driver's page.
//
// Opened on a phone by somebody who has no account here and never will, from a
// link forwarded over WhatsApp, while standing up, possibly one-handed, in a
// hall with bad signal. Everything about it follows from that: no sign-in, no
// navigation, no settings, one screen, and the two things that matter — what
// to hold up, and what to say — above everything else on it.
//
// What it deliberately does not contain is in lib/pickup.js: no surname, no
// number for the principal, no destination, nothing from the vault. If this
// link is forwarded to the wrong person, what they have learned is that
// somebody is landing at an airport, which they could have learned from the
// arrivals board.

function when(at, timezone) {
  if (!at) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit',
      timeZone: timezone || undefined,
    }).format(new Date(at));
  } catch { return new Date(at).toLocaleString(); }
}

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div className="card-row">
      <span className="card-row-label">{label}</span>
      <span className="card-row-value">{value}</span>
    </div>
  );
}

export default function DriverCard() {
  const { token } = useParams();
  const [card, setCard] = useState(null);
  const [gone, setGone] = useState('');
  const { signal } = useSignal(`/trips/pickup/${token}/signal`, { enabled: !gone });

  useEffect(() => {
    api.get(`/trips/pickup/${token}`)
      .then((d) => setCard(d.pickup))
      .catch((e) => setGone(e.message));
  }, [token]);

  // Held up at arm's length and not touched again.
  useAwakeScreen(!!card && !gone);

  if (gone) {
    return (
      <main className="driver-card">
        <div className="driver-gone">
          <h1>This pickup is not available</h1>
          <p>
            The link may have expired, or a new one may have been issued.
            Ask whoever sent it to you for the current link.
          </p>
        </div>
      </main>
    );
  }

  if (!card) return <main className="driver-card"><p className="hint">Loading…</p></main>;

  const found = !!signal?.found;

  return (
    <main className="driver-card">
      <div className={`driver-signal${found ? ' is-found' : ''}`}>
        <SignalPanel signal={signal} size="full" muted={found} />
        <p className="driver-instruction">
          {found
            ? 'They have seen you. Stay where you are.'
            : 'Hold this up, screen facing out.'}
        </p>
      </div>

      <div className="driver-phrase">
        <span className="card-row-label">Phrase</span>
        <code>{card.pickupCode}</code>
        <p className="hint">
          Whoever speaks first, the other answers. Do not use a name, and do not
          write it on anything.
        </p>
      </div>

      <div className="driver-facts">
        <Row label="Passenger" value={card.passenger} />
        <Row label="Flight" value={[card.flightNumber, card.arrivingFrom && `from ${card.arrivingFrom}`].filter(Boolean).join(' ')} />
        <Row label="Terminal" value={card.terminal} />
        <Row label="Meet at" value={card.meetingPoint} />
        <Row label="Time" value={when(card.at, card.timezone)} />
        <Row label="Vehicle" value={card.vehicle} />
      </div>

      {card.callIfDelayed && (
        <a className="driver-call" href={`tel:${card.callIfDelayed.replace(/\s/g, '')}`}>
          Call if delayed — {card.callIfDelayed}
        </a>
      )}

      <p className="driver-foot">
        Kairos. This page stops working after the pickup.
      </p>
    </main>
  );
}
