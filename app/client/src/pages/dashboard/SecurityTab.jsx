import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import EncryptionKeySetup from '../../components/EncryptionKeySetup.jsx';
import TwoFactorSetup from '../../components/TwoFactorSetup.jsx';
import SignedInDevices from '../../components/SignedInDevices.jsx';
import SecurityQuestionSetup from '../../components/SecurityQuestionSetup.jsx';
import { useAsk } from '../../components/Ask.jsx';

// Two-factor authentication, and who has looked at what.
//
// These belong on one screen because they answer the same question: is my
// account, and what it holds, actually protected. The access log is here
// rather than buried because seeing it is what makes a principal willing to
// put a passport in at all.

export default function SecurityTab() {
  // Replaces window.prompt; see components/Ask.jsx.
  const [ask, askDialog] = useAsk();
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

  // Moving where the code is demanded is itself a security decision, so the
  // server charges one for it — otherwise somebody holding a live session could
  // quietly weaken the front door.
  async function changeScope(scope) {
    setError('');
    try {
      await api.post('/security/2fa/scope', { scope });
      load();
      return;
    } catch (err) {
      if (err.status !== 401) { setError(err.message); return; }
    }
    const code = await ask({
      title: 'Confirm it is you',
      label: 'Code from your authenticator',
      hint: 'Changing what two-factor covers needs a live code.',
      confirmLabel: 'Change',
    });
    if (!code) return;
    try { await api.post('/security/2fa/scope', { scope, code: code.trim() }); load(); }
    catch (err) { setError(err.message); }
  }

  async function disable() {
    const password = await ask({
      title: 'Turn two-factor off',
      label: 'Your password',
      hint: 'Both your password and a live code, so a borrowed screen cannot do this alone.',
      secret: true,
      confirmLabel: 'Continue',
    });
    if (!password) return;
    const c = await ask({
      title: 'And a code',
      label: 'Code from your authenticator',
      hint: 'The last one it will ask you for.',
      confirmLabel: 'Turn it off',
    });
    if (!c) return;
    setError('');
    try { await api.post('/security/2fa/disable', { password, code: c }); load(); }
    catch (err) { setError(err.message); }
  }

  if (!state) return <p className="hint">Loading…</p>;

  return (
    <div>
      {askDialog}
      {/* While the setup form is open it shows the error itself, next to the
          box being typed into. */}
      {error && !setup && <div className="alert alert-error">{error}</div>}

      {/* First on the screen when it is missing, because everything below
          depends on it and the old advice — run a command in a terminal —
          assumed a developer the person setting this up may not be. */}
      {!state.encryptionConfigured && <EncryptionKeySetup />}

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
              {state.twoFactor.scope === 'login_and_vault'
                ? 'A code is needed to sign in, and again to reveal anything sensitive.'
                : 'Your password signs you in. A code is needed to reveal anything sensitive.'}
            </p>

            {/* Where the code is spent. A code at the front door protects
                everything but is paid on every login, and that friction is what
                makes people turn two-factor off — an account with it off
                protects nothing at all. */}
            <div className="field totp-scope">
              <label htmlFor="totp-scope">Ask for a code</label>
              <select
                id="totp-scope"
                value={state.twoFactor.scope}
                onChange={(e) => changeScope(e.target.value)}
              >
                {(state.twoFactor.scopes || []).map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
              <p className="hint">
                {(state.twoFactor.scopes || []).find((s) => s.id === state.twoFactor.scope)?.hint}
              </p>
            </div>
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
          <TwoFactorSetup
            setup={setup}
            code={code}
            onCode={setCode}
            onSubmit={confirm}
            error={error}
            onCancel={() => { setSetup(null); setCode(''); setError(''); }}
          />
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

      <SignedInDevices />

      <SecurityQuestionSetup />

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
