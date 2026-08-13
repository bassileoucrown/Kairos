import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { BRAND_FULL } from '../lib/brand.js';

export default function AcceptInvite() {
  const { token } = useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    api.get(`/invites/${token}`)
      .then((data) => setInvite(data.invite))
      .catch((err) => setError(err.message));
  }, [token]);

  async function handleAccept() {
    setAccepting(true);
    setError('');
    try {
      await api.post(`/invites/${token}/accept`);
      setAccepted(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setAccepting(false);
    }
  }

  if (error && !invite) {
    return (
      <div className="centered-page">
        <div className="auth-card"><div className="alert alert-error">{error}</div></div>
      </div>
    );
  }
  if (!invite || authLoading) return <div className="spinner-page">Loading…</div>;

  if (accepted) {
    return (
      <div className="centered-page">
        <div className="auth-card">
          <h1>You're in</h1>
          <p className="subtitle">
            You're now {invite.ownerName}'s {invite.roleLabel}, with access to their account.
          </p>
          <button className="btn btn-primary btn-block" type="button" onClick={() => navigate('/workspace')}>
            Go to your workspace
          </button>
        </div>
      </div>
    );
  }

  const next = `/accept-invite/${token}`;

  return (
    <div className="centered-page">
      <div className="auth-card">
        <h1>{invite.ownerName} invited you</h1>
        <p className="subtitle">As their {invite.roleLabel} on {BRAND_FULL}, sent to {invite.invitedEmail}.</p>

        {/* Said before they agree, not buried in terms afterwards. Someone
            joining a stranger's household account deserves to know the shape
            of what they are joining while they can still decline. */}
        {invite.scope && <p className="hint invite-scope">{invite.scope}</p>}

        {error && <div className="alert alert-error">{error}</div>}

        {!user ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Link className="btn btn-primary btn-block" to={`/signup?next=${encodeURIComponent(next)}`}>
              Create an account to accept
            </Link>
            <Link className="btn btn-secondary btn-block" to={`/login?next=${encodeURIComponent(next)}`}>
              I already have an account
            </Link>
          </div>
        ) : user.email !== invite.invitedEmail ? (
          <div className="alert alert-error">
            You're logged in as {user.email}, but this invite was sent to {invite.invitedEmail}. Log out and sign in with that email to accept.
          </div>
        ) : (
          <button className="btn btn-primary btn-block" type="button" onClick={handleAccept} disabled={accepting}>
            {accepting ? 'Accepting…' : `Accept and become their ${invite.roleLabel}`}
          </button>
        )}
      </div>
    </div>
  );
}
