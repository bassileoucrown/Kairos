import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// The principal's pairing code.
//
// An emailed invitation is still the better path when email is working. This
// is for when it isn't, or when the principal is simply sitting across a table
// from the person: read them two things, and they're in.
//
// Deliberately armed rather than standing. It shows a countdown and a use
// count because those are the facts that decide whether a code is safe, and a
// credential whose expiry is invisible is one nobody ever turns off.

function countdown(minutes) {
  if (minutes <= 0) return 'expired';
  if (minutes < 60) return `${minutes} min left`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h}h ${minutes % 60}m left`;
  return `${Math.floor(h / 24)}d ${h % 24}h left`;
}

export default function AccessCode({ handle }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ code: '', role: 'pa', window: '24h', uses: 2 });

  function load() {
    return api.get('/access-codes').then(setData).catch((err) => setError(err.message));
  }
  useEffect(() => { load(); }, []);

  async function save(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/access-codes', form);
      setEditing(false);
      load();
    } catch (err) { setError(err.message); }
  }

  async function turnOff() {
    setError('');
    try { await api.del('/access-codes'); load(); }
    catch (err) { setError(err.message); }
  }

  if (!data) return null;
  const live = data.code?.live ? data.code : null;

  return (
    <div className="card code-card">
      {error && <div className="alert alert-error">{error}</div>}

      <div className="code-head">
        <div>
          <div className="name">Access code</div>
          <div className="meta">
            Bring someone on without email — read them your handle and this code.
          </div>
        </div>
        {live
          ? <span className="pill">Live</span>
          : <span className="pill is-off">Off</span>}
      </div>

      {live && (
        <>
          <div className="code-value">
            <span className="code-handle">@{handle}</span>
            <span className="code-word">{live.code}</span>
          </div>
          <div className="code-facts">
            Grants <strong>{live.roleLabel}</strong> · {countdown(live.minutesLeft)} ·{' '}
            {live.usesLeft} of {live.usesAllowed} {live.usesAllowed === 1 ? 'use' : 'uses'} left
          </div>
          <p className="hint">
            They need both parts. The handle on its own is public; the code on its own belongs to
            nobody in particular. Together they mean one specific person joining one specific
            account.
          </p>
          <div className="code-actions">
            <button className="btn btn-sm" type="button" onClick={() => setEditing((v) => !v)}>
              {editing ? 'Cancel' : 'Replace'}
            </button>
            <button className="btn btn-danger btn-sm" type="button" onClick={turnOff}>
              Turn off
            </button>
          </div>
        </>
      )}

      {!live && !editing && (
        <>
          {data.code && (
            <p className="hint">
              The last code {data.code.endedBecause === 'expired' ? 'expired' : 'was used up'}.
              Codes stop working on their own so an old one can't be dug out of a message months
              later.
            </p>
          )}
          <button className="btn btn-primary btn-sm" type="button" onClick={() => setEditing(true)}>
            Set a code
          </button>
        </>
      )}

      {editing && (
        <form className="code-form" onSubmit={save}>
          <div className="field">
            <label htmlFor="code-word">Code</label>
            <input
              id="code-word" type="text" value={form.code} required
              placeholder="THURSDAY-LAGOS-91"
              onChange={(e) => setForm({ ...form, code: e.target.value })}
            />
            <p className="hint">
              Yours to choose — something you can say down a phone. Letters, numbers and hyphens.
            </p>
          </div>
          <div className="field">
            <label htmlFor="code-role">It grants</label>
            <select
              id="code-role" value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              {(data.roles || []).map((r) => (
                <option key={r.id} value={r.id}>{r.description}</option>
              ))}
            </select>
          </div>
          <div className="code-row">
            <div className="field">
              <label htmlFor="code-window">Live for</label>
              <select
                id="code-window" value={form.window}
                onChange={(e) => setForm({ ...form, window: e.target.value })}
              >
                {(data.windows || []).map((w) => (
                  <option key={w.id} value={w.id}>{w.label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="code-uses">People</label>
              <input
                id="code-uses" type="number" min="1" max="10" value={form.uses}
                onChange={(e) => setForm({ ...form, uses: e.target.value })}
              />
            </div>
          </div>
          <button className="btn btn-primary btn-sm" type="submit">Arm it</button>
        </form>
      )}
    </div>
  );
}
