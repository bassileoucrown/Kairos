import { useEffect, useState } from 'react';
import AppShell, { resolveActivePrincipal } from '../components/AppShell.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';

// The household, from the principal's end.
//
// A driver, a cook, a housekeeper. What they are told, and whether anyone
// knows they got it — which is the whole feature. An instruction that only
// exists in a message somebody may or may not have read is not an instruction,
// it is a hope.

function statusPill(i) {
  if (i.status === 'done') return <span className="pill">Done</span>;
  if (i.status === 'acknowledged') return <span className="pill">Confirmed</span>;
  return <span className="pill is-warn">Not confirmed</span>;
}

function whenLabel(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function Household() {
  const { user } = useAuth();
  const [ownerId, setOwnerId] = useState(null);
  const [data, setData] = useState(null);
  const [titles, setTitles] = useState([]);
  const [error, setError] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [adding, setAdding] = useState(false);
  const [staff, setStaff] = useState({ name: '', email: '', jobTitle: '' });
  const [instruction, setInstruction] = useState({ memberId: '', body: '', dueAt: '' });

  function load(id) {
    return api.get(`/household/${id}`).then(setData).catch((err) => setError(err.message));
  }

  useEffect(() => {
    let live = true;
    resolveActivePrincipal(user).then((id) => {
      if (!live || !id) return;
      setOwnerId(id);
      load(id);
    });
    api.get('/household/titles').then((d) => setTitles(d.titles)).catch(() => {});
    return () => { live = false; };
  }, [user?.id]);

  async function addStaff(e) {
    e.preventDefault();
    setError(''); setInviteLink('');
    try {
      const d = await api.post(`/household/${ownerId}/staff`, staff);
      setInviteLink(`${window.location.origin}${d.inviteLink}`);
      setStaff({ name: '', email: '', jobTitle: '' });
      setAdding(false);
      load(ownerId);
    } catch (err) { setError(err.message); }
  }

  async function send(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post(`/household/${ownerId}/instructions`, instruction);
      setInstruction({ memberId: instruction.memberId, body: '', dueAt: '' });
      load(ownerId);
    } catch (err) { setError(err.message); }
  }

  async function revoke(id) {
    if (!window.confirm('End their access? What was asked of them stays on the record.')) return;
    try { await api.post(`/household/${ownerId}/staff/${id}/revoke`); load(ownerId); }
    catch (err) { setError(err.message); }
  }

  if (!data) {
    return <AppShell title="Household" active="household"><p className="hint">Loading…</p></AppShell>;
  }

  const active = data.members.filter((m) => m.status === 'active');

  return (
    <AppShell title="Household" active="household" guide="household">
      {error && <div className="alert alert-error">{error}</div>}
      {inviteLink && (
        <div className="alert alert-success">
          Added — since email delivery isn't fully wired up in this environment, here's the link
          too: <code>{inviteLink}</code>
        </div>
      )}

      <p className="hint hh-scope">
        Household staff see what they have been asked to do and nothing else — not the diary,
        not contacts, not the identity vault at any level.
      </p>

      {active.length > 0 && (
        <form className="card hh-send" onSubmit={send}>
          <div className="field">
            <label htmlFor="hh-who">Ask someone to do something</label>
            <select
              id="hh-who" value={instruction.memberId} required
              onChange={(e) => setInstruction({ ...instruction, memberId: e.target.value })}
            >
              <option value="">Choose…</option>
              {active.map((m) => (
                <option key={m.id} value={m.id}>{m.name} — {m.jobTitle}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="hh-body">What</label>
            <textarea
              id="hh-body" rows={2} value={instruction.body} required
              placeholder="Car at 7:15 for Heathrow Terminal 5."
              onChange={(e) => setInstruction({ ...instruction, body: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="hh-due">When (optional)</label>
            <input
              id="hh-due" type="datetime-local" value={instruction.dueAt}
              onChange={(e) => setInstruction({ ...instruction, dueAt: e.target.value })}
            />
          </div>
          <button className="btn btn-primary" type="submit">Send it</button>
        </form>
      )}

      <section className="ws-section">
        <h2 className="ws-heading">
          Recently asked
          {data.counts.unacknowledged > 0 && (
            <span className="ws-count">{data.counts.unacknowledged} unconfirmed</span>
          )}
        </h2>
        {data.instructions.length === 0 && (
          <div className="empty-state">Nothing asked yet.</div>
        )}
        {data.instructions.map((i) => (
          <div className="card hh-instr" key={i.id}>
            <div className="hh-instr-head">
              <div>
                <div className="name">{i.memberName} <span className="hint">· {i.memberJobTitle}</span></div>
                <div className="meta">
                  from {i.authorName}
                  {i.dueAt ? ` · for ${whenLabel(i.dueAt)}` : ''}
                </div>
              </div>
              {statusPill(i)}
            </div>
            <div className="hh-instr-body">{i.body}</div>
            {i.replyCount > 0 && (
              <div className="hint">{i.replyCount} {i.replyCount === 1 ? 'reply' : 'replies'}</div>
            )}
          </div>
        ))}
      </section>

      <section className="ws-section">
        <h2 className="ws-heading">Who's in the household</h2>
        {data.members.length === 0 && (
          <div className="empty-state">
            Nobody yet. A driver, a cook, a housekeeper — anyone who needs to be told things
            and confirm they have them.
          </div>
        )}
        {data.members.map((m) => (
          <div className="card hh-member" key={m.id}>
            <div>
              <div className="name">
                {m.name}{' '}
                <span className={'pill' + (m.status === 'invited' ? ' is-off' : '')}>
                  {m.status === 'invited' ? 'Invited' : 'Active'}
                </span>
              </div>
              <div className="meta">{m.jobTitle} · {m.email}</div>
            </div>
            {data.canManageRoster && (
              <button className="btn btn-danger btn-sm" type="button" onClick={() => revoke(m.id)}>
                Remove
              </button>
            )}
          </div>
        ))}

        {data.canManageRoster && (
          <>
            <button className="btn btn-sm" type="button" onClick={() => setAdding((a) => !a)}>
              {adding ? 'Cancel' : 'Add someone'}
            </button>
            {adding && (
              <form className="card" onSubmit={addStaff}>
                <div className="field">
                  <label htmlFor="hh-name">Name</label>
                  <input
                    id="hh-name" type="text" value={staff.name}
                    onChange={(e) => setStaff({ ...staff, name: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="hh-email">Email</label>
                  <input
                    id="hh-email" type="email" value={staff.email} required
                    onChange={(e) => setStaff({ ...staff, email: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="hh-title">Role in the household</label>
                  <input
                    id="hh-title" type="text" value={staff.jobTitle} required list="hh-titles"
                    placeholder="Driver"
                    onChange={(e) => setStaff({ ...staff, jobTitle: e.target.value })}
                  />
                  <datalist id="hh-titles">
                    {titles.map((t) => <option key={t} value={t} />)}
                  </datalist>
                  <p className="hint">A label, not a permission level — every role sees the same thing.</p>
                </div>
                <button className="btn btn-primary" type="submit">Add them</button>
              </form>
            )}
          </>
        )}
        {!data.canManageRoster && (
          <p className="hint">Only {data.principal.name} can add or remove household staff.</p>
        )}
      </section>
    </AppShell>
  );
}
