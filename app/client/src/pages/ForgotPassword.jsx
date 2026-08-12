import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await api.post('/auth/forgot-password', { email });
      setEmailConfigured(res.emailDeliveryConfigured !== false);
      setSubmitted(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="centered-page">
      <div className="auth-card">
        <h1>Reset your password</h1>
        <p className="subtitle">We'll email you a link to set a new one.</p>

        {error && <div className="alert alert-error">{error}</div>}

        {submitted ? (
          <>
            <div className="alert alert-success">
              If an account exists for that email, we've sent a reset link. It's valid for an hour.
            </div>
            {!emailConfigured && (
              <div className="alert alert-error">
                <strong>This deployment can't send email yet.</strong> No mail provider is
                configured, so the reset link was written to the server log instead of being
                delivered. Set <code>RESEND_API_KEY</code> on the server to turn real delivery on.
              </div>
            )}
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            <button className="btn btn-primary btn-block" type="submit" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        <p className="auth-switch">
          <Link to="/login">Back to log in</Link>
        </p>
      </div>
    </div>
  );
}
