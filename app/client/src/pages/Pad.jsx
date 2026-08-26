import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import AppShell, { resolveActivePrincipal } from '../components/AppShell.jsx';
import { MentionText, MentionPicker } from '../components/Mention.jsx';
import { useAuth } from '../lib/AuthContext.jsx';
import { dayLabelInZone } from '../lib/timezones.js';

/**
 * The pad.
 *
 * One field at the top and nothing in the way of it. Everything else on this
 * screen is what happens to a line AFTER it exists, and none of it is asked
 * for at the moment of writing — that is the whole design. A thought arrives
 * walking out of a meeting; if capturing it costs a form, it is not captured.
 *
 * Private by default, and the toggle says so in words rather than an icon.
 * Somebody writing "ask about the school fees" needs to know at a glance who
 * can read it, and a padlock glyph is not an answer to that question.
 */

// "Come back to it" in the words somebody would actually use, rather than
// making them operate a date picker to mean "tomorrow".
const LATER = [
  { id: 'tomorrow', label: 'Tomorrow', at: () => atHour(1, 9) },
  { id: 'week', label: 'Next week', at: () => atHour(7, 9) },
  { id: 'month', label: 'In a month', at: () => atHour(30, 9) },
];
function atHour(daysAhead, hour) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

/**
 * Back to whatever the line was written against.
 *
 * The owner comes from the APPOINTMENT, resolved server-side, not from the
 * note. Those are different people whenever an assistant writes it — a private
 * line sits on its author's pad — and using the note's owner built a link to
 * /appointments/<the assistant>/<booking>, which finds nothing. A note that
 * opens no page is worse than a note with no link, because it looks broken
 * rather than plain.
 */
function AboutLink({ about }) {
  if (!about) return null;
  if (about.kind === 'booking') {
    // No owner means the appointment is gone. Say what the line was about and
    // offer nothing to click, rather than a link that leads to a refusal.
    if (!about.ownerId) return <span className="pad-about">on an appointment since removed</span>;
    return (
      <Link className="pad-about" to={`/appointments/${about.ownerId}/${about.id}`}>
        on an appointment
      </Link>
    );
  }
  if (about.kind === 'itinerary') return <span className="pad-about">on the itinerary</span>;
  return <span className="pad-about">about a contact</span>;
}

export default function Pad() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [items, setItems] = useState(null);
  // A line that became a task or went to the team is settled, and settled lines
  // live behind a tab. Anything linking here BECAUSE of what a line became — a
  // task pointing back at the conversation it came out of — has to land on that
  // tab, or it lands on a screen that appears not to contain the thing it
  // promised. The link says which; the tab is still a tab.
  const [showDone, setShowDone] = useState(params.get('show') === 'settled');
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ownerId, setOwnerId] = useState(null);
  const [openMenu, setOpenMenu] = useState(null);
  const boxRef = useRef(null);

  function load(done = showDone) {
    return api.get(`/pad?state=${done ? 'done' : 'open'}`)
      .then((d) => setItems(d.items))
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    resolveActivePrincipal(user).then((id) => setOwnerId(id || user?.id || null));
  }, [user?.id]);
  useEffect(() => { load(); }, [showDone]);

  async function write(e) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/pad', { body, visibility, ownerId });
      setBody('');
      // Deliberately does not reset the register. Somebody adding three things
      // to the office pad should not have to say so three times.
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function change(id, patch) {
    setError('');
    try {
      await api.patch(`/pad/${id}`, patch);
      setOpenMenu(null);
      await load();
    } catch (err) { setError(err.message); }
  }

  async function remove(id) {
    setError('');
    try {
      await api.del(`/pad/${id}`);
      await load();
    } catch (err) { setError(err.message); }
  }

  const list = items || [];
  // Three bands, in the order somebody would work through them: what another
  // person is held up by, then what you asked to see again, then the rest.
  const answering = list.filter((i) => i.yoursToAnswer);
  const waking = list.filter((i) => !i.yoursToAnswer && i.awake);
  const resting = list.filter((i) => !i.yoursToAnswer && !i.awake);

  return (
    <AppShell
      title="The pad"
      active="pad"
      actions={<span className="pill">{list.length} {showDone ? 'done' : 'open'}</span>}
    >
      {error && <div className="alert alert-error">{error}</div>}

      <form className="card pad-write" onSubmit={write}>
        <textarea
          ref={boxRef}
          aria-label="Something to come back to"
          rows={2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Anything. Sort it out later."
        />
        <MentionPicker ownerId={ownerId} value={body} onChange={setBody} textareaRef={boxRef} />
        <div className="pad-write-row">
          <select aria-label="Who can see this" value={visibility}
            onChange={(e) => setVisibility(e.target.value)} style={{ width: 'auto' }}>
            <option value="private">Only me</option>
            <option value="office">The office can see it</option>
          </select>
          <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !body.trim()}>
            {busy ? 'Saving…' : 'Jot it'}
          </button>
        </div>
      </form>

      <div className="tabs" style={{ borderBottom: 'none', marginBottom: 12 }}>
        <button className={'tab-btn' + (showDone ? '' : ' is-active')} type="button"
          onClick={() => setShowDone(false)}>Open</button>
        <button className={'tab-btn' + (showDone ? ' is-active' : '')} type="button"
          onClick={() => setShowDone(true)}>Settled</button>
      </div>

      {items === null && <p className="hint">Loading…</p>}
      {items && list.length === 0 && (
        <div className="empty-state">
          {showDone
            ? 'Nothing settled yet.'
            : 'Nothing on the pad. Write the next thing you would otherwise forget.'}
        </div>
      )}

      {answering.length > 0 && (
        <>
          <h2 className="section-head">Waiting on your answer</h2>
          {answering.map((i) => (
            <PadLine key={i.id} item={i} ownerId={ownerId} me={user}
              open={openMenu === i.id} onOpen={setOpenMenu}
              onChange={change} onRemove={remove} onDone={() => load()} />
          ))}
        </>
      )}

      {waking.length > 0 && (
        <>
          <h2 className="section-head">You asked to come back to these</h2>
          {waking.map((i) => (
            <PadLine key={i.id} item={i} ownerId={ownerId} me={user}
              open={openMenu === i.id} onOpen={setOpenMenu}
              onChange={change} onRemove={remove} onDone={() => load()} />
          ))}
        </>
      )}

      {resting.length > 0 && (waking.length > 0 || answering.length > 0) && (
        <h2 className="section-head">The rest</h2>
      )}
      {resting.map((i) => (
        <PadLine key={i.id} item={i} ownerId={ownerId} me={user}
          open={openMenu === i.id} onOpen={setOpenMenu}
          onChange={change} onRemove={remove} onDone={() => load()} />
      ))}
    </AppShell>
  );
}

/**
 * The conversation a handed line grows.
 *
 * Deliberately plain — a list of what was said and a box to say the next
 * thing. No registers, no records, no formatting: this is "for what time?"
 * and "eight", and dressing that up as a thread would be dressing up.
 *
 * When it outgrows this, the line becomes a task in a space and the
 * conversation continues there, where it can involve more than two people and
 * be cited later.
 */
function PadReplies({ item, me, onReplied }) {
  const [replies, setReplies] = useState(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function load() {
    api.get(`/pad/${item.id}/replies`)
      .then((d) => setReplies(d.replies || []))
      .catch((err) => setError(err.message));
  }
  useEffect(load, [item.id]);

  async function send(e) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/pad/${item.id}/replies`, { body });
      setBody('');
      load();
      onReplied?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="pad-thread">
      {error && <div className="alert alert-error">{error}</div>}
      {replies === null && <p className="hint">Loading…</p>}
      {replies?.map((r) => (
        <div className={'pad-reply' + (r.authorId === me?.id ? ' is-mine' : '')} key={r.id}>
          <span className="pad-reply-who">{r.authorId === me?.id ? 'You' : r.authorName}</span>
          <span className="pad-reply-body">{r.body}</span>
        </div>
      ))}
      <form className="pad-reply-form" onSubmit={send}>
        <input
          type="text"
          aria-label={`Reply about: ${item.body}`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={item.yoursToAnswer ? 'Answer them…' : 'Say something…'}
        />
        <button className="btn btn-secondary btn-sm" type="submit" disabled={busy || !body.trim()}>
          {busy ? 'Sending…' : 'Reply'}
        </button>
      </form>
    </div>
  );
}

function PadLine({ item, ownerId, me, open, onOpen, onChange, onRemove, onDone }) {
  const mine = item.authorId === me?.id;
  const settled = item.state === 'done';
  // Open on its own when the ball is in your court, closed otherwise. The one
  // line you are holding somebody up on should not need a click to be read.
  const [showThread, setShowThread] = useState(item.yoursToAnswer);

  // Only lines with two people on them have a conversation to have.
  const shared = !!item.assigneeId;

  return (
    <div className={'card pad-line'
      + (item.awake ? ' is-awake' : '')
      + (item.yoursToAnswer ? ' is-yours' : '')
      + (settled ? ' is-done' : '')}>
      <div className="pad-line-main">
        <button
          className="pad-tick"
          type="button"
          aria-label={settled ? `Reopen: ${item.body}` : `Settle: ${item.body}`}
          onClick={() => onChange(item.id, { state: settled ? 'open' : 'done' })}
        >
          {settled ? '↺' : '○'}
        </button>
        <div className="pad-body">
          <MentionText body={item.body} />
          <div className="pad-meta">
            {/* First, because it is the only thing on the line that somebody
                else is actually held up by. */}
            {item.yoursToAnswer && <span className="pad-tag is-turn">Your answer</span>}
            {item.visibility === 'office'
              ? <span className="pad-tag">Office</span>
              : <span className="pad-tag is-private">Only me</span>}
            {!mine && <> · {item.authorName}</>}
            {item.assigneeName && <> · handed to {item.assigneeName}</>}
            {item.wakeAt && !settled && (
              <> · back {dayLabelInZone(item.wakeAt, me?.timezone || 'UTC')}</>
            )}
            {item.about && <> · <AboutLink about={item.about} /></>}
            {/* A promoted line is kept rather than deleted, so it can say what
                it became instead of just vanishing from the pad. */}
            {item.taskId && <> · <Link to="/tasks">now a task</Link></>}
            {item.itineraryItemId && <> · <Link to="/itinerary">on the diary</Link></>}
            {item.threadId && <> · <Link to={`/threads/${item.threadId}`}>with the team</Link></>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {shared && (
            <button className="btn btn-secondary btn-sm" type="button"
              onClick={() => setShowThread((s) => !s)}>
              {showThread ? 'Hide' : (item.replyCount > 0 ? `Replies (${item.replyCount})` : 'Reply')}
            </button>
          )}
          {mine && !settled && (
            <button className="btn btn-secondary btn-sm" type="button"
              onClick={() => onOpen(open ? null : item.id)}>
              {open ? 'Close' : 'Do something'}
            </button>
          )}
        </div>
      </div>

      {/* Once a line has been handed over it can be talked about, settled or
          not — "it turned out the car was cancelled" is worth saying after
          the fact as much as before it. */}
      {shared && showThread && (
        <PadReplies item={item} me={me} onReplied={onDone} />
      )}

      {open && (
        <PadActions item={item} ownerId={ownerId} onChange={onChange}
          onRemove={onRemove} onDone={onDone} />
      )}
    </div>
  );
}

/**
 * The four things a line can become.
 *
 * Behind a button rather than always on screen: most lines are ticked off and
 * never promoted, and a pad where every entry carries four controls is a pad
 * that is harder to read than the envelope it replaced.
 */
function PadActions({ item, ownerId, onChange, onRemove, onDone }) {
  const [spaces, setSpaces] = useState(null);
  const [people, setPeople] = useState(null);
  const [pending, setPending] = useState([]);
  const [mode, setMode] = useState(null); // task | diary | hand
  const [spaceId, setSpaceId] = useState('');
  const [toUserId, setToUserId] = useState('');
  const [when, setWhen] = useState({ date: '', time: '09:00' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/spaces').then((d) => {
      setSpaces(d.spaces || []);
      setSpaceId((d.spaces || [])[0]?.id || '');
    }).catch(() => setSpaces([]));
    // Not swallowed. A dropped error here left the list empty, which the
    // screen then explained as "nobody shares an office with you" — a
    // confident, wrong answer built out of a failure nobody was shown.
    api.get(`/mentions/${ownerId}/lookup?q=`)
      .then((d) => { setPeople(d.people || []); setPending(d.pending || []); })
      .catch((err) => { setPeople([]); setError(err.message); });
  }, [ownerId]);

  async function run(path, payload) {
    setBusy(true);
    setError('');
    try {
      await api.post(`/pad/${item.id}/${path}`, payload);
      onDone();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="pad-actions">
      {error && <div className="alert alert-error">{error}</div>}

      <div className="pad-action-row">
        <span className="pad-action-label">Come back to it</span>
        {LATER.map((l) => (
          <button key={l.id} className="itin-tool" type="button"
            onClick={() => onChange(item.id, { wakeAt: l.at() })}>{l.label}</button>
        ))}
        {item.wakeAt && (
          <button className="itin-tool" type="button"
            onClick={() => onChange(item.id, { wakeAt: null })}>Not any more</button>
        )}
      </div>

      <div className="pad-action-row">
        <span className="pad-action-label">Make it</span>
        <button className="itin-tool" type="button"
          onClick={() => setMode(mode === 'task' ? null : 'task')}>A task</button>
        <button className="itin-tool" type="button"
          onClick={() => setMode(mode === 'diary' ? null : 'diary')}>Something on the diary</button>
        <button className="itin-tool" type="button"
          onClick={() => setMode(mode === 'hand' ? null : 'hand')}>Somebody else's</button>
        {/* Only once there is a conversation to carry. Before that, "take it
            to the team" means posting a line nobody has discussed, which is
            what the office pad register is already for. */}
        {(item.replyCount > 0 || item.assigneeId) && (
          <button className="itin-tool" type="button"
            onClick={() => setMode(mode === 'team' ? null : 'team')}>The team's</button>
        )}
        <button className="itin-tool is-danger" type="button"
          onClick={() => onRemove(item.id)}>Bin it</button>
      </div>

      {mode === 'task' && (
        <div className="pad-action-form">
          {spaces === null && <p className="hint">Loading spaces…</p>}
          {spaces?.length === 0 && <p className="hint">You have no spaces to put it in yet.</p>}
          {spaces?.length > 0 && (
            <>
              {/* The question the pad exists to postpone, asked at last. */}
              <select aria-label="Which space" value={spaceId}
                onChange={(e) => setSpaceId(e.target.value)} style={{ width: 'auto' }}>
                {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button className="btn btn-primary btn-sm" type="button" disabled={busy || !spaceId}
                onClick={() => run('task', { spaceId })}>
                {busy ? 'Making…' : 'Make it a task'}
              </button>
            </>
          )}
        </div>
      )}

      {mode === 'diary' && (
        <div className="pad-action-form">
          <input aria-label="Which day" type="date" value={when.date}
            onChange={(e) => setWhen((w) => ({ ...w, date: e.target.value }))} />
          <input aria-label="What time" type="time" value={when.time}
            onChange={(e) => setWhen((w) => ({ ...w, time: e.target.value }))} />
          <button className="btn btn-primary btn-sm" type="button"
            disabled={busy || !when.date || !when.time}
            onClick={() => run('itinerary', {
              ownerId,
              startAt: new Date(`${when.date}T${when.time}`).toISOString(),
            })}>
            {busy ? 'Adding…' : 'Put it on the day'}
          </button>
        </div>
      )}

      {mode === 'team' && (
        <div className="pad-action-form">
          <p className="hint" style={{ flexBasis: '100%', margin: 0 }}>
            This moves the note and everything said about it into the team room, where
            the whole office can see it. Each line keeps whoever wrote it. The note stays
            here, settled, pointing at the room.
          </p>
          <button className="btn btn-primary btn-sm" type="button" disabled={busy}
            onClick={() => run('thread', { ownerId })}>
            {busy ? 'Taking it over…' : 'Take it to the team'}
          </button>
        </div>
      )}

      {mode === 'hand' && (
        <div className="pad-action-form">
          {people === null && <p className="hint">Loading…</p>}

          {/* THE EMPTY STATE HAS TO SAY WHICH EMPTY IT IS. It used to read
              "Nobody shares an office with you yet" whatever the reason — so
              somebody who had added their whole team the day before was told,
              flatly, that they had nobody, with no hint that the people they
              were thinking of were sitting on an unaccepted invitation. That
              sends you looking for a bug in the wrong place. */}
          {people?.length === 0 && pending.length === 0 && (
            <p className="hint">
              Nobody works with you on Kairos yet. Add them under{' '}
              <Link to="/dashboard?tab=members">Team</Link>.
            </p>
          )}
          {people?.length === 0 && pending.length > 0 && (
            <p className="hint">
              {pending.length === 1
                ? `${pending[0].name} has not accepted yet, so there is nothing linking your accounts.`
                : `${pending.length} people have been invited but have not accepted yet.`}
              {' '}You can chase it under <Link to="/dashboard?tab=members">Team</Link>.
            </p>
          )}

          {people?.length > 0 && (
            <>
              <select aria-label="Who it is for" value={toUserId}
                onChange={(e) => setToUserId(e.target.value)} style={{ width: 'auto' }}>
                <option value="">Choose somebody</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {/* Said plainly, because this is the one action that widens who
                  can read a private line. */}
              <p className="hint">They will see this note and be told about it.</p>
              {pending.length > 0 && (
                <p className="hint">
                  {pending.length === 1 ? `${pending[0].name} is` : `${pending.length} others are`}
                  {' '}invited but not on this list until they accept.
                </p>
              )}
              <button className="btn btn-primary btn-sm" type="button" disabled={busy || !toUserId}
                onClick={() => run('hand', { toUserId })}>
                {busy ? 'Handing…' : 'Hand it over'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
