import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { dayName } from '../../lib/timezones.js';

// A day holds a list of blocks rather than a single start/end, so a schedule
// can be "9–12 and 2–5" (or mornings only, or an evening window) instead of
// one unbroken stretch. A day is "on" exactly when it has at least one block.
function emptyWeek() {
  return [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, blocks: [] }));
}

function addMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = Math.min(h * 60 + m + mins, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// A new block starts an hour after the previous one ends, so adding a second
// window to a 9–5 day proposes 6–7pm rather than something already covered.
function nextBlock(blocks) {
  if (blocks.length === 0) return { startTime: '09:00', endTime: '17:00' };
  const last = blocks[blocks.length - 1];
  const startTime = addMinutes(last.endTime, 60);
  return { startTime, endTime: addMinutes(startTime, 60) };
}

// Serves both paths: the principal editing their own, and an assistant
// editing a principal's. Passing ownerId switches the endpoints; everything
// else — validation, layout, copy — is deliberately identical.
export default function AvailabilityTab({ ownerId = null, principalName = null }) {
  const base = ownerId ? `/pa/${ownerId}` : '';
  const whose = principalName ? `${principalName}'s` : 'your';
  const [week, setWeek] = useState(null);
  // How far ahead the diary is open. It lives with the hours because it is
  // the same question — when can people book me — asked about the far edge
  // rather than the daily one.
  const [windowDays, setWindowDays] = useState(14);
  const [windowChoices, setWindowChoices] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setWeek(null);
    api.get(`${base}/availability`).then((data) => {
      const next = emptyWeek();
      for (const rule of data.rules) {
        const day = next.find((d) => d.dayOfWeek === rule.dayOfWeek);
        if (day) day.blocks.push({ startTime: rule.startTime, endTime: rule.endTime });
      }
      for (const day of next) day.blocks.sort((a, b) => a.startTime.localeCompare(b.startTime));
      setWeek(next);
      setWindowDays(data.windowDays);
      setWindowChoices(data.windowChoices || []);
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
        if (b.startTime >= b.endTime) {
          setError(`${dayName(day.dayOfWeek)}: each block needs a start time before its end time.`);
          return;
        }
      }
      const sorted = [...day.blocks].sort((a, b) => a.startTime.localeCompare(b.startTime));
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].startTime < sorted[i - 1].endTime) {
          setError(`${dayName(day.dayOfWeek)}: time blocks can't overlap.`);
          return;
        }
      }
    }

    const rules = week.flatMap((d) => d.blocks.map((b) => ({
      dayOfWeek: d.dayOfWeek, startTime: b.startTime, endTime: b.endTime,
    })));

    setSubmitting(true);
    try {
      await api.put(`${base}/availability`, { rules, windowDays });
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
                      aria-label={`${dayName(day.dayOfWeek)} block ${i + 1} start time`}
                      onChange={(e) => updateBlock(day, i, { startTime: e.target.value })}
                    />
                    <span className="to-label">to</span>
                    <input
                      type="time"
                      value={b.endTime}
                      aria-label={`${dayName(day.dayOfWeek)} block ${i + 1} end time`}
                      onChange={(e) => updateBlock(day, i, { endTime: e.target.value })}
                    />
                    <button
                      type="button"
                      className="block-remove"
                      aria-label={`Remove ${dayName(day.dayOfWeek)} block ${i + 1}`}
                      onClick={() => removeBlock(day, i)}
                    >
                      ×
                    </button>
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
    </form>
  );
}
