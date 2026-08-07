import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { listTimezones } from '../../lib/timezones.js';
import OnboardingLayout from './OnboardingLayout.jsx';

const timezones = listTimezones();

export default function ProfileStep() {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(user.name);
  const [slug, setSlug] = useState(user.slug);
  const [timezone, setTimezone] = useState(user.timezone);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { user: updated } = await api.patch('/profile', { name, slug, timezone });
      // PA/EA/Chief of Staff accounts don't need their own availability or
      // meeting types to be useful — they land in PA Home and only touch
      // those principal-only steps if they later choose to open their own
      // bookable calendar (Dashboard's Settings still exposes them).
      const isAssistant = user.accountCategory && user.accountCategory !== 'principal';
      const nextStep = isAssistant ? 'done' : 'meeting_type';
      const { user: stepped } = await api.post('/profile/onboarding-step', { step: nextStep });
      updateUser({ ...updated, onboardingStep: stepped.onboardingStep });
      navigate(isAssistant ? '/pa' : '/onboarding/meeting-type');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <OnboardingLayout step="profile">
      <h1>Your profile</h1>
      <p className="subtitle">This is how people will find and book you.</p>

      {error && <div className="alert alert-error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="name">Display name</label>
          <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="slug">Booking link</label>
          <input
            id="slug"
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            required
          />
          <p className="hint">/book/{slug || 'your-name'}</p>
        </div>
        <div className="field">
          <label htmlFor="timezone">Timezone</label>
          <select id="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {timezones.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
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
