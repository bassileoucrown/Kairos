import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import { dateKeyInZone, timeLabelInZone, zonedToUtc } from '../../lib/timezones.js';
import VideoJoinLink from '../../components/VideoJoinLink.jsx';

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

function Entry({ booking, timezone, compact }) {
  const held = booking.status === 'pending';
  return (
    <span
      className={'cal-entry' + (held ? ' is-held' : '')}
      style={{ '--entry-color': booking.meetingTypeColor }}
      title={`${timeLabelInZone(booking.startAt, timezone)} · ${booking.meetingTypeName} · ${booking.bookerName}${held ? ' (awaiting a decision)' : ''}`}
    >
      {timeLabelInZone(booking.startAt, timezone)} {compact ? booking.bookerName : `${booking.bookerName} · ${booking.meetingTypeName}`}
    </span>
  );
}

export default function CalendarTab({ ownerId = null, timezone = null }) {
  const { user } = useAuth();
  const base = ownerId ? `/pa/${ownerId}` : '';
  const zone = timezone || user?.timezone || 'UTC';

  const [view, setView] = useState(() => {
    try {
      const stored = localStorage.getItem(VIEW_KEY);
      return VIEWS.some((v) => v.id === stored) ? stored : 'month';
    } catch { return 'month'; }
  });
  const today = dateKeyInZone(new Date().toISOString(), zone);
  const [anchor, setAnchor] = useState(today);
  const [bookings, setBookings] = useState(null);
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

  useEffect(() => {
    const from = zonedToUtc(period.days[0], '00:00', zone);
    const to = zonedToUtc(shiftDays(period.days[period.days.length - 1], 1), '00:00', zone);
    let live = true;
    setBookings(null);
    setError('');
    api.get(`${base}/bookings?scope=range&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then((d) => { if (live) setBookings(d.bookings); })
      .catch((err) => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [base, zone, period.days[0], period.days[period.days.length - 1]]);

  const byDay = useMemo(() => {
    const map = new Map();
    for (const b of bookings || []) {
      const key = dateKeyInZone(b.startAt, zone);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(b);
    }
    for (const list of map.values()) list.sort((a, b) => a.startAt.localeCompare(b.startAt));
    return map;
  }, [bookings, zone]);

  const selectedBookings = selectedDay ? (byDay.get(selectedDay) || []) : [];

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

      {bookings === null && <p className="hint">Loading…</p>}

      {/* ---- A day, hour by hour ---- */}
      {bookings !== null && view === 'day' && (
        <DayView day={anchor} bookings={byDay.get(anchor) || []} zone={zone} />
      )}

      {/* ---- A week: seven columns with room, seven sections without ---- */}
      {bookings !== null && view === 'week' && (
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
                  {list.map((b) => <Entry key={b.id} booking={b} timezone={zone} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ---- A month, as before ---- */}
      {bookings !== null && view === 'month' && (
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
                {list.slice(0, 3).map((b) => <Entry key={b.id} booking={b} timezone={zone} compact />)}
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
          {selectedBookings.length === 0 && <p className="hint">Nothing booked.</p>}
          {selectedBookings.map((b) => <Row key={b.id} booking={b} zone={zone} />)}
        </div>
      )}
    </div>
  );
}

function Row({ booking: b, zone }) {
  return (
    <div className="booking-row" style={{ marginBottom: 8 }}>
      <div>
        <div className="when">
          <span className="cal-swatch" style={{ background: b.meetingTypeColor }} />
          {timeLabelInZone(b.startAt, zone)} · {b.meetingTypeName}
          {b.status === 'pending' && <span className="pill is-off" style={{ marginLeft: 8 }}>Held</span>}
        </div>
        <div className="meta">{b.bookerName} ({b.bookerEmail}) · {b.formatLabel}</div>
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
function DayView({ day, bookings, zone }) {
  const hours = useMemo(() => {
    let first = 8;
    let last = 18;
    for (const b of bookings) {
      const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hour12: false })
        .format(new Date(b.startAt)));
      first = Math.min(first, h);
      last = Math.max(last, h + 1);
    }
    return Array.from({ length: Math.max(1, last - first) }, (_, i) => first + i);
  }, [bookings, zone]);

  const byHour = useMemo(() => {
    const map = new Map();
    for (const b of bookings) {
      const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hour12: false })
        .format(new Date(b.startAt)));
      if (!map.has(h)) map.set(h, []);
      map.get(h).push(b);
    }
    return map;
  }, [bookings, zone]);

  return (
    <div className="cal-hours">
      {bookings.length === 0 && (
        <div className="empty-state" style={{ padding: '20px 0' }}>Nothing booked on this day.</div>
      )}
      {hours.map((h) => (
        <div className="cal-hour" key={h}>
          <span className="cal-hour-label">{pad(h)}:00</span>
          <div className="cal-hour-body">
            {(byHour.get(h) || []).map((b) => <Row key={b.id} booking={b} zone={zone} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
