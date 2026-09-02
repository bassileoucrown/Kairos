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
  // The other half of the question. An assistant whose principal will never
  // open an app was previously offered only "Skip for now", which left them
  // with an empty account and nothing to do in it — the one person most likely
  // to want this product, told to come back when their boss arrives.
  const [keeping, setKeeping] = useState(false);
  const [keptName, setKeptName] = useState('');

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

  async function takeOn(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    setSubmitting(true);
    try {
      // Their zone, guessed from this browser, because an assistant usually
      // sits in the same country as the person they work for — and it is a
      // field they can correct rather than a decision they must make now.
      const d = await api.post('/pa/kept', {
        name: keptName,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      });
      setNotice(`${d.principal.name} is set up. ${d.holding.whenTheyJoin}`);
      setKeptName('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
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

  // The whole point of the branch: an assistant sets their principal up and
  // starts working the same minute, rather than waiting for somebody else to
  // join. What they build is held for that person, not owned — see the claim
  // line under the form, which is the server's own words rather than a promise
  // this screen invents.
  if (iAmAssistant && keeping) {
    return (
      <OnboardingLayout step="connect">
        <h1>Set them up yourself</h1>
        <p className="subtitle">
          You can run their diary, their trips and their movements from today. When they
          eventually join Kairos, connect to their handle and move across whatever should
          follow them — nothing crosses on its own. Their essentials stay shut until then,
          because there is no second factor of theirs to protect documents with yet.
        </p>

        {error && <div className="alert alert-error">{error}</div>}
        {notice && <div className="alert alert-success">{notice}</div>}

        <form onSubmit={takeOn}>
          <div className="field">
            <label htmlFor="kept-name">Their name</label>
            <input
              id="kept-name" type="text" value={keptName} placeholder="Adaeze Okonkwo"
              onChange={(e) => setKeptName(e.target.value)} required
            />
          </div>
          <p className="hint">
            Their name is all we need. We do not ask for their email: their contact details
            are theirs to give, not yours to hand over. Nothing is sent to them and they are
            not told this exists.
          </p>

          <div className="onboarding-actions">
            <button className="btn btn-secondary" type="button" onClick={() => setKeeping(false)}>
              They are on Kairos
            </button>
            <button className="btn btn-primary" type="submit" disabled={submitting}>
              {submitting ? 'Setting up…' : 'Set them up'}
            </button>
          </div>
        </form>

        {notice && (
          <div className="onboarding-actions" style={{ marginTop: '1rem' }}>
            <button className="btn btn-primary" type="button" onClick={advance}>
              Start working
            </button>
          </div>
        )}
      </OnboardingLayout>
    );
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

        {iAmAssistant && (
          <p className="hint" style={{ marginTop: '.75rem' }}>
            <button
              className="link-button" type="button" onClick={() => { setKeeping(true); setError(''); setNotice(''); }}
            >
              They are not on Kairos
            </button>
            {' — set them up yourself and start today.'}
          </p>
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
