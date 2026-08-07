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
    api.get('/members').then((data) => setMembers(data.members)).catch((err) => setError(err.message));
  }

  useEffect(load, []);

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
            </div>
            <button className="btn btn-danger btn-sm" type="button" onClick={() => revoke(m.id)}>Revoke</button>
          </div>
        </div>
      ))}

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
