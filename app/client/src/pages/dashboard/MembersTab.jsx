import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

const ROLE_LABELS = { pa: 'PA / EA', delegate: 'Delegate' };

export default function MembersTab() {
  const [members, setMembers] = useState(null);
  const [error, setError] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('pa');
  const [submitting, setSubmitting] = useState(false);

  function load() {
    return api.get('/members').then((data) => setMembers(data.members)).catch((err) => setError(err.message));
  }

  useEffect(() => { load(); }, []);

  async function handleInvite(e) {
    e.preventDefault();
    setError('');
    setInviteLink('');
    setSubmitting(true);
    try {
      const data = await api.post('/members', { email, role });
      setEmail('');
      setInviteLink(`${window.location.origin}${data.inviteLink}`);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  // Hold the intended value locally while the request is in flight. A
  // checkbox bound purely to server state springs back on click and reads as
  // broken.
  const [pendingScheduling, setPendingScheduling] = useState({});
  async function setScheduling(id, value) {
    setError('');
    setPendingScheduling((p) => ({ ...p, [id]: value }));
    try {
      await api.patch(`/members/${id}`, { canManageScheduling: value });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setPendingScheduling((p) => {
        const next = { ...p };
        delete next[id];
        return next;
      });
    }
  }

  async function revoke(id) {
    if (!window.confirm('Revoke this access?')) return;
    try {
      await api.post(`/members/${id}/revoke`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      {inviteLink && (
        <div className="alert alert-success">
          Invite sent — since email delivery isn't fully wired up in this environment, here's the link too: <code>{inviteLink}</code>
        </div>
      )}

      {members === null && <p className="hint">Loading…</p>}
      {members && members.length === 0 && <div className="empty-state">No PAs or delegates yet — invite one below.</div>}
      {members && members.map((m) => (
        <div className="card" key={m.id}>
          <div className="meeting-type-card">
            <div>
              <div className="name">
                {m.memberName || m.invitedEmail} <span className={'pill' + (m.status === 'invited' ? ' is-off' : '')}>{m.status === 'invited' ? 'Invited' : 'Active'}</span>
              </div>
              <div className="meta">{ROLE_LABELS[m.role]} · {m.invitedEmail}</div>
              <label className="member-toggle">
                <input
                  type="checkbox"
                  checked={pendingScheduling[m.id] ?? m.canManageScheduling}
                  aria-label={`Let ${m.memberName || m.invitedEmail} manage your availability and meeting types`}
                  onChange={(e) => setScheduling(m.id, e.target.checked)}
                />
                <span>
                  Can set my availability and meeting types
                </span>
              </label>
            </div>
            <button className="btn btn-danger btn-sm" type="button" onClick={() => revoke(m.id)}>Revoke</button>
          </div>
        </div>
      ))}

      <p className="tz-note" style={{ marginTop: 14, marginBottom: 4 }}>
        Assistants can set your bookable hours and meeting types by default — that's the job. Turn
        it off for anyone whose remit shouldn't include it. Your profile, integrations, and who else
        has access stay yours alone either way.
      </p>

      <form onSubmit={handleInvite} className="card" style={{ marginTop: 12 }}>
        <div className="field">
          <label htmlFor="invite-email">Email</label>
          <input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="invite-role">Role</label>
          <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="pa">PA / EA — full access to approvals, briefs, contacts, comms</option>
            <option value="delegate">Delegate — scheduling access</option>
          </select>
        </div>
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? 'Sending…' : 'Send invite'}
        </button>
      </form>
    </div>
  );
}
