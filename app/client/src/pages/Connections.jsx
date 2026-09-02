import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell.jsx';
import { api } from '../lib/api.js';

// Peers, across principals.
//
// Two assistants running two different executives, trying to get those two
// executives in a room. It is the most common conversation in the job and the
// app had nowhere to hold it — they share no principal, no space and no
// membership, so nothing connected them at all.
//
// Reached by an exact handle. There is no search here and there never will be:
// a directory of who is on Kairos, and who they run, is itself the sensitive
// thing. You get a handle the way you always did — from a signature, or from
// them.

function Person({ c }) {
  return (
    <div className="conn-person">
      <div className="conn-name">{c.person?.name || 'Someone'}</div>
      <div className="conn-handle">@{c.person?.handle}</div>
    </div>
  );
}

export default function Connections() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [handle, setHandle] = useState('');
  // Who the typed handle belongs to, once looked up. Null before anybody has
  // looked; { found: false } when nobody discoverable answers to it.
  const [who, setWho] = useState(null);
  const [looking, setLooking] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    return api.get('/connections').then(setData).catch((err) => setError(err.message));
  }
  useEffect(() => { load(); }, []);

  // WHY THIS EXISTS. Sending a request answers neutrally on purpose, so nobody
  // can walk the alphabet and learn who is on Kairos. Carried into looking
  // somebody up, that same rule made connections pointless: you typed a
  // colleague's handle, got a shrug, and could not tell a typo from an absence.
  // So an exact handle now resolves to a name — for anybody who has not turned
  // that off. See routes/connections.js.
  async function look() {
    const h = handle.trim().replace(/^@/, '');
    if (!h) return;
    setLooking(true);
    setError('');
    try {
      setWho(await api.get(`/connections/lookup?handle=${encodeURIComponent(h)}`));
    } catch (err) { setError(err.message); } finally { setLooking(false); }
  }

  async function request(e) {
    e.preventDefault();
    setError(''); setNotice(''); setBusy(true);
    try {
      const d = await api.post('/connections', { handle, note });
      setWho(null);
      setNotice(d.message);
      setHandle(''); setNote('');
      load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function act(id, path) {
    setError('');
    try {
      if (path === 'end') await api.del(`/connections/${id}`);
      else await api.post(`/connections/${id}/${path}`);
      load();
    } catch (err) { setError(err.message); }
  }

  return (
    <AppShell title="Connections" active="connections" guide="connections">
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      <form className="card conn-ask" onSubmit={request}>
        <div className="field">
          <label htmlFor="conn-handle">Connect with someone</label>
          <div className="conn-handle-input">
            <span aria-hidden="true">@</span>
            <input
              id="conn-handle" type="text" value={handle} required
              placeholder="their-handle"
              onChange={(e) => setHandle(e.target.value)}
            />
          </div>
          <p className="hint">
            You need their exact handle — there is still no directory to search.
            Nothing about your principal is shared by connecting.
          </p>
          <button
            className="btn btn-sm" type="button" onClick={look}
            disabled={looking || !handle.trim()}
          >
            {looking ? 'Looking…' : 'Who is this?'}
          </button>

          {/* Said before the request goes, so somebody can tell a mistyped
              handle from a person who is not here — which is the whole
              complaint this answers. */}
          {who && who.found && (
            <p className="alert alert-success conn-found">
              <strong>{who.name}</strong> — @{who.handle}
              {who.self && ' — that is you.'}
              {who.status === 'accepted' && ' — you are already connected.'}
              {who.status === 'pending' && ' — there is already a request between you.'}
            </p>
          )}
          {who && !who.found && (
            <p className="hint">
              Nobody by that handle. Either it is mistyped, they are not on Kairos,
              or they have chosen not to be found this way.
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="conn-note">A line of context (optional)</label>
          <input
            id="conn-note" type="text" value={note} maxLength={280}
            placeholder="Arranging the Thursday meeting between our principals"
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Send request'}
        </button>
      </form>

      {!data && <p className="hint">Loading…</p>}

      {data?.incoming.length > 0 && (
        <section className="ws-section">
          <h2 className="ws-heading">
            Asking to connect
            <span className="ws-count">{data.incoming.length}</span>
          </h2>
          {data.incoming.map((c) => (
            <div className="card conn-row" key={c.id}>
              <Person c={c} />
              {c.note && <div className="conn-note">“{c.note}”</div>}
              <div className="conn-actions">
                <button className="btn btn-primary btn-sm" type="button" onClick={() => act(c.id, 'accept')}>
                  Accept
                </button>
                <button className="btn btn-sm" type="button" onClick={() => act(c.id, 'decline')}>
                  Decline
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="ws-section">
        <h2 className="ws-heading">
          Your lines
          {data?.connected.length > 0 && <span className="ws-count">{data.connected.length}</span>}
        </h2>
        {data && data.connected.length === 0 && (
          <div className="empty-state">
            No connections yet. Assistants who work for other principals are the point of
            this — a confirmation made here becomes a record, instead of a message in a phone.
          </div>
        )}
        {data?.connected.map((c) => (
          <div className="card conn-row" key={c.id}>
            <Person c={c} />
            <div className="conn-last">
              {c.lastMessage
                ? <><strong>{c.lastMessage.authorName}:</strong> {c.lastMessage.body}</>
                : <span className="hint">Nothing said yet.</span>}
            </div>
            <div className="conn-actions">
              {c.threadId && (
                <Link className="btn btn-primary btn-sm" to={`/threads/${c.threadId}`}>Open line</Link>
              )}
              <button
                className="btn btn-danger btn-sm"
                type="button"
                onClick={() => {
                  if (window.confirm('End this connection? The line closes for both of you.')) act(c.id, 'end');
                }}
              >
                End
              </button>
            </div>
          </div>
        ))}
      </section>

      {data?.outgoing.length > 0 && (
        <section className="ws-section">
          <h2 className="ws-heading">Waiting on them</h2>
          {data.outgoing.map((c) => (
            <div className="card conn-row" key={c.id}>
              <Person c={c} />
              <span className="pill is-off">Asked</span>
            </div>
          ))}
        </section>
      )}
    </AppShell>
  );
}
