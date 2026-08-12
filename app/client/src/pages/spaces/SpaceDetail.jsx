import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import AppShell from '../../components/AppShell.jsx';
import { CONTEXT_LABELS } from './SpacesHome.jsx';
import { BRAND_SHORT } from '../../lib/brand.js';

const ROLE_LABELS = { pa: 'PA', ea: 'EA', chief_of_staff: 'Chief of Staff', principal: 'Principal' };
const DELEGATABLE = [
  { value: 'pa', label: 'PAs' },
  { value: 'ea', label: 'EAs' },
  { value: 'chief_of_staff', label: 'Chiefs of Staff' },
];

export default function SpaceDetail() {
  const { spaceId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [threadName, setThreadName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [notice, setNotice] = useState('');
  const [projects, setProjects] = useState([]);
  const [projectName, setProjectName] = useState('');

  function load() {
    api.get(`/spaces/${spaceId}`).then(setData).catch((err) => setError(err.message));
    api.get(`/spaces/${spaceId}/projects`).then((d) => setProjects(d.projects)).catch(() => {});
  }
  useEffect(load, [spaceId]);

  async function addProject(e) {
    e.preventDefault();
    setError('');
    try {
      const res = await api.post(`/spaces/${spaceId}/projects`, { name: projectName });
      setProjectName('');
      navigate(`/projects/${res.project.id}`);
    } catch (err) { setError(err.message); }
  }

  async function addThread(e) {
    e.preventDefault();
    setError('');
    try {
      const res = await api.post(`/spaces/${spaceId}/threads`, { name: threadName });
      setThreadName('');
      navigate(`/threads/${res.thread.id}`);
    } catch (err) { setError(err.message); }
  }

  async function addMember(e) {
    e.preventDefault();
    setError(''); setNotice('');
    try {
      await api.post(`/spaces/${spaceId}/members`, { email: memberEmail });
      setMemberEmail('');
      setNotice('Access granted.');
      load();
    } catch (err) { setError(err.message); }
  }

  async function removeMember(id) {
    setError('');
    try {
      await api.del(`/spaces/${spaceId}/members/${id}`);
      load();
    } catch (err) { setError(err.message); }
  }

  async function toggleRole(role) {
    setError('');
    const current = data.space.autoDelegateRoles;
    const next = current.includes(role) ? current.filter((r) => r !== role) : [...current, role];
    try {
      await api.patch(`/spaces/${spaceId}`, { autoDelegateRoles: next });
      load();
    } catch (err) { setError(err.message); }
  }

  if (error && !data) return <div className="spinner-page">{error}</div>;
  if (!data) return <div className="spinner-page">Loading…</div>;

  const { space, members, threads, owner, canManageMembers } = data;
  const isPrivate = space.context === 'private';

  return (
    <AppShell
      title={space.name}
      active="spaces"
      actions={<span className={`ctx-chip ctx-${space.context}`}>{CONTEXT_LABELS[space.context]}</span>}
    >

        {error && <div className="alert alert-error">{error}</div>}
        {notice && <div className="alert alert-success">{notice}</div>}

        {!space.isOwner && (
          <p className="tz-note" style={{ marginBottom: 14 }}>
            {owner.name} owns this space — you have access as their {ROLE_LABELS[user.accountCategory] || 'member'}.
          </p>
        )}

        <h3 style={{ marginTop: 8 }}>Projects</h3>
        {projects.length === 0 && <div className="empty-state">No projects yet.</div>}
        {projects.map((p) => (
          <Link className="card space-card" key={p.id} to={`/projects/${p.id}`}>
            <div>
              <div className="name">{p.name}</div>
              <div className="meta">
                {p.doneCount} of {p.stageCount} stage{p.stageCount === 1 ? '' : 's'} done
                {p.blockedCount > 0 && ` · ${p.blockedCount} blocked`}
              </div>
            </div>
            {p.blockedCount > 0
              ? <span className="stage-badge is-blocked">Blocked</span>
              : <span className="pill">{p.status}</span>}
          </Link>
        ))}

        {data.canWrite && (
          <form onSubmit={addProject} className="card" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="New project name"
              aria-label="New project name"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              required
              style={{ flex: 1, minWidth: 200 }}
            />
            <button className="btn btn-primary btn-sm" type="submit">Add project</button>
          </form>
        )}

        <h3 style={{ marginTop: 30 }}>Threads</h3>
        {threads.length === 0 && <div className="empty-state">No threads yet.</div>}
        {threads.map((t) => (
          <Link className="card space-card" key={t.id} to={`/threads/${t.id}`}>
            <div>
              <div className="name">{t.name}</div>
              <div className="meta">Started {new Date(t.createdAt).toLocaleDateString()}</div>
            </div>
            <span className="pill">Open</span>
          </Link>
        ))}

        {data.canWrite && (
          <form onSubmit={addThread} className="card" style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="New thread name"
              aria-label="New thread name"
              value={threadName}
              onChange={(e) => setThreadName(e.target.value)}
              required
              style={{ flex: 1, minWidth: 200 }}
            />
            <button className="btn btn-primary btn-sm" type="submit">Add thread</button>
          </form>
        )}

        <h3 style={{ marginTop: 30 }}>Who can see this</h3>

        {isPrivate ? (
          <div className="empty-state">
            This is a Private space — only you. It can't be shared, and no assistant can be added to
            it. Other people can't see that it exists.
          </div>
        ) : (
          <>
            <div className="card">
              <div className="meeting-type-card">
                <div>
                  <div className="name">{owner.name} <span className="pill">Owner</span></div>
                  <div className="meta">{owner.email}</div>
                </div>
              </div>
            </div>

            {members.map((m) => (
              <div className="card" key={m.id}>
                <div className="meeting-type-card">
                  <div>
                    <div className="name">
                      {m.name}{' '}
                      <span className="pill">{ROLE_LABELS[m.accountCategory] || m.role}</span>
                      {m.canDelegate && <span className="pill" style={{ marginLeft: 6 }}>Can delegate</span>}
                    </div>
                    <div className="meta">{m.email}</div>
                  </div>
                  {canManageMembers && (
                    <button className="btn btn-danger btn-sm" type="button" onClick={() => removeMember(m.id)}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}

            {canManageMembers && (
              <form onSubmit={addMember} className="card" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <input
                  type="email"
                  placeholder={`Their ${BRAND_SHORT} email`}
                  aria-label="Add member by email"
                  value={memberEmail}
                  onChange={(e) => setMemberEmail(e.target.value)}
                  required
                  style={{ flex: 1, minWidth: 220 }}
                />
                <button className="btn btn-primary btn-sm" type="submit">Give access</button>
              </form>
            )}

            {space.isOwner && (
              <>
                <h3 style={{ marginTop: 30 }}>Automatic access by role</h3>
                <p className="tz-note" style={{ marginBottom: 10 }}>
                  Assistants in these roles get access to this space automatically, now and when you
                  add them later. Role sets the starting position — you can still add or remove
                  anyone individually above.
                </p>
                <div className="card" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {DELEGATABLE.map((r) => {
                    const on = space.autoDelegateRoles.includes(r.value);
                    return (
                      <button
                        key={r.value}
                        type="button"
                        className={'role-option' + (on ? ' is-selected' : '')}
                        style={{ width: 'auto', flexDirection: 'row', alignItems: 'center', gap: 8 }}
                        aria-pressed={on}
                        onClick={() => toggleRole(r.value)}
                      >
                        <span className="role-option-label">{r.label}</span>
                        <span className="role-option-hint">{on ? 'auto' : 'off'}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
    </AppShell>
  );
}
