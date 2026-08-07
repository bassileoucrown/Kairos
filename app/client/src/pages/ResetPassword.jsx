import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';

export default function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [valid, setValid] = useState(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.get(`/auth/reset-password/${token}`).then((data) => setValid(data.valid)).catch(() => setValid(false));
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/auth/reset-password/${token}`, { password });
      setDone(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="centered-page">
      <div className="auth-card">
        <h1>Set a new password</h1>

        {valid === null && <p className="hint">Checking link…</p>}

        {valid === false && (
          <>
            <div className="alert alert-error">This reset link is invalid or has expired.</div>
            <p className="auth-switch"><Link to="/forgot-password">Request a new one</Link></p>
          </>
        )}

        {valid === true && done && (
          <div className="alert alert-success">Password updated. Redirecting to log in…</div>
        )}

        {valid === true && !done && (
          <form onSubmit={handleSubmit}>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="field">
              <label htmlFor="password">New password</label>
              <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
              <p className="hint">At least 8 characters.</p>
            </div>
            <div className="field">
              <label htmlFor="confirm-password">Confirm new password</label>
              <input id="confirm-password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required autoComplete="new-password" />
            </div>
            <button className="btn btn-primary btn-block" type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : 'Set new password'}
            </button>
            <p className="hint" style={{ marginTop: 10 }}>This will sign you out everywhere else.</p>
          </form>
        )}
      </div>
    </div>
  );
}
