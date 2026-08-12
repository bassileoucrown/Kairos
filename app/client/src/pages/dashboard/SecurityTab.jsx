import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

// Two-factor authentication, and who has looked at what.
//
// These belong on one screen because they answer the same question: is my
// account, and what it holds, actually protected. The access log is here
// rather than buried because seeing it is what makes a principal willing to
// put a passport in at all.

export default function SecurityTab() {
  const [state, setState] = useState(null);
  const [log, setLog] = useState([]);
  const [setup, setSetup] = useState(null);
  const [codes, setCodes] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  function load() {
    return Promise.all([
      api.get('/security').then(setState),
      api.get('/security/access-log').then((d) => setLog(d.entries)),
    ]).catch((err) => setError(err.message));
  }
  useEffect(() => { load(); }, []);

  async function begin() {
    setError('');
    try { setSetup(await api.post('/security/2fa/setup')); }
    catch (err) { setError(err.message); }
  }

  async function confirm(e) {
    e.preventDefault();
    setError('');
    try {
      const d = await api.post('/security/2fa/confirm', { code });
      setCodes(d.recoveryCodes);
      setSetup(null);
      setCode('');
      load();
    } catch (err) { setError(err.message); }
  }

  async function disable() {
    const password = window.prompt('Enter your password');
    if (!password) return;
    const c = window.prompt('And a current code from your authenticator');
    if (!c) return;
    setError('');
    try { await api.post('/security/2fa/disable', { password, code: c }); load(); }
    catch (err) { setError(err.message); }
  }

  if (!state) return <p className="hint">Loading…</p>;

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}

      <section className="ess-group">
        <h3 className="ess-heading">Two-factor authentication</h3>

        {!state.encryptionConfigured && (
          <div className="alert alert-warning">
            This deployment has no encryption key set, so two-factor cannot be enabled yet.
          </div>
        )}

        {state.twoFactor.enabled ? (
          <div className="card">
            <p>
              <span className="pill">On</span>{' '}
              Signing in needs a code from your authenticator app.
            </p>
            <p className="hint">
              {state.twoFactor.recoveryCodesRemaining} recovery code
              {state.twoFactor.recoveryCodesRemaining === 1 ? '' : 's'} left.
            </p>
            <button className="btn btn-danger btn-sm" type="button" onClick={disable}>
              Turn off
            </button>
          </div>
        ) : (
          <div className="card">
            <p>
              Your password is the only thing protecting this account. If it holds passport or
              policy details, that is not enough on its own.
            </p>
            {!setup && (
              <button
                className="btn btn-primary btn-sm" type="button"
                onClick={begin} disabled={!state.encryptionConfigured}
              >
                Set up two-factor
              </button>
            )}
          </div>
        )}

        {setup && (
          <form className="card" onSubmit={confirm}>
            <p>Add this to your authenticator app, then enter the code it shows.</p>
            <p className="hint">
              Most apps scan a QR code; you can also type the key in by hand.
            </p>
            <div className="ess-secret"><code>{setup.secret}</code></div>
            <div className="field">
              <label htmlFor="totp-code">Code from the app</label>
              <input
                id="totp-code" type="text" inputMode="numeric" autoComplete="one-time-code"
                value={code} onChange={(e) => setCode(e.target.value)} required
              />
            </div>
            <button className="btn btn-primary" type="submit">Confirm</button>
          </form>
        )}

        {codes && (
          <div className="card">
            <h4>Recovery codes</h4>
            <p className="hint">
              Save these somewhere safe now — each works once, and they are not shown again.
              They are how you get back in if you lose the phone.
            </p>
            <ul className="ess-codes">{codes.map((c) => <li key={c}><code>{c}</code></li>)}</ul>
          </div>
        )}
      </section>

      <section className="ess-group">
        <h3 className="ess-heading">Who has looked at your details</h3>
        <p className="hint">
          Every time someone reveals an identity detail on your account, it is recorded here.
        </p>
        {log.length === 0 && <div className="empty-state">Nothing yet.</div>}
        {log.map((entry) => (
          <div className="card ess-row" key={entry.id}>
            <div className="ess-main">
              <div className="ess-label">
                {entry.isSelf ? 'You' : entry.actorName} {entry.action}
                {entry.field ? ` — ${entry.field.replace(/_/g, ' ')}` : ''}
              </div>
              <div className="ess-meta">
                <span className="hint">{new Date(entry.at).toLocaleString()}</span>
              </div>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
