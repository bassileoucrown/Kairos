import { useEffect, useState } from 'react';
import AppShell from '../components/AppShell.jsx';
import { api } from '../lib/api.js';

// The staff member's screen, and deliberately the whole of it.
//
// A driver at six in the morning wants one question answered — what am I doing
// and where — and wants to say "got it" in one tap. Everything the rest of the
// app does is somebody else's business, and none of it is reachable from here
// because none of it is reachable from their account at all.

function whenLabel(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return `${today ? 'Today' : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} `
    + `at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function Instruction({ i, onChanged }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');

  async function expand() {
    setOpen((o) => !o);
    if (!detail) {
      try { setDetail(await api.get(`/household/instructions/${i.id}`)); }
      catch (err) { setError(err.message); }
    }
  }

  async function act(path) {
    setError('');
    try { await api.post(`/household/instructions/${i.id}/${path}`); onChanged(); }
    catch (err) { setError(err.message); }
  }

  async function sendReply(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post(`/household/instructions/${i.id}/replies`, { body: reply });
      setReply('');
      setDetail(await api.get(`/household/instructions/${i.id}`));
      onChanged();
    } catch (err) { setError(err.message); }
  }

  return (
    <div className={'card instr' + (i.status === 'open' ? ' is-open' : '')}>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="instr-head">
        <div>
          {i.dueAt && <div className="instr-when">{whenLabel(i.dueAt)}</div>}
          <div className="instr-from">
            {i.authorName}
            {i.principalName && i.principalName !== i.authorName ? ` · ${i.principalName}` : ''}
          </div>
        </div>
        {i.status === 'done' && <span className="pill">Done</span>}
        {i.status === 'acknowledged' && <span className="pill">Got it</span>}
      </div>

      <div className="instr-body">{i.body}</div>

      <div className="instr-actions">
        {i.status === 'open' && (
          <button className="btn btn-primary btn-sm" type="button" onClick={() => act('acknowledge')}>
            Got it
          </button>
        )}
        {i.status !== 'done' && (
          <button className="btn btn-sm" type="button" onClick={() => act('done')}>
            Mark done
          </button>
        )}
        <button className="btn btn-sm" type="button" onClick={expand}>
          {open ? 'Hide' : (i.replyCount > 0 ? `${i.replyCount} replies` : 'Reply')}
        </button>
      </div>

      {open && (
        <div className="instr-thread">
          {(detail?.replies || []).map((r) => (
            <div className="instr-reply" key={r.id}>
              <strong>{r.authorName}</strong> {r.body}
            </div>
          ))}
          <form className="instr-reply-form" onSubmit={sendReply}>
            <input
              type="text" value={reply} required
              aria-label="Reply"
              placeholder="Traffic on the bridge — ten minutes behind."
              onChange={(e) => setReply(e.target.value)}
            />
            <button className="btn btn-primary btn-sm" type="submit">Send</button>
          </form>
        </div>
      )}
    </div>
  );
}

export default function MyInstructions() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  function load() {
    return api.get('/household/mine').then(setData).catch((err) => setError(err.message));
  }
  useEffect(() => { load(); }, []);

  if (error && !data) {
    return <AppShell title="What you've been asked" active="instructions">
      <div className="alert alert-error">{error}</div>
    </AppShell>;
  }
  if (!data) {
    return <AppShell title="What you've been asked" active="instructions">
      <p className="hint">Loading…</p>
    </AppShell>;
  }

  const posts = data.posts.map((p) => `${p.jobTitle} to ${p.principalName}`).join(' · ');
  const open = data.instructions.filter((i) => i.status !== 'done');
  const done = data.instructions.filter((i) => i.status === 'done');

  return (
    <AppShell title="What you've been asked" active="instructions" guide="my_instructions">
      {posts && <p className="today-date">{posts}</p>}

      {open.length === 0 && (
        <div className="empty-state">Nothing outstanding. You're clear.</div>
      )}
      {open.map((i) => <Instruction key={i.id} i={i} onChanged={load} />)}

      {done.length > 0 && (
        <>
          <h2 className="section-head">Done</h2>
          {done.slice(0, 10).map((i) => <Instruction key={i.id} i={i} onChanged={load} />)}
        </>
      )}
    </AppShell>
  );
}
