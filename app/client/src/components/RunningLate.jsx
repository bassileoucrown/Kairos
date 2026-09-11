import { useState } from 'react';
import { api } from '../lib/api.js';

// Running late.
//
// The most common thing that happens to a principal's day, and the one the app
// used to have no answer for: moving an item moved one row, and the meeting it
// now sat on top of, the driver waiting at the old time, and the flight that
// would be missed were all somebody else's problem.
//
// Shown before it is done, always. An assistant needs to see that the 15:30 car
// would now leave at 16:15 and miss the 17:40 *before* agreeing to it, not
// discover it in the confirmation.
//
// AND THE DAY CAN BE STOPPED PART WAY DOWN. Being late for the eleven o'clock
// is not being late for the four o'clock. Every entry that would move carries a
// "Stop here", which is the assistant saying the day recovers at that point —
// everything from there keeps its own time, and the screen re-reads the plan so
// what is on it is still what would happen.

const PRESETS = [10, 15, 30, 45, 60, 90];

function timeOf(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function EffectRow({ e, held, onHold, onRelease, busy }) {
  if (e.effect === 'held') {
    return (
      <li className="late-row is-held">
        <span className="late-time">{timeOf(e.startAt)}</span>
        <span className="late-title">{e.title}</span>
        <span className="late-verdict">
          {e.reason}
          {' '}
          <button className="linkish" type="button" disabled={busy} onClick={onRelease}>
            let it move
          </button>
        </span>
      </li>
    );
  }
  if (e.effect === 'unchanged') {
    return (
      <li className="late-row is-unchanged">
        <span className="late-time">{timeOf(e.startAt)}</span>
        <span className="late-title">{e.title}</span>
        <span className="late-verdict">unchanged{e.reason ? ` — ${e.reason}` : ''}</span>
      </li>
    );
  }
  if (e.effect === 'conflict') {
    return (
      <li className="late-row is-conflict">
        <span className="late-time">{timeOf(e.startAt)}</span>
        <span className="late-title">{e.title}</span>
        <span className="late-verdict">{e.reason}</span>
      </li>
    );
  }
  return (
    <li className="late-row is-shifted">
      <span className="late-time">
        <s>{timeOf(e.startAt)}</s> {timeOf(e.newStartAt)}
      </span>
      <span className="late-title">{e.title}</span>
      <span className="late-verdict">
        {e.movedBy} min later
        {e.staff && ` · ${e.staff.name} will be told`}
        {e.attendee && ` · ${e.attendee.name} needs a message`}
        {!held && (
          <>
            {' · '}
            <button className="linkish" type="button" disabled={busy} onClick={onHold}>
              stop here
            </button>
          </>
        )}
      </span>
    </li>
  );
}

export default function RunningLate({ ownerId, item, onDone, onCancel }) {
  const [minutes, setMinutes] = useState(15);
  const [plan, setPlan] = useState(null);
  const [hold, setHold] = useState(null);
  const [tooSoon, setTooSoon] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // TWO KINDS OF THING CAN OVERRUN, and the difference matters at the end
  // rather than at the start. An itinerary entry moving is a row changing; an
  // appointment somebody booked moving is a message to them. The screens are
  // identical because the question is identical — what does this do to the
  // rest of the day — so only the address changes.
  const isBooking = item.source === 'booking';
  const base = isBooking
    ? `/itinerary/${ownerId}/bookings/${String(item.id).replace(/^booking:/, '')}/delay`
    : `/itinerary/${ownerId}/items/${item.id}/delay`;

  // One function for every re-read, because the hold changes what the rest of
  // the day does and a screen still showing the old cascade under a new hold
  // would be worse than no preview at all.
  async function preview(m, h) {
    setMinutes(m); setHold(h);
    setError(''); setBusy(true);
    try {
      const d = await api.post(`${base}/preview`, { minutes: m, hold: h ?? undefined });
      setPlan(d.plan);
      setTooSoon(d.tooSoon || null);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function apply() {
    setError(''); setBusy(true);
    try {
      await api.post(base, {
        minutes,
        hold: hold ?? undefined,
        // The conflict was shown and read. Sometimes the plane really is going
        // to be missed and the day still has to be rearranged around it.
        acceptConflicts: (plan?.counts.conflicts || 0) > 0,
      });
      onDone();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="card late">
      <div className="late-head">
        <strong>{item.title} is running late</strong>
        <button className="btn btn-danger btn-sm" type="button" onClick={onCancel}>Cancel</button>
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="late-presets">
        {PRESETS.map((m) => (
          <button
            key={m}
            type="button"
            className={'btn btn-sm' + (plan && minutes === m ? ' btn-primary' : '')}
            disabled={busy}
            onClick={() => preview(m, hold)}
          >
            {m < 60 ? `${m} min` : `${m / 60} hr`}
          </button>
        ))}
      </div>

      {!plan && <p className="hint">Pick how late, and you'll see what it does to the rest of the day before anything moves.</p>}

      {plan && (
        <>
          {/* THE REFUSAL IS SHOWN WITH THE PLAN, NOT INSTEAD OF IT. Inside the
          half hour the appointment cannot be moved from here — but what the
          day would have done is still the thing being decided about on the
          phone call that replaces it. */}
          {tooSoon && <div className="alert alert-error">{tooSoon.error}</div>}
          <p className="late-summary">
            {plan.item.title} now {timeOf(plan.item.newStartAt)}.{' '}
            {plan.counts.shifted === 0 && plan.counts.conflicts === 0
              ? 'Nothing else is affected.'
              : [
                plan.counts.shifted > 0 && `${plan.counts.shifted} moved`,
                plan.counts.conflicts > 0 && `${plan.counts.conflicts} cannot move`,
              ].filter(Boolean).join(', ') + '.'}
            {plan.counts.held > 0 && ' The rest of the day is held.'}
          </p>
          <ul className="late-list">
            {plan.effects.map((e) => (
              <EffectRow
                key={e.id}
                e={e}
                held={!!hold}
                busy={busy}
                onHold={() => preview(minutes, e.id)}
                onRelease={() => preview(minutes, null)}
              />
            ))}
          </ul>
          {plan.counts.shifted > 0 && !hold && (
            <p className="hint">
              Being late for one thing need not move the whole day. Use <em>stop here</em> on
              the first entry you will still make on time — it and everything after it stay put.
            </p>
          )}
              {/* THE ONE THING KAIROS DOES SEND. Moving an appointment tells the
              person who booked it, because they would otherwise arrive at the
              old time — that is not a judgement call, it is the whole meaning
              of moving it. Said before the button, not discovered after. */}
          {isBooking && (
            <p className="hint">
              <strong>{item.title}</strong> is somebody else&rsquo;s appointment.
              Applying this moves it and emails them the new time.
            </p>
          )}
      {plan.attendeesToTell.length > 0 && (
            <p className="hint">
              Still to message: {plan.attendeesToTell.map((a) => a.name).join(', ')}. Kairos won't
              send that for you — how you word running late is a judgement call.
            </p>
          )}
          <button
            className={'btn ' + (plan.counts.conflicts > 0 ? 'btn-danger' : 'btn-primary')}
            type="button"
            disabled={busy || !!tooSoon}
            onClick={apply}
          >
            {plan.counts.conflicts > 0 ? 'Apply anyway' : 'Apply'}
          </button>
        </>
      )}
    </div>
  );
}
