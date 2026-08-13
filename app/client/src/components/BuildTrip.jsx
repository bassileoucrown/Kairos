import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// A flight is never just a flight.
//
// It is a check-out, a car, the flight, and something at the other end — and
// the reason those get forgotten is that entering them is four more forms at
// the moment you have already finished the interesting part. So one form
// builds the chain, marks the flight as the anchor it is, and hands the
// driving legs to whoever is driving. They get told here, rather than in a
// step somebody has to remember afterwards, because that step is the one that
// actually gets missed.

export default function BuildTrip({ ownerId, date, timezone, onDone, onCancel }) {
  const [staff, setStaff] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    title: '', from: '', to: '', reference: '',
    departTime: '08:00', arriveTime: '', endTimezone: '',
    pickupLeadMinutes: 180, pickupFrom: '', driverId: '',
    checkOutLeadMinutes: 30, includeCheckOut: true,
    arrivalTransferMinutes: 45, includeArrival: true, arrivalTo: '', arrivalDriverId: '',
  });

  useEffect(() => {
    if (!ownerId) return;
    api.get(`/household/${ownerId}`)
      .then((d) => setStaff(d.members.filter((m) => m.status === 'active')))
      // A principal with no household, or an assistant without the remit for
      // one, simply gets no driver picker. Not an error.
      .catch(() => setStaff([]));
  }, [ownerId]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const depart = new Date(`${date}T${f.departTime}`);
      const body = {
        title: f.title,
        departAt: depart.toISOString(),
        arriveAt: f.arriveTime ? new Date(`${date}T${f.arriveTime}`).toISOString() : undefined,
        from: f.from, to: f.to, reference: f.reference,
        startTimezone: timezone,
        endTimezone: f.endTimezone || undefined,
        pickupLeadMinutes: Number(f.pickupLeadMinutes) || 0,
        pickupFrom: f.pickupFrom,
        driverId: f.driverId || undefined,
        ...(f.includeCheckOut && Number(f.pickupLeadMinutes) > 0
          ? { checkOutLeadMinutes: Number(f.checkOutLeadMinutes) || 0 } : {}),
        ...(f.includeArrival
          ? {
            arrivalTransferMinutes: Number(f.arrivalTransferMinutes) || 0,
            arrivalTo: f.arrivalTo,
            arrivalDriverId: f.arrivalDriverId || undefined,
          } : {}),
      };
      const d = await api.post(`/itinerary/${ownerId}/trips`, body);
      onDone(d);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <form className="card trip" onSubmit={submit}>
      <div className="trip-head">
        <strong>Build a trip</strong>
        <button className="btn btn-danger btn-sm" type="button" onClick={onCancel}>Cancel</button>
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="trip-grid">
        <div className="field">
          <label htmlFor="trip-title">Flight</label>
          <input id="trip-title" type="text" value={f.title} required
            placeholder="BA 083 to Lagos" onChange={set('title')} />
        </div>
        <div className="field">
          <label htmlFor="trip-ref">Reference</label>
          <input id="trip-ref" type="text" value={f.reference} placeholder="PNR / seat" onChange={set('reference')} />
        </div>
        <div className="field">
          <label htmlFor="trip-from">From</label>
          <input id="trip-from" type="text" value={f.from} placeholder="Heathrow T5" onChange={set('from')} />
        </div>
        <div className="field">
          <label htmlFor="trip-to">To</label>
          <input id="trip-to" type="text" value={f.to} placeholder="Lagos" onChange={set('to')} />
        </div>
        <div className="field">
          <label htmlFor="trip-depart">Departs</label>
          <input id="trip-depart" type="time" value={f.departTime} required onChange={set('departTime')} />
        </div>
        <div className="field">
          <label htmlFor="trip-arrive">Arrives</label>
          <input id="trip-arrive" type="time" value={f.arriveTime} onChange={set('arriveTime')} />
        </div>
      </div>
      <p className="hint">
        The flight is set as an anchor: if the day runs late, everything else bends around it and
        Kairos tells you plainly that this one will not wait.
      </p>

      <h3 className="trip-section">Getting there</h3>
      <div className="trip-grid">
        <div className="field">
          <label htmlFor="trip-lead">Car, minutes before departure</label>
          <input id="trip-lead" type="number" min="0" value={f.pickupLeadMinutes} onChange={set('pickupLeadMinutes')} />
        </div>
        <div className="field">
          <label htmlFor="trip-pickup">Picked up from</label>
          <input id="trip-pickup" type="text" value={f.pickupFrom} placeholder="The hotel" onChange={set('pickupFrom')} />
        </div>
        <div className="field">
          <label htmlFor="trip-driver">Driver</label>
          <select id="trip-driver" value={f.driverId} onChange={set('driverId')}>
            <option value="">Nobody yet</option>
            {staff.map((m) => <option key={m.id} value={m.id}>{m.name} — {m.jobTitle}</option>)}
          </select>
          {staff.length === 0 && <p className="hint">Add household staff to assign a driver.</p>}
        </div>
      </div>

      <label className="member-toggle">
        <input type="checkbox" checked={f.includeCheckOut}
          onChange={(e) => setF({ ...f, includeCheckOut: e.target.checked })} />
        <span>Add a check-out before the car</span>
      </label>
      {f.includeCheckOut && (
        <div className="field">
          <label htmlFor="trip-checkout">Minutes before the car</label>
          <input id="trip-checkout" type="number" min="0" value={f.checkOutLeadMinutes}
            onChange={set('checkOutLeadMinutes')} />
        </div>
      )}

      <h3 className="trip-section">At the other end</h3>
      <label className="member-toggle">
        <input type="checkbox" checked={f.includeArrival}
          onChange={(e) => setF({ ...f, includeArrival: e.target.checked })} />
        <span>Add a transfer on arrival</span>
      </label>
      {f.includeArrival && (
        <div className="trip-grid">
          <div className="field">
            <label htmlFor="trip-gap">Minutes after landing</label>
            <input id="trip-gap" type="number" min="0" value={f.arrivalTransferMinutes}
              onChange={set('arrivalTransferMinutes')} />
            <p className="hint">Bags and immigration, not wheels-down.</p>
          </div>
          <div className="field">
            <label htmlFor="trip-arrto">Taken to</label>
            <input id="trip-arrto" type="text" value={f.arrivalTo} placeholder="The residence" onChange={set('arrivalTo')} />
          </div>
          <div className="field">
            <label htmlFor="trip-arrdriver">Driver there</label>
            <select id="trip-arrdriver" value={f.arrivalDriverId} onChange={set('arrivalDriverId')}>
              <option value="">Nobody yet</option>
              {staff.map((m) => <option key={m.id} value={m.id}>{m.name} — {m.jobTitle}</option>)}
            </select>
          </div>
        </div>
      )}

      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? 'Building…' : 'Build it'}
      </button>
      <p className="hint">
        Anyone you assigned is sent their leg straight away, and has to confirm they have it.
      </p>
    </form>
  );
}
