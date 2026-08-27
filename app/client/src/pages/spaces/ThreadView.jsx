import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import SoonButton from '../../components/SoonButton.jsx';
import AppShell from '../../components/AppShell.jsx';
import VoiceRecorder from '../../components/VoiceRecorder.jsx';
import { MentionText, MentionPicker } from '../../components/Mention.jsx';
import { STAGE_STATUS_LABELS } from './ProjectDetail.jsx';
import { useVisiblePoll } from '../../lib/useVisiblePoll.js';
import TaskList from './TaskList.jsx';
import { PersonName } from '../../components/PersonMenu.jsx';
import LineSwitcher from '../../components/LineSwitcher.jsx';

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

/**
 * Put the words on the clipboard.
 *
 * Refused in plenty of ordinary situations — an insecure origin, a browser
 * that wants a fresher gesture — and there is nothing useful to say when it
 * is: the text is on screen and selectable, so a convenience failing is not
 * the task failing.
 */
/**
 * Picking a message by tapping it — anywhere on it.
 *
 * ON THE ROW, NOT THE BUBBLE, for two reasons. A voice note has no bubble at
 * all: its body is empty until somebody transcribes it, so a bubble-only
 * handle would leave recordings — the format most likely to be sent in error
 * from a car — as the one kind of message that could not be picked or taken
 * back. And the bubble already contains buttons, because an @ in it opens a
 * person menu; a button inside a button is invalid and behaves accordingly.
 *
 * Anything already interactive keeps its own click. Tapping a name, a link, an
 * audio control or a verb means that thing, not "select this line".
 */
function pickHandler(id, selected, onSelect) {
  return (e) => {
    if (e.target.closest('button, a, audio, input, textarea, select, label')) return;
    onSelect(selected ? null : id);
  };
}

function copyText(text) {
  try { navigator.clipboard?.writeText(String(text || '')); } catch { /* on screen anyway */ }
}

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
        // null, not undefined. This dropdown IS the decision, so "Unassigned"
        // has to arrive as a decision — the server reads a missing assignee as
        // "nobody said", and would hand the task to whoever an @ left in the
        // title happens to name.
        onCreate({ sourceMessageId: message.id, title, assigneeId: assigneeId || null, dueAt: dueAt || undefined });
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

const TASK_STATE_LABEL = { open: 'Open', doing: 'Doing', blocked: 'Blocked', done: 'Done' };

/**
 * What this line became, shown on the line itself.
 *
 * A task used to be the end of a conversation. You said "book the car", somebody
 * turned it into a task, and from that moment the work lived in a list with a
 * status dropdown and nowhere to speak — while the message it came from sat in
 * the thread looking exactly like every other message, giving no sign that
 * anything had happened to it. Both halves of that were wrong. The task belongs
 * on the line so the room can see the work exists, and Reply below it means the
 * conversation carries on where it started rather than needing somewhere new.
 *
 * NOT A LINK, deliberately. The obvious destination is /tasks, and /tasks is
 * MY tasks — so a chip for work handed to somebody else would lead to a list
 * that does not contain it, which is worse than no link at all. The task's own
 * controls are already on this screen, under "Still to do, from this thread".
 *
 * A FINISHED TASK IS NOT SHOWN AT ALL. It never reaches here — the server stops
 * sending it once it is done, so a room does not accumulate every errand the
 * office has ever closed. It is still on the space's list and in My Tasks.
 */
function TaskChip({ t }) {
  return (
    <span className={`msg-task is-${t.status}`}>
      <span className="msg-task-mark" aria-hidden="true">☑</span>
      <span className="msg-task-title">{t.title}</span>
      <span className="msg-task-state">{TASK_STATE_LABEL[t.status] || t.status}</span>
      {t.assigneeName && <span className="hint"> · {t.assigneeName}</span>}
    </span>
  );
}

/**
 * The line being answered, quoted above the answer.
 *
 * A stub, and deliberately not a second rendering of the message: it carries
 * no actions, no acknowledgements and no recording, because it is a pointer,
 * not a copy. Clicking it goes to the original, which is the only place any of
 * that is true.
 */
function QuotedLine({ q }) {
  return (
    <a className="msg-quote" href={`#m-${q.id}`}>
      <span className="msg-quote-who">{q.authorName}</span>
      <span className="msg-quote-body">
        {q.body || (q.register === 'record' ? 'a record' : 'a voice note')}
      </span>
    </a>
  );
}

/**
 * Fixing what you already said.
 *
 * WHY IT IS OFFERED AT ALL. Everything in this product is written in a hurry,
 * from a car or between meetings, and half of it is instructions somebody will
 * act on: "car at six" typed as "car at nine" is not a typo, it is a driver in
 * the wrong place. The alternative — send a correction underneath — leaves both
 * lines standing and the reader deciding which one is current.
 *
 * WHAT IS NOT EDITABLE, and this is the load-bearing half. Only your own words,
 * and never a record that has been acknowledged: once somebody has agreed to a
 * decision, the way to change it is to supersede it, which leaves both in the
 * history. Editing it out from under them is exactly what the lock exists to
 * stop, and the server refuses it whatever this screen offers.
 *
 * IT SAYS SO. An edited line is marked "· edited" from the first save. A
 * message that can change silently is a message nobody can rely on.
 */
function EditMessage({ m, onSave, onCancel }) {
  const [text, setText] = useState(m.body || '');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="msg-edit"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        // Left open on a refusal — the words are still in the box, which is
        // the whole reason not to close it optimistically.
        try { await onSave(text); } catch { /* said in the banner */ } finally { setBusy(false); }
      }}
    >
      <textarea
        aria-label="Edit this message"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        required
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" type="submit"
          disabled={busy || !text.trim() || text.trim() === (m.body || '').trim()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button className="btn btn-secondary btn-sm" type="button" onClick={onCancel}>
          Never mind
        </button>
      </div>
    </form>
  );
}

function clipLength(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// A recording is fetched only when someone chooses to play it — the audio
// element loads on demand, so opening a thread full of voice notes costs
// nothing until one is played.
function VoiceBubble({ threadId, m }) {
  return (
    <div className="msg-voice">
      <audio
        className="voice-audio"
        controls
        preload="none"
        src={`/api/threads/${threadId}/messages/${m.id}/audio`}
      />
      <span className="hint">Voice note · {clipLength(m.voice.durationMs)}</span>
      <SoonButton feature="transcription" />
    </div>
  );
}

function Note({
  m, threadId, canWrite, members, viewerId,
  onPromote, onMakeTask, onDone, onReply, onEdit, onWithdraw,
  selected, onSelect,
}) {
  const [picking, setPicking] = useState(false);
  const [tasking, setTasking] = useState(false);
  const [editing, setEditing] = useState(false);
  const hasText = !!String(m.body || '').trim();
  // Your own words, and only where there are words: a recording has nothing to
  // retype, and the transcript it does not have yet is a different feature.
  const mine = m.authorId === viewerId && hasText;
  return (
    <div
      className={'msg-note' + (m.doneAt ? ' is-done' : '') + (selected ? ' is-picked' : '')}
      id={`m-${m.id}`}
      onClick={pickHandler(m.id, selected, onSelect)}
    >
      <span className="msg-avatar" aria-hidden="true">{initials(m.authorName)}</span>
      <div style={{ minWidth: 0 }}>
        <div className="msg-who">
          <PersonName userId={m.authorId} name={m.authorName} viewerId={viewerId} />
          {' '}<em>{timeLabel(m.createdAt)}{m.editedAt ? ' · edited' : ''}</em>
        </div>
        {m.replyTo && <QuotedLine q={m.replyTo} />}
        {editing ? (
          <EditMessage
            m={m}
            onCancel={() => setEditing(false)}
            onSave={async (text) => { await onEdit(m.id, text); setEditing(false); }}
          />
        ) : hasText && (
          <div className="msg-bubble">
            <MentionText body={m.body} mentions={m.mentions} viewerId={viewerId} />
          </div>
        )}
        {m.voice && <VoiceBubble threadId={threadId} m={m} />}
        {m.tasks?.map((t) => <TaskChip key={t.id} t={t} />)}
        {/* Both actions turn a message into text somebody else will act on —
            a frozen record, or a task with a title. A recording has neither
            until it is transcribed, so they are not offered rather than
            offered and then refused. */}
        {/* Works on a recording as readily as on text, which is the point:
            "book the car for six" needs no transcription to have been done. */}
        {m.doneAt && (
          <div className="msg-done">
            <span className="msg-done-mark">✓ Done</span>
            <span className="hint">
              by {m.doneByName || 'someone'} · {timeLabel(m.doneAt)}
            </span>
            {canWrite && (
              <button className="msg-promote" type="button" onClick={() => onDone(m.id, false)}>
                Undo
              </button>
            )}
          </div>
        )}

        {/* Reply survives everything else on this row. A line that is done, or
            that has already been turned into a task, is exactly the line
            somebody needs to ask a question about — "which Thursday?", "it
            turned out the car was cancelled" — and hiding the answer button
            behind the message's state is what made a task the end of a
            conversation. */}
        {/* ONLY ON THE MESSAGE YOU PICKED. Five verbs under every line is what
            this used to be, and on a phone it was four cramped buttons beneath
            every sentence somebody had said. Tapping a message is how a person
            says "this one" — the verbs then belong to it, and to nothing else.
            The row is in the same place in the tree either way, so what changed
            is when it is there, not where. */}
        {canWrite && selected && !picking && !tasking && !editing && (
          <div className="msg-actions-row">
            <button className="msg-promote" type="button" onClick={() => onReply(m)}>
              Reply
            </button>
            <button className="msg-promote" type="button"
              onClick={() => copyText(hasText ? m.body : '')}>
              Copy
            </button>
            {mine && (
              <button className="msg-promote" type="button" onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
            {mine && (
              <button className="msg-promote is-danger" type="button"
                onClick={() => onWithdraw(m.id)}>
                Take it back
              </button>
            )}
            {!m.doneAt && (
              <>
                <button className="msg-promote" type="button" onClick={() => onDone(m.id, true)}>
                  Mark done
                </button>
                {hasText && (
                  <>
                    <button className="msg-promote" type="button" onClick={() => setPicking(true)}>
                      Promote to record
                    </button>
                    <button className="msg-promote" type="button" onClick={() => setTasking(true)}>
                      Make a task
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        )}
        {canWrite && !hasText && m.voice && !m.doneAt && (
          <p className="hint msg-voice-hint">
            Marking it done needs nothing written. Write out what was said only to
            file it as a record or turn it into a task.
          </p>
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

function Record({ m, viewerId, canWrite, onAck, onStatus, onSupersede, onReply, onEdit, selected, onSelect }) {
  const [superseding, setSuperseding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [replacement, setReplacement] = useState('');
  const [replacementType, setReplacementType] = useState(m.recordType);
  const hasAcked = m.acks.some((a) => a.userId === viewerId);
  const isSuperseded = m.recordStatus === 'superseded';
  const isBlocker = m.recordType === 'blocker';

  return (
    <div
      className={'msg-record' + (isSuperseded ? ' is-superseded' : '') + (selected ? ' is-picked' : '')}
      id={`m-${m.id}`}
      onClick={pickHandler(m.id, selected, onSelect)}
    >
      <div className="msg-record-head">
        <span className="msg-badge">{TYPE_LABEL[m.recordType] || m.recordType}</span>
        <span className={'msg-badge status-' + m.recordStatus}>{STATUS_LABEL[m.recordStatus]}</span>
        <span className="msg-seq">R-{String(m.recordSeq).padStart(2, '0')}</span>
        {m.locked && <span className="msg-seq" title="Acknowledged — body is frozen">🔒 locked</span>}
      </div>

      {m.replyTo && <QuotedLine q={m.replyTo} />}
      {editing ? (
        <EditMessage
          m={m}
          onCancel={() => setEditing(false)}
          onSave={async (text) => { await onEdit(m.id, text); setEditing(false); }}
        />
      ) : (
        <div className="msg-record-body">
          <MentionText body={m.body} mentions={m.mentions} viewerId={viewerId} />
        </div>
      )}
      {m.tasks?.map((t) => <TaskChip key={t.id} t={t} />)}

      <div className="msg-record-foot">
        {m.promotedFromId && (
          <span className="msg-promoted">
            ⤴ promoted from a note by{' '}
            <PersonName userId={m.authorId} name={m.authorName} viewerId={viewerId} />
          </span>
        )}
        {!m.promotedFromId && (
          <span>by <PersonName userId={m.authorId} name={m.authorName} viewerId={viewerId} /></span>
        )}
        {m.promotedByName && <> · filed by {m.promotedByName}</>}
        {' · '}{timeLabel(m.createdAt)}
        {m.acks.length > 0 && <> · acknowledged by {m.acks.map((a) => a.name).join(', ')}</>}
      </div>

      {/* THE FROZEN THING STILL HAS TO BE ANSWERABLE. A record's body locks on
          first acknowledgement and that is the point — but "which Thursday?"
          is not an amendment, and making somebody supersede a decision in
          order to ask a question about it would be absurd. So Reply sits
          outside every gate on this row, including the superseded one: why a
          record was replaced is worth saying underneath it. */}
      {canWrite && selected && (
        <div className="msg-record-actions">
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => onReply(m)}>
            Reply
          </button>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => copyText(m.body)}>
            Copy
          </button>
          {/* A record can be corrected right up until somebody acknowledges
              it, and not one moment after. Before the lock it is a draft
              nobody has agreed to; after it, the honest way to change it is
              Supersede, which leaves both in the history. */}
          {m.authorId === viewerId && !m.locked && !isSuperseded && (
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => setEditing((e) => !e)}>
              {editing ? 'Never mind' : 'Edit'}
            </button>
          )}
          {!isSuperseded && !hasAcked && (
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
          {!isSuperseded && (
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => setSuperseding((s) => !s)}>
              Supersede
            </button>
          )}
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
  const navigate = useNavigate();
  const { hash } = useLocation();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [body, setBody] = useState('');
  const [register, setRegister] = useState('note');
  const [recordType, setRecordType] = useState('decision');
  const [view, setView] = useState('all');
  const [sending, setSending] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState([]);
  // The message the next thing said will be pinned to, if any. Held here
  // rather than on the message, because there is one composer and it can only
  // be answering one thing at a time.
  const [replyTo, setReplyTo] = useState(null);
  // WHICH MESSAGE THE VERBS BELONG TO. One at a time: two messages with their
  // actions open is two ways to press the wrong Take it back.
  const [picked, setPicked] = useState(null);
  const endRef = useRef(null);
  const composerRef = useRef(null);
  // When this room last had anything happen in it, which is what sets how
  // often it asks for more. See `beat` below.
  const lastSaidRef = useRef(0);

  function load() {
    return api.get(`/threads/${threadId}/messages`).then((d) => {
      setData(d);
      // Space membership drives the assignee list — you can only hand work to
      // someone who can already see where it lives.
      api.get(`/spaces/${d.thread.spaceId}`)
        .then((s) => setMembers([{ id: s.owner.id, name: s.owner.name }, ...s.members.map((m) => ({ id: m.userId, name: m.name }))]))
        .catch(() => {});
      // Live work only, matching the chips on the messages themselves — a
      // finished task leaves the conversation and lives on in My Tasks and on
      // the space's list, which is where a completed thing belongs.
      api.get(`/tasks?spaceId=${d.thread.spaceId}`)
        .then((r) => setTasks(r.tasks.filter(
          (t) => t.sourceThreadId === threadId && t.status !== 'done',
        )))
        .catch(() => {});
    }).catch((err) => setError(err.message));
  }

  /**
   * Just the messages, for asking again while somebody sits here reading.
   *
   * Separate from load() deliberately: that also refetches the space's members
   * and the thread's tasks, which is three requests to answer a question that
   * only needs one. Polling the heavy one every few seconds would be three
   * times the traffic for no more truth.
   *
   * Errors are swallowed here and nowhere else. A refresh that fails is a
   * refresh — the next one is seconds away — and turning a dropped packet into
   * a red banner across a conversation somebody is reading would be worse than
   * the momentary staleness it reports.
   */
  const refresh = useCallback(() => {
    api.get(`/threads/${threadId}/messages`)
      .then((d) => setData((was) => (was ? { ...was, messages: d.messages } : d)))
      .catch(() => {});
  }, [threadId]);

  /**
   * Leave the old room before entering the new one.
   *
   * The switcher made this matter. Until it existed you arrived at a thread by
   * loading the page, so there was never a previous room's state to inherit;
   * now one tap changes the id under a mounted component, and React keeps
   * everything until the fetch comes back. For the length of that request the
   * screen showed the office room's messages beneath the private line's
   * header — the exact confusion a pair room exists to prevent, and on a slow
   * connection not brief.
   *
   * The half-written message goes too. It was addressed to whoever you were
   * talking to, and carrying it into a room full of other people is one
   * absent-minded Enter away from being the leak itself.
   */
  useEffect(() => {
    setData(null); setMembers([]); setTasks([]);
    setError(''); setReplyTo(null); setPicked(null); setBody('');
    // Arriving counts as activity. Somebody who has just opened a room is
    // present and looking, whatever the room's history — seeding this from the
    // age of the last message instead would leave a quiet room on its slowest
    // rhythm at precisely the moment a person is sitting in front of it.
    lastSaidRef.current = Date.now();
    load();
  }, [threadId]);
  // Escape puts a message down. Nothing else on this screen claims the key,
  // and a selection you cannot clear without hunting for the same words again
  // is a selection people leave on.
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') setPicked(null); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  /**
   * How often to ask, decided by whether anybody is actually talking.
   *
   * This was every twelve seconds, flat, and twelve seconds is the wrong
   * number twice over. Waiting that long for a reply that has already been
   * sent reads as the app being broken — people reload, which is the report
   * that started this. And twelve seconds is far too eager for a room nobody
   * has spoken in since Tuesday, on a phone, all day.
   *
   * So the interval follows the conversation: while something was said in the
   * last two minutes it asks every two seconds, and it lengthens from there as
   * the room goes quiet, out to half a minute. Somebody mid-exchange gets an
   * answer that lands like an answer; a room at rest costs almost nothing.
   */
  const beat = useCallback(() => {
    const quietFor = Date.now() - lastSaidRef.current;
    if (quietFor < 2 * 60 * 1000) return 2000;
    if (quietFor < 10 * 60 * 1000) return 6000;
    return 30000;
  }, []);
  useVisiblePoll(refresh, beat);

  /**
   * Arriving without stealing the reader's place.
   *
   * The old rule was: scroll to the end whenever the message count changes.
   * That is right while you are at the foot of a conversation and wrong the
   * moment you are not — somebody reading back through last Tuesday gets
   * yanked to the bottom because a colleague said "ok" — and the more traffic
   * a room has, the more often it happens. So: at the bottom, follow along.
   * Away from it, stay exactly where you are and say what arrived.
   */
  const atBottom = useRef(true);
  const [behind, setBehind] = useState(0);
  const count = data?.messages.length || 0;
  const lastCount = useRef(0);

  useEffect(() => {
    const el = document.scrollingElement || document.documentElement;
    const check = () => {
      atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      if (atBottom.current) setBehind(0);
    };
    check();
    window.addEventListener('scroll', check, { passive: true });
    return () => window.removeEventListener('scroll', check);
  }, []);

  /**
   * Arriving at one particular line, from somewhere else.
   *
   * A task links back to the message it came from, and a reply quotes the line
   * it answers — both land here with #m-<id> on the URL. The element does not
   * exist at mount, so the browser's own hash handling finds nothing and the
   * reader is dropped at the foot of the conversation instead. Handled once the
   * messages are in, and remembered in a ref so the follow-along effect below
   * does not immediately pull them back down to the end.
   */
  const wantedAnchor = useRef(false);
  useEffect(() => {
    const id = hash?.startsWith('#m-') ? hash.slice(1) : null;
    if (!id || !data) return;
    const el = document.getElementById(id);
    if (!el) return;
    wantedAnchor.current = true;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('is-pointed-at');
    const t = setTimeout(() => el.classList.remove('is-pointed-at'), 2000);
    return () => clearTimeout(t);
  }, [hash, data?.messages.length]);

  useEffect(() => {
    const grew = count - lastCount.current;
    lastCount.current = count;
    if (grew <= 0) return;
    // Anything arriving — theirs or your own — puts the room back on its
    // quickest rhythm. One place, so the cadence cannot disagree with what is
    // on screen. See `beat` above.
    lastSaidRef.current = Date.now();
    if (wantedAnchor.current) { wantedAnchor.current = false; return; }
    if (atBottom.current) {
      endRef.current?.scrollIntoView({ block: 'nearest' });
    } else {
      setBehind((b) => b + grew);
    }
  }, [count]);

  function catchUp() {
    setBehind(0);
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function send(e) {
    e.preventDefault();
    setError('');
    setSending(true);
    try {
      await api.post(`/threads/${threadId}/messages`, {
        body,
        register,
        recordType: register === 'record' ? recordType : undefined,
        replyToId: replyTo?.id,
      });
      setBody('');
      setReplyTo(null);
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
  // Fixing what you already said. The server decides whether it is allowed —
  // your own words, and not a record somebody has acknowledged — so a refusal
  // arrives as prose in the banner rather than being second-guessed here.
  // Not through act(): that swallows the failure, which would close the edit
  // box over the top of somebody's typing and leave them re-writing it from
  // memory. Rethrown so the box stays open with the words still in it.
  async function editMessage(id, body) {
    setError('');
    try {
      await api.patch(`/threads/${threadId}/messages/${id}`, { body });
      load();
    } catch (err) { setError(err.message); throw err; }
  }

  /**
   * Answer this one.
   *
   * Drops the register back to Note, deliberately. A reply to a record is
   * almost never itself a record — "which Thursday?" is a question, not a
   * decision — and leaving the composer set to Record would file the question
   * as R-08 in the formal history of the project.
   */
  function startReply(m) {
    setReplyTo({
      id: m.id,
      authorName: m.authorName,
      register: m.register,
      body: String(m.body || '').trim() || null,
    });
    setRegister('note');
    composerRef.current?.focus();
  }
  // Carried out, or not after all. Deliberately lighter than a task: an
  // instruction worth thirty seconds should cost about that to close.
  const markDone = (id, done) => act(() => (done
    ? api.post(`/threads/${threadId}/messages/${id}/done`)
    : api.del(`/threads/${threadId}/messages/${id}/done`)));

  /**
   * Taking a message back.
   *
   * Confirmed first, because it cannot be undone and the words are gone from
   * the row rather than hidden — see routes/threads.js. What remains is that
   * somebody said something and thought better of it, which is the honest
   * state of the room and the reason this is not called Delete.
   */
  async function withdraw(id) {
    if (!window.confirm('Take this message back? The words go; that you said something stays.')) return;
    setError('');
    try {
      await api.del(`/threads/${threadId}/messages/${id}`);
      setPicked(null);
      load();
    } catch (err) { setError(err.message); }
  }

  if (error && !data) return <div className="spinner-page">{error}</div>;
  if (!data) return <div className="spinner-page">Loading…</div>;

  const shown = view === 'records'
    ? data.messages.filter((m) => m.register === 'record')
    : data.messages;

  return (
    <AppShell
      title={data.thread.name}
      active="spaces"
      actions={
        <div className="register-toggle" role="group" aria-label="Which messages to show">
          <button type="button" className={view === 'all' ? 'is-on' : ''} onClick={() => setView('all')}>
            Everything
          </button>
          <button type="button" className={view === 'records' ? 'is-on' : ''} onClick={() => setView('records')}>
            Records only
          </button>
        </div>
      }
    >
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
        {error && <div className="alert alert-error">{error}</div>}

        <p className="tz-note" style={{ marginBottom: 14 }}>
          {view === 'records'
            ? 'The formal record for this thread — what was decided, approved, and signed off.'
            : 'Chat freely. When something is actually decided, promote it to a record so it counts.'}
        </p>

        <LineSwitcher threadId={threadId} />

        <div className="msg-stream">
          {shown.length === 0 && (
            <div className="empty-state">
              {view === 'records' ? 'Nothing formal recorded yet.' : 'No messages yet — say something.'}
            </div>
          )}
          {shown.map((m) => (
            m.register === 'record'
              ? <Record key={m.id} m={m} viewerId={data.viewerId} canWrite={data.canWrite}
                  onAck={ack} onStatus={setStatus} onSupersede={supersede} onReply={startReply}
                  onEdit={editMessage} selected={picked === m.id} onSelect={setPicked} />
              : <Note key={m.id} m={m} threadId={threadId} canWrite={data.canWrite} members={members}
                  viewerId={data.viewerId} onPromote={promote} onMakeTask={makeTask}
                  onDone={markDone} onReply={startReply} onEdit={editMessage}
                  onWithdraw={withdraw} selected={picked === m.id} onSelect={setPicked} />
          ))}
          <div ref={endRef} />
          {/* Said rather than done. Somebody reading back through last Tuesday
              keeps their place, and finds out what landed when they look up. */}
          {behind > 0 && (
            <button className="thread-behind" type="button" onClick={catchUp}>
              {behind === 1 ? '1 new message' : `${behind} new messages`} ↓
            </button>
          )}
        </div>

        {tasks.length > 0 && view === 'all' && (
          <>
            <h3 style={{ marginTop: 8 }}>Still to do, from this thread</h3>
            <TaskList tasks={tasks} onChanged={load} viewerId={data.viewerId}
              canWrite={data.canWrite} />
          </>
        )}

        {data.canWrite && (
          <form className="msg-compose" onSubmit={send}>
            {/* What the next thing said will be pinned to, and a way out of
                it. Shown rather than implied: a reply that silently attaches
                itself to something the writer has forgotten about is worse
                than no anchor at all. */}
            {replyTo && (
              <div className="msg-replying">
                <span className="hint">Replying to <strong>{replyTo.authorName}</strong></span>
                <span className="msg-replying-body">
                  {replyTo.body || (replyTo.register === 'record' ? 'a record' : 'a voice note')}
                </span>
                <button className="msg-promote" type="button" onClick={() => setReplyTo(null)}>
                  Not a reply
                </button>
              </div>
            )}
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

            {/* The picker sits in a positioned wrapper so it can open above
                the box without pushing the send button down the page. */}
            <div className="mention-anchor">
              <textarea
                ref={composerRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                aria-label="Message"
                placeholder={register === 'record'
                  ? 'State it plainly — this becomes part of the formal record.'
                  : 'Write a message… @ to name someone'}
                required
              />
              <MentionPicker
                spaceId={data.thread.spaceId}
                value={body}
                onChange={setBody}
                textareaRef={composerRef}
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={sending}>
              {sending ? 'Sending…' : register === 'record' ? 'File record' : 'Send'}
            </button>
          </form>
        )}

        {/* Only alongside notes. A record is a frozen line of text that people
            acknowledge and later cite, and a recording cannot be that until
            somebody has written down what it says. */}
        {data.canWrite && register === 'note' && (
          data.voice?.available
            ? (
              <VoiceRecorder
                threadId={threadId}
                maxSeconds={data.voice.maxSeconds}
                retentionDays={data.voice.retentionDays}
                replyToId={replyTo?.id || null}
                onSent={() => { setReplyTo(null); load(); }}
              />
            )
            : <p className="hint voice-unavailable">{data.voice?.unavailableReason}</p>
        )}
    </AppShell>
  );
}
