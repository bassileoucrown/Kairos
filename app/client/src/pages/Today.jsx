import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import AppShell, { resolveActivePrincipal } from '../components/AppShell.jsx';
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

export default function Today() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

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
          {schedule.length === 0 ? (
            <div className="empty-state">
              Nothing scheduled. <Link to="/itinerary">Add something to the itinerary</Link>.
            </div>
          ) : (
            <ul className="sched-list">
              {schedule.map((e) => <ScheduleEntry key={e.id} e={e} />)}
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

          {needsYou.overdueTasks.map((t) => (
            <Link className="needs-card is-overdue" key={t.id} to="/tasks">
              <div className="needs-kind">Overdue task</div>
              <div className="needs-title">{t.title}</div>
              <div className="needs-meta">
                {t.spaceName}{t.projectName ? ` · ${t.projectName}` : ''} · due {new Date(t.dueAt).toLocaleDateString()}
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
