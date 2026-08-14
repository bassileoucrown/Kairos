import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import AppShell, { resolveActivePrincipal } from '../components/AppShell.jsx';
import { useAuth } from '../lib/AuthContext.jsx';

// The concierge desk, shown before it opens.
//
// Built visibly and marked plainly, the same way calendar sync and WhatsApp
// are: a principal deciding whether Kairos is the place their life goes should
// be able to see the shape of what is coming, and should never be unable to
// tell which parts work today.
//
// The difference from those two is stated rather than glossed. Calendar sync
// is gated on a credential — somebody sets an environment variable and it goes
// live. This is gated on people: a contracted, vetted network who answer at
// 2am in the city the principal is actually in. There is no key that turns
// that on, so nothing here offers to "connect".
//
// And there is no request box. The obvious placeholder — a form that takes a
// request and returns a friendly message — would be a lie told to somebody at
// the exact moment they were relying on us. The one thing this screen accepts
// is an expression of interest, which is real, is kept, and says on its face
// that it reaches Exousia rather than a concierge.

export default function Concierge() {
  const { user } = useAuth();
  const [ownerId, setOwnerId] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => { resolveActivePrincipal(user).then(setOwnerId); }, [user]);
  useEffect(() => {
    if (!ownerId) return;
    api.get(`/concierge/${ownerId}`).then(setData).catch((e) => setError(e.message));
  }, [ownerId]);

  async function toggle(service, on) {
    setBusy(service);
    setError('');
    try {
      const d = on
        ? await api.post(`/concierge/${ownerId}/interest`, { service })
        : await api.del(`/concierge/${ownerId}/interest/${service}`);
      setData((prev) => ({ ...prev, interest: d.interest }));
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  }

  if (!data) {
    return <AppShell title="Concierge" active="concierge"><p className="hint">Loading…</p></AppShell>;
  }

  const wanted = new Set(data.interest.map((i) => i.service));

  return (
    <AppShell title="Concierge" active="concierge">
      {error && <div className="alert alert-error">{error}</div>}

      {!data.available && (
        <div className="card soon-banner">
          <div className="soon-head">
            <h2>Not open yet</h2>
            <span className="pill is-off">Coming</span>
          </div>
          <p>{data.reason}</p>
          <p className="hint">
            Everything else on this screen is a description of what it will do, not
            something you can use today. Nothing here reaches anybody.
          </p>
        </div>
      )}

      <p className="tz-note" style={{ marginBottom: 16 }}>
        A concierge desk is the part of this that is not software: somebody who takes
        “find me a table for four at eight, it is my wife’s birthday” and comes back
        with it done. Kairos already holds the things such a desk needs — the diary,
        the trip, the household, who matters and when their anniversary falls — so
        when it opens it will not be starting from an empty conversation.
      </p>

      {data.services.map((s) => (
        <div className="card soon-service" key={s.id}>
          <div>
            <div className="name">{s.label}</div>
            <div className="meta">{s.detail}</div>
          </div>
          <button
            className={`btn btn-sm${wanted.has(s.id) ? '' : ' btn-secondary'}`}
            type="button"
            disabled={busy === s.id}
            onClick={() => toggle(s.id, !wanted.has(s.id))}
          >
            {wanted.has(s.id) ? 'Wanted ✓' : 'I would use this'}
          </button>
        </div>
      ))}

      <p className="hint" style={{ marginTop: 14 }}>
        Marking one records it against this account and tells Exousia what to open
        first. It does not raise a request, and nobody is waiting on the other end
        of it yet.
      </p>
    </AppShell>
  );
}
