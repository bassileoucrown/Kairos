import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import TaskList, { dueState } from './TaskList.jsx';
import { CONTEXT_LABELS } from './SpacesHome.jsx';

const CONTEXTS = ['work', 'personal', 'private'];

export default function MyTasks() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [showDone, setShowDone] = useState(false);

  function load() {
    return api.get('/tasks/mine').then((d) => setTasks(d.tasks)).catch((err) => setError(err.message));
  }
  useEffect(() => { load(); }, []);

  async function handleLogout() { await logout(); navigate('/login'); }

  if (error && !tasks) return <div className="spinner-page">{error}</div>;
  if (!tasks) return <div className="spinner-page">Loading…</div>;

  const scoped = filter === 'all' ? tasks : tasks.filter((t) => t.spaceContext === filter);
  const live = scoped.filter((t) => t.status !== 'done');
  const done = scoped.filter((t) => t.status === 'done');

  const overdue = live.filter((t) => dueState(t.dueAt, t.status) === 'overdue');
  const soon = live.filter((t) => dueState(t.dueAt, t.status) === 'due-soon');
  const rest = live.filter((t) => !dueState(t.dueAt, t.status));

  return (
    <div className="shell">
      <div className="topbar">
        <span className="topbar-brand">Kairos — My Tasks</span>
        <div className="topbar-actions">
          <Link to="/spaces" className="btn btn-secondary btn-sm">Spaces</Link>
          <Link to="/dashboard" className="btn btn-secondary btn-sm">My Dashboard</Link>
          <span>{user.name}</span>
          <button className="btn btn-secondary btn-sm" type="button" onClick={handleLogout}>Log out</button>
        </div>
      </div>

      <div className="page">
        <div className="page-header">
          <h1>My tasks</h1>
          <span className="pill">{live.length} open</span>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <p className="tz-note" style={{ marginBottom: 14 }}>
          Everything assigned to you, across every context. Work and personal sit in one list without
          mixing — each row says which world it belongs to, and you can narrow to one.
        </p>

        <div className="tabs">
          {['all', ...CONTEXTS].map((c) => (
            <button
              key={c}
              type="button"
              className={'tab-btn' + (filter === c ? ' is-active' : '')}
              onClick={() => setFilter(c)}
            >
              {c === 'all' ? 'All' : CONTEXT_LABELS[c]}
            </button>
          ))}
        </div>

        {overdue.length > 0 && (
          <>
            <h3 className="task-band is-overdue">Overdue</h3>
            <TaskList tasks={overdue} onChanged={load} showContext />
          </>
        )}
        {soon.length > 0 && (
          <>
            <h3 className="task-band is-soon">Due within a day</h3>
            <TaskList tasks={soon} onChanged={load} showContext />
          </>
        )}

        <h3 className="task-band">Everything else</h3>
        <TaskList
          tasks={rest}
          onChanged={load}
          showContext
          emptyText={live.length > 0 ? 'Nothing else outstanding.' : 'Nothing assigned to you right now.'}
        />

        {done.length > 0 && (
          <>
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              style={{ marginTop: 18 }}
              onClick={() => setShowDone((s) => !s)}
            >
              {showDone ? 'Hide' : 'Show'} {done.length} completed
            </button>
            {showDone && <div style={{ marginTop: 10 }}><TaskList tasks={done} onChanged={load} showContext /></div>}
          </>
        )}
      </div>
    </div>
  );
}
