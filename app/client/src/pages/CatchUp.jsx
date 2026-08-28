import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import AppShell from '../components/AppShell.jsx';

// What happened while you were away.
//
// EVERY OTHER SCREEN ANSWERS "what is true now". This one answers "what did I
// miss", which is a different question and the only one somebody has when they
// come back from four days out. Answering it before meant opening six screens
// and doing the subtraction by eye.
//
// ORDERED BY WHAT WOULD BE WORST TO HAVE MISSED, not by time. A decision filed
// in your absence is something you are now working under whether you saw it or
// not; a chatty room is something you can read at leisure. A reverse-chronology
// feed would bury the first under the second on any busy week.

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

const DIARY_WORDS = {
  booked: 'was put in the diary',
  approved: 'was approved',
  declined: 'was declined',
  cancelled: 'was called off',
  rescheduled: 'was moved',
  relengthened: 'changed length',
  format_agreed: 'settled its format',
  format_proposed: 'was asked to change format',
  format_countered: 'came back with another format',
};

export default function CatchUp() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    api.get('/catch-up').then(setData).catch((e) => setError(e.message));
  }, []);

  async function done() {
    setDismissed(true);
    try { await api.post('/catch-up/seen', {}); } catch { /* nothing worth saying */ }
  }

  if (!data) return <AppShell title="While you were away"><p className="hint">{error || 'Loading…'}</p></AppShell>;

  // Two different nothings, and they must not share a sentence: somebody who
  // was never away has not "missed nothing", they simply were not gone.
  if (!data.away && data.empty) {
    return (
      <AppShell title="While you were away">
        <div className="empty-state">
          You have not been away. This fills up when you have been gone
          long enough to have missed something — it counts from when you
          last had Kairos open, so you never have to pick a date.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="While you were away">
      {error && <div className="alert alert-error">{error}</div>}

      <div className="report-head">
        <div>
          <h3 style={{ margin: 0 }}>Since {when(data.since)}</h3>
          <p className="hint" style={{ margin: '2px 0 0' }}>
            Counted from when you last had Kairos open.
          </p>
        </div>
        {!dismissed && !data.empty && (
          <button className="btn btn-sm" type="button" onClick={done}>
            I have read this
          </button>
        )}
      </div>

      {data.empty && (
        <div className="alert alert-success">
          Nothing happened while you were out. The office was quiet.
        </div>
      )}

      {/* WORST TO HAVE MISSED, FIRST. */}
      {data.records.length > 0 && (
        <section className="catch-block">
          <h4>Decided without you</h4>
          <p className="hint">You are working under these whether or not you saw them filed.</p>
          {data.records.map((r) => (
            <Link className="card catch-row" key={r.id} to={`/threads/${r.threadId}`}>
              <div className="catch-main">
                <div className="catch-line">{r.body}</div>
                <div className="hint">
                  {r.authorName} · {r.threadName} · {when(r.at)}
                </div>
              </div>
              <span className={'pill' + (r.recordStatus === 'open' ? ' is-warn' : '')}>
                {r.recordType?.replace(/_/g, ' ')}
              </span>
            </Link>
          ))}
        </section>
      )}

      {data.tasks.length > 0 && (
        <section className="catch-block">
          <h4>Handed to you</h4>
          {data.tasks.map((t) => (
            <Link className="card catch-row" key={t.id} to="/tasks">
              <div className="catch-main">
                <div className="catch-line">{t.title}</div>
                <div className="hint">
                  {t.fromName ? `from ${t.fromName}` : 'assigned'} · {t.spaceName}
                  {t.dueAt ? ` · due ${when(t.dueAt)}` : ''}
                </div>
              </div>
              {t.priority === 'high' && <span className="pill is-warn">High</span>}
            </Link>
          ))}
        </section>
      )}

      {data.diary.length > 0 && (
        <section className="catch-block">
          <h4>The diary moved</h4>
          {data.diary.map((d, i) => (
            <div className="card catch-row" key={`${d.at}-${i}`}>
              <div className="catch-main">
                <div className="catch-line">
                  <strong>{d.who}</strong> {DIARY_WORDS[d.kind] || d.kind.replace(/_/g, ' ')}
                </div>
                <div className="hint">
                  {d.byName ? `${d.byName} · ` : ''}{d.ownerName}&apos;s diary · {when(d.at)}
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      {data.rooms.length > 0 && (
        <section className="catch-block">
          <h4>Rooms with something in them</h4>
          {data.rooms.map((r) => (
            <Link className="card catch-row" key={r.threadId} to={`/threads/${r.threadId}`}>
              <div className="catch-main">
                <div className="catch-line">{r.name}</div>
                <div className="hint thread-preview">
                  {r.lastMessage
                    ? `${r.lastMessage.authorName}: ${r.lastMessage.body}`
                    : r.spaceName}
                </div>
              </div>
              <span className="pill is-unread">{r.unread} new</span>
            </Link>
          ))}
        </section>
      )}
    </AppShell>
  );
}
