import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';

export const CONTEXT_LABELS = { work: 'Work', personal: 'Personal', private: 'Private' };

const CONTEXT_ORDER = ['work', 'personal', 'private'];
const CONTEXT_BLURB = {
  work: 'Clients, employers, boards. Assistants get access by default.',
  personal: 'Family, friends, your own life. Shared only when you choose to.',
  private: 'Only you. These can never be shared with anyone.',
};

export default function SpacesHome() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [spaces, setSpaces] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [context, setContext] = useState('work');
  const [filter, setFilter] = useState('all');

  function load() {
    api.get('/spaces').then((data) => setSpaces(data.spaces)).catch((err) => setError(err.message));
  }
  useEffect(load, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      const data = await api.post('/spaces', { name, context });
      setName('');
      setCreating(false);
      load();
      navigate(`/spaces/${data.space.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  const visible = spaces && (filter === 'all' ? spaces : spaces.filter((s) => s.context === filter));

  return (
    <div className="shell">
      <div className="topbar">
        <span className="topbar-brand">Kairos — Spaces</span>
        <div className="topbar-actions">
          <Link to="/dashboard" className="btn btn-secondary btn-sm">My Dashboard</Link>
          <Link to="/pa" className="btn btn-secondary btn-sm">PA Home</Link>
          <span>{user.name}</span>
          <button className="btn btn-secondary btn-sm" type="button" onClick={handleLogout}>Log out</button>
        </div>
      </div>

      <div className="page">
        <div className="page-header">
          <h1>Spaces</h1>
          <button className="btn btn-primary btn-sm" type="button" onClick={() => setCreating((c) => !c)}>
            {creating ? 'Cancel' : 'New space'}
          </button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <p className="tz-note" style={{ marginBottom: 14 }}>
          Work, Personal, and Private never mix. Nothing moves between them, and a Private space
          can't be shared with anyone — not even an assistant.
        </p>

        <div className="tabs">
          {['all', ...CONTEXT_ORDER].map((c) => (
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

        {creating && (
          <form onSubmit={handleCreate} className="card" style={{ marginBottom: 16 }}>
            <div className="field">
              <label htmlFor="space-name">Name</label>
              <input id="space-name" type="text" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="space-context">Context</label>
              <select id="space-context" value={context} onChange={(e) => setContext(e.target.value)}>
                {CONTEXT_ORDER.map((c) => <option key={c} value={c}>{CONTEXT_LABELS[c]}</option>)}
              </select>
              <p className="hint">{CONTEXT_BLURB[context]}</p>
            </div>
            <button className="btn btn-primary" type="submit">Create space</button>
          </form>
        )}

        {spaces === null && <p className="hint">Loading…</p>}
        {visible && visible.length === 0 && (
          <div className="empty-state">
            No spaces here yet. Create one to start a thread with someone.
          </div>
        )}

        {visible && CONTEXT_ORDER.map((ctx) => {
          const inContext = visible.filter((s) => s.context === ctx);
          if (inContext.length === 0) return null;
          return (
            <div key={ctx} style={{ marginBottom: 22 }}>
              <div className="context-heading">
                <span className={`ctx-chip ctx-${ctx}`}>{CONTEXT_LABELS[ctx]}</span>
                <span className="hint">{CONTEXT_BLURB[ctx]}</span>
              </div>
              {inContext.map((s) => (
                <Link className="card space-card" key={s.id} to={`/spaces/${s.id}`}>
                  <div>
                    <div className="name">{s.name}</div>
                    <div className="meta">
                      {s.threadCount} thread{s.threadCount === 1 ? '' : 's'}
                      {!s.isOwner && ' · shared with you'}
                    </div>
                  </div>
                  <span className={`ctx-chip ctx-${s.context}`}>{CONTEXT_LABELS[s.context]}</span>
                </Link>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
