import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import { STAGE_STATUS_LABELS } from './ProjectDetail.jsx';
import TaskList from './TaskList.jsx';

const RECORD_TYPES = [
  { value: 'decision', label: 'Decision' },
  { value: 'approval', label: 'Approval' },
  { value: 'request', label: 'Request' },
  { value: 'update', label: 'Update' },
  { value: 'sign_off', label: 'Sign-off' },
  { value: 'blocker', label: 'Blocker' },
];
const TYPE_LABEL = Object.fromEntries(RECORD_TYPES.map((t) => [t.value, t.label]));
const STATUS_LABEL = {
  open: 'Awaiting', accepted: 'Accepted', declined: 'Declined',
  resolved: 'Resolved', superseded: 'Superseded',
};

function initials(name) {
  return (name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

function timeLabel(iso) {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Turning a message into a task is the same one-click gesture as promoting it
// to a record, and for the same reason: the thing you need to do next almost
// always gets said in passing, and retyping it elsewhere is where it gets lost.
function TaskMaker({ message, members, viewerId, onCreate, onCancel }) {
  const [title, setTitle] = useState(message.body.slice(0, 120));
  // Default to yourself. Noting a task off the back of a message almost always
  // means "I'll handle this" — and leaving it unassigned drops it out of My
  // Tasks entirely, which is the one list the person is actually going to look
  // at. Reassigning is one dropdown away.
  const [assigneeId, setAssigneeId] = useState(viewerId || '');
  const [dueAt, setDueAt] = useState('');

  return (
    <form
      className="msg-task-form"
      onSubmit={(e) => {
        e.preventDefault();
        onCreate({ sourceMessageId: message.id, title, assigneeId: assigneeId || undefined, dueAt: dueAt || undefined });
      }}
    >
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Task title"
        required
        style={{ flex: 1, minWidth: 180 }}
      />
      <select aria-label="Assign to" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} style={{ width: 'auto' }}>
        <option value="">Unassigned</option>
        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      <input type="date" aria-label="Task due date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} style={{ width: 'auto' }} />
      <button className="btn btn-primary btn-sm" type="submit">Create task</button>
      <button className="btn btn-danger btn-sm" type="button" onClick={onCancel}>Cancel</button>
    </form>
  );
}

function Note({ m, canWrite, members, viewerId, onPromote, onMakeTask }) {
  const [picking, setPicking] = useState(false);
  const [tasking, setTasking] = useState(false);
  return (
    <div className="msg-note">
      <span className="msg-avatar" aria-hidden="true">{initials(m.authorName)}</span>
      <div style={{ minWidth: 0 }}>
        <div className="msg-who">{m.authorName} <em>{timeLabel(m.createdAt)}{m.editedAt ? ' · edited' : ''}</em></div>
        <div className="msg-bubble">{m.body}</div>
        {canWrite && !picking && !tasking && (
          <div className="msg-actions-row">
            <button className="msg-promote" type="button" onClick={() => setPicking(true)}>
              Promote to record
            </button>
            <button className="msg-promote" type="button" onClick={() => setTasking(true)}>
              Make a task
            </button>
          </div>
        )}
        {picking && (
          <div className="msg-promote-picker">
            <span className="hint" style={{ marginRight: 4 }}>Record as:</span>
            {RECORD_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => { setPicking(false); onPromote(m.id, t.value); }}
              >
                {t.label}
              </button>
            ))}
            <button type="button" className="btn btn-danger btn-sm" onClick={() => setPicking(false)}>Cancel</button>
          </div>
        )}
        {tasking && (
          <TaskMaker
            message={m}
            members={members}
            viewerId={viewerId}
            onCancel={() => setTasking(false)}
            onCreate={(payload) => { setTasking(false); onMakeTask(payload); }}
          />
        )}
      </div>
    </div>
  );
}

function Record({ m, viewerId, canWrite, onAck, onStatus, onSupersede }) {
  const [superseding, setSuperseding] = useState(false);
  const [replacement, setReplacement] = useState('');
  const [replacementType, setReplacementType] = useState(m.recordType);
  const hasAcked = m.acks.some((a) => a.userId === viewerId);
  const isSuperseded = m.recordStatus === 'superseded';
  const isBlocker = m.recordType === 'blocker';

  return (
    <div className={'msg-record' + (isSuperseded ? ' is-superseded' : '')}>
      <div className="msg-record-head">
        <span className="msg-badge">{TYPE_LABEL[m.recordType] || m.recordType}</span>
        <span className={'msg-badge status-' + m.recordStatus}>{STATUS_LABEL[m.recordStatus]}</span>
        <span className="msg-seq">R-{String(m.recordSeq).padStart(2, '0')}</span>
        {m.locked && <span className="msg-seq" title="Acknowledged — body is frozen">🔒 locked</span>}
      </div>

      <div className="msg-record-body">{m.body}</div>

      <div className="msg-record-foot">
        {m.promotedFromId && (
          <span className="msg-promoted">⤴ promoted from a note by {m.authorName}</span>
        )}
        {!m.promotedFromId && <span>by {m.authorName}</span>}
        {m.promotedByName && <> · filed by {m.promotedByName}</>}
        {' · '}{timeLabel(m.createdAt)}
        {m.acks.length > 0 && <> · acknowledged by {m.acks.map((a) => a.name).join(', ')}</>}
      </div>

      {canWrite && !isSuperseded && (
        <div className="msg-record-actions">
          {!hasAcked && (
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => onAck(m.id)}>
              Acknowledge
            </button>
          )}
          {m.recordStatus === 'open' && (isBlocker ? (
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => onStatus(m.id, 'resolved')}>
              Resolve blocker
            </button>
          ) : (
            <>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => onStatus(m.id, 'accepted')}>Accept</button>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => onStatus(m.id, 'declined')}>Decline</button>
            </>
          ))}
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => setSuperseding((s) => !s)}>
            Supersede
          </button>
        </div>
      )}

      {superseding && (
        <form
          className="msg-supersede"
          onSubmit={(e) => {
            e.preventDefault();
            onSupersede(m.id, replacement, replacementType);
            setReplacement('');
            setSuperseding(false);
          }}
        >
          <textarea
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder="What replaces this record?"
            aria-label="Replacement record"
            required
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="hint" htmlFor={`sup-type-${m.id}`}>Replacement is a</label>
            <select
              id={`sup-type-${m.id}`}
              aria-label="Replacement record type"
              value={replacementType}
              onChange={(e) => setReplacementType(e.target.value)}
              style={{ width: 'auto' }}
            >
              {RECORD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <button className="btn btn-primary btn-sm" type="submit">File replacement</button>
          </div>
          {isBlocker && replacementType === 'blocker' && (
            <p className="hint" style={{ margin: 0 }}>
              Replacing a Blocker with another Blocker restates it — the stage stays blocked. Choose
              Update to lift it.
            </p>
          )}
        </form>
      )}
    </div>
  );
}

export default function ThreadView() {
  const { threadId } = useParams();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [body, setBody] = useState('');
  const [register, setRegister] = useState('note');
  const [recordType, setRecordType] = useState('decision');
  const [view, setView] = useState('all');
  const [sending, setSending] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const endRef = useRef(null);

  function load() {
    return api.get(`/threads/${threadId}/messages`).then((d) => {
      setData(d);
      // Space membership drives the assignee list — you can only hand work to
      // someone who can already see where it lives.
      api.get(`/spaces/${d.thread.spaceId}`)
        .then((s) => setMembers([{ id: s.owner.id, name: s.owner.name }, ...s.members.map((m) => ({ id: m.userId, name: m.name }))]))
        .catch(() => {});
      api.get(`/tasks?spaceId=${d.thread.spaceId}`)
        .then((r) => setTasks(r.tasks.filter((t) => t.sourceThreadId === threadId)))
        .catch(() => {});
    }).catch((err) => setError(err.message));
  }
  useEffect(() => { load(); }, [threadId]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [data?.messages.length]);

  async function send(e) {
    e.preventDefault();
    setError('');
    setSending(true);
    try {
      await api.post(`/threads/${threadId}/messages`, {
        body, register, recordType: register === 'record' ? recordType : undefined,
      });
      setBody('');
      load();
    } catch (err) { setError(err.message); } finally { setSending(false); }
  }

  async function act(fn) {
    setError('');
    try { await fn(); load(); } catch (err) { setError(err.message); }
  }

  const promote = (id, type) => act(() => api.post(`/threads/${threadId}/messages/${id}/promote`, { recordType: type }));
  const ack = (id) => act(() => api.post(`/threads/${threadId}/messages/${id}/ack`));
  const setStatus = (id, status) => act(() => api.post(`/threads/${threadId}/messages/${id}/status`, { status }));
  const supersede = (id, replacementBody, replacementType) => act(() =>
    api.post(`/threads/${threadId}/messages/${id}/supersede`, { body: replacementBody, recordType: replacementType }));
  const makeTask = (payload) => act(() => api.post('/tasks', payload));

  async function handleLogout() { await logout(); navigate('/login'); }

  if (error && !data) return <div className="spinner-page">{error}</div>;
  if (!data) return <div className="spinner-page">Loading…</div>;

  const shown = view === 'records'
    ? data.messages.filter((m) => m.register === 'record')
    : data.messages;

  return (
    <div className="shell">
      <div className="topbar">
        <span className="topbar-brand">Kairos — Spaces</span>
        <div className="topbar-actions">
          <Link to={`/spaces/${data.thread.spaceId}`} className="btn btn-secondary btn-sm">Back to space</Link>
          <span>{user.name}</span>
          <button className="btn btn-secondary btn-sm" type="button" onClick={handleLogout}>Log out</button>
        </div>
      </div>

      <div className="page">
        {data.stage && (
          <p className="tz-note" style={{ marginBottom: 4 }}>
            <Link to={`/projects/${data.stage.projectId}`}>{data.stage.projectName}</Link>
            {' › '}{data.stage.name}
            {' '}
            <span className={`stage-badge is-${data.stage.status}`}>
              {STAGE_STATUS_LABELS[data.stage.status]}
            </span>
          </p>
        )}
        <div className="page-header">
          <h1>{data.thread.name}</h1>
          <div className="register-toggle" role="group" aria-label="Which messages to show">
            <button
              type="button"
              className={view === 'all' ? 'is-on' : ''}
              onClick={() => setView('all')}
            >
              Everything
            </button>
            <button
              type="button"
              className={view === 'records' ? 'is-on' : ''}
              onClick={() => setView('records')}
            >
              Records only
            </button>
          </div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <p className="tz-note" style={{ marginBottom: 14 }}>
          {view === 'records'
            ? 'The formal record for this thread — what was decided, approved, and signed off.'
            : 'Chat freely. When something is actually decided, promote it to a record so it counts.'}
        </p>

        <div className="msg-stream">
          {shown.length === 0 && (
            <div className="empty-state">
              {view === 'records' ? 'Nothing formal recorded yet.' : 'No messages yet — say something.'}
            </div>
          )}
          {shown.map((m) => (
            m.register === 'record'
              ? <Record key={m.id} m={m} viewerId={data.viewerId} canWrite={data.canWrite}
                  onAck={ack} onStatus={setStatus} onSupersede={supersede} />
              : <Note key={m.id} m={m} canWrite={data.canWrite} members={members}
                  viewerId={data.viewerId} onPromote={promote} onMakeTask={makeTask} />
          ))}
          <div ref={endRef} />
        </div>

        {tasks.length > 0 && view === 'all' && (
          <>
            <h3 style={{ marginTop: 8 }}>Tasks from this thread</h3>
            <TaskList tasks={tasks} onChanged={load} />
          </>
        )}

        {data.canWrite && (
          <form className="msg-compose" onSubmit={send}>
            <div className="register-toggle" role="group" aria-label="Message register">
              <button type="button" className={register === 'note' ? 'is-on' : ''} onClick={() => setRegister('note')}>
                Note
              </button>
              <button type="button" className={register === 'record' ? 'is-on' : ''} onClick={() => setRegister('record')}>
                Record
              </button>
            </div>

            {register === 'record' && (
              <select
                aria-label="Record type"
                value={recordType}
                onChange={(e) => setRecordType(e.target.value)}
                style={{ width: 'auto' }}
              >
                {RECORD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            )}

            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              aria-label="Message"
              placeholder={register === 'record'
                ? 'State it plainly — this becomes part of the formal record.'
                : 'Write a message…'}
              required
            />
            <button className="btn btn-primary" type="submit" disabled={sending}>
              {sending ? 'Sending…' : register === 'record' ? 'File record' : 'Send'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
