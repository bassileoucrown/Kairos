import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import { dateKeyInZone, timeLabelInZone } from '../../lib/timezones.js';
import VideoJoinLink from '../../components/VideoJoinLink.jsx';
import SlotItIn from '../../components/SlotItIn.jsx';
import { KIND_ICON, KIND_LABEL } from '../Today.jsx';

// How much diary to look at.
//
// It was a month, always, and a month is the wrong answer most of the time.
// Somebody checking what today holds does not want thirty-one boxes of which
// one matters, and somebody planning a trip wants the week either side of it.
// So the length is a choice, and it is remembered — a person who works in
// weeks works in weeks every morning, and asking them again each time is the
// kind of small tax that makes a tool feel like work.
//
// EVERY VIEW ASKS FOR EXACTLY WHAT IT SHOWS. The range is computed here, in
// the principal's timezone, and sent to the server. Fetching everything and
// filtering in the browser is what this used to do, and it does not survive a
// diary with a few years in it.
const VIEWS = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

const VIEW_KEY = 'kairos_calendar_view';
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// A date key is just three numbers, so the arithmetic is plain UTC arithmetic.
// The timezone only matters at the two edges: deciding which key "now" falls
// on, and turning a key back into an instant to ask the server about.
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const dateOf = (key) => new Date(`${key}T00:00:00Z`);
function shiftDays(key, n) {
  const d = dateOf(key);
  d.setUTCDate(d.getUTCDate() + n);
  return keyOf(d);
}
function shiftMonths(key, n) {
  const d = dateOf(key);
  return keyOf(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
}

const label = (key, opts) => dateOf(key).toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts });

/**
 * Which days a view covers, and what to call the period.
 *
 * Month deliberately returns the whole six-week grid rather than the month:
 * the grid shows those leading and trailing days, so the fetch has to cover
 * them or they render empty and lie.
 */
function periodFor(view, anchor) {
  if (view === 'day') {
    return {
      days: [anchor],
      title: label(anchor, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    };
  }
  if (view === 'week') {
    const start = shiftDays(anchor, -dateOf(anchor).getUTCDay());
    const days = Array.from({ length: 7 }, (_, i) => shiftDays(start, i));
    const end = days[6];
    const sameMonth = start.slice(0, 7) === end.slice(0, 7);
    return {
      days,
      title: sameMonth
        ? `${label(start, { day: 'numeric' })} – ${label(end, { day: 'numeric', month: 'long', year: 'numeric' })}`
        : `${label(start, { day: 'numeric', month: 'short' })} – ${label(end, { day: 'numeric', month: 'short', year: 'numeric' })}`,
    };
  }
  const first = `${anchor.slice(0, 7)}-01`;
  const gridStart = shiftDays(first, -dateOf(first).getUTCDay());
  return {
    days: Array.from({ length: 42 }, (_, i) => shiftDays(gridStart, i)),
    month: anchor.slice(0, 7),
    title: label(first, { month: 'long', year: 'numeric' }),
  };
}

// The colour a kind of thing is drawn in, matching the left edge each entry
// already wears on Today and the Itinerary. One diary, one palette.
const KIND_COLOR = {
  flight: '#4C5B7A', train: '#4C5B7A', car: '#4C5B7A',
  hotel: '#8A5426', meal: '#B3703A', personal: '#B3703A',
  meeting: '#3E6357', call: '#3E6357', note: '#6B7280',
};

// What to call it, in as few words as a calendar cell allows. A booking is
// somebody's name; everything else is already titled.
function entryLabel(e, compact) {
  if (e.source === 'booking') {
    return compact ? e.bookerName : `${e.bookerName} · ${e.meetingTypeName}`;
  }
  return e.title;
}

function Entry({ entry: e, timezone, compact }) {
  const held = e.status === 'pending';
  const draft = e.status === 'draft';
  const proposed = e.status === 'proposed';
  const time = timeLabelInZone(e.startAt, timezone);
  const color = e.source === 'booking'
    ? (e.meetingTypeColor || KIND_COLOR.meeting)
    : (KIND_COLOR[e.kind] || KIND_COLOR.note);
  const state = held ? ' (awaiting a decision)'
    : proposed ? ' (waiting on a decision)'
      : draft ? ' (draft)' : '';
  return (
    <span
      className={'cal-entry' + (held || proposed ? ' is-held' : '') + (draft ? ' is-draft' : '')}
      style={{ '--entry-color': color }}
      title={`${time} · ${entryLabel(e)}${state}`}
    >
      <span className="cal-entry-icon" aria-hidden="true">{KIND_ICON[e.kind] || '•'}</span>
      {time} {entryLabel(e, compact)}
    </span>
  );
}

export default function CalendarTab({ ownerId = null, timezone = null }) {
  const { user } = useAuth();
  const zone = timezone || user?.timezone || 'UTC';

  const [view, setView] = useState(() => {
    try {
      const stored = localStorage.getItem(VIEW_KEY);
      return VIEWS.some((v) => v.id === stored) ? stored : 'month';
    } catch { return 'month'; }
  });
  const today = dateKeyInZone(new Date().toISOString(), zone);
  const [anchor, setAnchor] = useState(today);
  // The whole diary, not only the part of it strangers booked. This screen
  // used to ask for /bookings alone, so a month containing a flight to London,
  // a car, a hotel and a board meeting rendered as four empty boxes — the one
  // view people plan against was the one view that did not show the plan.
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');
  const [selectedDay, setSelectedDay] = useState(null);

  const period = useMemo(() => periodFor(view, anchor), [view, anchor]);

  function chooseView(id) {
    setView(id);
    setSelectedDay(null);
    try { localStorage.setItem(VIEW_KEY, id); } catch { /* private window; the choice just won't stick */ }
  }

  function shift(delta) {
    setSelectedDay(null);
    setAnchor((a) => {
      if (view === 'day') return shiftDays(a, delta);
      if (view === 'week') return shiftDays(a, delta * 7);
      return shiftMonths(a, delta);
    });
  }

  // The range endpoint already groups by day in the principal's zone and
  // decides which day an entry falls on there, which is the one place that
  // arithmetic belongs.
  // On the principal's own dashboard no ownerId is passed, and the route has
  // no "me" alias — it looks the id up and 404s on anything else.
  const subjectId = ownerId || user?.id;
  const first = period.days[0];
  const last = period.days[period.days.length - 1];
  // Bumped when something is added to the diary from this screen, so the day
  // it landed on redraws without a reload. The range effect is keyed on the
  // dates rather than on a function, so there is no load() to call.
  const [addedAt, setAddedAt] = useState(0);
  useEffect(() => {
    if (!subjectId) return undefined;
    let live = true;
    setEntries(null);
    setError('');
    api.get(`/itinerary/${subjectId}/range?from=${first}&to=${last}`)
      .then((d) => { if (live) setEntries(d.days); })
      .catch((err) => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [subjectId, first, last, addedAt]);

  const byDay = useMemo(() => {
    const map = new Map();
    for (const [key, list] of Object.entries(entries || {})) map.set(key, list);
    return map;
  }, [entries]);

  const selectedEntries = selectedDay ? (byDay.get(selectedDay) || []) : [];

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="cal-bar">
        <div className="cal-move">
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => shift(-1)} aria-label="Previous">←</button>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setAnchor(today); setSelectedDay(null); }}>
            Today
          </button>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => shift(1)} aria-label="Next">→</button>
        </div>
        <strong className="cal-title">{period.title}</strong>
        <div className="cal-views" role="group" aria-label="How much to show">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              className={'btn btn-sm ' + (view === v.id ? 'btn-primary' : 'btn-secondary')}
              aria-pressed={view === v.id}
              onClick={() => chooseView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {entries === null && <p className="hint">Loading…</p>}

      {/* ---- A day, hour by hour ---- */}
      {entries !== null && view === 'day' && (
        <DayView day={anchor} entries={byDay.get(anchor) || []} zone={zone} subjectId={subjectId} />
      )}

      {/* ---- A week: seven columns with room, seven sections without ---- */}
      {entries !== null && view === 'week' && (
        <div className="cal-week">
          {period.days.map((key) => {
            const list = byDay.get(key) || [];
            return (
              <div className={'cal-day' + (key === today ? ' is-today' : '')} key={key}>
                <div className="cal-day-head">
                  <span className="cal-dow">{WEEKDAY_LABELS[dateOf(key).getUTCDay()]}</span>
                  <span className="cal-dom">{label(key, { day: 'numeric' })}</span>
                </div>
                <div className="cal-day-body">
                  {list.length === 0 && <span className="cal-empty">—</span>}
                  {list.map((b) => <Entry key={b.id} entry={b} timezone={zone} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ---- A month, as before ---- */}
      {entries !== null && view === 'month' && (
        <div className="cal-month">
          {WEEKDAY_LABELS.map((w) => <div className="cal-dow-head" key={w}>{w}</div>)}
          {period.days.map((key) => {
            const list = byDay.get(key) || [];
            return (
              <button
                key={key}
                type="button"
                className={'cal-cell'
                  + (key.slice(0, 7) === period.month ? '' : ' is-outside')
                  + (selectedDay === key ? ' is-selected' : '')
                  + (key === today ? ' is-today' : '')}
                onClick={() => setSelectedDay(selectedDay === key ? null : key)}
              >
                <span className="cal-dom">{label(key, { day: 'numeric' })}</span>
                {list.slice(0, 3).map((b) => <Entry key={b.id} entry={b} timezone={zone} compact />)}
                {list.length > 3 && <span className="cal-more">+{list.length - 3} more</span>}
              </button>
            );
          })}
        </div>
      )}

      {selectedDay && view === 'month' && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 10 }}>
            {label(selectedDay, { weekday: 'long', day: 'numeric', month: 'long' })}
          </h3>
          {selectedEntries.length === 0 && <p className="hint">Nothing on this day.</p>}
          {selectedEntries.map((b) => <Row key={b.id} entry={b} zone={zone} subjectId={subjectId} />)}
          {/* Pre-filled with the day already open, because somebody who has
              clicked a day and is now adding something means THAT day, and
              retyping the date they just chose is the kind of small friction
              that sends people back to a paper diary. */}
          <div style={{ marginTop: 12 }}>
            <SlotItIn ownerId={ownerId} defaultDate={selectedDay} onAdded={() => setAddedAt(Date.now())} />
          </div>
        </div>
      )}
    </div>
  );
}

// One line of a day, whether it came from the booking page or from the person
// building the day. A booking's second line is who booked it; everything
// else's is where it is and what it is.
function Row({ entry: b, zone, subjectId }) {
  const isBooking = b.source === 'booking';
  const color = isBooking
    ? (b.meetingTypeColor || KIND_COLOR.meeting)
    : (KIND_COLOR[b.kind] || KIND_COLOR.note);
  return (
    <div className="booking-row" style={{ marginBottom: 8 }}>
      <div>
        <div className="when">
          <span className="cal-swatch" style={{ background: color }} />
          {timeLabelInZone(b.startAt, zone)}
          {b.endLabel ? ` – ${b.endLabel}` : ''}
          {' · '}
          {/* A WAY IN, which this row has never had. The day sheet's rows lead
              to the appointment and the calendar's did not, so anything seen
              here could be read and not acted on — no move, no change of
              length, no cancelling. That became obvious the moment the diary
              could be written to from this very screen: people added something
              and then had nowhere to go with it. The id arrives prefixed
              ("booking:...") because the range endpoint merges two sources. */}
          {isBooking && subjectId ? (
            <Link
              className="sched-title-link"
              to={`/appointments/${subjectId}/${String(b.id).replace(/^booking:/, '')}`}
            >
              {b.meetingTypeName}
            </Link>
          ) : (isBooking ? b.meetingTypeName : b.title)}
          {b.status === 'pending' && <span className="pill is-off" style={{ marginLeft: 8 }}>Held</span>}
          {b.status === 'proposed' && <span className="pill is-warn" style={{ marginLeft: 8 }}>Waiting</span>}
          {b.status === 'draft' && <span className="pill is-off" style={{ marginLeft: 8 }}>Draft</span>}
        </div>
        <div className="meta">
          {isBooking
            ? `${b.bookerName}${b.bookerEmail ? ` (${b.bookerEmail})` : ''}`
            : [KIND_LABEL[b.kind] || b.kind, b.location, b.destination && `→ ${b.destination}`]
              .filter(Boolean).join(' · ')}
        </div>
      </div>
      {b.videoRoom && <VideoJoinLink room={b.videoRoom} />}
    </div>
  );
}

/**
 * One day, by the hour.
 *
 * The hours shown are the ones that hold something, widened to a working day
 * so an empty Tuesday still looks like a day rather than a single line. Not
 * midnight to midnight: twenty-four rows to show two meetings is a scroll
 * nobody asked for.
 */
function DayView({ day, entries, zone, subjectId }) {
  const hours = useMemo(() => {
    let first = 8;
    let last = 18;
    for (const b of entries) {
      const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hour12: false })
        .format(new Date(b.startAt)));
      first = Math.min(first, h);
      last = Math.max(last, h + 1);
    }
    return Array.from({ length: Math.max(1, last - first) }, (_, i) => first + i);
  }, [entries, zone]);

  const byHour = useMemo(() => {
    const map = new Map();
    for (const b of entries) {
      const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hour12: false })
        .format(new Date(b.startAt)));
      if (!map.has(h)) map.set(h, []);
      map.get(h).push(b);
    }
    return map;
  }, [entries, zone]);

  // Ten ruled hours under the words "nothing on this day" is the same fact
  // told twice, the second time at length. The wrapper stays either way: it
  // is what says "this is the day view", and returning a bare empty-state
  // instead left the screen with nothing identifying which view was on.
  if (entries.length === 0) {
    return (
      <div className="cal-hours">
        <div className="empty-state" style={{ padding: '28px 0' }}>Nothing on this day.</div>
      </div>
    );
  }

  return (
    <div className="cal-hours">
      {hours.map((h) => (
        <div className="cal-hour" key={h}>
          <span className="cal-hour-label">{pad(h)}:00</span>
          <div className="cal-hour-body">
            {(byHour.get(h) || []).map((b) => <Row key={b.id} entry={b} zone={zone} subjectId={subjectId} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
