import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';

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
  open: 'Awaiting', accepted: 'Accepted', declined: 'Declined', superseded: 'Superseded',
};

function initials(name) {
  return (name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

function timeLabel(iso) {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Note({ m, canWrite, onPromote }) {
  const [picking, setPicking] = useState(false);
  return (
    <div className="msg-note">
      <span className="msg-avatar" aria-hidden="true">{initials(m.authorName)}</span>
      <div style={{ minWidth: 0 }}>
        <div className="msg-who">{m.authorName} <em>{timeLabel(m.createdAt)}{m.editedAt ? ' · edited' : ''}</em></div>
        <div className="msg-bubble">{m.body}</div>
        {canWrite && !picking && (
          <button className="msg-promote" type="button" onClick={() => setPicking(true)}>
            Promote to record
          </button>
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
      </div>
    </div>
  );
}

function Record({ m, viewerId, canWrite, onAck, onStatus, onSupersede }) {
  const [superseding, setSuperseding] = useState(false);
  const [replacement, setReplacement] = useState('');
  const hasAcked = m.acks.some((a) => a.userId === viewerId);
  const isSuperseded = m.recordStatus === 'superseded';

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
          {m.recordStatus === 'open' && (
            <>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => onStatus(m.id, 'accepted')}>Accept</button>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => onStatus(m.id, 'declined')}>Decline</button>
            </>
          )}
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
            onSupersede(m.id, replacement);
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
          <button className="btn btn-primary btn-sm" type="submit">File replacement</button>
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
  const endRef = useRef(null);

  function load() {
    api.get(`/threads/${threadId}/messages`).then(setData).catch((err) => setError(err.message));
  }
  useEffect(load, [threadId]);
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
  const supersede = (id, replacementBody) => act(() => api.post(`/threads/${threadId}/messages/${id}/supersede`, { body: replacementBody }));

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
              : <Note key={m.id} m={m} canWrite={data.canWrite} onPromote={promote} />
          ))}
          <div ref={endRef} />
        </div>

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
