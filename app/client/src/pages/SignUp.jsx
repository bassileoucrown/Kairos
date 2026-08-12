import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { detectTimezone } from '../lib/timezones.js';
import { stashPostOnboardingRedirect } from '../lib/postAuthRedirect.js';

const CATEGORIES = [
  { value: 'principal', label: 'Principal', hint: "It's my own calendar — clients or contacts book me directly." },
  { value: 'pa', label: 'Personal Assistant', hint: "I manage someone else's calendar — approvals, briefs, contacts." },
  { value: 'ea', label: 'Executive Assistant', hint: 'Same access as a PA. The title is yours, not a permission level.' },
  { value: 'chief_of_staff', label: 'Chief of Staff', hint: 'Same access again, broader remit across the principal’s operation.' },
];

export default function SignUp() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = searchParams.get('next');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accountCategory, setAccountCategory] = useState('principal');
  // Asked for only when this deployment is closed. Someone arriving from an
  // email invite is already vouched for and never sees this field.
  const [accessCode, setAccessCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);

  useEffect(() => {
    fetch('/api/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setNeedsCode(!!d?.signupRequiresCode))
      .catch(() => {});
  }, []);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await signup({ name, email, password, timezone: detectTimezone(), accountCategory, accessCode });
      stashPostOnboardingRedirect(next);
      navigate('/onboarding/profile');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="centered-page">
      <div className="auth-card">
        <h1>Create your Kairos account</h1>
        <p className="subtitle">Set up your scheduling page in a few minutes.</p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>You are a…</label>
            <div className="role-picker">
              {CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className={'role-option' + (accountCategory === c.value ? ' is-selected' : '')}
                  onClick={() => setAccountCategory(c.value)}
                  aria-pressed={accountCategory === c.value}
                >
                  <span className="role-option-label">{c.label}</span>
                  <span className="role-option-hint">{c.hint}</span>
                </button>
              ))}
            </div>
            <p className="hint">
              Either way you get your own calendar — this just decides where you land and what's
              streamlined. PAs and EAs can always set up a bookable calendar of their own later too.
            </p>
          </div>

          <div className="field">
            <label htmlFor="name">Full name</label>
            <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
            <p className="hint">At least 8 characters.</p>
          </div>
          {needsCode && (
            <div className="field">
              <label htmlFor="access-code">Access code</label>
              <input
                id="access-code" type="text" value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                required autoComplete="off"
              />
              <p className="hint">
                This Kairos is invite-only. If you were invited by email, open that link
                instead — you won't need a code.
              </p>
            </div>
          )}
          <button className="btn btn-primary btn-block" type="submit" disabled={submitting}>
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="auth-switch">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  );
}
