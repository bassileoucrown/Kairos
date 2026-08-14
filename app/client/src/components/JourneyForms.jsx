import { useState } from 'react';
import { api } from '../lib/api.js';
import { zonedToUtc } from '../lib/timezones.js';
import TimezonePicker from './TimezonePicker.jsx';

// Putting something INTO a trip.
//
// Everything a trip can hold — a flight with its terminal and seat, a car that
// says who is driving and whose number to ring, a hotel, the phrase that meets
// somebody at arrivals — has existed on the server since trips were built, and
// the Trips screen has been drawing all of it faithfully. It was drawing it for
// journeys that could not be created: "The journey" was read-only, and the one
// endpoint that fills it (POST /itinerary/:ownerId/trips) had no button
// anywhere in the app. A trip therefore looked like a name, two dates and an
// empty list, and every feature underneath was invisible because nothing ever
// reached the condition that renders it.
//
// Two ways in, because there are two shapes of thing to add.

const CAR_HINT = 'Whoever is meeting them needs to be callable when the flight lands late.';

/** The arrangement block, shared by both forms. */
function Arrangement({ prefix, arrangements, value, onChange }) {
  const spec = arrangements.find((a) => a.id === value.arrangement);
  return (
    <>
      <div className="field">
        <label htmlFor={`${prefix}-arrangement`}>Who is driving</label>
        <select
          id={`${prefix}-arrangement`} value={value.arrangement || ''}
          onChange={(e) => onChange({ ...value, arrangement: e.target.value })}
        >
          <option value="">Not decided yet</option>
          {arrangements.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
        {spec && <p className="hint">{spec.hint}</p>}
      </div>
      {spec?.needsContact && (
        <div className="code-row">
          <div className="field">
            <label htmlFor={`${prefix}-provider`}>Company</label>
            <input
              id={`${prefix}-provider`} type="text" placeholder="Addison Lee"
              value={value.provider || ''}
              onChange={(e) => onChange({ ...value, provider: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor={`${prefix}-contact`}>Who to ask for</label>
            <input
              id={`${prefix}-contact`} type="text" placeholder="Dispatch"
              value={value.contactName || ''}
              onChange={(e) => onChange({ ...value, contactName: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor={`${prefix}-phone`}>Number</label>
            <input
              id={`${prefix}-phone`} type="text" placeholder="+44 20 7387 8888"
              value={value.contactPhone || ''}
              onChange={(e) => onChange({ ...value, contactPhone: e.target.value })}
            />
            <p className="hint">{CAR_HINT}</p>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * A flight and everything that hangs off it, in one form.
 *
 * The server already builds the chain — the car to the airport, the hotel
 * check-out before it, the transfer at the far end, the pickup armed on
 * arrival — from a single request, and marks the flight as the anchor the
 * delay cascade reasons from. This is the form that was missing in front of
 * it. Entering those five legs separately is five forms at the moment somebody
 * has already finished the interesting part, which is how they end up not
 * entered at all.
 */
export function FlightChainForm({ ownerId, trip, homeTimezone, arrangements, onDone, onCancel }) {
  const [f, setF] = useState({
    title: '', from: '', to: trip.destination || '',
    departDate: trip.startsOn, departTime: '',
    arriveDate: trip.startsOn, arriveTime: '',
    startTimezone: homeTimezone || '',
    endTimezone: trip.destinationTimezone || '',
    terminal: '', seat: '', reference: '',
    pickupLeadMinutes: 180, checkInMinutes: 180, pickupFrom: '',
    arrivalTransferMinutes: 60, arrivalMeetingPoint: '', arrivalTo: '',
  });
  const [pickup, setPickup] = useState({ arrangement: 'own_driver' });
  const [arrival, setArrival] = useState({ arrangement: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const body = {
        tripId: trip.id,
        title: f.title, from: f.from, to: f.to,
        terminal: f.terminal, seat: f.seat, reference: f.reference,
        // Read in the zone the leg actually happens in, not the zone the
        // person filling the form happens to be sitting in.
        departAt: zonedToUtc(f.departDate, f.departTime, f.startTimezone),
        arriveAt: f.arriveTime
          ? zonedToUtc(f.arriveDate, f.arriveTime, f.endTimezone || f.startTimezone)
          : undefined,
        startTimezone: f.startTimezone || undefined,
        endTimezone: f.endTimezone || undefined,
        pickupLeadMinutes: Number(f.pickupLeadMinutes) || 0,
        checkInMinutes: Number(f.checkInMinutes) || 0,
        pickupFrom: f.pickupFrom,
        pickup,
        arrivalTransferMinutes: Number(f.arrivalTransferMinutes) || 0,
        arrivalMeetingPoint: f.arrivalMeetingPoint,
        arrivalTo: f.arrivalTo,
        arrival,
      };
      const d = await api.post(`/itinerary/${ownerId}/trips`, body);
      onDone(d);
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }

  return (
    <form className="card journey-form" onSubmit={submit}>
      <h4>A flight, and the cars either side of it</h4>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="field">
        <label htmlFor="leg-title">The flight</label>
        <input
          id="leg-title" type="text" required placeholder="BA 075 Lagos → London"
          value={f.title} onChange={set('title')}
        />
      </div>

      <div className="code-row">
        <div className="field">
          <label htmlFor="leg-from">Leaving from</label>
          <input id="leg-from" type="text" placeholder="LOS" value={f.from} onChange={set('from')} />
        </div>
        <div className="field">
          <label htmlFor="leg-to">Arriving at</label>
          <input id="leg-to" type="text" placeholder="LHR" value={f.to} onChange={set('to')} />
        </div>
        <div className="field">
          <label htmlFor="leg-terminal">Terminal</label>
          <input id="leg-terminal" type="text" placeholder="T5" value={f.terminal} onChange={set('terminal')} />
        </div>
        <div className="field">
          <label htmlFor="leg-seat">Seat</label>
          <input id="leg-seat" type="text" placeholder="2A" value={f.seat} onChange={set('seat')} />
        </div>
      </div>

      <div className="code-row">
        <div className="field">
          <label htmlFor="leg-depart-date">Departs</label>
          <input id="leg-depart-date" type="date" required value={f.departDate} onChange={set('departDate')} />
        </div>
        <div className="field">
          <label htmlFor="leg-depart-time">At</label>
          <input id="leg-depart-time" type="time" required value={f.departTime} onChange={set('departTime')} />
        </div>
        <div className="field">
          <label htmlFor="leg-start-tz">Local time where it leaves</label>
          <TimezonePicker
            id="leg-start-tz" value={f.startTimezone}
            onChange={(tz) => setF({ ...f, startTimezone: tz })}
          />
        </div>
      </div>

      <div className="code-row">
        <div className="field">
          <label htmlFor="leg-arrive-date">Lands</label>
          <input id="leg-arrive-date" type="date" value={f.arriveDate} onChange={set('arriveDate')} />
        </div>
        <div className="field">
          <label htmlFor="leg-arrive-time">At</label>
          <input id="leg-arrive-time" type="time" value={f.arriveTime} onChange={set('arriveTime')} />
        </div>
        <div className="field">
          <label htmlFor="leg-end-tz">Local time where it lands</label>
          <TimezonePicker
            id="leg-end-tz" value={f.endTimezone}
            onChange={(tz) => setF({ ...f, endTimezone: tz })}
            emptyLabel="Same as departure"
          />
          <p className="hint">
            Entered as the clock reads at each end. Nobody does the arithmetic in their head.
          </p>
        </div>
      </div>

      <div className="field">
        <label htmlFor="leg-ref">Booking reference</label>
        <input id="leg-ref" type="text" placeholder="PNR X7QK2M" value={f.reference} onChange={set('reference')} />
      </div>

      <h4>Getting to the airport</h4>
      <div className="code-row">
        <div className="field">
          <label htmlFor="leg-pickup-from">Collected from</label>
          <input
            id="leg-pickup-from" type="text" placeholder="Ikoyi residence"
            value={f.pickupFrom} onChange={set('pickupFrom')}
          />
        </div>
        <div className="field">
          <label htmlFor="leg-pickup-lead">Leave this long before (min)</label>
          <input id="leg-pickup-lead" type="number" min="0" value={f.pickupLeadMinutes} onChange={set('pickupLeadMinutes')} />
        </div>
        <div className="field">
          <label htmlFor="leg-checkin">At the airport this long before (min)</label>
          <input id="leg-checkin" type="number" min="0" value={f.checkInMinutes} onChange={set('checkInMinutes')} />
        </div>
      </div>
      <Arrangement prefix="leg-dep" arrangements={arrangements} value={pickup} onChange={setPickup} />

      <h4>At the other end</h4>
      <p className="hint">
        Away from home it will not be your own driver. This is the leg that says who it is instead.
      </p>
      <div className="code-row">
        <div className="field">
          <label htmlFor="leg-meet">Meeting point</label>
          <input
            id="leg-meet" type="text" placeholder="T5 arrivals, Costa Coffee"
            value={f.arrivalMeetingPoint} onChange={set('arrivalMeetingPoint')}
          />
        </div>
        <div className="field">
          <label htmlFor="leg-arrival-to">Going on to</label>
          <input
            id="leg-arrival-to" type="text" placeholder="The Connaught"
            value={f.arrivalTo} onChange={set('arrivalTo')}
          />
        </div>
        <div className="field">
          <label htmlFor="leg-transfer">Allow after landing (min)</label>
          <input id="leg-transfer" type="number" min="0" value={f.arrivalTransferMinutes} onChange={set('arrivalTransferMinutes')} />
          <p className="hint">Immigration, bags, and the walk out.</p>
        </div>
      </div>
      <Arrangement prefix="leg-arr" arrangements={arrangements} value={arrival} onChange={setArrival} />

      <div className="code-actions">
        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? 'Building…' : 'Add to the trip'}
        </button>
        <button className="btn btn-sm" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

const KINDS = [
  ['meeting', 'Meeting'], ['hotel', 'Hotel'], ['car', 'Car'], ['meal', 'Meal'],
  ['flight', 'Flight'], ['train', 'Train'], ['call', 'Call'], ['personal', 'Personal'],
  ['note', 'Note'],
];

/** One thing on its own — a dinner, a hotel, a car with no flight attached. */
export function SingleLegForm({ ownerId, trip, homeTimezone, arrangements, onDone, onCancel }) {
  const [f, setF] = useState({
    kind: 'meeting', title: '', date: trip.startsOn, time: '', endTime: '',
    timezone: trip.destinationTimezone || homeTimezone || '',
    location: '', destination: '', reference: '', notes: '',
  });
  const [car, setCar] = useState({ arrangement: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.post(`/itinerary/${ownerId}/items`, {
        tripId: trip.id,
        kind: f.kind, title: f.title,
        startAt: zonedToUtc(f.date, f.time, f.timezone),
        endAt: f.endTime ? zonedToUtc(f.date, f.endTime, f.timezone) : undefined,
        startTimezone: f.timezone || undefined,
        location: f.location, destination: f.destination,
        reference: f.reference, notes: f.notes,
        ...(f.kind === 'car' ? car : {}),
      });
      onDone();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }

  return (
    <form className="card journey-form" onSubmit={submit}>
      <h4>One thing on the trip</h4>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="code-row">
        <div className="field">
          <label htmlFor="one-kind">What is it</label>
          <select id="one-kind" value={f.kind} onChange={set('kind')}>
            {KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="one-title">Called</label>
          <input id="one-title" type="text" required placeholder="Dinner with the board" value={f.title} onChange={set('title')} />
        </div>
      </div>

      <div className="code-row">
        <div className="field">
          <label htmlFor="one-date">Day</label>
          <input id="one-date" type="date" required value={f.date} onChange={set('date')} />
        </div>
        <div className="field">
          <label htmlFor="one-time">From</label>
          <input id="one-time" type="time" required value={f.time} onChange={set('time')} />
        </div>
        <div className="field">
          <label htmlFor="one-end">Until</label>
          <input id="one-end" type="time" value={f.endTime} onChange={set('endTime')} />
        </div>
        <div className="field">
          <label htmlFor="one-tz">Local time where</label>
          <TimezonePicker id="one-tz" value={f.timezone} onChange={(tz) => setF({ ...f, timezone: tz })} />
        </div>
      </div>

      <div className="code-row">
        <div className="field">
          <label htmlFor="one-location">Where</label>
          <input id="one-location" type="text" value={f.location} onChange={set('location')} />
        </div>
        <div className="field">
          <label htmlFor="one-destination">Going on to</label>
          <input id="one-destination" type="text" value={f.destination} onChange={set('destination')} />
        </div>
        <div className="field">
          <label htmlFor="one-ref">Reference</label>
          <input id="one-ref" type="text" value={f.reference} onChange={set('reference')} />
        </div>
      </div>

      {f.kind === 'car' && (
        <Arrangement prefix="one-car" arrangements={arrangements} value={car} onChange={setCar} />
      )}

      <div className="field">
        <label htmlFor="one-notes">Anything else</label>
        <textarea id="one-notes" value={f.notes} onChange={set('notes')} />
      </div>

      <div className="code-actions">
        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? 'Adding…' : 'Add to the trip'}
        </button>
        <button className="btn btn-sm" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
