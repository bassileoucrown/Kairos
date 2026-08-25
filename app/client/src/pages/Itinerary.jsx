import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import AppShell, { resolveActivePrincipal } from '../components/AppShell.jsx';
import RunningLate from '../components/RunningLate.jsx';
import BuildTrip from '../components/BuildTrip.jsx';
import { useAuth } from '../lib/AuthContext.jsx';
import { ScheduleEntry, KIND_ICON, shapeOf, span } from './Today.jsx';
import TimezonePicker from '../components/TimezonePicker.jsx';
import { zonedToUtc } from '../lib/timezones.js';
import { useAsk } from '../components/Ask.jsx';

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

export default function Itinerary() {
  // Replaces window.prompt; see components/Ask.jsx.
  const [ask, askDialog] = useAsk();
  // Which entry is mid-removal, so a repeating one can be asked which of the
  // three removals is meant before anything goes.
  const [removing, setRemoving] = useState(null);
  // Which appointment is mid-move, and to when. A booking is somebody else's
  // diary too, so moving one is done deliberately rather than by dragging.
  const [moving, setMoving] = useState(null);
  const [moveTo, setMoveTo] = useState({ date: '', time: '' });
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

  async function moveBooking(e) {
    setError('');
    try {
      await api.post(`/pa/${ownerId}/bookings/${bookingIdOf(e)}/reschedule`, {
        startAt: zonedToUtc(moveTo.date, moveTo.time, data?.timezone || 'UTC'),
      });
      setMoving(null);
      load();
    } catch (err) { setError(err.message); }
  }

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
  // so it gets no now line and nothing on it is running, finished, or next.
  const todayKey = new Date().toISOString().slice(0, 10);
  const isToday = date === todayKey;
  const rows = shapeOf(entries, isToday ? Date.now() : null);

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
          return (
            <li
              className={'day-item itin-entry'
                + (row.running ? ' is-running' : '')
                + (row.done ? ' is-done' : '')
                + (e.status === 'draft' ? ' is-draft' : '')
                + (e.status === 'proposed' ? ' is-proposed' : '')}
              key={e.id}
            >
              <ScheduleEntry e={e} viewerIsPrincipal={viewerIsPrincipal} />

              <div className="itin-actions no-print">
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
                {mine && e.status !== 'draft' && (
                  <button className="itin-tool" type="button"
                    aria-label={`${e.title} is running late`}
                    onClick={() => setLateItem(e)}>Running late</button>
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
                {e.source === 'booking' && e.status !== 'cancelled' && moving !== e.id && (
                  <>
                    <button className="itin-tool" type="button"
                      aria-label={`Move ${e.title}`}
                      onClick={() => {
                        setMoving(e.id);
                        setMoveTo({ date, time: e.startLabel ? '' : '' });
                      }}>Move</button>
                    <button className="itin-tool is-danger" type="button"
                      aria-label={`Cancel ${e.title}`}
                      onClick={() => cancelBooking(e)}>Cancel</button>
                  </>
                )}
                {e.source === 'booking' && moving === e.id && (
                  <span className="itin-move">
                    <input
                      type="date"
                      aria-label="New date"
                      value={moveTo.date}
                      onChange={(ev) => setMoveTo((m) => ({ ...m, date: ev.target.value }))}
                    />
                    <input
                      type="time"
                      aria-label="New time"
                      value={moveTo.time}
                      onChange={(ev) => setMoveTo((m) => ({ ...m, time: ev.target.value }))}
                    />
                    <button className="itin-tool" type="button"
                      disabled={!moveTo.date || !moveTo.time}
                      onClick={() => moveBooking(e)}>Move it</button>
                    <button className="itin-tool" type="button"
                      onClick={() => setMoving(null)}>Keep</button>
                  </span>
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
