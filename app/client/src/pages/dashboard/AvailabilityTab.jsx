import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { dayName } from '../../lib/timezones.js';

function emptyWeek() {
  return [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    dayOfWeek: d, enabled: false, startTime: '09:00', endTime: '17:00',
  }));
}

export default function AvailabilityTab() {
  const [week, setWeek] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get('/availability').then((data) => {
      const base = emptyWeek();
      for (const rule of data.rules) {
        const day = base.find((d) => d.dayOfWeek === rule.dayOfWeek);
        if (day) {
          day.enabled = true;
          day.startTime = rule.startTime;
          day.endTime = rule.endTime;
        }
      }
      setWeek(base);
    }).catch((err) => setError(err.message));
  }, []);

  function updateDay(dayOfWeek, patch) {
    setWeek((prev) => prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d)));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');

    const enabledDays = week.filter((d) => d.enabled);
    for (const d of enabledDays) {
      if (d.startTime >= d.endTime) {
        setError(`${dayName(d.dayOfWeek)}: start time must be before end time.`);
        return;
      }
    }

    setSubmitting(true);
    try {
      await api.put('/availability', {
        rules: enabledDays.map((d) => ({ dayOfWeek: d.dayOfWeek, startTime: d.startTime, endTime: d.endTime })),
      });
      setSuccess('Availability updated.');
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

      <div className="week-editor">
        {week.map((d) => (
          <div key={d.dayOfWeek} className={'week-row' + (d.enabled ? '' : ' is-off')}>
            <button
              type="button"
              className={'day-toggle' + (d.enabled ? ' is-on' : '')}
              aria-pressed={d.enabled}
              aria-label={`Toggle ${dayName(d.dayOfWeek)}`}
              onClick={() => updateDay(d.dayOfWeek, { enabled: !d.enabled })}
            />
            <span className="day-label">{dayName(d.dayOfWeek).slice(0, 3)}</span>
            <input
              type="time"
              value={d.startTime}
              disabled={!d.enabled}
              onChange={(e) => updateDay(d.dayOfWeek, { startTime: e.target.value })}
            />
            <span className="to-label">to</span>
            <input
              type="time"
              value={d.endTime}
              disabled={!d.enabled}
              onChange={(e) => updateDay(d.dayOfWeek, { endTime: e.target.value })}
            />
          </div>
        ))}
      </div>

      <button className="btn btn-primary" type="submit" disabled={submitting}>
        {submitting ? 'Saving…' : 'Save availability'}
      </button>
    </form>
  );
}
