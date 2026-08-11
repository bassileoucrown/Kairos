import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { CONTEXT_LABELS } from './SpacesHome.jsx';

export const TASK_STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'doing', label: 'Doing' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
];
const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
];

// Overdue is worth showing as a state, not just a date the reader has to
// compare against today themselves.
export function dueState(dueAt, status) {
  if (!dueAt || status === 'done') return null;
  const due = new Date(dueAt).getTime();
  const now = Date.now();
  if (due <= now) return 'overdue';
  if (due - now <= 24 * 60 * 60 * 1000) return 'due-soon';
  return null;
}

function dueLabel(dueAt) {
  return new Date(dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function TaskList({ tasks, onChanged, showContext = false, emptyText = 'No tasks yet.' }) {
  // Ticking a checkbox should feel instant. These controls are fully
  // controlled by server state, so without holding the intended value locally
  // the box springs back until the round-trip lands, which reads as broken.
  const [pending, setPending] = useState({});

  async function update(id, patch) {
    setPending((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
    try {
      await api.patch(`/tasks/${id}`, patch);
      await onChanged();
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[id];
        return next;
      });
    }
  }
  async function remove(id) {
    await api.del(`/tasks/${id}`);
    await onChanged();
  }

  if (tasks.length === 0) return <div className="empty-state">{emptyText}</div>;

  return (
    <ul className="task-list">
      {tasks.map((raw) => {
        const t = { ...raw, ...(pending[raw.id] || {}) };
        const due = dueState(t.dueAt, t.status);
        return (
          <li key={t.id} className={`task-row${t.status === 'done' ? ' is-done' : ''}${due ? ` is-${due}` : ''}`}>
            <input
              type="checkbox"
              className="task-check"
              checked={t.status === 'done'}
              aria-label={`Mark ${t.title} done`}
              onChange={(e) => update(t.id, { status: e.target.checked ? 'done' : 'open' })}
            />

            <div className="task-main">
              <div className="task-title">{t.title}</div>
              <div className="task-meta">
                {showContext && (
                  <>
                    <span className={`ctx-chip ctx-${t.spaceContext}`}>{CONTEXT_LABELS[t.spaceContext]}</span>
                    {' '}<Link to={`/spaces/${t.spaceId}`}>{t.spaceName}</Link>
                    {t.projectName && <> › <Link to={`/projects/${t.projectId}`}>{t.projectName}</Link></>}
                    {' · '}
                  </>
                )}
                {t.stageName && <>{t.stageName} · </>}
                {t.assigneeName ? `${t.assigneeName}` : 'Unassigned'}
                {t.dueAt && (
                  <span className={due ? ` task-due is-${due}` : ' task-due'}>
                    {' · '}{due === 'overdue' ? 'Overdue ' : 'Due '}{dueLabel(t.dueAt)}
                  </span>
                )}
                {t.sourceThreadId && (
                  <> · <Link to={`/threads/${t.sourceThreadId}`}>from the conversation</Link></>
                )}
              </div>
            </div>

            <div className="task-actions">
              {t.priority !== 'normal' && (
                <span className={`task-priority is-${t.priority}`}>{t.priority}</span>
              )}
              <select
                aria-label={`Status for ${t.title}`}
                value={t.status}
                onChange={(e) => update(t.id, { status: e.target.value })}
                style={{ width: 'auto', fontSize: '0.78rem', padding: '4px 6px' }}
              >
                {TASK_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <select
                aria-label={`Priority for ${t.title}`}
                value={t.priority}
                onChange={(e) => update(t.id, { priority: e.target.value })}
                style={{ width: 'auto', fontSize: '0.78rem', padding: '4px 6px' }}
              >
                {PRIORITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <button className="btn btn-danger btn-sm" type="button"
                aria-label={`Delete ${t.title}`} onClick={() => remove(t.id)}>×</button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
