import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext.jsx';
import { api } from '../../lib/api.js';
import OnboardingLayout from './OnboardingLayout.jsx';

const ASSISTANT_CATEGORIES = new Set(['pa', 'ea', 'chief_of_staff', 'delegate']);

/**
 * Naming the person you work with, at the point it is on your mind.
 *
 * The screen asks the same question of everybody — "who do you work with" —
 * and the server decides what that means from who is asking: a principal
 * naming an assistant is appointing them, an assistant naming a principal is
 * asking to be taken on. Only the wording changes here, because those are two
 * genuinely different acts and reading "invite" when you are the one asking
 * for permission would be misleading.
 *
 * Skippable, deliberately. Plenty of principals arrive before their assistant
 * does, and an onboarding step that cannot be got past is a reason to abandon
 * the signup rather than a reason to fill it in.
 */
export default function ConnectStep() {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  const [handle, setHandle] = useState('');
  const [role, setRole] = useState('pa');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const iAmAssistant = ASSISTANT_CATEGORIES.has(user?.accountCategory);

  // An assistant is finished here. They have no bookable calendar of their own
  // to set up, and marching them through "create your first meeting type" is
  // asking them to invent something they will never use.
  async function advance() {
    const next = iAmAssistant ? 'done' : 'meeting_type';
    const { user: stepped } = await api.post('/profile/onboarding-step', { step: next });
    updateUser({ onboardingStep: stepped.onboardingStep });
    navigate(iAmAssistant ? '/pa' : '/onboarding/meeting-type');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    setSubmitting(true);
    try {
      const d = await api.post('/members/connect', {
        handle,
        role: iAmAssistant ? undefined : role,
      });
      setNotice(d.message || 'Sent.');
      setHandle('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <OnboardingLayout step="connect">
      <h1>{iAmAssistant ? 'Who do you work for?' : 'Who works with you?'}</h1>
      <p className="subtitle">
        {iAmAssistant
          ? 'Enter their handle and they will be asked to approve your access. Nothing is '
            + 'granted until they do.'
          : 'Enter their handle and they will be invited to manage your schedule with you.'}
      </p>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="connect-handle">Their handle</label>
          <input
            id="connect-handle"
            type="text"
            value={handle}
            placeholder="@ada"
            onChange={(e) => setHandle(e.target.value)}
            required
          />
          {/* Said plainly rather than discovered when nothing happens. The
              answer is the same whether or not the handle exists, because
              handles are not a directory to search. */}
          <p className="hint">
            We will not say whether that handle exists — if it does, they will see it.
          </p>
        </div>

        {!iAmAssistant && (
          <div className="field">
            <label htmlFor="connect-role">Their title</label>
            <select id="connect-role" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="pa">PA</option>
              <option value="ea">EA</option>
              <option value="chief_of_staff">Chief of Staff</option>
              <option value="delegate">Delegate — scheduling only</option>
            </select>
          </div>
        )}

        <div className="onboarding-actions">
          <button className="btn btn-secondary" type="button" onClick={advance}>
            {notice ? 'Continue' : 'Skip for now'}
          </button>
          <button className="btn btn-primary" type="submit" disabled={submitting || !handle.trim()}>
            {submitting ? 'Sending…' : (iAmAssistant ? 'Ask for access' : 'Send invitation')}
          </button>
        </div>
      </form>
    </OnboardingLayout>
  );
}
