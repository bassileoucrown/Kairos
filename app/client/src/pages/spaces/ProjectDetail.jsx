import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import { CONTEXT_LABELS } from './SpacesHome.jsx';
import TaskList from './TaskList.jsx';

export const STAGE_STATUS_LABELS = {
  not_started: 'Not started', active: 'Active', blocked: 'Blocked', done: 'Done',
};
const SETTABLE = ['not_started', 'active', 'done'];

export default function ProjectDetail() {
  const { projectId } = useParams();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [stageName, setStageName] = useState('');
  const [stageDue, setStageDue] = useState('');
  const [tasks, setTasks] = useState([]);
  const [taskTitle, setTaskTitle] = useState('');

  function load() {
    return Promise.all([
      api.get(`/projects/${projectId}`).then(setData).catch((err) => setError(err.message)),
      api.get(`/tasks?projectId=${projectId}`).then((r) => setTasks(r.tasks)).catch(() => {}),
    ]);
  }
  useEffect(() => { load(); }, [projectId]);

  async function addTask(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/tasks', { spaceId: data.space.id, projectId, title: taskTitle });
      setTaskTitle('');
      load();
    } catch (err) { setError(err.message); }
  }

  async function act(fn) {
    setError('');
    try {
      const res = await fn();
      if (res?.stages) setData((d) => ({ ...d, stages: res.stages }));
      else load();
    } catch (err) { setError(err.message); }
  }

  async function addStage(e) {
    e.preventDefault();
    await act(async () => {
      const res = await api.post(`/projects/${projectId}/stages`, { name: stageName, dueAt: stageDue || undefined });
      setStageName(''); setStageDue('');
      return res;
    });
  }

  const setStatus = (id, status) => act(() => api.patch(`/projects/stages/${id}`, { status }));
  const move = (id, direction) => act(() => api.post(`/projects/stages/${id}/move`, { direction }));
  const removeStage = (id) => act(() => api.del(`/projects/stages/${id}`));

  async function handleLogout() { await logout(); navigate('/login'); }

  if (error && !data) return <div className="spinner-page">{error}</div>;
  if (!data) return <div className="spinner-page">Loading…</div>;

  const { project, space, stages, canWrite } = data;
  const doneCount = stages.filter((s) => s.status === 'done').length;

  return (
    <div className="shell">
      <div className="topbar">
        <span className="topbar-brand">Kairos — Spaces</span>
        <div className="topbar-actions">
          <Link to={`/spaces/${space.id}`} className="btn btn-secondary btn-sm">Back to space</Link>
          <span>{user.name}</span>
          <button className="btn btn-secondary btn-sm" type="button" onClick={handleLogout}>Log out</button>
        </div>
      </div>

      <div className="page">
        <p className="tz-note" style={{ marginBottom: 4 }}>
          <Link to={`/spaces/${space.id}`}>{space.name}</Link>
          {' · '}
          <span className={`ctx-chip ctx-${space.context}`}>{CONTEXT_LABELS[space.context]}</span>
        </p>
        <div className="page-header">
          <h1>{project.name}</h1>
          <span className="pill">{doneCount} of {stages.length} stages done</span>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <p className="tz-note" style={{ marginBottom: 16 }}>
          Each stage has its own thread. Filing a <strong>Blocker</strong> there marks the stage
          blocked; an accepted <strong>Sign-off</strong> marks it done — the record is what moves the
          project, not a status dropdown someone forgot to update.
        </p>

        {stages.length === 0 && (
          <div className="empty-state">No stages yet. Add the first one below.</div>
        )}

        <ol className="stage-list">
          {stages.map((s, i) => (
            <li key={s.id} className={`stage-row stage-${s.status}`}>
              <div className="stage-main">
                <div className="stage-head">
                  <span className="stage-pos">{i + 1}</span>
                  <span className="stage-name">{s.name}</span>
                  <span className={`stage-badge is-${s.status}`}>{STAGE_STATUS_LABELS[s.status]}</span>
                  {s.openBlockers > 0 && (
                    <span className="stage-badge is-blocked">
                      {s.openBlockers} open blocker{s.openBlockers === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                <div className="stage-meta">
                  {s.dueAt ? `Due ${new Date(s.dueAt).toLocaleDateString()}` : 'No due date'}
                  {' · '}{s.messageCount} message{s.messageCount === 1 ? '' : 's'}
                  {' · '}{s.recordCount} record{s.recordCount === 1 ? '' : 's'}
                </div>
              </div>

              <div className="stage-actions">
                {s.threadId && (
                  <Link className="btn btn-primary btn-sm" to={`/threads/${s.threadId}`}>Open thread</Link>
                )}
                {canWrite && (
                  <>
                    <select
                      aria-label={`Status for ${s.name}`}
                      value={SETTABLE.includes(s.status) ? s.status : ''}
                      onChange={(e) => setStatus(s.id, e.target.value)}
                      style={{ width: 'auto', fontSize: '0.8rem', padding: '5px 8px' }}
                    >
                      {!SETTABLE.includes(s.status) && (
                        <option value="">{STAGE_STATUS_LABELS[s.status]}</option>
                      )}
                      {SETTABLE.map((v) => (
                        <option key={v} value={v}>{STAGE_STATUS_LABELS[v]}</option>
                      ))}
                    </select>
                    <button className="btn btn-secondary btn-sm" type="button"
                      aria-label={`Move ${s.name} up`} onClick={() => move(s.id, 'up')} disabled={i === 0}>↑</button>
                    <button className="btn btn-secondary btn-sm" type="button"
                      aria-label={`Move ${s.name} down`} onClick={() => move(s.id, 'down')} disabled={i === stages.length - 1}>↓</button>
                    <button className="btn btn-danger btn-sm" type="button"
                      aria-label={`Remove ${s.name}`} onClick={() => removeStage(s.id)}>Remove</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>

        <h3 style={{ marginTop: 30 }}>Tasks</h3>
        <TaskList tasks={tasks} onChanged={load} emptyText="No tasks on this project yet." />
        {canWrite && (
          <form onSubmit={addTask} className="card" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
            <input
              type="text"
              placeholder="New task"
              aria-label="New project task"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              required
              style={{ flex: 1, minWidth: 200 }}
            />
            <button className="btn btn-primary btn-sm" type="submit">Add task</button>
          </form>
        )}

        <h3 style={{ marginTop: 30 }}>Add a stage</h3>
        {canWrite && (
          <form onSubmit={addStage} className="card" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="New stage name"
              aria-label="New stage name"
              value={stageName}
              onChange={(e) => setStageName(e.target.value)}
              required
              style={{ flex: 1, minWidth: 200 }}
            />
            <input
              type="date"
              aria-label="Stage due date"
              value={stageDue}
              onChange={(e) => setStageDue(e.target.value)}
              style={{ width: 'auto' }}
            />
            <button className="btn btn-primary btn-sm" type="submit">Add stage</button>
          </form>
        )}
      </div>
    </div>
  );
}
