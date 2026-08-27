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

  async function archive(threadId, on) {
    setError('');
    try {
      if (on) await api.post(`/threads/${threadId}/archive`);
      else await api.del(`/threads/${threadId}/archive`);
      await load();
    } catch (err) { setError(err.message); }
  }

  async function rename() {
    const next = window.prompt('What should this space be called?', data.space.name);
    if (next === null || !next.trim() || next.trim() === data.space.name) return;
    setError('');
    try {
      await api.patch(`/spaces/${spaceId}`, { name: next.trim() });
      await load();
    } catch (err) { setError(err.message); }
  }

  /**
   * Closing the space, with what it costs said out loud first.
   *
   * The counts come from the server rather than from what happens to be on
   * screen — this page shows threads and projects, not how many records or
   * messages are inside them, and "12 threads" is not the number that makes
   * somebody stop and think. The name has to be typed, and the server checks
   * it too: a guard only the screen enforces is decoration.
   */
  async function closeSpace() {
    setError('');
    let contents;
    try {
      contents = (await api.get(`/spaces/${spaceId}/contents`)).contents;
    } catch (err) { setError(err.message); return; }
    const held = [
      `${contents.threads} thread${contents.threads === 1 ? '' : 's'}`,
      `${contents.messages} message${contents.messages === 1 ? '' : 's'}`,
      `${contents.records} record${contents.records === 1 ? '' : 's'}`,
      `${contents.projects} project${contents.projects === 1 ? '' : 's'}`,
      `${contents.tasks} task${contents.tasks === 1 ? '' : 's'}`,
    ].join(', ');
    const typed = window.prompt(
      `Closing "${data.space.name}" deletes ${held}. There is no undo.\n\n`
      + 'If you may want to look any of it up later, archive the threads instead.\n\n'
      + `Type the space's name to close it:`,
    );
    if (typed === null) return;
    try {
      await api.del(`/spaces/${spaceId}`, { confirmName: typed.trim() });
      navigate('/spaces');
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
  // Live and put-away, kept apart on the screen for the same reason they are
  // kept apart in the data: a finished room should stop competing for
  // attention without ceasing to exist.
  const live = threads.filter((t) => !t.archivedAt);
  const archived = threads.filter((t) => t.archivedAt);
  const liveProjects = projects.filter((p) => p.status !== 'archived');
  const archivedProjects = projects.filter((p) => p.status === 'archived');
  const isPrivate = space.context === 'private';

  return (
    <AppShell
      title={space.name}
      active="spaces"
      actions={(
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className={`ctx-chip ctx-${space.context}`}>{CONTEXT_LABELS[space.context]}</span>
          {space.isOwner && (space.kind || 'standard') === 'standard' && (
            <>
              <button className="btn btn-secondary btn-sm" type="button" onClick={rename}>
                Rename
              </button>
              {/* Last, and the only danger-styled thing on the page. */}
              <button className="btn btn-danger btn-sm" type="button" onClick={closeSpace}>
                Close space
              </button>
            </>
          )}
        </span>
      )}
    >

        {error && <div className="alert alert-error">{error}</div>}
        {notice && <div className="alert alert-success">{notice}</div>}

        {!space.isOwner && (
          <p className="tz-note" style={{ marginBottom: 14 }}>
            {owner.name} owns this space — you have access as their {ROLE_LABELS[user.accountCategory] || 'member'}.
          </p>
        )}

        <h3 style={{ marginTop: 8 }}>Projects</h3>
        {liveProjects.length === 0 && <div className="empty-state">No projects yet.</div>}
        {liveProjects.map((p) => (
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

        {/* Same treatment as an archived conversation: out of the live list,
            under its own heading, and still one tap from being read. Taking it
            back out is on the project's own page, where the person deciding
            can see what is in it. */}
        {archivedProjects.length > 0 && (
          <>
            <h4 style={{ marginTop: 18, marginBottom: 6 }}>Archived projects</h4>
            {archivedProjects.map((p) => (
              <Link className="card space-card is-archived" key={p.id} to={`/projects/${p.id}`}>
                <div>
                  <div className="name">{p.name}</div>
                  <div className="meta">
                    {p.doneCount} of {p.stageCount} stage{p.stageCount === 1 ? '' : 's'} done
                  </div>
                </div>
                <span className="pill is-off">Archived</span>
              </Link>
            ))}
          </>
        )}

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
        {live.length === 0 && <div className="empty-state">No threads yet.</div>}
        {live.map((t) => (
          <div className="card space-card" key={t.id}>
            <Link to={`/threads/${t.id}`} style={{ flex: 1, minWidth: 0 }}>
              <div className="name">{t.name}</div>
              <div className="meta">Started {new Date(t.createdAt).toLocaleDateString()}</div>
            </Link>
            {data.canWrite && (
              <button className="btn btn-secondary btn-sm" type="button"
                onClick={() => archive(t.id, true)}>Archive</button>
            )}
          </div>
        ))}

        {/* PUT AWAY, NOT THROWN AWAY. Kept under its own heading rather than
            mixed back into the list: the point of archiving is that the room
            stops competing for attention while every word in it stays there to
            be looked up. */}
        {archived.length > 0 && (
          <>
            <h3 style={{ marginTop: 26 }}>Archived</h3>
            <p className="hint" style={{ marginBottom: 8 }}>
              Readable in full, and closed to new messages. Take one out of the
              archive to carry on in it.
            </p>
            {archived.map((t) => (
              <div className="card space-card is-archived" key={t.id}>
                <Link to={`/threads/${t.id}`} style={{ flex: 1, minWidth: 0 }}>
                  <div className="name">{t.name}</div>
                  <div className="meta">
                    Archived {new Date(t.archivedAt).toLocaleDateString()}
                  </div>
                </Link>
                {data.canWrite && (
                  <button className="btn btn-secondary btn-sm" type="button"
                    onClick={() => archive(t.id, false)}>Take out</button>
                )}
              </div>
            ))}
          </>
        )}

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
