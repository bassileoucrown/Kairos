import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import PasswordField from './PasswordField.jsx';

// Setting, or changing, the question that guards signing other devices out.
//
// The answer is never shown back — it is stored as a scrypt hash, exactly like
// a password, so there is nothing here to reveal. Changing it costs the account
// password, because a security control anybody with the tab open can rewrite
// is not a control.

export default function SecurityQuestionSetup() {
  const [state, setState] = useState(null);
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/security/question').then((d) => setState(d.question)).catch((e) => setError(e.message));
  }, []);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const d = await api.post('/security/question', { question, answer, password });
      setState(d.question);
      setNotice('Saved. This is what signing another device out will ask for.');
      setOpen(false);
      setQuestion(''); setAnswer(''); setPassword('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;

  return (
    <section className="ess-group">
      <h3 className="ess-heading">Your security question</h3>
      <p className="hint">
        This guards signing other devices out — and it is deliberately not your authenticator
        code, because the device you have lost is often the one your authenticator is on. A
        question travels in your head.
      </p>

      {notice && <div className="alert alert-success">{notice}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card ess-row">
        <div className="ess-main">
          <div className="ess-label">
            {state.isSet ? state.question : 'Not set'}
          </div>
          <div className="ess-meta">
            <span className="hint">
              {state.isSet
                ? 'The answer is stored hashed and is never shown, here or anywhere.'
                : 'Until you set one, signing another device out asks for your password instead.'}
            </span>
          </div>
        </div>
        <button className="btn btn-secondary btn-sm" type="button" onClick={() => setOpen((o) => !o)}>
          {state.isSet ? 'Change' : 'Set one'}
        </button>
      </div>

      {open && (
        <form onSubmit={save} className="card key-setup" style={{ marginTop: 12 }}>
          <label className="field">
            <span>Your question</span>
            <input
              id="sq-set-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="The name of the street my grandmother lived on"
              maxLength={200}
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span>The answer</span>
            <input
              id="sq-set-answer"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              maxLength={200}
              autoComplete="off"
            />
            <small className="hint">Capitals and extra spaces do not matter.</small>
          </label>
          <PasswordField
            id="sq-set-password"
            label="Your password, to confirm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          <p className="hint">
            Write your own rather than picking a familiar one. A question anybody could look up
            is one anybody could answer — and remember this can only ever end a session, never
            open anything.
          </p>
          <div className="code-actions">
            <button className="btn" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
