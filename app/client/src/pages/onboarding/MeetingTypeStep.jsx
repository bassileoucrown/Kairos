import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext.jsx';
import { api } from '../../lib/api.js';
import OnboardingLayout from './OnboardingLayout.jsx';

export default function MeetingTypeStep() {
  const { updateUser } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('30 Minute Meeting');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [locationType, setLocationType] = useState('video');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.post('/meeting-types', {
        name,
        durationMinutes: Number(durationMinutes),
        locationType,
        description,
      });
      const { user: stepped } = await api.post('/profile/onboarding-step', { step: 'done' });
      updateUser({ onboardingStep: stepped.onboardingStep });
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <OnboardingLayout step="meeting_type">
      <h1>Create your first meeting type</h1>
      <p className="subtitle">This is what people will book. You can add more later.</p>

      {error && <div className="alert alert-error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="mt-name">Name</label>
          <input id="mt-name" type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="mt-duration">Duration (minutes)</label>
          <input
            id="mt-duration"
            type="number"
            min={5}
            max={480}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="mt-location">Format</label>
          <select id="mt-location" value={locationType} onChange={(e) => setLocationType(e.target.value)}>
            <option value="video">Video call</option>
            <option value="phone">Phone call</option>
            <option value="in_person">In person</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="mt-description">Description (optional)</label>
          <textarea id="mt-description" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="onboarding-actions">
          <span />
          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? 'Finishing…' : 'Finish setup'}
          </button>
        </div>
      </form>
    </OnboardingLayout>
  );
}
