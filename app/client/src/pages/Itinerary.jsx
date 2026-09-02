import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import AppShell, { resolveActivePrincipal } from '../components/AppShell.jsx';
import RunningLate from '../components/RunningLate.jsx';
import BuildTrip from '../components/BuildTrip.jsx';
import { useAuth } from '../lib/AuthContext.jsx';
import { ScheduleEntry, KIND_ICON, shapeOf, span } from './Today.jsx';
import TimezonePicker from '../components/TimezonePicker.jsx';
import { zonedToUtc, dateKeyInZone } from '../lib/timezones.js';
import { useAsk } from '../components/Ask.jsx';
import BookingNotes from '../components/BookingNotes.jsx';
import MoveAppointment from '../components/MoveAppointment.jsx';

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
  const [repeat, setRepeat] = useState('');
  const [repeatCount, setRepeatCount] = useState(12);
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
        // Left off entirely for a one-off rather than sent as "none", so the
        // server's "is this repeating" question has one answer, not two.
        recurrence: repeat ? { freq: repeat, count: Number(repeatCount) } : undefined,
      });
      // Stay open. A trip is a sequence — outbound, car, hotel, dinner — and
      // closing the form after each leg means re-opening it and re-picking the
      // kind four more times. What varies between legs is cleared; what
      // usually carries (the kind, roughly when) is kept.
      setJustAdded(repeat ? `${title} — ${repeatCount} times` : title);
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

      {/* Two monthlies, deliberately offered as two things. The 15th of every
          month and the second Tuesday of every month are different rules that
          only coincide by accident, and a standing board meeting is almost
          always the second. The last-weekday option is separate again: "the
          fourth Friday" and "the last Friday" are the same day in about two
          months out of three, which is exactly what makes guessing dangerous. */}
      <div className="field">
        <label htmlFor="itin-repeat">Repeats</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select
            id="itin-repeat"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            style={{ width: 'auto', flex: '1 1 220px' }}
          >
            <option value="">Once — does not repeat</option>
            <option value="daily">Every day</option>
            <option value="weekdays">Every weekday</option>
            <option value="weekly">Every week</option>
            <option value="fortnightly">Every two weeks</option>
            <option value="monthly">Every month, same date</option>
            <option value="monthly-weekday">Every month, same weekday</option>
            <option value="monthly-last-weekday">Every month, last such weekday</option>
            <option value="yearly">Every year</option>
          </select>
          {repeat && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
              <input
                type="number"
                min={2}
                max={260}
                value={repeatCount}
                aria-label="How many times"
                onChange={(e) => setRepeatCount(e.target.value)}
                style={{ width: 90 }}
              />
              <span className="hint" style={{ margin: 0 }}>times</span>
            </label>
          )}
        </div>
        {repeat && (
          <p className="hint">
            Each one is a real entry you can move or cancel on its own. A date that does
            not exist is skipped rather than moved — the 31st happens only in months that
            have one.
          </p>
        )}
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

/** HH:MM in the principal's zone, for prefilling a time input. */
function timeInZone(iso, timeZone) {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.hour}:${map.minute}`;
}

/**
 * Correcting an entry that is already on the day.
 *
 * WHY THIS IS NOT "REMOVE AND ADD AGAIN". That is what the screen made
 * somebody do, and it is not the same act: a repeating entry loses its series,
 * an appointment mirrored from a booking loses the link, and the notes hanging
 * off it go with the row. A wrong time on the right entry is the commonest
 * thing that happens to a diary, and it should cost one field.
 *
 * ONE OCCURRENCE, NOT THE SERIES. A standing Tuesday that moved this week has
 * not moved every week, and guessing otherwise rewrites a year of somebody's
 * diary from a single edit. Said on the form rather than inferred.
 */
function EditItem({ ownerId, item, timezone, onSaved, onCancel }) {
  const dayKey = dateKeyInZone(item.startAt, timezone);
  const [kind, setKind] = useState(item.kind || 'meeting');
  const [title, setTitle] = useState(item.title || '');
  const [startTime, setStartTime] = useState(timeInZone(item.startAt, timezone));
  const [endTime, setEndTime] = useState(item.endAt ? timeInZone(item.endAt, timezone) : '');
  const [location, setLocation] = useState(item.location || '');
  const [destination, setDestination] = useState(item.destination || '');
  const [reference, setReference] = useState(item.reference || '');
  const [notes, setNotes] = useState(item.notes || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const isTravel = TRAVEL_KINDS.has(kind);

  async function submit(ev) {
    ev.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.patch(`/itinerary/${ownerId}/items/${item.id}`, {
        kind,
        title,
        // The principal's zone, exactly as the add form does it — an assistant
        // in London correcting a Lagos departure must not store London time.
        startAt: zonedToUtc(dayKey, startTime, timezone),
        // Cleared to empty rather than omitted, so removing an end time is a
        // thing somebody can actually do. The server maps '' to NULL.
        endAt: endTime ? zonedToUtc(endDateFor(dayKey, startTime, endTime), endTime, timezone) : '',
        location, destination: isTravel ? destination : '', reference, notes,
      });
      onSaved();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }

  return (
    <form className="card itin-form itin-edit" onSubmit={submit}>
      {error && <div className="alert alert-error">{error}</div>}
      {item.seriesId && (
        <p className="hint">
          This one only. The rest of the repeat stays where it is.
        </p>
      )}

      <div className="kind-picker">
        {KINDS.map((k) => (
          <button
            key={k.value} type="button"
            className={'kind-chip' + (kind === k.value ? ' is-on' : '')}
            onClick={() => setKind(k.value)}
          >
            <span aria-hidden="true">{KIND_ICON[k.value] || '•'}</span> {k.label}
          </button>
        ))}
      </div>

      <div className="field">
        <label htmlFor={`ed-title-${item.id}`}>What it is</label>
        <input id={`ed-title-${item.id}`} type="text" required value={title}
          onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className="itin-times">
        <div className="field">
          <label htmlFor={`ed-start-${item.id}`}>Starts</label>
          <input id={`ed-start-${item.id}`} type="time" required value={startTime}
            onChange={(e) => setStartTime(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`ed-end-${item.id}`}>Ends</label>
          <input id={`ed-end-${item.id}`} type="time" value={endTime}
            onChange={(e) => setEndTime(e.target.value)} />
          {endsNextDay(startTime, endTime) && (
            <p className="hint">Overnight — ends the next morning.</p>
          )}
        </div>
      </div>

      <div className="field">
        <label htmlFor={`ed-loc-${item.id}`}>{isTravel ? 'From' : 'Where'}</label>
        <input id={`ed-loc-${item.id}`} type="text" value={location}
          onChange={(e) => setLocation(e.target.value)} />
      </div>
      {isTravel && (
        <div className="field">
          <label htmlFor={`ed-dest-${item.id}`}>To</label>
          <input id={`ed-dest-${item.id}`} type="text" value={destination}
            onChange={(e) => setDestination(e.target.value)} />
        </div>
      )}
      <div className="field">
        <label htmlFor={`ed-ref-${item.id}`}>Reference</label>
        <input id={`ed-ref-${item.id}`} type="text" value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Flight number, booking reference, room" />
      </div>
      <div className="field">
        <label htmlFor={`ed-notes-${item.id}`}>Notes</label>
        <textarea id={`ed-notes-${item.id}`} rows={2} value={notes}
          onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save the change'}
        </button>
        <button className="btn btn-secondary btn-sm" type="button" onClick={onCancel}>
          Never mind
        </button>
      </div>
    </form>
  );
}

/**
 * Running twenty minutes over, on an appointment somebody booked.
 *
 * The third of the three controls the appointment's own page offers, and it
 * was the one this screen did not have — so an assistant lengthening a meeting
 * from the day sheet had to open the appointment to do it. It starts at the
 * same time; only the end moves.
 */
function ChangeLength({ ownerId, bookingId, minutes, onSaved, onCancel }) {
  const [mins, setMins] = useState(String(minutes));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(''); setBusy(true);
    try {
      await api.post(`/pa/${ownerId}/bookings/${bookingId}/duration`,
        { minutes: Number(mins), note });
      onSaved();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="card itin-form">
      {error && <div className="alert alert-error">{error}</div>}
      <div className="field" style={{ maxWidth: 220 }}>
        <label htmlFor={`len-${bookingId}`}>Minutes</label>
        <input id={`len-${bookingId}`} type="number" min="5" max="480" step="5" value={mins}
          onChange={(e) => setMins(e.target.value)} />
        <p className="hint">It starts at the same time. Currently {minutes} min.</p>
      </div>
      <div className="field">
        <label htmlFor={`len-why-${bookingId}`}>Why (optional)</label>
        <input id={`len-why-${bookingId}`} type="text" maxLength={280} value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="They are bringing two colleagues" />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary btn-sm" type="button"
          disabled={busy || !mins || Number(mins) === minutes} onClick={save}>
          {busy ? 'Saving…' : 'Change the length'}
        </button>
        <button className="btn btn-secondary btn-sm" type="button" onClick={onCancel}>
          Never mind
        </button>
      </div>
    </div>
  );
}

export default function Itinerary() {
  // Replaces window.prompt; see components/Ask.jsx.
  const [ask, askDialog] = useAsk();
  // Which entry is mid-removal, so a repeating one can be asked which of the
  // three removals is meant before anything goes.
  const [removing, setRemoving] = useState(null);
  // Which appointment is mid-move, and to when. A booking is somebody else's
  // diary too, so moving one is done deliberately rather than by dragging.
  const [moving, setMoving] = useState(null);
  // Which appointment has its notes open. One at a time: the panel is a
  // conversation, not a field, and two of them side by side is noise.
  const [noting, setNoting] = useState(null);
  // Which entry is being corrected, and which appointment is having its
  // length changed. One at a time each, for the same reason as the notes.
  const [editing, setEditing] = useState(null);
  const [lengthening, setLengthening] = useState(null);
  const { user } = useAuth();
  const [ownerId, setOwnerId] = useState(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [buildingTrip, setBuildingTrip] = useState(false);
  const [lateItem, setLateItem] = useState(null);

  // ONLY THE ANSWER TO THE QUESTION STILL BEING ASKED.
  //
  // Two fetches of this screen could be in flight at once — the one the mount
  // fires for today, and the one changing the day fires for the day you asked
  // for — and whichever ANSWERED last won, because the response was piped
  // straight into setData. The heading reads the `date` state and the entries
  // read the response, so when the older answer landed second the screen showed
  // one day's name over another day's schedule, and said nothing was loading.
  //
  // For a diary that is not cosmetic. Somebody checks whether Wednesday is
  // free, sees Tuesday's entries under Wednesday's heading, and books over a
  // meeting that is already there. It reproduced about a third of the time on a
  // loaded machine and never on an idle one, which is exactly how a race hides.
  //
  // Every request takes a ticket; only the newest one may write.
  const reqRef = useRef(0);
  function load(d = date, owner = ownerId) {
    if (!owner) return Promise.resolve();
    const seq = ++reqRef.current;
    return api.get(`/itinerary/${owner}/day?date=${d}`)
      .then((r) => { if (seq === reqRef.current) setData(r); })
      .catch((err) => { if (seq === reqRef.current) setError(err.message); });
  }

  // Resolve who this day belongs to before fetching it — an assistant's
  // default is the principal they support, not themselves.
  //
  // Setting the owner is enough to fetch: the effect below already runs when
  // ownerId goes from null to an id. Fetching here as well sent a second
  // identical request carrying the date captured when this effect was created,
  // which is the stale racer described above.
  useEffect(() => {
    let cancelled = false;
    resolveActivePrincipal(user).then((id) => {
      if (cancelled || !id) return;
      setOwnerId(id);
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

  async function remove(id, scope = 'one') {
    setError('');
    try {
      await api.del(`/itinerary/${ownerId}/items/${id}?scope=${scope}`);
      setRemoving(null);
      load();
    } catch (err) { setError(err.message); }
  }

  // A booking carries "booking:" in front of its id on the day sheet, because
  // the sheet merges two kinds of thing. The API wants the booking's own id.
  const bookingIdOf = (e) => String(e.id).replace(/^booking:/, '');


  async function cancelBooking(e) {
    setError('');
    try {
      await api.post(`/pa/${ownerId}/bookings/${bookingIdOf(e)}/cancel`, {});
      setMoving(null);
      load();
    } catch (err) { setError(err.message); }
  }

  const entries = data?.entries || [];
  const viewerIsPrincipal = data?.viewerIsPrincipal !== false;

  // Planning happens on days that are not today, and most of what this screen
  // shows is some other Tuesday. A day that is not today has no "now" in it,
  // so it gets no now line and nothing on it is running or next.
  //
  // BUT IT STILL HAS A PAST. The clock is passed on every day, not only
  // today's, because "this already happened" is true of last Thursday's
  // eleven o'clock from wherever you are reading it. Withholding the clock
  // meant a week gone by looked exactly like a week to come — every entry
  // live, nothing settled, and no way to see at a glance what had been got
  // through. `markNow` keeps the line itself on today alone.
  const todayKey = new Date().toISOString().slice(0, 10);
  const isToday = date === todayKey;
  const rows = shapeOf(entries, Date.now(), { markNow: isToday });

  // The same sentence Today opens with, so the two screens describe one day
  // the same way rather than each in its own dialect.
  const summary = entries.length === 0
    ? 'Nothing on it yet.'
    : `${entries.length} item${entries.length === 1 ? '' : 's'}, `
      + `${entries[0].startLabel} until `
      + `${entries[entries.length - 1].endLabel || entries[entries.length - 1].startLabel}.`;

  return (
    <AppShell
      title="Itinerary"
      active="itinerary"
      guide="itinerary"
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
      {askDialog}
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

      {/* The same masthead Today wears, because it is the same day — read
          there, built here. */}
      <header className="today-head">
        <h1 className="today-date day-heading">
          {friendly(date)}
          {isToday && <span className="today-badge">Today</span>}
        </h1>
        {data && (
          <p className="today-summary tz-note">
            {summary}
            <span className="today-zone">
              {viewerIsPrincipal ? '' : `${data.principal.name}'s day · `}
              {data.timezone.replace('_', ' ')}
            </span>
          </p>
        )}
      </header>

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

      {/* The day hangs off the same spine it does on Today: same gaps, same
          rail, same proportions. One day, built here and read there.

          The controls sit under each entry rather than beside it. Beside it
          they pushed each card in from the right by however many controls that
          row happened to carry, so five entries had five different widths and
          the right edge of the day sawtoothed down the page. And the two that
          are decisions — publish it, ask about it — are buttons, while the
          three that are upkeep are words, because a red Remove on every row
          was the loudest thing on a screen for planning a day. */}
      <ol className="sched-list day-spine">
        {rows.map((row, i) => {
          if (row.type === 'now') {
            return (
              <li className={'day-now no-print' + (row.trailing ? ' is-trailing' : '')} key="now">
                <span className="day-now-label">now</span>
              </li>
            );
          }
          if (row.type === 'gap') {
            return (
              <li className="day-gap" key={`gap-${i}`} style={{ height: row.height }}>
                {row.height >= 34 && <span className="day-gap-label">{span(row.mins)} clear</span>}
                {row.holdsNow && <span className="day-now-inline no-print" aria-label="now" />}
              </li>
            );
          }
          const { e } = row;
          const mine = e.source === 'itinerary';
          // ALREADY HAPPENED. The appointment's own page has always said this
          // — "it can no longer be moved, lengthened or called off" — while
          // the day sheet went on offering all three on a meeting from last
          // Tuesday. Pressing one got a refusal from the server, which is the
          // app teaching somebody that its buttons are a guess.
          //
          // What survives is everything that is ABOUT the past rather than a
          // change to it: notes, minutes, the way through to the appointment.
          const past = !!row.done;
          return (
            <li
              className={'day-item itin-entry'
                + (row.running ? ' is-running' : '')
                + (row.done ? ' is-done' : '')
                + (e.status === 'draft' ? ' is-draft' : '')
                + (e.status === 'proposed' ? ' is-proposed' : '')}
              key={e.id}
            >
              <ScheduleEntry
                e={e}
                viewerIsPrincipal={viewerIsPrincipal}
                href={e.source === 'booking' ? `/appointments/${ownerId}/${bookingIdOf(e)}` : null}
              />
              {e.source === 'booking' && noting === e.id && (
                <BookingNotes ownerId={ownerId} bookingId={bookingIdOf(e)} onChanged={load} />
              )}

              {mine && editing === e.id && (
                <EditItem
                  ownerId={ownerId}
                  item={e}
                  timezone={data?.timezone || 'UTC'}
                  onSaved={() => { setEditing(null); load(); }}
                  onCancel={() => setEditing(null)}
                />
              )}
              {e.source === 'booking' && lengthening === e.id && (
                <ChangeLength
                  ownerId={ownerId}
                  bookingId={bookingIdOf(e)}
                  minutes={Math.round((Date.parse(e.endAt) - Date.parse(e.startAt)) / 60000) || 30}
                  onSaved={() => { setLengthening(null); load(); }}
                  onCancel={() => setLengthening(null)}
                />
              )}

              <div className="itin-actions no-print">
                {/* Said out loud rather than left to a dimmed row. The greying
                    alone reads as "not loaded" as easily as "finished", and
                    what somebody is scanning a past day for is precisely which
                    things got done. */}
                {past && <span className="pill is-done-pill">Done</span>}

                {mine && !viewerIsPrincipal && e.status === 'draft' && (
                  <>
                    <button className="btn btn-primary btn-sm" type="button"
                      onClick={() => act(e.id, 'publish')}>Publish</button>
                    <button className="btn btn-secondary btn-sm" type="button"
                      onClick={async () => {
                        const note = await ask({
                          title: 'Send this for approval',
                          label: 'Anything they should know',
                          hint: 'Goes to them with the item. Leave it empty if it speaks for itself.',
                          multiline: true,
                          optional: true,
                          confirmLabel: 'Send it',
                        });
                        if (note === null) return;
                        act(e.id, 'propose', { note });
                      }}>Ask them</button>
                  </>
                )}
                {mine && viewerIsPrincipal && e.status === 'proposed' && (
                  <>
                    <button className="btn btn-primary btn-sm" type="button"
                      onClick={() => act(e.id, 'decide', { approve: true })}>Approve</button>
                    <button className="btn btn-secondary btn-sm" type="button"
                      onClick={async () => {
                        const note = await ask({
                          title: 'Decline this',
                          label: 'Anything they should know',
                          hint: 'It goes back to their drafts rather than away, so a reason saves a round trip.',
                          multiline: true,
                          optional: true,
                          confirmLabel: 'Decline',
                        });
                        if (note === null) return;
                        act(e.id, 'decide', { approve: false, note });
                      }}>Decline</button>
                  </>
                )}

                {/* Not only a live-day alert here: on a day still being
                    planned this is the question "if this slips an hour, does
                    the flight still work?", which is exactly when it is worth
                    asking. So it stays on every day, quietly. */}
                {mine && e.status !== 'draft' && !past && (
                  <button className="itin-tool" type="button"
                    aria-label={`${e.title} is running late`}
                    onClick={() => setLateItem(e)}>Running late</button>
                )}
                {/* Editing it, rather than removing it and typing it again —
                    which is what this screen made somebody do for a wrong
                    time, a changed room, or a misspelt name, and which loses
                    the notes and the series along with the mistake. */}
                {mine && editing !== e.id && (
                  <button className="itin-tool" type="button"
                    aria-label={`Edit ${e.title}`}
                    onClick={() => { setEditing(e.id); setRemoving(null); }}>Edit</button>
                )}
                {/* Offered, never applied on its own: a schedule that reshuffles
                    itself because traffic moved is one nobody trusts. */}
                {mine && e.location && e.destination && (
                  <TravelTime ownerId={ownerId} item={e} onApplied={load} />
                )}
                {/* A repeating entry has three different removals and they are
                    not interchangeable: away next week, the arrangement has
                    ended, or it was set up wrongly. Asked inline rather than
                    guessed, because guessing wrong deletes a year of diary. */}
                {mine && removing === e.id && e.seriesId && (
                  <>
                    <span className="hint" style={{ margin: 0 }}>Remove</span>
                    <button className="itin-tool is-danger" type="button"
                      onClick={() => remove(e.id, 'one')}>just this one</button>
                    <button className="itin-tool is-danger" type="button"
                      onClick={() => remove(e.id, 'following')}>this and later</button>
                    <button className="itin-tool is-danger" type="button"
                      onClick={() => remove(e.id, 'series')}>all of them</button>
                    <button className="itin-tool" type="button"
                      onClick={() => setRemoving(null)}>Keep</button>
                  </>
                )}
                {mine && removing !== e.id && (
                  <button className="itin-tool is-danger" type="button"
                    aria-label={`Remove ${e.title}`}
                    onClick={() => (e.seriesId ? setRemoving(e.id) : remove(e.id))}>Remove</button>
                )}
                {/* An appointment somebody booked is still an appointment, and
                    until now the day sheet offered nothing at all for one —
                    the tools above are gated to items this office created. So
                    an assistant who needed to move a confirmed meeting had to
                    cancel it and ask the booker to book again, which costs the
                    booker two emails and loses the thread. */}
                {e.source === 'booking' && e.status !== 'cancelled' && !past && moving !== e.id && (
                  <>
                    {/* The same question as on an entry the office created —
                        "if this overruns, what does it do to the rest of the
                        day" — and until now it was asked only of half the
                        day. See lib/cascade.js: the plan reads bookings as
                        well as itinerary items, so the answer is about the
                        whole schedule rather than the part this office typed. */}
                    <button className="itin-tool" type="button"
                      aria-label={`${e.title} is running late`}
                      onClick={() => setLateItem(e)}>Running late</button>
                    <button className="itin-tool" type="button"
                      aria-label={`Move ${e.title}`}
                      onClick={() => setMoving(e.id)}>Move</button>
                    {/* The third of the three the appointment's own page
                        offers, and the one that was missing here. Running
                        twenty minutes over is not the same decision as moving
                        to Thursday, so it is not a field inside the move. */}
                    {lengthening !== e.id && (
                      <button className="itin-tool" type="button"
                        aria-label={`Change the length of ${e.title}`}
                        onClick={() => setLengthening(e.id)}>Length</button>
                    )}
                    <button className="itin-tool is-danger" type="button"
                      aria-label={`Cancel ${e.title}`}
                      onClick={() => cancelBooking(e)}>Cancel</button>
                  </>
                )}
                {/* The same picker the appointment's own page uses, rather
                    than a second one that could disagree with it about what
                    is free. It used to be two bare boxes here: you typed a
                    time, pressed Move, and learned from a red banner whether
                    anything was already there. */}
                {e.source === 'booking' && moving === e.id && (
                  <MoveAppointment
                    ownerId={ownerId}
                    bookingId={bookingIdOf(e)}
                    timezone={data?.timezone || 'UTC'}
                    startAt={e.startAt}
                    minutes={Math.round((Date.parse(e.endAt) - Date.parse(e.startAt)) / 60000) || 30}
                    onMoved={() => { setMoving(null); load(); }}
                    onCancel={() => setMoving(null)}
                  />
                )}
                {e.source === 'booking' && (
                  <button className="itin-tool" type="button"
                    aria-label={`Notes on ${e.title}`}
                    onClick={() => setNoting((n) => (n === e.id ? null : e.id))}>
                    {noting === e.id ? 'Hide notes' : 'Notes'}
                  </button>
                )}
                {e.source === 'booking' && <span className="pill">From a booking</span>}
              </div>
            </li>
          );
        })}
      </ol>

    </AppShell>
  );
}

/**
 * How long this leg will actually take, asked of the road.
 *
 * The number it replaces has always been typed by hand, and in Lagos it is the
 * whole schedule — the same drive is twelve minutes on a Sunday morning and
 * eighty at six on a Thursday. The answer is shown with the old number beside
 * it and applied only when somebody says so.
 */
function TravelTime({ ownerId, item, onApplied }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);

  async function ask(apply) {
    setBusy(true);
    try {
      const d = await api.post(`/itinerary/${ownerId}/items/${item.id}/travel-time`, { apply });
      setState(d);
      if (apply) onApplied?.();
    } catch (e) {
      setState({ error: e.message, unconfigured: e.status === 501 });
    } finally { setBusy(false); }
  }

  if (state?.error) {
    return (
      <span className="travel-note">
        {state.unconfigured
          ? <span className="notyet">Not available yet</span>
          : state.error}
      </span>
    );
  }

  if (!state) {
    return (
      // A word, like the other upkeep controls beside it — it was the one
      // button left in a row of links.
      <button className="itin-tool no-print" type="button" disabled={busy}
        onClick={() => ask(false)}>
        {busy ? 'Asking…' : 'Travel time'}
      </button>
    );
  }

  return (
    <span className="travel-note">
      <strong>{state.minutes} min</strong>
      {state.traffic ? ' with traffic' : ' without traffic data'}
      {state.previousMinutes > 0 && state.previousMinutes !== state.minutes
        && ` · was ${state.previousMinutes}`}
      {!state.applied && (
        <button className="btn btn-secondary btn-sm no-print" type="button" disabled={busy}
          onClick={() => ask(true)}>Use it</button>
      )}
      {state.applied && <span className="pill">Applied</span>}
    </span>
  );
}
