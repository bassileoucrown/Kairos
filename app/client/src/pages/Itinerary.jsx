import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import AppShell, { resolveActivePrincipal } from '../components/AppShell.jsx';
import RunningLate from '../components/RunningLate.jsx';
import BuildTrip from '../components/BuildTrip.jsx';
import { useAuth } from '../lib/AuthContext.jsx';
import { ScheduleEntry, KIND_ICON } from './Today.jsx';
import TimezonePicker from '../components/TimezonePicker.jsx';
import { zonedToUtc } from '../lib/timezones.js';

const KINDS = [
  { value: 'flight', label: 'Flight' },
  { value: 'train', label: 'Train' },
  { value: 'car', label: 'Car' },
  { value: 'hotel', label: 'Hotel' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'meal', label: 'Meal' },
  { value: 'call', label: 'Call' },
  { value: 'personal', label: 'Personal' },
  { value: 'note', label: 'Note' },
];
// Only these genuinely land somewhere else, so only these ask about a second
// timezone — everything else would just be a field to ignore.
const TRAVEL_KINDS = new Set(['flight', 'train', 'car']);

function shiftDate(key, days) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function friendly(key) {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}
// The form asks for times against one date, but a red-eye leaves at 22:40 and
// lands at 05:15 — the single most ordinary shape of travel for the people
// this is built for. An end time at or before the start therefore means the
// next morning, not an invalid entry.
function toLocalInput(date, time) { return `${date}T${time}`; }
function endsNextDay(startTime, endTime) {
  return !!endTime && endTime <= startTime;
}
function endDateFor(date, startTime, endTime) {
  if (!endsNextDay(startTime, endTime)) return date;
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function AddItem({ ownerId, date, timezone, onAdded, onDone, onCancel }) {
  const [kind, setKind] = useState('meeting');
  const [title, setTitle] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('');
  const [location, setLocation] = useState('');
  const [destination, setDestination] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [endTimezone, setEndTimezone] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [justAdded, setJustAdded] = useState('');
  const titleRef = useRef(null);
  const isTravel = TRAVEL_KINDS.has(kind);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.post(`/itinerary/${ownerId}/items`, {
        kind,
        title,
        // Read in the principal's own zone, which is what the planner is
        // looking at — and NOT the browser's, which is only the same thing
        // when the person filling the form is sitting in the same country.
        // An assistant in London arranging a 09:00 Lagos departure used to
        // store 09:00 London, an hour out, with this form's own timezone
        // field sitting right beside it saying otherwise.
        startAt: zonedToUtc(date, startTime, timezone),
        endAt: endTime
          ? zonedToUtc(endDateFor(date, startTime, endTime), endTime, timezone)
          : undefined,
        startTimezone: timezone,
        endTimezone: isTravel && endTimezone ? endTimezone : undefined,
        location, destination, reference, notes,
      });
      // Stay open. A trip is a sequence — outbound, car, hotel, dinner — and
      // closing the form after each leg means re-opening it and re-picking the
      // kind four more times. What varies between legs is cleared; what
      // usually carries (the kind, roughly when) is kept.
      setJustAdded(title);
      setTitle('');
      setLocation('');
      setDestination('');
      setReference('');
      setNotes('');
      titleRef.current?.focus();
      onAdded();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }

  return (
    <form className="card itin-form" onSubmit={submit}>
      {error && <div className="alert alert-error">{error}</div>}
      {justAdded && !error && (
        <div className="alert alert-success" role="status">
          Added “{justAdded}”. Next one, or Done when the day is built.
        </div>
      )}

      <div className="kind-picker">
        {KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            className={'kind-option' + (kind === k.value ? ' is-selected' : '')}
            aria-pressed={kind === k.value}
            onClick={() => setKind(k.value)}
          >
            <span aria-hidden="true">{KIND_ICON[k.value]}</span> {k.label}
          </button>
        ))}
      </div>

      <div className="field">
        <label htmlFor="itin-title">What is it?</label>
        <input
          id="itin-title" ref={titleRef} type="text" value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder={isTravel ? 'BA075 to London' : 'Board pre-read with the chair'}
          required
        />
      </div>

      <div className="itin-row">
        <div className="field">
          <label htmlFor="itin-start">Starts</label>
          <input id="itin-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="itin-end">Ends (optional)</label>
          <input id="itin-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          {endsNextDay(startTime, endTime) && (
            <p className="hint">Arrives the next morning.</p>
          )}
        </div>
      </div>

      <div className="itin-row">
        <div className="field">
          <label htmlFor="itin-location">{isTravel ? 'From' : 'Where'}</label>
          <input id="itin-location" type="text" value={location} onChange={(e) => setLocation(e.target.value)}
            placeholder={isTravel ? 'Lagos (LOS), Terminal 1' : 'The office'} />
        </div>
        {isTravel && (
          <div className="field">
            <label htmlFor="itin-destination">To</label>
            <input id="itin-destination" type="text" value={destination} onChange={(e) => setDestination(e.target.value)}
              placeholder="London (LHR), Terminal 5" />
          </div>
        )}
      </div>

      {isTravel && (
        <div className="field">
          <label htmlFor="itin-endtz">Arrival timezone</label>
          <TimezonePicker
            id="itin-endtz" value={endTimezone} onChange={setEndTimezone}
            emptyLabel={`Same as departure (${timezone})`}
          />
          <p className="hint">
            Set this and the arrival time is shown in local time at the other end, so nobody
            does the arithmetic in their head at 3am.
          </p>
        </div>
      )}

      <div className="itin-row">
        <div className="field">
          <label htmlFor="itin-ref">Reference</label>
          <input id="itin-ref" type="text" value={reference} onChange={(e) => setReference(e.target.value)}
            placeholder={isTravel ? 'PNR / seat' : 'Confirmation number'} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="itin-notes">Notes for the principal</label>
        <textarea id="itin-notes" value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything they should know before they walk in." />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? 'Adding…' : 'Add to the day'}
        </button>
        <button className="btn btn-secondary" type="button" onClick={justAdded ? onDone : onCancel}>
          {justAdded ? 'Done' : 'Cancel'}
        </button>
      </div>
    </form>
  );
}

export default function Itinerary() {
  const { user } = useAuth();
  const [ownerId, setOwnerId] = useState(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [buildingTrip, setBuildingTrip] = useState(false);
  const [lateItem, setLateItem] = useState(null);

  function load(d = date, owner = ownerId) {
    if (!owner) return Promise.resolve();
    return api.get(`/itinerary/${owner}/day?date=${d}`)
      .then(setData).catch((err) => setError(err.message));
  }

  // Resolve who this day belongs to before fetching it — an assistant's
  // default is the principal they support, not themselves.
  useEffect(() => {
    let cancelled = false;
    resolveActivePrincipal(user).then((id) => {
      if (cancelled || !id) return;
      setOwnerId(id);
      load(date, id);
    });
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => { if (ownerId) load(date); }, [date, ownerId]);

  // An assistant's two ways out of a draft: put it straight on the
  // principal's day, or ask them first. Both live on the item itself so the
  // decision is made where the work is, not on a separate screen.
  async function act(id, path, body) {
    setError('');
    try {
      await api.post(`/itinerary/${ownerId}/items/${id}/${path}`, body);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(id) {
    setError('');
    try {
      await api.del(`/itinerary/${ownerId}/items/${id}`);
      load();
    } catch (err) { setError(err.message); }
  }

  const entries = data?.entries || [];
  const viewerIsPrincipal = data?.viewerIsPrincipal !== false;

  return (
    <AppShell
      title="Itinerary"
      active="itinerary"
      actions={
        <>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => window.print()}>
            Print day sheet
          </button>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => setBuildingTrip((t) => !t)}>
            {buildingTrip ? 'Cancel' : 'Build a trip'}
          </button>
          <button className="btn btn-primary btn-sm" type="button" onClick={() => setAdding((a) => !a)}>
            {adding ? 'Cancel' : 'Add item'}
          </button>
        </>
      }
    >
      {error && <div className="alert alert-error">{error}</div>}

      <div className="day-nav no-print">
        <button className="btn btn-secondary btn-sm" type="button" aria-label="Previous day"
          onClick={() => setDate((d) => shiftDate(d, -1))}>←</button>
        <input type="date" aria-label="Day" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 'auto' }} />
        <button className="btn btn-secondary btn-sm" type="button" aria-label="Next day"
          onClick={() => setDate((d) => shiftDate(d, 1))}>→</button>
        <button className="btn btn-secondary btn-sm" type="button"
          onClick={() => setDate(new Date().toISOString().slice(0, 10))}>Today</button>
      </div>

      <h2 className="day-heading">{friendly(date)}</h2>
      {data && (
        <p className="tz-note" style={{ marginBottom: 14 }}>
          {data.principal.name}'s day, shown in {data.timezone.replace('_', ' ')}.
          {entries.length > 0 && ` ${entries.length} item${entries.length === 1 ? '' : 's'}.`}
        </p>
      )}

      {buildingTrip && (
        <BuildTrip
          ownerId={ownerId}
          date={date}
          timezone={data?.timezone || 'UTC'}
          onDone={() => { setBuildingTrip(false); load(); }}
          onCancel={() => setBuildingTrip(false)}
        />
      )}

      {lateItem && (
        <RunningLate
          ownerId={ownerId}
          item={lateItem}
          onDone={() => { setLateItem(null); load(); }}
          onCancel={() => setLateItem(null)}
        />
      )}

      {adding && (
        <AddItem
          ownerId={ownerId}
          date={date}
          timezone={data?.timezone || 'UTC'}
          onAdded={() => load()}
          onDone={() => setAdding(false)}
          onCancel={() => setAdding(false)}
        />
      )}

      {!data && <p className="hint">Loading…</p>}

      {data && entries.length === 0 && (
        <div className="empty-state">
          Nothing on this day yet. Add a flight, a car, a dinner — anything that fills the day,
          not just what someone booked.
        </div>
      )}

      <ul className="sched-list">
        {entries.map((e) => (
          <div className="itin-entry" key={e.id}>
            <ScheduleEntry e={e} />
            {e.source === 'itinerary' && !viewerIsPrincipal && e.status === 'draft' && (
              <>
                <button className="btn btn-primary btn-sm no-print" type="button"
                  onClick={() => act(e.id, 'publish')}>Publish</button>
                <button className="btn btn-sm no-print" type="button"
                  onClick={() => {
                    const note = window.prompt('What should they know about this?') ?? null;
                    if (note === null) return;
                    act(e.id, 'propose', { note });
                  }}>Ask them</button>
              </>
            )}
            {e.source === 'itinerary' && !viewerIsPrincipal && e.status === 'proposed' && (
              <span className="pill is-warn no-print">Waiting on them</span>
            )}
            {e.source === 'itinerary' && viewerIsPrincipal && e.status === 'proposed' && (
              <>
                <button className="btn btn-primary btn-sm no-print" type="button"
                  onClick={() => act(e.id, 'decide', { approve: true })}>Approve</button>
                <button className="btn btn-sm no-print" type="button"
                  onClick={() => act(e.id, 'decide', { approve: false, note: window.prompt('Anything they should know? (optional)') ?? '' })}>Decline</button>
              </>
            )}
            {e.source === 'itinerary' && e.status !== 'draft' && (
              <button className="btn btn-sm no-print" type="button"
                aria-label={`${e.title} is running late`} onClick={() => setLateItem(e)}>Running late</button>
            )}
            {e.source === 'itinerary' && (
              <button className="btn btn-danger btn-sm no-print" type="button"
                aria-label={`Remove ${e.title}`} onClick={() => remove(e.id)}>Remove</button>
            )}
            {e.source === 'booking' && <span className="pill no-print">From a booking</span>}
          </div>
        ))}
      </ul>
    </AppShell>
  );
}
