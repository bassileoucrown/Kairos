import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { BRAND_FULL } from '../lib/brand.js';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = searchParams.get('next');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [storageWarning, setStorageWarning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Two-factor. The server answers needsCode once the password is right, and
  // until this existed there was no box to type the code into — an account
  // with two-factor on could not sign in at all.
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState('');
  const [usingRecovery, setUsingRecovery] = useState(false);

  // Only asked after a failure, and only to explain one specific case: a
  // deployment storing accounts on a disk that gets wiped on restart. Saying
  // "incorrect email or password" is right for a wrong password and wrong for
  // an account the server threw away.
  async function checkStorage() {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) return;
      const data = await res.json();
      setStorageWarning(!data.storageDurable);
    } catch {
      // The status endpoint is a courtesy; failing to reach it changes nothing.
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login({ email, password, code: needsCode ? code.trim() : undefined });
      navigate(next || '/');
    } catch (err) {
      if (err.data?.needsCode) {
        // The password was right. Ask for the second factor rather than
        // reporting a failure the person cannot act on.
        setNeedsCode(true);
        setCode('');
        // On the first ask there is nothing to apologise for; the prompt
        // itself is the message.
        setError(needsCode ? err.message : '');
      } else {
        setError(err.message);
        checkStorage();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="centered-page">
      <div className="auth-card">
        <h1>Log in to {BRAND_FULL}</h1>
        <p className="subtitle">Welcome back.</p>

        {error && <div className="alert alert-error">{error}</div>}
        {error && storageWarning && (
          <div className="alert alert-warning">
            This deployment is storing accounts on temporary disk, so they are erased
            whenever the server restarts or is redeployed. If your account worked before
            and doesn't now, it was almost certainly wiped rather than mistyped — sign up
            again. Connecting a database makes accounts permanent.
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </div>
          <div className="field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <label htmlFor="password">Password</label>
              <Link to="/forgot-password" style={{ fontSize: '0.82rem' }}>Forgot password?</Link>
            </div>
            <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </div>
          {needsCode && (
            <div className="field totp-login">
              <label htmlFor="login-code">
                {usingRecovery ? 'Recovery code' : 'Code from your authenticator app'}
              </label>
              <input
                id="login-code"
                type="text"
                inputMode={usingRecovery ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                autoFocus
                placeholder={usingRecovery ? 'abcde-12345' : '000000'}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
              <p className="hint">
                {usingRecovery
                  ? 'One of the codes you saved when you turned two-factor on. Each works once.'
                  : 'The six digits showing right now in Google Authenticator, 1Password, or whichever app you set up. They change every 30 seconds.'}
              </p>
              <button
                className="link-button"
                type="button"
                onClick={() => { setUsingRecovery((v) => !v); setCode(''); setError(''); }}
              >
                {usingRecovery ? 'Use a code from the app instead' : "Lost the phone? Use a recovery code"}
              </button>
            </div>
          )}

          <button className="btn btn-primary btn-block" type="submit" disabled={submitting}>
            {submitting ? 'Logging in…' : needsCode ? 'Verify and log in' : 'Log in'}
          </button>
        </form>

        <p className="auth-switch">
          Don't have an account? <Link to={next ? `/signup?next=${encodeURIComponent(next)}` : '/signup'}>Sign up</Link>
        </p>
      </div>
    </div>
  );
}
