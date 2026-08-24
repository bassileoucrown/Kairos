import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import AccessCode from '../../components/AccessCode.jsx';
import { useAuth } from '../../lib/AuthContext.jsx';

export default function MembersTab() {
  const { user } = useAuth();
  const [members, setMembers] = useState(null);
  // Fetched rather than hard-coded, so the titles offered here are exactly the
  // ones the server accepts and onboarding asked about — the two drifted apart
  // once already, and a Chief of Staff was invited as somebody's PA.
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [email, setEmail] = useState('');
  // Empty means "whatever they call themselves" — the server reads it off
  // their account rather than the principal having to know.
  const [role, setRole] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function load() {
    return api.get('/members').then((data) => setMembers(data.members)).catch((err) => setError(err.message));
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    api.get('/members/roles').then((d) => setRoles(d.roles)).catch(() => {});
  }, []);

  async function changeRole(id, value) {
    setError('');
    try {
      await api.patch(`/members/${id}`, { role: value });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleInvite(e) {
    e.preventDefault();
    setError('');
    setInviteLink('');
    setSubmitting(true);
    try {
      const data = await api.post('/members', role ? { email, role } : { email });
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

  // Approving is what actually grants access, so it is the one click that
  // matters on this screen. No confirm on either: approve is reversible with
  // Revoke, and decline is reversible by them asking again.
  async function decide(id, decision) {
    try {
      await api.post(`/members/${id}/${decision}`);
      load();
    } catch (err) {
      setError(err.message);
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

      <AccessCode handle={user?.slug} />
      {inviteLink && (
        <div className="alert alert-success">
          Invite sent — since email delivery isn't fully wired up in this environment, here's the link too: <code>{inviteLink}</code>
        </div>
      )}

      {members === null && <p className="hint">Loading…</p>}
      {members && members.length === 0 && (
        <div className="empty-state">
          No one on your team yet — invite your PA, EA, or Chief of Staff below.
        </div>
      )}
      {/* Somebody has asked to work for you, and nothing has been granted.
          Deliberately not the same row as a member: no title to change, no
          scheduling toggle, and "Revoke" would be the wrong word for a thing
          that was never given. Two answers and the facts to answer on. */}
      {members && members.filter((m) => m.status === 'requested').map((m) => (
        <div className="card" key={m.id}>
          <div className="meeting-type-card">
            <div>
              <div className="name">
                {m.memberName || m.invitedEmail} <span className="pill is-off">Asking</span>
              </div>
              <div className="meta">
                Says they are your {m.roleLabel} · {m.invitedEmail}
              </div>
              <p className="hint" style={{ marginTop: 6 }}>
                They have no access until you approve this.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => decide(m.id, 'decline')}>
                Decline
              </button>
              <button className="btn btn-primary btn-sm" type="button" onClick={() => decide(m.id, 'approve')}>
                Approve
              </button>
            </div>
          </div>
        </div>
      ))}

      {members && members.filter((m) => m.status !== 'requested').map((m) => (
        <div className="card" key={m.id}>
          <div className="meeting-type-card">
            <div>
              <div className="name">
                {m.memberName || m.invitedEmail} <span className={'pill' + (m.status === 'invited' ? ' is-off' : '')}>{m.status === 'invited' ? 'Invited' : 'Active'}</span>
              </div>
              <div className="meta">
                <select
                  className="role-select"
                  value={m.role}
                  aria-label={`Title for ${m.memberName || m.invitedEmail}`}
                  onChange={(e) => changeRole(m.id, e.target.value)}
                >
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
                {' · '}{m.invitedEmail}
              </div>
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
            <option value="">Use their own title, if they already have an account</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.description}</option>)}
          </select>
        </div>
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? 'Sending…' : 'Send invite'}
        </button>
      </form>
    </div>
  );
}
