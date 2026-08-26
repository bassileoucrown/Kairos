import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { dateKeyInZone, dayLabelInZone, timeLabelInZone, zonedToUtc } from '../lib/timezones.js';

/**
 * Choosing where to move an appointment to.
 *
 * WHAT THIS REPLACED. A bare date box and a bare time box. You typed a time,
 * pressed Move, and found out from a red banner whether anything was already
 * there — which makes finding a free hour a guessing game played one failed
 * submit at a time, against a diary you cannot see.
 *
 * So the day is shown. What is already on it, and what is free.
 *
 * BUT THE GRID IS NOT A FENCE. The office may put a meeting anywhere — see
 * lib/rescheduleBooking.js — so the typed time stays, and the suggestions
 * never stand in place of it. Times outside the published hours are offered
 * too, behind one click, because a seven o'clock breakfast is a normal thing
 * for an office to arrange and a picker that omitted it would be quietly
 * telling somebody they cannot.
 */

const overlap = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && aEnd > bStart;

export default function MoveAppointment({
  ownerId, bookingId, timezone, startAt, minutes, onMoved, onCancel,
}) {
  const zone = timezone || 'UTC';
  const [date, setDate] = useState(() => dateKeyInZone(startAt, zone));
  const [day, setDay] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [typed, setTyped] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const base = `/pa/${ownerId}/bookings/${bookingId}`;

  useEffect(() => {
    let stale = false;
    setDay(null);
    setChosen(null);
    api.get(`${base}/openings?date=${date}`)
      .then((d) => { if (!stale) setDay(d); })
      .catch((err) => { if (!stale) setError(err.message); });
    return () => { stale = true; };
  }, [ownerId, bookingId, date]);

  /**
   * Change which day is being looked at.
   *
   * CLEARS THE TIMES IN THE SAME BREATH AS THE DATE, and that pairing is the
   * whole point of the function. Setting only the date left one frame in which
   * the heading said Thursday while the buttons underneath were still
   * Wednesday's free times — the effect below does clear them, but not until
   * after that render. For a moment the picker offered times as free on a day
   * it had not looked at yet, which is the one thing a picker must never do.
   *
   * Both setters land in one commit, so no frame can ever show a day's label
   * above another day's times.
   */
  function goToDay(iso) {
    setDate(iso);
    setDay(null);
    setChosen(null);
    setTyped('');
  }

  function shiftDay(n) {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    goToDay(d.toISOString().slice(0, 10));
  }

  const openings = day?.openings || [];
  const anyWithinHours = openings.some((o) => o.withinHours);
  // Lead with the times a stranger could have taken — they are what is normal
  // for this principal. If the principal publishes no hours at all, that
  // filter would hide everything, so it does not apply.
  const shown = (showAll || !anyWithinHours) ? openings : openings.filter((o) => o.withinHours);

  /**
   * What a hand-typed time would collide with, worked out here so it is
   * answered while somebody is still looking at the form.
   *
   * Advisory only. The server refuses the move on its own account, from its
   * own read of the diary; this exists so the refusal is rarely a surprise,
   * not so it can be relied upon.
   */
  const verdict = useMemo(() => {
    if (!typed || !day) return null;
    const start = Date.parse(zonedToUtc(date, typed, zone));
    if (Number.isNaN(start)) return null;
    const end = start + (day.minutes || minutes) * 60000;
    const hit = (day.busy || []).find((b) => overlap(start, end, Date.parse(b.startAt), Date.parse(b.endAt)));
    if (!hit) return { ok: true, text: 'Nothing else is there.' };
    if (hit.kind === 'booking') return { ok: false, text: `That overlaps ${hit.label}.` };
    return { ok: true, text: `Free, but ${hit.label} is on the day at that time.` };
  }, [typed, day, date, zone, minutes]);

  const startAtToSend = chosen
    ? chosen.startAt
    : (typed ? zonedToUtc(date, typed, zone) : null);

  async function move() {
    setBusy(true);
    setError('');
    try {
      await api.post(`${base}/reschedule`, { startAt: startAtToSend, note });
      onMoved?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="move-picker">
      {error && <div className="alert alert-error">{error}</div>}

      <div className="move-day">
        <button className="btn btn-secondary btn-sm" type="button" onClick={() => shiftDay(-1)}>←</button>
        <input aria-label="Which day" type="date" value={date}
          onChange={(e) => goToDay(e.target.value)} />
        <button className="btn btn-secondary btn-sm" type="button" onClick={() => shiftDay(1)}>→</button>
        <span className="hint" style={{ margin: 0 }}>{dayLabelInZone(`${date}T12:00:00Z`, 'UTC')}</span>
      </div>

      {day === null && <p className="hint">Reading the day…</p>}

      {day && (day.busy || []).length > 0 && (
        <div className="move-busy">
          <span className="move-busy-head">Already that day</span>
          {day.busy.map((b) => (
            <span className={`move-busy-item is-${b.kind === 'booking' ? 'booking' : 'other'}`} key={b.id}>
              {timeLabelInZone(b.startAt, zone)} {b.label}
            </span>
          ))}
        </div>
      )}

      {day && (
        <>
          {openings.length === 0 ? (
            <div className="empty-state">
              Nothing free that day between{' '}
              {timeLabelInZone(day.dayStartsAt, zone)} and {timeLabelInZone(day.dayEndsAt, zone)}.
              You can still put it anywhere below.
            </div>
          ) : (
            <div className="slot-grid">
              {shown.map((o) => (
                <button
                  key={o.startAt}
                  type="button"
                  className={'slot-btn'
                    + (chosen?.startAt === o.startAt ? ' is-selected' : '')
                    + (o.withinHours ? '' : ' is-offhours')
                    + (o.tight ? ' is-tight' : '')}
                  // Said on the button as well as in the line below it, because
                  // somebody scanning for a time should not have to click one
                  // to find out it lands on top of a flight.
                  title={[
                    o.withinHours ? null : 'Outside your published hours',
                    o.tight ? 'Back-to-back with something' : null,
                    o.alongside ? `${o.alongside} is on the day` : null,
                  ].filter(Boolean).join(' · ') || undefined}
                  onClick={() => { setChosen(o); setTyped(''); }}
                >
                  {timeLabelInZone(o.startAt, zone)}
                </button>
              ))}
            </div>
          )}

          {anyWithinHours && openings.some((o) => !o.withinHours) && (
            <button className="link-button" type="button" onClick={() => setShowAll((s) => !s)}>
              {showAll ? 'Only my published hours' : 'Show times outside my hours'}
            </button>
          )}

          {chosen && (
            <p className="hint">
              {dayLabelInZone(chosen.startAt, zone)} at {timeLabelInZone(chosen.startAt, zone)},
              ending {timeLabelInZone(chosen.endAt, zone)}.
              {!chosen.withinHours && ' Outside your published hours.'}
              {chosen.tight && ' Back-to-back with something either side.'}
              {chosen.alongside && ` ${chosen.alongside} is on the day at that time.`}
            </p>
          )}

          <div className="field" style={{ maxWidth: 220 }}>
            <label htmlFor="mv-time">Or a time of your own</label>
            <input id="mv-time" type="time" value={typed}
              onChange={(e) => { setTyped(e.target.value); setChosen(null); }} />
            {verdict && (
              <p className={verdict.ok ? 'hint' : 'hint is-warn'}>{verdict.text}</p>
            )}
          </div>
        </>
      )}

      <div className="field">
        <label htmlFor="mv-why">Why (optional)</label>
        <input id="mv-why" type="text" maxLength={280} value={note}
          onChange={(e) => setNote(e.target.value)} placeholder="The board ran over" />
        <p className="hint">It runs {minutes} minutes either way. They will be emailed the new time.</p>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" type="button"
          disabled={busy || !startAtToSend} onClick={move}>
          {busy ? 'Moving…' : 'Move it'}
        </button>
        {onCancel && (
          <button className="btn btn-sm" type="button" onClick={onCancel}>Never mind</button>
        )}
      </div>
    </div>
  );
}
