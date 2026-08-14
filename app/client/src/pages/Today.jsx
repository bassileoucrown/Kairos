import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import AppShell, { resolveActivePrincipal } from '../components/AppShell.jsx';
import RunningLate from '../components/RunningLate.jsx';
import { useAuth } from '../lib/AuthContext.jsx';

export const KIND_ICON = {
  flight: '✈', train: '🚆', car: '🚗', hotel: '🛎', meeting: '👥',
  meal: '🍽', personal: '★', call: '☎', note: '•',
};
const KIND_LABEL = {
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

function untilLabel(startAt) {
  const mins = Math.round((new Date(startAt) - Date.now()) / 60000);
  if (mins < 0) return 'now';
  if (mins < 60) return `in ${mins} min`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `in ${hrs} hr${hrs === 1 ? '' : 's'}` : 'later';
}

export function ScheduleEntry({ e }) {
  return (
    <li className={`sched-row kind-${e.kind}` + (e.status === 'proposed' ? ' is-proposed' : '')}>
      <div className="sched-time">
        <span className="sched-start">{e.startLabel}</span>
        {e.endLabel && <span className="sched-end">{e.endLabel}</span>}
      </div>
      <span className="sched-icon" aria-hidden="true">{KIND_ICON[e.kind] || '•'}</span>
      <div className="sched-main">
        <div className="sched-title">
          {e.title}
          {e.status === 'proposed' && <span className="pill is-warn sched-pill">Awaiting you</span>}
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
        </div>
        {e.notes && <div className="sched-notes">{e.notes}</div>}
      </div>
      {e.videoRoom && (
        <a className="btn btn-secondary btn-sm" href={`https://meet.jit.si/${e.videoRoom}`} target="_blank" rel="noreferrer">Join</a>
      )}
    </li>
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

export default function Today() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [lateItem, setLateItem] = useState(null);

  async function load() {
    const id = await resolveActivePrincipal(user);
    if (!id) return;
    return api.get(`/today/${id}`).then(setData).catch((err) => setError(err.message));
  }
  useEffect(() => { load(); }, [user?.id]);

  async function decideItinerary(id, approve) {
    // A decline without a reason is just a dead end for whoever arranged it,
    // so ask — but never block on it.
    const note = approve ? '' : (window.prompt('Anything they should know? (optional)') ?? '');
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

  return (
    <AppShell
      title="Today"
      active="today"
      actions={<Link className="btn btn-primary btn-sm" to="/itinerary">Plan the day</Link>}
    >
      {error && <div className="alert alert-error">{error}</div>}

      <p className="today-date">{friendlyDate(data.date)} · {data.timezone.replace('_', ' ')}</p>

      {data.directLine && (
        <DirectLine line={data.directLine} isSelf={data.isSelf} principalName={data.principal.name} />
      )}

      {nextUp && (
        <div className="next-up">
          <span className="next-up-label">Next up {untilLabel(nextUp.startAt)}</span>
          <span className="next-up-title">
            <span aria-hidden="true">{KIND_ICON[nextUp.kind] || '•'}</span> {nextUp.startLabel} — {nextUp.title}
          </span>
          {nextUp.location && <span className="next-up-where">{nextUp.location}</span>}
        </div>
      )}

      <div className="today-grid">
        <section>
          <h2 className="section-head">The day</h2>
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
            <ul className="sched-list">
              {schedule.map((e) => (
                <div className="today-row" key={e.id}>
                  <ScheduleEntry e={e} />
                  {e.source === 'itinerary' && (
                    <button
                      className="btn btn-sm today-late"
                      type="button"
                      aria-label={`${e.title} is running late`}
                      onClick={() => setLateItem(e)}
                    >
                      Running late
                    </button>
                  )}
                </div>
              ))}
            </ul>
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
          <h2 className="section-head">
            Needs you
            {needsYou.count > 0 && <span className="count-pill">{needsYou.count}</span>}
          </h2>

          {needsYou.count === 0 && (
            <div className="empty-state">Nothing waiting on you. Genuinely.</div>
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

          {/* Both bands, and the difference is the point: one is a warning
              you can still act on, the other is a report of a deadline that
              has already gone. */}
          {(needsYou.dueTasks || needsYou.overdueTasks || []).map((t) => (
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
