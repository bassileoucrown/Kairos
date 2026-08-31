import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import AppShell from '../components/AppShell.jsx';

// Everything not working yet, in one place, by name.
//
// The placeholders scattered through the app answer "what is this button?"
// where somebody happens to be standing. This answers the other question —
// "what else is coming?" — which is the one asked by somebody being shown the
// product rather than using it, and which no amount of in-place marking will
// ever answer, because nobody clicks through eight screens to assemble a list.
//
// It reads from the same registry as the placeholders, so it cannot drift from
// them and it cannot outlive them: when a capability starts working it drops
// off this page and its placeholder disappears, in the same instant, from one
// fact on the server.

// Where each screen id actually is. `to` is optional, deliberately: an
// appointment and a room are always a PARTICULAR one, so there is no address
// to send somebody to and a link would have to invent a destination. Those
// read as a place instead — which is still an answer, and a truthful one.
const WHERE = {
  itinerary: { label: 'Itinerary', to: '/itinerary' },
  trips: { label: 'Trips', to: '/trips' },
  vault: { label: 'Essentials', to: '/dashboard?tab=essentials' },
  direct_line: { label: 'The direct line', to: '/today' },
  concierge: { label: 'Concierge', to: '/concierge' },
  settings: { label: 'Settings', to: '/dashboard?tab=settings' },
  ai_assist: { label: 'AI Assist', to: '/pa?tab=ai_assist' },
  catch_up: { label: 'While you were away', to: '/catch-up' },
  mail: { label: 'Correspondence', to: '/mail' },
  report: { label: 'the weekly report', to: '/report' },
  appointment: { label: 'any appointment' },
  thread: { label: 'any room' },
};

export default function Coming() {
  const [caps, setCaps] = useState(null);

  useEffect(() => {
    api.get('/capabilities').then((d) => setCaps(d.capabilities)).catch(() => setCaps([]));
  }, []);

  if (!caps) {
    return <AppShell title="Coming" active="coming"><p className="hint">Loading…</p></AppShell>;
  }

  const waiting = caps.filter((c) => !c.available);
  const working = caps.filter((c) => c.available);

  return (
    <AppShell title="Coming" active="coming">
      <p className="tz-note" style={{ marginBottom: 18 }}>
        Everything here is designed and placed in the app, and none of it works yet. Each one
        appears on its own screen as a named control that says so when pressed — nothing is
        hidden and nothing pretends. When the thing behind it starts working, it disappears
        from this page by itself.
      </p>

      {waiting.length === 0 && (
        <div className="empty-state">Everything on this deployment is working.</div>
      )}

      {waiting.map((c) => {
        const soon = c.state === 'soon' || !c.needs?.length;
        const where = WHERE[c.screen];
        return (
          <div className="card coming-row" key={c.id}>
            <div>
              <div className="coming-head">
                <span className="name">{c.label}</span>
                <span className={`notyet${soon ? '' : ' is-key'}`}>
                  {soon ? 'Coming soon' : 'Not available yet'}
                </span>
              </div>
              <div className="meta">{c.what}</div>
              <div className="hint">
                Appears on{' '}
                {where?.to
                  ? <Link to={where.to}>{where.label}</Link>
                  : (where?.label || c.screen)}
                {c.control && <> as <strong>{c.control}</strong></>}
                {!soon && c.needs?.length > 0 && (
                  <> · waiting on {c.needs.map((n) => <code key={n}>{n}</code>)}</>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {working.length > 0 && (
        <>
          <h3 className="ess-heading">Working on this deployment</h3>
          {working.map((c) => (
            <div className="card coming-row is-on" key={c.id}>
              <div>
                <div className="coming-head">
                  <span className="name">{c.label}</span>
                  <span className="pill">On</span>
                </div>
                <div className="meta">{c.what}</div>
              </div>
            </div>
          ))}
        </>
      )}
    </AppShell>
  );
}
