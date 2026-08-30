import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAsk } from '../../components/Ask.jsx';
import AppShell from '../../components/AppShell.jsx';
import { CONTEXT_LABELS } from './SpacesHome.jsx';
import TaskList from './TaskList.jsx';
import { MentionPicker } from '../../components/Mention.jsx';

export const STAGE_STATUS_LABELS = {
  not_started: 'Not started', active: 'Active', blocked: 'Blocked', done: 'Done',
};
const SETTABLE = ['not_started', 'active', 'done'];

export default function ProjectDetail() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [ask, askDialog] = useAsk();
  const [error, setError] = useState('');
  const [stageName, setStageName] = useState('');
  const [stageDue, setStageDue] = useState('');
  const [tasks, setTasks] = useState([]);
  const [taskTitle, setTaskTitle] = useState('');
  // Which stage the next task goes on. Defaulted below to the first stage that
  // is actually being worked on, because "no stage" was the old behaviour and
  // it is the one answer that put the task nowhere.
  const [taskStage, setTaskStage] = useState('');
  const taskRef = useRef(null);

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
      // stageId rather than projectId: the stage names its own project, so
      // sending both is two answers to one question. Sending NEITHER is what
      // this box used to do, which is how tasks added on the screen that shows
      // the stages ended up belonging to none of them.
      await api.post('/tasks', taskStage
        ? { stageId: taskStage, title: taskTitle }
        : { spaceId: data.space.id, projectId, title: taskTitle });
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

  /**
   * Renaming and putting a project away.
   *
   * The API has taken both since projects were built — PATCH accepts a name
   * and a status of active, done or archived — and this screen offered
   * neither, so a project kept the name it was given in a hurry and a finished
   * one sat on the space's list looking live forever. Nothing was refusing it;
   * there was simply no way in.
   *
   * ARCHIVE RATHER THAN DELETE, the same answer as a thread and for the same
   * reason: a project is a spine of decisions somebody may be asked about in a
   * year, and tidying a list is not worth losing it. Reversible in one tap.
   */
  async function rename() {
    const next = window.prompt('What should this project be called?', data.project.name);
    if (next === null || !next.trim() || next.trim() === data.project.name) return;
    await act(() => api.patch(`/projects/${projectId}`, { name: next.trim() }));
  }

  // The dedicated endpoint rather than a status value. status is the state of
  // the work — active, done — and archiving is a decision about the list; the
  // old spelling could not express a project that was both finished and filed.
  const putAway = (on) => act(() => (on
    ? api.post(`/projects/${projectId}/archive`)
    : api.del(`/projects/${projectId}/archive`)));

  /**
   * Deleting a project, which was not reachable at all before.
   *
   * The stages and the tasks go with it; the conversations do not, and the
   * refusal says so. The confirmation IS the count, matching the server —
   * somebody who has typed "5" has read that five things go, which a yes/no
   * dialog does not tell them.
   */
  async function destroy() {
    const { contents } = await api.get(`/projects/${projectId}/deletion`);
    const going = contents.stages + contents.tasks;
    const typed = await ask({
      title: `Delete “${data.project.name}”?`,
      hint: `${contents.stages} stage${contents.stages === 1 ? '' : 's'} and `
        + `${contents.tasks} task${contents.tasks === 1 ? '' : 's'} go with it. `
        + (contents.threads
          ? `${contents.threads} conversation${contents.threads === 1 ? '' : 's'} stay in the space. `
          : '')
        + 'Archive it instead if you might want it back.',
      label: going ? `Type ${going} to confirm` : 'Type DELETE to confirm',
      confirmLabel: 'Delete',
    });
    if (going ? String(typed || '').trim() !== String(going) : String(typed || '').trim() !== 'DELETE') return;
    await api.del(`/projects/${projectId}`, going ? { alsoDelete: going } : {});
    navigate(`/spaces/${data.space.id}`);
  }

  const setStatus = (id, status) => act(() => api.patch(`/projects/stages/${id}`, { status }));
  const move = (id, direction) => act(() => api.post(`/projects/stages/${id}/move`, { direction }));
  const removeStage = (id) => act(() => api.del(`/projects/stages/${id}`));

  if (error && !data) return <div className="spinner-page">{error}</div>;
  if (!data) return <div className="spinner-page">Loading…</div>;

  const { project, space, stages, canWrite, isOwner } = data;
  // Both spellings, for the same reason the space page reads both: a project
  // filed before archived_at existed says so with its status.
  const isFiled = !!project.archivedAt || project.status === 'archived';
  const doneCount = stages.filter((s) => s.status === 'done').length;

  /**
   * The project's work, filed under the stage it belongs to.
   *
   * This screen used to draw the stages in one box and then EVERY task in a
   * second flat one, so nothing on it showed a task belonging to a stage —
   * which is what made a stage look like a thing that stands on its own. It is
   * not: a stage is a phase of the work, and the work is these tasks.
   *
   * The leftovers keep their own heading rather than being hidden or forced
   * onto a stage. Tasks made from a message in the project's own thread have
   * no stage, and pretending otherwise would file somebody's work by guess.
   */
  const byStage = new Map(stages.map((s) => [s.id, []]));
  const unplaced = [];
  for (const t of tasks) {
    if (t.stageId && byStage.has(t.stageId)) byStage.get(t.stageId).push(t);
    else unplaced.push(t);
  }
  const moveStage = (taskId, stageId) => act(() => api.patch(`/tasks/${taskId}`, { stageId }));
  const stagePicker = canWrite ? stages : null;

  return (
    <AppShell
      title={project.name}
      active="spaces"
      actions={(
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="pill">{doneCount} of {stages.length} stages done</span>
          {canWrite && (isFiled ? (
            <button className="btn btn-secondary btn-sm" type="button"
              onClick={() => putAway(false)}>Take out of the archive</button>
          ) : (
            <>
              <button className="btn btn-secondary btn-sm" type="button" onClick={rename}>
                Rename
              </button>
              <button className="btn btn-secondary btn-sm" type="button"
                onClick={() => putAway(true)}>Archive</button>
              {/* Only the owner may destroy it, so only they are shown it —
                  a button that always refuses is worse than no button. */}
              {isOwner && (
                <button className="btn btn-danger btn-sm" type="button" onClick={destroy}>
                  Delete
                </button>
              )}
            </>
          ))}
        </span>
      )}
    >
        <p className="tz-note" style={{ marginBottom: 4 }}>
          <Link to={`/spaces/${space.id}`}>{space.name}</Link>
          {' · '}
          <span className={`ctx-chip ctx-${space.context}`}>{CONTEXT_LABELS[space.context]}</span>
        </p>
        {error && <div className="alert alert-error">{error}</div>}

        {isFiled && (
          <div className="alert" style={{ marginTop: 8 }}>
            This project is archived — it has left the space's live list and everything
            in it is still here to read. Take it out of the archive to carry on.
          </div>
        )}

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

              {/* The stage's own work, under the stage. */}
              <div className="stage-tasks">
                <TaskList
                  tasks={byStage.get(s.id) || []}
                  onChanged={load}
                  canWrite={canWrite}
                  stages={stagePicker}
                  onMoveStage={moveStage}
                  emptyText="Nothing on this stage yet."
                />
              </div>
            </li>
          ))}
        </ol>

        {/* NOT HIDDEN AND NOT GUESSED ONTO A STAGE. A task made from a message
            in the project's thread arrives with no stage, and the honest place
            for it is a heading of its own with the picker right there. */}
        {unplaced.length > 0 && (
          <>
            <h3 style={{ marginTop: 30 }}>Not yet on a stage</h3>
            <TaskList
              tasks={unplaced}
              onChanged={load}
              canWrite={canWrite}
              stages={stagePicker}
              onMoveStage={moveStage}
              emptyText="Nothing waiting to be placed."
            />
          </>
        )}

        <h3 style={{ marginTop: 30 }}>Add a task</h3>
        {canWrite && (
          <form onSubmit={addTask} className="card" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
            <div className="mention-anchor" style={{ flex: 1, minWidth: 200 }}>
              <input
                type="text"
                ref={taskRef}
                placeholder="New task — @ to name someone"
                aria-label="New project task"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                required
                style={{ width: '100%' }}
              />
              <MentionPicker
                spaceId={data.space.id}
                value={taskTitle}
                onChange={setTaskTitle}
                textareaRef={taskRef}
              />
            </div>
            <select
              aria-label="Stage for the new task"
              value={taskStage}
              onChange={(e) => setTaskStage(e.target.value)}
              style={{ width: 'auto' }}
            >
              <option value="">No stage yet</option>
              {stages.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
            </select>
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
    {askDialog}
    </AppShell>
  );
}
