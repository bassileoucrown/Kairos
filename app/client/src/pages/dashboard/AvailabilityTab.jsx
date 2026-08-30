import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { dayName } from '../../lib/timezones.js';
import RhythmRead from '../../components/RhythmRead.jsx';
import NotAvailable from '../../components/NotAvailable.jsx';

// A day holds a list of blocks rather than a single start/end, so a schedule
// can be "9–12 and 2–5" (or mornings only, or an evening window) instead of
// one unbroken stretch. A day is "on" exactly when it has at least one block.
function emptyWeek() {
  return [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, blocks: [] }));
}

// Null past midnight rather than clamped to 23:59, so the screen can say a
// block does not fit instead of showing a shorter one than was asked for.
function addMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + mins;
  if (total > 23 * 60 + 59) return null;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function minutesBetween(a, b) {
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  return (bh * 60 + bm) - (ah * 60 + am);
}

// What a block runs to, said the way somebody would read it back. Shown
// rather than asked for: working out 09:00 plus three hours is arithmetic,
// and arithmetic is not what anybody opened this screen to do.
function endsAt(startTime, lengthMinutes) {
  return addMinutes(startTime, lengthMinutes);
}

// A new block starts an hour after the previous one ends, so adding a second
// window to a 9–5 day proposes 6–7pm rather than something already covered.
function nextBlock(blocks) {
  if (blocks.length === 0) return { startTime: '09:00', lengthMinutes: 480, slotMinutes: null };
  const last = blocks[blocks.length - 1];
  const after = endsAt(last.startTime, last.lengthMinutes);
  // A day already running to the end of the evening has nowhere to put
  // another block; offer the same hour again and let them move it.
  const startTime = (after && addMinutes(after, 60)) || last.startTime;
  return { startTime, lengthMinutes: 60, slotMinutes: null };
}

// Serves both paths: the principal editing their own, and an assistant
// editing a principal's. Passing ownerId switches the endpoints; everything
// else — validation, layout, copy — is deliberately identical.
export default function AvailabilityTab({ ownerId = null, principalName = null, selfId = null }) {
  const base = ownerId ? `/pa/${ownerId}` : '';
  const readId = ownerId || selfId;
  const whose = principalName ? `${principalName}'s` : 'your';
  const [week, setWeek] = useState(null);
  // How far ahead the diary is open. It lives with the hours because it is
  // the same question — when can people book me — asked about the far edge
  // rather than the daily one.
  const [windowDays, setWindowDays] = useState(14);
  const [windowChoices, setWindowChoices] = useState([]);
  const [lengthChoices, setLengthChoices] = useState([]);
  const [capChoices, setCapChoices] = useState([]);
  const [gapChoices, setGapChoices] = useState([]);
  // The breather between meetings, and how long before the end to say so.
  const [gapMinutes, setGapMinutes] = useState(10);
  const [warnMinutes, setWarnMinutes] = useState(5);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setWeek(null);
    api.get(`${base}/availability`).then((data) => {
      const next = emptyWeek();
      for (const rule of data.rules) {
        const day = next.find((d) => d.dayOfWeek === rule.dayOfWeek);
        if (day) {
          day.blocks.push({
            startTime: rule.startTime,
            lengthMinutes: rule.lengthMinutes ?? minutesBetween(rule.startTime, rule.endTime),
            slotMinutes: rule.slotMinutes ?? null,
          });
        }
      }
      for (const day of next) day.blocks.sort((a, b) => a.startTime.localeCompare(b.startTime));
      setWeek(next);
      setWindowDays(data.windowDays);
      setWindowChoices(data.windowChoices || []);
      setLengthChoices(data.lengthChoices || []);
      setCapChoices(data.capChoices || []);
      setGapChoices(data.gapChoices || []);
      setGapMinutes(data.gapMinutes ?? 10);
      setWarnMinutes(data.warnMinutes ?? 5);
    }).catch((err) => setError(err.message));
  }, [ownerId]);

  function updateDay(dayOfWeek, blocks) {
    setWeek((prev) => prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, blocks } : d)));
    setSuccess('');
  }

  function toggleDay(day) {
    updateDay(day.dayOfWeek, day.blocks.length > 0 ? [] : [nextBlock([])]);
  }

  function updateBlock(day, index, patch) {
    updateDay(day.dayOfWeek, day.blocks.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  }

  function addBlock(day) {
    updateDay(day.dayOfWeek, [...day.blocks, nextBlock(day.blocks)]);
  }

  function removeBlock(day, index) {
    updateDay(day.dayOfWeek, day.blocks.filter((_, i) => i !== index));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');

    for (const day of week) {
      for (const b of day.blocks) {
        const ends = endsAt(b.startTime, b.lengthMinutes);
        if (!ends || ends <= b.startTime) {
          setError(`${dayName(day.dayOfWeek)}: a block starting at ${b.startTime} does not fit before midnight.`);
          return;
        }
        if (b.slotMinutes && b.slotMinutes > b.lengthMinutes) {
          setError(`${dayName(day.dayOfWeek)}: that block is shorter than the longest meeting it says it takes.`);
          return;
        }
      }
      const sorted = [...day.blocks].sort((a, b) => a.startTime.localeCompare(b.startTime));
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].startTime < (endsAt(sorted[i - 1].startTime, sorted[i - 1].lengthMinutes) || '23:59')) {
          setError(`${dayName(day.dayOfWeek)}: time blocks can't overlap.`);
          return;
        }
      }
    }

    const rules = week.flatMap((d) => d.blocks.map((b) => ({
      dayOfWeek: d.dayOfWeek,
      startTime: b.startTime,
      lengthMinutes: b.lengthMinutes,
      slotMinutes: b.slotMinutes || null,
    })));

    setSubmitting(true);
    try {
      await api.put(`${base}/availability`, { rules, windowDays, gapMinutes, warnMinutes });
      const span = windowChoices.find((c) => c.days === windowDays)?.label.toLowerCase()
        || `${windowDays} days`;
      setSuccess(rules.length === 0
        ? `Saved — ${whose} booking page is closed until there are times.`
        : `Availability updated. People can book ${span} ahead.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!week) return <p className="hint">Loading…</p>;

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <p className="tz-note" style={{ marginBottom: 14 }}>
        Set the hours people can book {principalName || 'you'}, in {whose} timezone. Add more than
        one block to a day to split it — mornings only, or 9–12 and 2–5 with lunch protected.
      </p>

      {/* Above the week, because it governs it: these hours repeat only as far
          as this reaches. Somebody who sets a week of hours and never finds
          this has silently opened three months of their diary, or one day of
          it, without deciding to. */}
      <div className="field" style={{ maxWidth: 320 }}>
        <label htmlFor="booking-window">How far ahead people can book</label>
        <select
          id="booking-window"
          value={windowDays}
          onChange={(e) => { setWindowDays(Number(e.target.value)); setSuccess(''); }}
        >
          {windowChoices.map((c) => (
            <option key={c.days} value={c.days}>{c.label}</option>
          ))}
          {/* A window set elsewhere, or by an older version, is shown rather
              than silently snapped to the nearest offered length. */}
          {!windowChoices.some((c) => c.days === windowDays) && (
            <option value={windowDays}>{windowDays} days</option>
          )}
        </select>
        <p className="hint">
          The booking page shows this much of {whose} diary and no more. Beyond it, there is
          nothing to choose — which is how you keep next quarter from being spoken for.
        </p>
      </div>

      <div className="field" style={{ maxWidth: 320 }}>
        <label htmlFor="gap-minutes">Breather after every meeting</label>
        <select
          id="gap-minutes"
          value={gapMinutes}
          onChange={(e) => { setGapMinutes(Number(e.target.value)); setSuccess(''); }}
        >
          {gapChoices.map((c) => (
            <option key={c.minutes} value={c.minutes}>{c.label}</option>
          ))}
        </select>
        <p className="hint">
          Held clear after everything booked, so nothing can be put back to back. It comes out of
          the bookable hours — a longer breather means fewer meetings in the same day, which is
          the point of it.
        </p>
      </div>

      <div className="field" style={{ maxWidth: 320 }}>
        <label htmlFor="warn-minutes">Say when time is nearly up</label>
        <select
          id="warn-minutes"
          value={warnMinutes}
          onChange={(e) => { setWarnMinutes(Number(e.target.value)); setSuccess(''); }}
        >
          <option value={0}>Only when it is up</option>
          <option value={2}>2 minutes before</option>
          <option value={5}>5 minutes before</option>
          <option value={10}>10 minutes before</option>
          <option value={15}>15 minutes before</option>
        </select>
        <p className="hint">
          {principalName || 'You'} and anyone assisting get a chime and a note on screen, wherever
          they are in Kairos. It reaches whoever has Kairos open — nothing is sent to a closed
          app yet.
        </p>
      </div>

      <div className="week-editor">
        {week.map((day) => {
          const enabled = day.blocks.length > 0;
          return (
            <div key={day.dayOfWeek} className={'week-row' + (enabled ? '' : ' is-off')}>
              <div className="week-row-day">
                <button
                  type="button"
                  className={'day-toggle' + (enabled ? ' is-on' : '')}
                  aria-pressed={enabled}
                  aria-label={`Toggle ${dayName(day.dayOfWeek)}`}
                  onClick={() => toggleDay(day)}
                />
                <span className="day-label">{dayName(day.dayOfWeek).slice(0, 3)}</span>
              </div>

              <div className="week-row-blocks">
                {!enabled && <span className="day-off-label">Unavailable</span>}

                {day.blocks.map((b, i) => (
                  <div className="time-block" key={i}>
                    <input
                      type="time"
                      value={b.startTime}
                      aria-label={`${dayName(day.dayOfWeek)} block ${i + 1} starts at`}
                      onChange={(e) => updateBlock(day, i, { startTime: e.target.value })}
                    />
                    <span className="to-label">for</span>
                    <select
                      value={b.lengthMinutes}
                      aria-label={`${dayName(day.dayOfWeek)} block ${i + 1} runs for`}
                      onChange={(e) => updateBlock(day, i, { lengthMinutes: Number(e.target.value) })}
                    >
                      {lengthChoices.map((c) => (
                        <option key={c.minutes} value={c.minutes}>{c.label}</option>
                      ))}
                      {!lengthChoices.some((c) => c.minutes === b.lengthMinutes) && (
                        <option value={b.lengthMinutes}>{b.lengthMinutes} minutes</option>
                      )}
                    </select>
                    <span className={'block-ends' + (endsAt(b.startTime, b.lengthMinutes) ? '' : ' is-error')}>
                      {endsAt(b.startTime, b.lengthMinutes)
                        ? `→ ${endsAt(b.startTime, b.lengthMinutes)}`
                        : 'runs past midnight'}
                    </span>
                    <button
                      type="button"
                      className="block-remove"
                      aria-label={`Remove ${dayName(day.dayOfWeek)} block ${i + 1}`}
                      onClick={() => removeBlock(day, i)}
                    >
                      ×
                    </button>
                    {/* The whole point of splitting a day: an hour in the
                        morning and only half of one after lunch. */}
                    <label className="block-cap">
                      <span>longest meeting</span>
                      <select
                        value={b.slotMinutes ?? ''}
                        aria-label={`${dayName(day.dayOfWeek)} block ${i + 1} longest meeting`}
                        onChange={(e) => updateBlock(day, i, {
                          slotMinutes: e.target.value === '' ? null : Number(e.target.value),
                        })}
                      >
                        <option value="">No limit</option>
                        {capChoices.filter((c) => c.minutes <= b.lengthMinutes).map((c) => (
                          <option key={c.minutes} value={c.minutes}>{c.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                ))}

                {enabled && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm block-add"
                    onClick={() => addBlock(day)}
                  >
                    + Add hours
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button className="btn btn-primary" type="submit" disabled={submitting}>
        {submitting ? 'Saving…' : 'Save availability'}
      </button>

      {/* Under the hours it is about, so a reading of when somebody works best
          is next to the control that acts on it. */}
      {readId && (
        <section style={{ marginTop: 32 }}>
          <h3 style={{ marginBottom: 4 }}>When {principalName || 'you'} work best</h3>
          <p className="tz-note" style={{ marginBottom: 14 }}>
            Read from the diary rather than guessed at. Every line says how many items it counted.
          </p>
          <RhythmRead ownerId={readId} principalName={principalName} />
        </section>
      )}

      {/* Beside the hours, because it answers the same question from the other
          side: those say when somebody CAN be booked, this says when they
          cannot regardless. Anywhere else and a person setting their hours
          would have to go looking for it. */}
      {readId && (
        <section style={{ marginTop: 32 }}>
          <NotAvailable ownerId={readId} principalName={principalName} />
        </section>
      )}
    </form>
  );
}
