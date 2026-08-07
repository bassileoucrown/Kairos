import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import { dateKeyInZone, timeLabelInZone } from '../../lib/timezones.js';
import VideoJoinLink from '../../components/VideoJoinLink.jsx';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function monthGrid(year, month) {
  // month: 0-indexed. Returns an array of {year,month,day,inMonth} covering
  // full weeks (Sun-Sat) so the grid always has complete rows.
  const first = new Date(Date.UTC(year, month, 1));
  const startOffset = first.getUTCDay();
  const gridStart = new Date(Date.UTC(year, month, 1 - startOffset));
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getTime());
    d.setUTCDate(gridStart.getUTCDate() + i);
    cells.push({
      year: d.getUTCFullYear(),
      month: d.getUTCMonth(),
      day: d.getUTCDate(),
      inMonth: d.getUTCMonth() === month,
      key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
    });
  }
  return cells;
}

export default function CalendarTab() {
  const { user } = useAuth();
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState('');
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selectedDay, setSelectedDay] = useState(null);

  useEffect(() => {
    api.get('/bookings').then((data) => setBookings(data.bookings)).catch((err) => setError(err.message));
  }, []);

  const byDay = useMemo(() => {
    const map = new Map();
    if (!bookings) return map;
    for (const b of bookings) {
      const key = dateKeyInZone(b.startAt, user.timezone);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(b);
    }
    for (const list of map.values()) list.sort((a, b) => a.startAt.localeCompare(b.startAt));
    return map;
  }, [bookings, user.timezone]);

  const cells = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const monthLabel = new Date(Date.UTC(cursor.year, cursor.month, 1))
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  function shiftMonth(delta) {
    setSelectedDay(null);
    setCursor((c) => {
      const d = new Date(Date.UTC(c.year, c.month + delta, 1));
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
    });
  }

  const selectedBookings = selectedDay ? (byDay.get(selectedDay) || []) : [];

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <button className="btn btn-secondary btn-sm" type="button" onClick={() => shiftMonth(-1)}>← Prev</button>
        <strong>{monthLabel}</strong>
        <button className="btn btn-secondary btn-sm" type="button" onClick={() => shiftMonth(1)}>Next →</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, background: 'var(--border)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} style={{ background: 'var(--bg-raised)', padding: '8px 6px', fontSize: '0.72rem', fontWeight: 700, textAlign: 'center', color: 'var(--text-muted)' }}>{w}</div>
        ))}
        {cells.map((cell) => {
          const dayBookings = byDay.get(cell.key) || [];
          const isSelected = selectedDay === cell.key;
          return (
            <button
              key={cell.key}
              type="button"
              onClick={() => setSelectedDay(isSelected ? null : cell.key)}
              style={{
                background: 'var(--surface)',
                border: 'none',
                borderTop: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
                minHeight: 74,
                padding: '6px 5px',
                textAlign: 'left',
                cursor: 'pointer',
                opacity: cell.inMonth ? 1 : 0.4,
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
              }}
            >
              <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{cell.day}</span>
              {dayBookings.slice(0, 3).map((b) => (
                <span
                  key={b.id}
                  style={{
                    fontSize: '0.65rem',
                    background: b.meetingTypeColor + '22',
                    color: b.meetingTypeColor,
                    borderRadius: 4,
                    padding: '1px 4px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {timeLabelInZone(b.startAt, user.timezone)} {b.bookerName}
                </span>
              ))}
              {dayBookings.length > 3 && (
                <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>+{dayBookings.length - 3} more</span>
              )}
            </button>
          );
        })}
      </div>

      {selectedDay && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 10 }}>{selectedDay}</h3>
          {selectedBookings.length === 0 && <p className="hint">Nothing booked.</p>}
          {selectedBookings.map((b) => (
            <div key={b.id} className="booking-row" style={{ marginBottom: 8 }}>
              <div>
                <div className="when">
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: b.meetingTypeColor, marginRight: 6 }} />
                  {timeLabelInZone(b.startAt, user.timezone)} · {b.meetingTypeName}
                </div>
                <div className="meta">{b.bookerName} ({b.bookerEmail})</div>
              </div>
              {b.videoRoom && <VideoJoinLink room={b.videoRoom} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
