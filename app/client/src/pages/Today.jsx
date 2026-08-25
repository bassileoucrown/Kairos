import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import AppShell, { resolveActivePrincipal } from '../components/AppShell.jsx';
import RunningLate from '../components/RunningLate.jsx';
import { useAuth } from '../lib/AuthContext.jsx';
import { useAsk } from '../components/Ask.jsx';

export const KIND_ICON = {
  flight: '✈', train: '🚆', car: '🚗', hotel: '🛎', meeting: '👥',
  meal: '🍽', personal: '★', call: '☎', note: '•',
};
export const KIND_LABEL = {
  flight: 'Flight', train: 'Train', car: 'Car', hotel: 'Hotel', meeting: 'Meeting',
  meal: 'Meal', personal: 'Personal', call: 'Call', note: 'Note',
};
const TIER_LABEL = { 1: 'Public', 2: 'Standard', 3: 'Priority', 4: 'Inner Circle' };

// "in 5 hours" beats a bare date when the whole point is that it has not
// happened yet and there is still time to act on it.
function dueLabel(iso) {
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return `overdue since ${new Date(iso).toLocaleDateString()}`;
  const hours = Math.round(ms / 3600000);
  if (hours < 1) return 'due within the hour';
  if (hours < 24) return `due in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `due in ${days} day${days === 1 ? '' : 's'}`;
}

function friendlyDate(key) {
  const d = new Date(`${key}T12:00:00Z`);
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

// How long a stretch of minutes is, said the way somebody says it.
export function span(mins) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/**
 * The day, as a shape rather than a list.
 *
 * A list of five cards tells you there are five things. It does not tell you
 * that four of them are before noon and the fifth is at seven, which is the
 * thing somebody actually wants to know when they open this at breakfast — and
 * the thing a diary is for. So the space between two entries on screen is
 * proportional to the space between them in the day, clamped so that a
 * nine-hour gap does not push the evening off the bottom of a phone.
 *
 * The clamp is the whole design decision. Unclamped it is a chart nobody can
 * read; unproportioned it is the list this replaces. Between the two it is a
 * shape you take in before you read a word of it.
 *
 * Pass now = null for a day that is not today — a Tuesday next month has no
 * "now" in it, and calling one of its entries running, finished or next would
 * be a lie the screen then acts on.
 */
export function shapeOf(schedule, now) {
  const rows = [];
  const dated = now !== null;
  // With no clock to place, there is no now line to draw and nothing to call
  // live, so both are settled before the loop starts.
  let nowPlaced = !dated;
  let liveClaimed = !dated;

  for (let i = 0; i < schedule.length; i++) {
    const e = schedule[i];
    const start = new Date(e.startAt).getTime();
    const end = e.endAt ? new Date(e.endAt).getTime() : start;
    const running = dated && now >= start && now < end;
    const done = dated && now >= end && end > start;

    // The now line goes above the first entry that has not started.
    if (!nowPlaced && now < start) {
      rows.push({ type: 'now' });
      nowPlaced = true;
    }
    // "Running late" belongs on exactly one entry: whatever is happening, or
    // if nothing is, whatever is next. You cannot be late for this morning's
    // meeting at seven in the evening, and offering the option on all six
    // entries turned the day into a column of grey buttons louder than the
    // day itself.
    const live = !liveClaimed && !done;
    if (live) liveClaimed = true;
    rows.push({ type: 'item', e, running, done, live });

    const next = schedule[i + 1];
    if (!next) continue;
    const gapMins = Math.max(0, Math.round((new Date(next.startAt).getTime() - end) / 60000));
    if (gapMins >= 5) {
      // The now line belongs in the gap it actually falls inside, drawn where
      // it falls rather than shoved to the top of the next thing. Claiming it
      // here is also what stops it being drawn twice: the check at the top of
      // the next iteration would otherwise place a second one above `next`.
      const holdsNow = now >= end && now < new Date(next.startAt).getTime();
      if (holdsNow) nowPlaced = true;
      rows.push({
        type: 'gap',
        mins: gapMins,
        // Roughly half a pixel a minute, floored so a breather is still
        // visible and ceilinged so an empty afternoon does not become scroll.
        height: Math.min(84, Math.max(14, Math.round(gapMins * 0.5))),
        holdsNow,
      });
    }
  }
  if (!nowPlaced && schedule.length > 0) rows.push({ type: 'now', trailing: true });
  return rows;
}

function untilLabel(startAt) {
  const mins = Math.round((new Date(startAt) - Date.now()) / 60000);
  if (mins < 0) return 'now';
  if (mins < 60) return `in ${mins} min`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `in ${hrs} hr${hrs === 1 ? '' : 's'}` : 'later';
}

// One entry, wherever a day is shown. A div rather than an li: both callers
// wrap it in something of their own — a spine node here, a row of controls on
// the Itinerary — and an li inside a div inside a ul was invalid in both.
// `viewerIsPrincipal` decides one word, and it matters: a proposed item is
// "awaiting you" to the principal being asked and "waiting on them" to the
// assistant who did the asking. The Itinerary used to render its own second
// pill for the assistant's side, so a row could carry both at once and tell
// one reader two opposite things about the same item.
export function ScheduleEntry({ e, viewerIsPrincipal = true }) {
  return (
    <div className={`sched-row kind-${e.kind}` + (e.status === 'proposed' ? ' is-proposed' : '')}>
      <div className="sched-time">
        <span className="sched-start">{e.startLabel}</span>
        {e.endLabel && <span className="sched-end">{e.endLabel}</span>}
      </div>
      <span className="sched-icon" aria-hidden="true">{KIND_ICON[e.kind] || '•'}</span>
      <div className="sched-main">
        <div className="sched-title">
          {e.title}
          {e.status === 'proposed' && (
            <span className="pill is-warn sched-pill">
              {viewerIsPrincipal ? 'Awaiting you' : 'Waiting on them'}
            </span>
          )}
          {e.status === 'draft' && <span className="pill is-off sched-pill">Draft</span>}
        </div>
        <div className="sched-meta">
          <span className="sched-kind">{KIND_LABEL[e.kind] || e.kind}</span>
          {e.location && <> · {e.location}</>}
          {e.destination && <> → {e.destination}</>}
          {e.reference && <> · <span className="sched-ref">{e.reference}</span></>}
          {e.crossesTimezone && (
            <> · <span className="sched-tz">
              arrives {e.endLabel} {e.endTimezone.split('/').pop().replace('_', ' ')}
              {e.overnight && ' next day'}
            </span></>
          )}
          {!e.crossesTimezone && e.overnight && <> · <span className="sched-tz">arrives next day</span></>}
          {/* Said in words rather than with a loop glyph, because the rule is
              what matters: "every month" does not distinguish the second
              Tuesday from the last Friday, and the label does. */}
          {e.recurrenceLabel && <> · <span className="sched-repeat">{e.recurrenceLabel}</span></>}
        </div>
        {e.notes && <div className="sched-notes">{e.notes}</div>}
      </div>
      {e.videoRoom && (
        <a className="btn btn-secondary btn-sm" href={`https://meet.jit.si/${e.videoRoom}`} target="_blank" rel="noreferrer">Join</a>
      )}
    </div>
  );
}

// The quick word.
//
// Most of what passes between a principal and the person running their diary
// is one line long — "car's outside", "he's running late", "confirm Thursday".
// It has always gone to WhatsApp because opening the app to say it was more
// trouble than it was worth. So the room is already there, one tap from the
// day, and nobody has to set anything up.
export function DirectLine({ line, isSelf, principalName }) {
  return (
    <Link className="direct-line" to={`/threads/${line.threadId}`}>
      <span className="direct-line-label">
        Direct line
        <span className="hint"> · {isSelf ? 'you and your team' : `${principalName} and the team`}</span>
      </span>
      <span className="direct-line-last">
        {line.lastMessage
          ? <><strong>{line.lastMessage.authorName}:</strong> {line.lastMessage.body}</>
          : <span className="hint">No messages yet — say something quick.</span>}
      </span>
      {line.unanswered > 0 && <span className="count-pill">{line.unanswered}</span>}
    </Link>
  );
}

// A clock that ticks, so a countdown on this screen is true rather than true
// at the moment the page happened to load. Half a minute is fine for a screen
// that speaks in minutes, and cheap enough to leave running.
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export default function Today() {
  // Replaces window.prompt; see components/Ask.jsx.
  const [ask, askDialog] = useAsk();
  const now = useNow();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [lateItem, setLateItem] = useState(null);
  // Today is where the office actually stands each morning, so the line to a
  // booker belongs here too rather than only on the planner.
  const [noting, setNoting] = useState(null);

  async function load() {
    const id = await resolveActivePrincipal(user);
    if (!id) return;
    return api.get(`/today/${id}`).then(setData).catch((err) => setError(err.message));
  }
  useEffect(() => { load(); }, [user?.id]);

  async function decideItinerary(id, approve) {
    // A decline without a reason is just a dead end for whoever arranged it,
    // so ask — but never block on it.
    const note = approve ? '' : await ask({
      title: 'Decline this',
      label: 'Anything they should know',
      hint: 'It goes back to their drafts rather than away, so a reason saves a round trip.',
      multiline: true,
      optional: true,
      confirmLabel: 'Decline',
    });
    if (!approve && note === null) return;
    try {
      await api.post(`/itinerary/${data.principal.id}/items/${id}/decide`, { approve, note });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function approve(id, action) {
    try {
      await api.post(`/pa/${data.principal.id}/approvals/${id}/${action}`);
      load();
    } catch (err) { setError(err.message); }
  }

  if (error && !data) return <AppShell title="Today" active="today"><div className="alert alert-error">{error}</div></AppShell>;
  if (!data) return <AppShell title="Today" active="today"><p className="hint">Loading…</p></AppShell>;

  const { schedule, nextUp, needsYou, todayTasks, relationships } = data;

  // What the day is, in one sentence, before any of it is read.
  const firstItem = schedule[0];
  const lastItem = schedule[schedule.length - 1];
  const summary = schedule.length === 0
    ? 'Nothing in the diary.'
    : `${schedule.length} thing${schedule.length === 1 ? '' : 's'}, `
      + `${firstItem.startLabel} until ${lastItem.endLabel || lastItem.startLabel}.`;

  // What is happening right now, or what is next. This is the one thing the
  // screen exists to answer, so it is the one thing said loudly.
  const running = schedule.find((e) => {
    const s0 = new Date(e.startAt).getTime();
    const e0 = e.endAt ? new Date(e.endAt).getTime() : s0;
    return now >= s0 && now < e0;
  });
  const minsLeft = running && running.endAt
    ? Math.max(0, Math.round((new Date(running.endAt).getTime() - now) / 60000))
    : null;
  const rows = shapeOf(schedule, now);

  // The band used to announce the next thing even when that thing was the
  // very next line on the screen, so the day opened by saying the same
  // meeting twice in a row, in the same words. It earns its space in exactly
  // two cases: something is running (where it knows things the row does not —
  // how long is left, and where to join), or there is nothing left in today's
  // spine at all, where an absence is worth stating out loud rather than
  // leaving as blank space. When the next thing is already drawn below, the
  // row says "in 8 hrs" itself and the band stays out of the way.
  const nextInSpine = rows.some((r) => r.type === 'item' && r.live && !r.running);
  // nextUp can be tomorrow's first thing, which is not in today's spine and so
  // cannot be a repeat of anything — worth saying when today is done.
  const beyondToday = !nextInSpine && nextUp && new Date(nextUp.startAt).getTime() > now
    ? nextUp
    : null;

  // With nothing waiting, the right-hand column was a whole column of nothing:
  // a heading and a sentence, floated beside a day that could have used the
  // width. When there is nothing to put in it, there is no column.
  const needsAnything = needsYou.count > 0 || relationships.length > 0;

  return (
    <AppShell
      title="Today"
      active="today"
      actions={<Link className="btn btn-secondary btn-sm" to="/itinerary">Plan the day</Link>}
    >
      {askDialog}
      {error && <div className="alert alert-error">{error}</div>}

      {/* The masthead. Set in a serif, because this is the one line on the
          screen that is a statement rather than a control. */}
      <header className="today-head">
        <h1 className="today-date">{friendlyDate(data.date)}</h1>
        <p className="today-summary">
          {summary}
          <span className="today-zone"> {data.timezone.replace('_', ' ')}</span>
        </p>
      </header>

      {/* Now. Three states, and the third is worth saying out loud rather
          than leaving as an absence. */}
      {running ? (
        <div className="now-band is-running">
          <span className="now-label">Now</span>
          <span className="now-title">{running.title}</span>
          <span className="now-detail">
            {minsLeft === null ? running.startLabel
              : minsLeft === 0 ? 'due to end'
                : `${span(minsLeft)} left · until ${running.endLabel}`}
            {running.location ? ` · ${running.location}` : ''}
          </span>
          {running.videoRoom && (
            <a className="btn btn-primary btn-sm" href={`https://meet.jit.si/${running.videoRoom}`}
              target="_blank" rel="noreferrer">Join</a>
          )}
        </div>
      ) : beyondToday ? (
        <div className="now-band">
          <span className="now-label">Next {untilLabel(beyondToday.startAt)}</span>
          <span className="now-title">{beyondToday.title}</span>
          <span className="now-detail">
            {beyondToday.startLabel}
            {beyondToday.location ? ` · ${beyondToday.location}` : ''}
          </span>
        </div>
      ) : !nextInSpine ? (
        <div className="now-band is-clear">
          <span className="now-label">Now</span>
          <span className="now-title">
            {schedule.length === 0 ? 'Nothing in the diary today.' : 'The day is clear from here.'}
          </span>
        </div>
      ) : null}

      {data.directLine && (
        <DirectLine line={data.directLine} isSelf={data.isSelf} principalName={data.principal.name} />
      )}

      <div className={'today-grid' + (needsAnything ? '' : ' is-single')}>
        <section>
          {lateItem && (
            <RunningLate
              ownerId={data.principal.id}
              item={lateItem}
              onDone={() => { setLateItem(null); load(); }}
              onCancel={() => setLateItem(null)}
            />
          )}

          {schedule.length === 0 ? (
            <div className="empty-state">
              Nothing scheduled. <Link to="/itinerary">Add something to the itinerary</Link>.
            </div>
          ) : (
            <ol className="sched-list day-spine">
              {rows.map((row, i) => {
                if (row.type === 'now') {
                  return (
                    <li className={'day-now' + (row.trailing ? ' is-trailing' : '')} key="now">
                      <span className="day-now-label">now</span>
                    </li>
                  );
                }
                if (row.type === 'gap') {
                  return (
                    <li className="day-gap" key={`gap-${i}`} style={{ height: row.height }}>
                      {/* Only worth naming when there is enough of it to use. */}
                      {row.height >= 34 && <span className="day-gap-label">{span(row.mins)} clear</span>}
                      {row.holdsNow && <span className="day-now-inline" aria-label="now" />}
                    </li>
                  );
                }
                const { e } = row;
                return (
                  <li
                    className={'day-item today-row'
                      + (row.running ? ' is-running' : '')
                      + (row.done ? ' is-done' : '')
                      + (row.live && !row.running ? ' is-next' : '')}
                    key={e.id}
                  >
                    {row.live && !row.running && (
                      <span className="day-next-flag">Next {untilLabel(e.startAt)}</span>
                    )}
                    <ScheduleEntry e={e} />
                    {e.source === 'itinerary' && row.live && (
                      <button
                        className="today-late"
                        type="button"
                        aria-label={`${e.title} is running late`}
                        onClick={() => setLateItem(e)}
                      >
                        Running late
                      </button>
                    )}
                    {e.source === 'booking' && (
                      <button
                        className="today-late"
                        type="button"
                        aria-label={`Notes on ${e.title}`}
                        onClick={() => setNoting((n) => (n === e.id ? null : e.id))}
                      >
                        {noting === e.id ? 'Hide notes' : 'Notes'}
                      </button>
                    )}
                    {e.source === 'booking' && noting === e.id && (
                      <BookingNotes
                        ownerId={data.principal.id}
                        bookingId={String(e.id).replace(/^booking:/, '')}
                      />
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {todayTasks.length > 0 && (
            <>
              <h2 className="section-head">Due today</h2>
              <ul className="mini-list">
                {todayTasks.map((t) => (
                  <li key={t.id}>
                    <span className={`ctx-chip ctx-${t.spaceContext}`}>{t.spaceContext}</span>
                    <span>{t.title}</span>
                    {t.projectName && <span className="mini-meta">{t.projectName}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section>
          {needsAnything ? (
            <h2 className="section-head">
              Needs you
              {needsYou.count > 0 && <span className="count-pill">{needsYou.count}</span>}
            </h2>
          ) : (
            /* One line, at the foot of the day, rather than a heading and an
               empty box holding open a column beside it. */
            <p className="today-nothing">Nothing waiting on you. Genuinely.</p>
          )}

          {needsYou.approvals.map((a) => (
            <div className="needs-card" key={a.id}>
              <div className="needs-kind">{TIER_LABEL[a.accessTier] || 'Request'} booking</div>
              <div className="needs-title">{a.meetingTypeName} with {a.bookerName}</div>
              <div className="needs-meta">{new Date(a.startAt).toLocaleString()}</div>
              <div className="needs-actions">
                <button className="btn btn-primary btn-sm" type="button" onClick={() => approve(a.id, 'approve')}>Approve</button>
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => approve(a.id, 'decline')}>Decline</button>
              </div>
            </div>
          ))}

          {(needsYou.expiring || []).map((e) => (
            <Link className="needs-card" key={e.id} to="/dashboard?tab=essentials">
              <div className="needs-kind">
                {e.state === 'expired' ? 'Expired' : 'Expiring soon'}
              </div>
              <div className="needs-title">{e.label}</div>
              <div className="needs-meta">
                {e.state === 'expired'
                  ? `Lapsed ${Math.abs(e.daysUntil)} days ago — ${e.expiresOn}`
                  : `${e.daysUntil} days left — ${e.expiresOn}. Many countries want six months.`}
              </div>
            </Link>
          ))}

          {(needsYou.itineraryRequests || []).map((i) => (
            <div className="needs-card" key={i.id}>
              <div className="needs-kind">Itinerary — {i.requestedBy || 'your assistant'} is asking</div>
              <div className="needs-title">{i.title}</div>
              <div className="needs-meta">
                {new Date(i.startAt).toLocaleString()}
                {i.location ? ` · ${i.location}` : ''}
                {i.destination ? ` → ${i.destination}` : ''}
              </div>
              {i.proposalNote && <div className="needs-note">“{i.proposalNote}”</div>}
              <div className="needs-actions">
                <button className="btn btn-primary btn-sm" type="button" onClick={() => decideItinerary(i.id, true)}>Approve</button>
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => decideItinerary(i.id, false)}>Decline</button>
              </div>
            </div>
          ))}

          {(needsYou.unconfirmedInstructions || []).map((i) => (
            <Link className="needs-card" key={i.id} to="/household">
              <div className="needs-kind">
                {i.memberName} hasn't confirmed
              </div>
              <div className="needs-title">{i.body}</div>
              <div className="needs-meta">
                {i.memberJobTitle}
                {i.dueAt ? ` · for ${new Date(i.dueAt).toLocaleString()}` : ''}
              </div>
            </Link>
          ))}

          {needsYou.recordsAwaiting.map((r) => (
            <Link className="needs-card" key={r.id} to={`/threads/${r.threadId}`}>
              <div className="needs-kind">
                <span className={`ctx-chip ctx-${r.spaceContext}`}>{r.spaceContext}</span>
                {' '}Record R-{String(r.recordSeq).padStart(2, '0')} · {r.recordType.replace('_', ' ')}
              </div>
              <div className="needs-title">{r.body.slice(0, 110)}{r.body.length > 110 ? '…' : ''}</div>
              <div className="needs-meta">{r.authorName} · {r.threadName}</div>
            </Link>
          ))}

          {/* dueTasks carries both bands, and the difference is the point: one
              is a warning you can still act on, the other is a report of a
              deadline that has already gone. (needsYou.overdueTasks is the
              same rows filtered, kept for the rail's count — reading it here
              as a fallback was dead code, since dueTasks is always an array.) */}
          {(needsYou.dueTasks || []).map((t) => (
            <Link
              className={'needs-card ' + (t.band === 'due_soon' ? 'is-warn' : 'is-overdue')}
              key={t.id}
              to="/tasks"
            >
              <div className="needs-kind">
                {t.band === 'due_soon' ? 'Task coming up' : 'Overdue task'}
                {t.priority === 'high' && <span className="needs-flag">High</span>}
              </div>
              <div className="needs-title">{t.title}</div>
              <div className="needs-meta">
                {t.spaceName}{t.projectName ? ` · ${t.projectName}` : ''} · {dueLabel(t.dueAt)}
              </div>
            </Link>
          ))}

          {needsYou.blockedStages.map((s) => (
            <Link className="needs-card is-overdue" key={s.id} to={`/projects/${s.projectId}`}>
              <div className="needs-kind">Blocked stage</div>
              <div className="needs-title">{s.name}</div>
              <div className="needs-meta">{s.projectName}</div>
            </Link>
          ))}

          {relationships.length > 0 && (
            <>
              <h2 className="section-head">Worth remembering</h2>
              <ul className="mini-list">
                {relationships.map((r) => (
                  <li key={`${r.contactId}-${r.kind}`}>
                    <span>{r.name}</span>
                    <span className="mini-meta">
                      {r.kind} {r.daysUntil === 0 ? 'today' : `in ${r.daysUntil} day${r.daysUntil === 1 ? '' : 's'}`}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </AppShell>
  );
}
