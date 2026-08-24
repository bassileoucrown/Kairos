import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext.jsx';
import { api } from '../../lib/api.js';
import TimezonePicker from '../../components/TimezonePicker.jsx';
import OnboardingLayout from './OnboardingLayout.jsx';
import { BRAND_SHORT } from '../../lib/brand.js';

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
      // Everyone goes on to name who they work with — it is the one question
      // that matters as much to an assistant as to a principal, and asking it
      // here is the moment it is on their mind. That step decides where each
      // of them goes next: a principal on to meeting types, an assistant
      // straight into PA Home, since a PA needs neither their own availability
      // nor their own meeting types to be useful. (Dashboard's Settings still
      // exposes both if they later want a bookable calendar of their own.)
      const { user: stepped } = await api.post('/profile/onboarding-step', { step: 'connect' });
      updateUser({ ...updated, onboardingStep: stepped.onboardingStep });
      navigate('/onboarding/connect');
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
          <label htmlFor="slug">Handle</label>
          <input
            id="slug"
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            required
          />
          <p className="hint">
            You are <strong>@{slug || 'your-name'}</strong> here — how colleagues refer to you
            inside {BRAND_SHORT}. Your booking page also lives at /book/{slug || 'your-name'}.
          </p>
        </div>
        <div className="field">
          <label htmlFor="timezone">Timezone</label>
          <TimezonePicker id="timezone" value={timezone} onChange={setTimezone} />
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
