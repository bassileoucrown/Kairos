import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext.jsx';
import { api } from '../../lib/api.js';
import TimezonePicker from '../../components/TimezonePicker.jsx';
import OnboardingLayout from './OnboardingLayout.jsx';
import { BRAND_SHORT } from '../../lib/brand.js';

/**
 * THE HANDLE IS CHOSEN HERE, FROM AN EMPTY FIELD.
 *
 * It used to arrive pre-filled with a handle made out of the person's name at
 * signup. That was wrong twice over. A handle is held FOR GOOD in this app —
 * see lib/handles.js — so the app was spending @adaeze-okonkwo permanently on
 * somebody who had not asked for it, and burning it for everyone if she then
 * chose @ada. And a filled box is a decision already made: people accept what
 * is in front of them, and the one field on this screen that ought to be a
 * choice was the one arriving pre-answered.
 *
 * So: nothing in the box, nothing offered, and no going on without one.
 *
 * WHY IT IS CHECKED WHILE THEY TYPE. The alternative is letting somebody
 * decide on a name, type it, press Continue and only then be told it was never
 * available. The check is advisory — the server is the authority and answers
 * again on submit — so the button is never held hostage to a request in
 * flight; it is disabled only when the field is genuinely empty.
 */
export default function ProfileStep() {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(user.name);
  // Their own choice if they have made one — coming back to this screen should
  // show what they picked. Empty if they have not.
  const [slug, setSlug] = useState(user.handleChosen ? user.slug : '');
  const [timezone, setTimezone] = useState(user.timezone);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // null while unknown or in flight; { available, problem } once answered.
  const [check, setCheck] = useState(null);

  const typed = slug.trim();

  useEffect(() => {
    setCheck(null);
    if (typed.length < 3) return undefined;
    let live = true;
    // Long enough that typing a handle is one request rather than fifteen, and
    // short enough that the answer is there before somebody reaches for the
    // button.
    const t = setTimeout(() => {
      api.get(`/profile/handle-available?handle=${encodeURIComponent(typed)}`)
        .then((d) => { if (live) setCheck(d); })
        .catch(() => { /* advisory: the submit below asks the real question */ });
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [typed]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!typed) { setError('Choose a handle.'); return; }
    setSubmitting(true);
    try {
      const { user: updated } = await api.patch('/profile', { name, slug: typed, timezone });
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
            placeholder="Choose one"
            autoComplete="off"
            spellCheck="false"
            required
          />
          {/* The verdict, in the same words the server uses, and only once
              there is enough typed to have a verdict about. */}
          {typed.length >= 3 && check && (
            <p className={check.available ? 'hint handle-free' : 'hint handle-taken'}>
              {check.available
                ? `@${check.handle} is free.`
                : check.problem}
            </p>
          )}
          <p className="hint">
            {typed
              ? <>You will be <strong>@{typed}</strong> here — how colleagues refer to you
                inside {BRAND_SHORT}. Your booking page lives at /book/{typed}.</>
              : <>Pick what colleagues will call you inside {BRAND_SHORT}. Letters, numbers and
                hyphens. It is yours for good, so it is worth a moment.</>}
          </p>
        </div>
        <div className="field">
          <label htmlFor="timezone">Timezone</label>
          <TimezonePicker id="timezone" value={timezone} onChange={setTimezone} />
        </div>

        <div className="onboarding-actions">
          <span />
          {/* Disabled on an empty field only. Never on the check: a slow or
              failed request must not be able to trap somebody on this screen,
              and the server answers the same question again on submit. */}
          <button className="btn btn-primary" type="submit" disabled={submitting || !typed}>
            {submitting ? 'Saving…' : 'Continue'}
          </button>
        </div>
      </form>
    </OnboardingLayout>
  );
}
