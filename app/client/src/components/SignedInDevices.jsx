import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import SoonButton from './SoonButton.jsx';
import PasswordField from './PasswordField.jsx';

// Everywhere this account is signed in, and the way to end any of it.
//
// The control this screen exists for is used in one situation: a phone is
// gone. So it is built for somebody who is not calm — the current device is
// labelled so nobody evicts themselves by accident, the guard is a question
// they can answer from memory rather than a code from a device they no longer
// have, and ending a session takes effect on that device's very next request
// because sessions are rows rather than tokens.

function ago(iso) {
  if (!iso) return 'unknown';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  return new Date(iso).toLocaleDateString();
}

export default function SignedInDevices() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  // What the guard is asking for is decided by the server, not guessed here:
  // an account with a question answers one, an account without answers with a
  // password, and the screen renders whichever it is told.
  const [secret, setSecret] = useState('');
  const [pending, setPending] = useState(null);

  function load() {
    return api.get('/security/sessions')
      .then((d) => { setData(d); setError(''); })
      .catch((e) => setError(e.message));
  }
  useEffect(() => { load(); }, []);

  async function run() {
    if (!pending) return;
    setBusy(pending.key);
    setError('');
    setNotice('');
    const body = data.guard.needs === 'answer' ? { answer: secret } : { password: secret };
    try {
      const d = pending.handle
        ? await api.post(`/security/sessions/${pending.handle}/revoke`, body)
        : await api.post('/security/sessions/revoke-others', body);
      setData((prev) => ({ ...prev, sessions: d.sessions }));
      setNotice(pending.handle
        ? 'That device has been signed out.'
        : `${d.ended} other ${d.ended === 1 ? 'session' : 'sessions'} ended.`);
      setSecret('');
      setPending(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  if (error && !data) return <div className="alert alert-error">{error}</div>;
  if (!data) return <p className="hint">Loading…</p>;

  const others = data.sessions.filter((s) => !s.isCurrent);
  const asks = data.guard.needs === 'answer';

  return (
    <section className="ess-group">
      <h3 className="ess-heading">Where you are signed in</h3>
      <p className="hint">
        Signing in on another device does not disturb this one. If a device is lost, end its
        session here — it stops working on that device immediately, not when it expires.
      </p>

      {notice && <div className="alert alert-success">{notice}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {data.sessions.map((s) => (
        <div className={`card ess-row${s.isCurrent ? ' is-current-device' : ''}`} key={s.id}>
          <div className="ess-main">
            <div className="ess-label">
              {s.device}
              {s.isCurrent && <span className="pill" style={{ marginLeft: 8 }}>This device</span>}
            </div>
            <div className="ess-meta">
              <span className="hint">
                Last used {ago(s.lastSeenAt)}
                {s.address ? ` · ${s.address}` : ''}
                {' · signed in '}{new Date(s.signedInAt).toLocaleDateString()}
              </span>
            </div>
          </div>
          {!s.isCurrent && (
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              disabled={!!busy}
              onClick={() => { setPending({ key: s.id, handle: s.id }); setSecret(''); setNotice(''); }}
            >
              Sign out
            </button>
          )}
        </div>
      ))}

      {/* The location we cannot honestly give, named where it would appear. */}
      <div style={{ marginTop: 8 }}>
        <SoonButton feature="session_location" />
      </div>

      {others.length > 0 && (
        <div className="code-actions" style={{ marginTop: 14 }}>
          <button
            className="btn btn-secondary"
            type="button"
            disabled={!!busy}
            onClick={() => { setPending({ key: 'others', handle: null }); setSecret(''); setNotice(''); }}
          >
            Sign out all {others.length} other {others.length === 1 ? 'device' : 'devices'}
          </button>
        </div>
      )}

      {pending && (
        <div className="card key-setup revoke-panel" style={{ marginTop: 14 }}>
          <div className="ess-label">
            {pending.handle ? 'Sign this device out' : 'Sign out every other device'}
          </div>
          <p className="hint">
            {asks
              ? data.guard.question
              : 'You have not set a security question, so this asks for your password. '
                + 'Set one below and it will ask that instead — useful when the missing '
                + 'device is the one your authenticator lives on.'}
          </p>
          {/* The answer to a security question is already in the clear — it is
              not a credential anywhere else, and hiding it would only make it
              harder to type. Only the password fallback gets a Show. */}
          {asks ? (
            <label className="field">
              <span>Your answer</span>
              <input
                id="revoke-secret"
                type="text"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                autoComplete="off"
              />
            </label>
          ) : (
            <PasswordField
              id="revoke-secret"
              label="Your password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="current-password"
            />
          )}
          <div className="code-actions">
            <button className="btn" type="button" onClick={run} disabled={!secret || !!busy}>
              {busy ? 'Ending…' : 'Sign out'}
            </button>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => { setPending(null); setSecret(''); setError(''); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
