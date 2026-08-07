import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { dayName } from '../../lib/timezones.js';
import OnboardingLayout from './OnboardingLayout.jsx';

const DEFAULT_START = '09:00';
const DEFAULT_END = '17:00';

function initialWeek() {
  // Off by default on Sunday(0)/Saturday(6), on Mon–Fri.
  return [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    dayOfWeek: d,
    enabled: d >= 1 && d <= 5,
    startTime: DEFAULT_START,
    endTime: DEFAULT_END,
  }));
}

export default function AvailabilityStep() {
  const { updateUser } = useAuth();
  const navigate = useNavigate();
  const [week, setWeek] = useState(initialWeek);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function updateDay(dayOfWeek, patch) {
    setWeek((prev) => prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d)));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const enabledDays = week.filter((d) => d.enabled);
    if (enabledDays.length === 0) {
      setError('Turn on at least one day so people can book you.');
      return;
    }
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
      const { user: stepped } = await api.post('/profile/onboarding-step', { step: 'meeting_type' });
      updateUser({ onboardingStep: stepped.onboardingStep });
      navigate('/onboarding/meeting-type');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <OnboardingLayout step="availability">
      <h1>Your weekly availability</h1>
      <p className="subtitle">When can people book time with you? You can change this any time.</p>

      {error && <div className="alert alert-error">{error}</div>}

      <form onSubmit={handleSubmit}>
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

        <div className="onboarding-actions">
          <span />
          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Continue'}
          </button>
        </div>
      </form>
    </OnboardingLayout>
  );
}
