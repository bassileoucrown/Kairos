import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// The principal's pairing codes.
//
// An emailed invitation is still the better path when email is working. This
// is for when it isn't, or when the principal is simply sitting across a table
// from the person: read them two things, and they're in.
//
// Several at once, on purpose. Bringing on a Chief of Staff and a
// scheduling-only delegate in the same week are two different remits, and each
// wants its own code with its own window — turning one off must not touch the
// other. Each is listed with what it grants, so the principal can see which is
// which before deciding what to end.
//
// Deliberately armed rather than standing. Every one shows a countdown and a
// use count because those are the facts that decide whether a code is safe,
// and a credential whose expiry is invisible is one nobody ever turns off.

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
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ code: '', role: 'pa', window: '24h', uses: 2 });

  function load() {
    return api.get('/access-codes').then(setData).catch((err) => setError(err.message));
  }
  useEffect(() => { load(); }, []);

  async function save(e) {
    e.preventDefault();
    setError('');
    try {
      const d = await api.post('/access-codes', form);
      setData((prev) => ({ ...prev, codes: d.codes }));
      setForm({ code: '', role: 'pa', window: '24h', uses: 2 });
      setAdding(false);
    } catch (err) { setError(err.message); }
  }

  async function turnOff(id) {
    setError('');
    try {
      const d = await api.del(`/access-codes/${id}`);
      setData((prev) => ({ ...prev, codes: d.codes }));
    } catch (err) { setError(err.message); }
  }

  if (!data) return null;
  const codes = data.codes || [];
  const live = codes.filter((c) => c.live);
  const ended = codes.filter((c) => !c.live);
  const maxLive = data.maxLive || 5;
  const full = live.length >= maxLive;

  return (
    <div className="card code-card">
      {error && <div className="alert alert-error">{error}</div>}

      <div className="code-head">
        <div>
          <div className="name">Access codes</div>
          <div className="meta">
            Bring someone on without email — read them your handle and one of these.
          </div>
        </div>
        {live.length
          ? <span className="pill">{live.length} live</span>
          : <span className="pill is-off">Off</span>}
      </div>

      {live.map((c) => (
        <div className="code-live" key={c.id}>
          <div className="code-value">
            <span className="code-handle">@{handle}</span>
            <span className="code-word">{c.code}</span>
          </div>
          <div className="code-facts">
            Grants <strong>{c.roleLabel}</strong> · {countdown(c.minutesLeft)} ·{' '}
            {c.usesLeft} of {c.usesAllowed} {c.usesAllowed === 1 ? 'use' : 'uses'} left
          </div>
          <div className="code-actions">
            <button
              className="btn btn-danger btn-sm" type="button"
              onClick={() => turnOff(c.id)}
            >
              Turn off
            </button>
          </div>
        </div>
      ))}

      {live.length > 0 && (
        <p className="hint">
          They need both parts. The handle on its own is public; a code on its own belongs to
          nobody in particular. Together they mean one specific person joining one specific
          account.
        </p>
      )}

      {!adding && (
        <>
          {full ? (
            <p className="hint">
              You're holding {maxLive} live codes, which is the limit. Turn one off to add
              another — codes that pile up are codes nobody reads.
            </p>
          ) : (
            <button className="btn btn-primary btn-sm" type="button" onClick={() => setAdding(true)}>
              {live.length ? 'Add another code' : 'Set a code'}
            </button>
          )}
          {live.length === 0 && ended.length > 0 && (
            <p className="hint">
              The last code {ended[0].endedBecause === 'expired' ? 'expired' : 'was used up'}.
              Codes stop working on their own so an old one can't be dug out of a message months
              later.
            </p>
          )}
        </>
      )}

      {adding && (
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
          <div className="code-actions">
            <button className="btn btn-primary btn-sm" type="submit">Arm it</button>
            <button className="btn btn-sm" type="button" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
