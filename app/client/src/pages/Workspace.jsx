import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AppShell, { setActivePrincipal } from '../components/AppShell.jsx';
import { api } from '../lib/api.js';

// The assistant's own dashboard — not the principal's screen relabelled.
//
// A principal's Today answers "what is my day". An assistant's question is a
// different one: "what is outstanding, across everyone I run". Making them
// pick a principal before the app will say anything is the small friction
// that turns a tool into a chore, so this spans all of them at once and the
// switcher becomes a way in rather than a prerequisite.

function fmtTime(iso, tz) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
    .format(new Date(iso));
}

function fmtDay(iso, tz) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' })
    .format(new Date(iso));
}

const KIND_ICON = {
  flight: '✈', train: '🚆', car: '🚗', hotel: '🛏', meeting: '👥',
  meal: '🍽', personal: '•', call: '☎', note: '✎',
};

function ItemLine({ item, tz, children }) {
  return (
    <div className="ws-item">
      <span className="ws-item-icon" aria-hidden="true">{KIND_ICON[item.kind] || '•'}</span>
      <div className="ws-item-body">
        <div className="ws-item-title">{item.title}</div>
        <div className="ws-item-meta">
          {item.principalName && <strong>{item.principalName}</strong>}
          {item.principalName && ' · '}
          {fmtDay(item.startAt, tz)} at {fmtTime(item.startAt, tz)}
          {item.location ? ` · ${item.location}` : ''}
        </div>
        {item.proposalNote && <div className="ws-item-note">You asked: “{item.proposalNote}”</div>}
        {item.decisionNote && <div className="ws-item-note is-decision">They said: “{item.decisionNote}”</div>}
      </div>
      {children && <div className="ws-item-actions">{children}</div>}
    </div>
  );
}

export default function Workspace() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const navigate = useNavigate();

  function load() {
    return api.get('/workspace')
      .then(setData)
      .catch((err) => setError(err.message));
  }

  useEffect(() => { load(); }, []);

  async function act(principalId, itemId, path, body) {
    setBusy(itemId);
    setError('');
    try {
      await api.post(`/itinerary/${principalId}/items/${itemId}/${path}`, body);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  // Going "into" a principal means the principal-scoped screens should follow,
  // so set the switcher rather than only navigating — otherwise Today opens on
  // whoever was selected last.
  function openPrincipal(id, to = '/today') {
    setActivePrincipal(id);
    navigate(to);
  }

  return (
    <AppShell title="Workspace">
      {error && <div className="alert alert-error">{error}</div>}
      {!data && <p className="hint">Loading…</p>}

      {data && data.principals.length === 0 && (
        <div className="empty-state">
          <p>You aren't supporting anyone yet.</p>
          <p className="hint">
            A principal adds you from their Team screen. Once they do, they'll appear here and
            everything you arrange for them runs through this page.
          </p>
        </div>
      )}

      {data && data.principals.length > 0 && (
        <>
          <section className="ws-section">
            <h2 className="ws-heading">Who you're running</h2>
            <div className="ws-principals">
              {data.principals.map((p) => (
                <div className="card ws-principal" key={p.id}>
                  <div className="ws-principal-head">
                    <div>
                      <div className="name">{p.name}</div>
                      <div className="meta">{p.roleLabel} · {p.localTime} their time</div>
                    </div>
                    {p.pendingApprovals > 0 && (
                      <span className="pill is-warn">{p.pendingApprovals} to approve</span>
                    )}
                  </div>
                  <div className="ws-principal-next">
                    {p.nextUp
                      ? <>Next: <strong>{p.nextUp.title}</strong> at {fmtTime(p.nextUp.startAt, p.timezone)}</>
                      : <span className="hint">Nothing else confirmed today</span>}
                  </div>
                  <div className="ws-principal-actions">
                    <button className="btn btn-sm" type="button" onClick={() => openPrincipal(p.id, '/today')}>
                      Their day
                    </button>
                    <button className="btn btn-sm" type="button" onClick={() => openPrincipal(p.id, '/itinerary')}>
                      Itinerary
                    </button>
                    {p.pendingApprovals > 0 && (
                      <button className="btn btn-sm" type="button" onClick={() => openPrincipal(p.id, '/pa?tab=approvals')}>
                        Approvals
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="ws-section">
            <h2 className="ws-heading">
              Your drafts
              {data.drafts.length > 0 && <span className="ws-count">{data.drafts.length}</span>}
            </h2>
            <p className="hint ws-sub">
              Yours alone. Nothing here is on anyone's calendar until you send or publish it.
            </p>
            {data.drafts.length === 0 && <div className="empty-state">No drafts in progress.</div>}
            {data.drafts.map((i) => (
              <div className="card" key={i.id}>
                <ItemLine item={i} tz={i.timezone}>
                  <button
                    className="btn btn-primary btn-sm"
                    type="button"
                    disabled={busy === i.id}
                    onClick={() => act(i.principalId, i.id, 'publish')}
                  >
                    Publish
                  </button>
                  <button
                    className="btn btn-sm"
                    type="button"
                    disabled={busy === i.id}
                    onClick={() => {
                      const note = window.prompt(`What should ${i.principalName} know about this?`) ?? null;
                      if (note === null) return;
                      act(i.principalId, i.id, 'propose', { note });
                    }}
                  >
                    Ask them
                  </button>
                </ItemLine>
              </div>
            ))}
          </section>

          {data.awaitingDecision.length > 0 && (
            <section className="ws-section">
              <h2 className="ws-heading">
                Waiting on them
                <span className="ws-count">{data.awaitingDecision.length}</span>
              </h2>
              {data.awaitingDecision.map((i) => (
                <div className="card" key={i.id}>
                  <ItemLine item={i} tz={i.timezone} />
                </div>
              ))}
            </section>
          )}

          {data.recentlyDecided.length > 0 && (
            <section className="ws-section">
              <h2 className="ws-heading">Recently answered</h2>
              {data.recentlyDecided.map((i) => (
                <div className="card" key={i.id}>
                  <ItemLine item={i} tz={i.timezone}>
                    <span className={'pill' + (i.approved ? '' : ' is-off')}>
                      {i.approved ? 'Approved' : 'Declined'}
                    </span>
                  </ItemLine>
                </div>
              ))}
            </section>
          )}

          {data.myTasks.length > 0 && (
            <section className="ws-section">
              <h2 className="ws-heading">Your tasks</h2>
              {data.myTasks.slice(0, 8).map((t) => (
                <div className="card ws-task" key={t.id}>
                  <div>
                    <div className="name">{t.title}</div>
                    <div className="meta">{t.spaceName}{t.dueAt ? ` · due ${fmtDay(t.dueAt)}` : ''}</div>
                  </div>
                  {t.overdue && <span className="pill is-off">Overdue</span>}
                </div>
              ))}
              <Link className="hint" to="/tasks">All your tasks →</Link>
            </section>
          )}
        </>
      )}
    </AppShell>
  );
}
