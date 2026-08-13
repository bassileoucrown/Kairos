import { useState } from 'react';
import { api } from '../lib/api.js';

// The assistant's side of the pairing code.
//
// Two fields rather than one, and that is the security design: a code alone
// would be a bearer token guessable against every account at once, and two
// principals would eventually choose the same phrase. With the handle, you
// have to know whose account you are joining before a guess is worth
// anything.

export default function JoinWithCode({ onJoined }) {
  const [handle, setHandle] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const d = await api.post('/access-codes/redeem', { handle, code });
      onJoined(d.joined);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <form className="card join-code" onSubmit={submit}>
      <div className="name">Join a principal</div>
      <p className="meta">
        If they gave you a code instead of an email invitation, this is where it goes.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="code-row">
        <div className="field">
          <label htmlFor="join-handle">Their handle</label>
          <div className="conn-handle-input">
            <span aria-hidden="true">@</span>
            <input
              id="join-handle" type="text" value={handle} required
              placeholder="ada-boss"
              onChange={(e) => setHandle(e.target.value)}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="join-code">Code</label>
          <input
            id="join-code" type="text" value={code} required
            placeholder="THURSDAY-LAGOS-91"
            autoComplete="off"
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
      </div>
      <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>
        {busy ? 'Checking…' : 'Join'}
      </button>
    </form>
  );
}
