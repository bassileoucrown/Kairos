import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import AppShell from '../components/AppShell.jsx';
import Tabs from '../components/Tabs.jsx';

// The pilot, from outside it.
//
// Three questions, which are the three a pilot actually asks: what did people
// tell us, what broke, and what did anybody actually use. Each of those had a
// home already — an endpoint — and no screen, which meant reading them took a
// terminal. A pilot whose findings need curl is a pilot nobody reads.
//
// Gated on ANNOUNCEMENT_AUTHORS, the same list the faults endpoint uses. Not a
// second gate of its own: two answers to "who is the operator" drift the first
// time one is edited, and the drift here would be somebody reading reports
// they were never meant to see.

function ago(iso) {
  if (!iso) return '—';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const KIND_LABEL = { confusing: 'Confused', wrong: 'Wrong', idea: 'Idea', other: 'Note' };

function Feedback() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get('/feedback').then(setData).catch((e) => setError(e.message));
  }, []);
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!data) return <p className="hint">Loading…</p>;
  if (!data.feedback.length) {
    return <div className="empty-state">Nothing reported yet. The Tell us tab is on every screen.</div>;
  }
  return data.feedback.map((f) => (
    <div className="card op-row" key={f.id}>
      <div className="op-main">
        <div className="op-body">{f.body}</div>
        <div className="hint">
          {f.userLabel}{f.role ? ` (${f.role})` : ''} · <code>{f.route}</code> · {ago(f.createdAt)}
        </div>
      </div>
      <span className={'pill' + (f.kind === 'wrong' ? ' is-warn' : '')}>
        {KIND_LABEL[f.kind] || f.kind}
      </span>
    </div>
  ));
}

function Faults() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  function load() {
    api.get('/errors').then(setData).catch((e) => setError(e.message));
  }
  useEffect(load, []);
  async function clear(fp) {
    try { await api.del(`/errors/${fp}`); load(); } catch (e) { setError(e.message); }
  }
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!data) return <p className="hint">Loading…</p>;
  if (!data.faults.length) {
    return <div className="empty-state">Nothing has broken. Faults land here on their own.</div>;
  }
  return (
    <>
      {!data.notifying && (
        <p className="hint">
          Recorded here only. Set an error webhook and these also interrupt somebody.
        </p>
      )}
      {data.faults.map((f) => (
        <div className="card op-row" key={f.fingerprint}>
          <div className="op-main">
            <div className="op-body">{f.message}</div>
            <div className="hint">
              {f.count} time{f.count === 1 ? '' : 's'} · {f.kind} · {f.route || '—'} · last {ago(f.lastAt)}
            </div>
          </div>
          <button className="btn btn-sm" type="button" onClick={() => clear(f.fingerprint)}>
            Clear
          </button>
        </div>
      ))}
    </>
  );
}

function Usage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get('/usage?days=14').then(setData).catch((e) => setError(e.message));
  }, []);
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!data) return <p className="hint">Loading…</p>;

  return (
    <>
      <p className="hint">
        The last {data.days} days. Counts and screens only — never anything anybody wrote.
      </p>

      {/* THE NUMBER THAT MATTERS MOST IN WEEK TWO, and the one nobody thinks to
          collect until it is too late to know: who is still opening it. */}
      <h4>Who is still here</h4>
      {data.people.length === 0
        ? <div className="empty-state">Nobody has used it in this window.</div>
        : data.people.map((p) => (
          <div className="card op-row" key={p.who + p.role}>
            <div className="op-main">
              <div className="op-body">{p.who || 'Someone'} <span className="hint">{p.role}</span></div>
              <div className="hint">{p.events} things done · last seen {ago(p.lastAt)}</div>
            </div>
          </div>
        ))}

      <h4 style={{ marginTop: 20 }}>Screens opened</h4>
      {data.screens.map((s) => (
        <div className="card op-row" key={s.route}>
          <div className="op-main">
            <div className="op-body"><code>{s.route}</code></div>
            <div className="hint">{s.views} views · {s.people} {s.people === 1 ? 'person' : 'people'}</div>
          </div>
        </div>
      ))}

      <h4 style={{ marginTop: 20 }}>What people did</h4>
      {data.events.filter((e) => e.event !== 'screen').length === 0
        ? <p className="hint">Only navigation so far.</p>
        : data.events.filter((e) => e.event !== 'screen').map((e) => (
          <div className="card op-row" key={e.event}>
            <div className="op-main"><div className="op-body">{e.event.replace(/_/g, ' ')}</div></div>
            <span className="pill">{e.count}</span>
          </div>
        ))}
    </>
  );
}

const TABS = [
  { id: 'feedback', label: 'What testers said' },
  { id: 'faults', label: 'What broke' },
  { id: 'usage', label: 'What was used' },
];

export default function Operator() {
  const [tab, setTab] = useState('feedback');
  return (
    <AppShell title="The pilot" guide="operator">
      <Tabs tabs={TABS} active={tab} onChange={setTab} label="Pilot sections" />
      {tab === 'feedback' && <Feedback />}
      {tab === 'faults' && <Faults />}
      {tab === 'usage' && <Usage />}
    </AppShell>
  );
}
