import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { CONTEXT_LABELS } from './SpacesHome.jsx';
import { MentionText } from '../../components/Mention.jsx';
import { useAsk } from '../../components/Ask.jsx';

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

/**
 * The steps inside one task.
 *
 * A STEP IS A TASK, not a checklist row, because a step still gets given to
 * somebody and still falls due — "email the surveyor by Thursday, Ngozi" is
 * the most ordinary sentence in this product. So the same @ that hands over a
 * task hands over a step, resolved on the server exactly the same way.
 *
 * Drawn much lighter than its parent all the same. A step carries no priority
 * and no status dropdown: four controls per step turns a task with five of
 * them into thirty things to look at, and the point of breaking a task up is
 * to see it more clearly, not less.
 */
function Steps({ task, onChanged, viewerId, canWrite }) {
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  // Same rule as the tasks above, and for the same reason: these boxes are
  // fully controlled by server state, so without holding the intended value
  // locally the tick springs back until the round-trip lands — which reads as
  // a checkbox that does not work.
  const [pending, setPending] = useState({});
  const steps = (task.subtasks || []).map((k) => ({ ...k, ...(pending[k.id] || {}) }));
  const total = steps.length;
  const done = steps.filter((k) => k.status === 'done').length;

  async function add(e) {
    e.preventDefault();
    if (!adding.trim() || busy) return;
    setBusy(true);
    try {
      await api.post('/tasks', { parentTaskId: task.id, title: adding });
      setAdding('');
      await onChanged();
    } finally { setBusy(false); }
  }

  async function tick(step, isDone) {
    const status = isDone ? 'done' : 'open';
    setPending((p) => ({ ...p, [step.id]: { status } }));
    try {
      await api.patch(`/tasks/${step.id}`, { status });
      await onChanged();
    } finally {
      setPending((p) => { const next = { ...p }; delete next[step.id]; return next; });
    }
  }

  return (
    <div className="task-steps">
      {total > 0 && (
        <div className="task-steps-count">
          {done} of {total} step{total === 1 ? '' : 's'} done
        </div>
      )}
      <ul className="task-step-list">
        {steps.map((k) => {
          const due = dueState(k.dueAt, k.status);
          return (
            <li key={k.id} className={`task-step${k.status === 'done' ? ' is-done' : ''}`}>
              <input
                type="checkbox"
                className="task-check"
                checked={k.status === 'done'}
                aria-label={`Mark step ${k.title} done`}
                onChange={(e) => tick(k, e.target.checked)}
              />
              <span className="task-step-title">
                <MentionText body={k.title} mentions={k.mentions} viewerId={viewerId} />
              </span>
              <span className="task-step-meta">
                {k.assigneeName || 'Unassigned'}
                {k.dueAt && (
                  <span className={due ? ` task-due is-${due}` : ' task-due'}>
                    {' · '}{due === 'overdue' ? 'Overdue ' : 'Due '}{dueLabel(k.dueAt)}
                  </span>
                )}
              </span>
              {canWrite && (
                <button
                  className="btn btn-danger btn-sm" type="button"
                  aria-label={`Delete step ${k.title}`}
                  onClick={async () => { await api.del(`/tasks/${k.id}`); await onChanged(); }}
                >×</button>
              )}
            </li>
          );
        })}
      </ul>
      {canWrite && (
        <form className="task-step-add" onSubmit={add}>
          <input
            type="text"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            placeholder="Add a step — @ to name someone"
            aria-label={`Add a step to ${task.title}`}
          />
          <button className="btn btn-secondary btn-sm" type="submit" disabled={!adding.trim() || busy}>
            Add step
          </button>
        </form>
      )}
    </div>
  );
}

export default function TaskList({
  tasks, onChanged, showContext = false, emptyText = 'No tasks yet.', viewerId = null,
  canWrite = false, stages = null, onMoveStage = null,
}) {
  // Ticking a checkbox should feel instant. These controls are fully
  // controlled by server state, so without holding the intended value locally
  // the box springs back until the round-trip lands, which reads as broken.
  const [pending, setPending] = useState({});
  // Above the early return, because hooks are not conditional.
  const [ask, askDialog] = useAsk();

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
  /**
   * Delete, which now has to ask about the steps.
   *
   * The server refuses the first attempt when a task has steps and says how
   * many, because deleting the task deletes them. That refusal arrived after
   * this button was written, so it silently did nothing for exactly the tasks
   * where doing nothing was most confusing — the ones with work underneath.
   *
   * The confirmation IS the count, matching the server: somebody who has typed
   * "3" has read that there were three, which a yes/no dialog does not tell
   * them. Asked only when there is something to lose; a bare task still goes
   * in one press.
   */
  async function remove(id, title) {
    try {
      await api.del(`/tasks/${id}`);
    } catch (err) {
      const steps = err?.data?.steps;
      if (!steps) throw err;
      const typed = await ask({
        title: `Delete “${title}”?`,
        hint: `It has ${steps} step${steps === 1 ? '' : 's'} under it, and they go too. `
          + 'Archive it instead if you might want it back.',
        label: `Type ${steps} to confirm`,
        confirmLabel: 'Delete',
      });
      if (String(typed || '').trim() !== String(steps)) return;
      await api.del(`/tasks/${id}`, { alsoDelete: steps });
    }
    await onChanged();
  }

  /** Put it away: off the list, still findable, back in one press. */
  async function archive(id) {
    await api.post(`/tasks/${id}/archive`);
    await onChanged();
  }

  if (tasks.length === 0) return <div className="empty-state">{emptyText}</div>;

  return (
    <>
    {askDialog}
    <ul className="task-list">
      {tasks.map((raw) => {
        const t = { ...raw, ...(pending[raw.id] || {}) };
        const due = dueState(t.dueAt, t.status);
        // Per row where the server said so, falling back to the list's own
        // flag. My Tasks spans spaces the viewer has different access to; a
        // project or a thread is one room, and passes one answer for all of
        // them.
        const mayWrite = t.canWrite ?? canWrite;
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
              <div className="task-title">
                <MentionText body={t.title} mentions={t.mentions} viewerId={viewerId} />
              </div>
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
                {/* A step read outside its task is a sentence with its subject
                    missing, and My Tasks shows steps flat on purpose. */}
                {t.parentTitle && <>part of “{t.parentTitle}” · </>}
                {t.assigneeName ? `${t.assigneeName}` : 'Unassigned'}
                {t.steps?.total > 0 && (
                  <> · {t.steps.done} of {t.steps.total} steps</>
                )}
                {t.dueAt && (
                  <span className={due ? ` task-due is-${due}` : ' task-due'}>
                    {' · '}{due === 'overdue' ? 'Overdue ' : 'Due '}{dueLabel(t.dueAt)}
                  </span>
                )}
                {/* THE WAY BACK TO THE TALKING. A task is a title, an owner and
                    a date, and it should stay that — but assigning work must
                    not be the moment the discussion of it stops. Whichever door
                    the task came in by, the conversation is one click away, and
                    the thread link lands on the exact line rather than at the
                    foot of a room with a hundred messages in it. */}
                {t.sourceThreadId && (
                  <> · <Link to={`/threads/${t.sourceThreadId}${t.sourceMessageId ? `#m-${t.sourceMessageId}` : ''}`}>
                    carry on the conversation
                  </Link></>
                )}
                {!t.sourceThreadId && t.sourcePadItemId && (
                  <> · <Link to="/pad?show=settled">carry on the conversation</Link></>
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
              {/* Only where a caller hands over the stages — the project screen.
                  My Tasks spans every space at once, and a dropdown of one
                  project's stages beside a task from another would be a way to
                  file work somewhere it does not belong. */}
              {stages && onMoveStage && (
                <select
                  aria-label={`Stage for ${t.title}`}
                  value={t.stageId || ''}
                  onChange={(e) => onMoveStage(t.id, e.target.value || null)}
                  style={{ width: 'auto', fontSize: '0.78rem', padding: '4px 6px' }}
                >
                  <option value="">No stage</option>
                  {stages.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                </select>
              )}
              {/* Archive first, and deliberately to the left of the delete:
                  it is the one that should be reached for, and the one whose
                  cost of being wrong is a single press.
                  Both hidden where the viewer only reads — a select that
                  refuses is a nuisance, a delete that refuses is an offer to
                  destroy something that was never theirs. */}
              {mayWrite && (
                <>
                  <button className="btn btn-sm" type="button"
                    aria-label={`Archive ${t.title}`} onClick={() => archive(t.id)}>Archive</button>
                  <button className="btn btn-danger btn-sm" type="button"
                    aria-label={`Delete ${t.title}`} onClick={() => remove(t.id, t.title)}>×</button>
                </>
              )}
            </div>

            {/* Below the row rather than beside it: the steps belong to this
                task and reading them as a second column of work is exactly the
                confusion that made a five-step task look like five. */}
            {(mayWrite || (t.subtasks || []).length > 0) && (
              <Steps task={t} onChanged={onChanged} viewerId={viewerId} canWrite={mayWrite} />
            )}
          </li>
        );
      })}
    </ul>
    </>
  );
}
