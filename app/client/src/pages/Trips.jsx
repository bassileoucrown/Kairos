import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import AppShell, { resolveActivePrincipal } from '../components/AppShell.jsx';
import { useAuth } from '../lib/AuthContext.jsx';

// Trips.
//
// The screen exists because a journey is not a pile of appointments. Everything
// here answers a question a day sheet cannot: which timezone am I actually in
// on Thursday, who is meeting me at the far end and on whose number, does this
// passport survive the trip, and what is the phrase so nobody has to hold up a
// board with my name on it.

function dayCount(a, b) {
  const days = Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;
  return days > 0 ? days : 1;
}

function StatusPill({ status }) {
  if (status === 'confirmed') return <span className="pill">Confirmed</span>;
  if (status === 'proposed') return <span className="pill is-warn">Waiting on you</span>;
  if (status === 'cancelled') return <span className="pill is-off">Cancelled</span>;
  return <span className="pill is-off">Draft</span>;
}

/**
 * The phrase, and the card address alongside it exactly once.
 *
 * The address is returned by the server only when a pickup is armed and is
 * never part of reading a trip back — so it lives in component state for as
 * long as this screen is open, and is gone on reload. That is deliberate: it
 * is a credential for a driver, not a property of the journey.
 */
function Pickup({ item, freshCard, onArm, onDisarm }) {
  if (!item.pickupArmed && !item.pickupCode) {
    return (
      <button className="btn btn-sm" type="button" onClick={() => onArm(item.id)}>
        Arrange a meeting phrase
      </button>
    );
  }
  return (
    <div className="trip-pickup">
      <div className="trip-phrase">
        <span className="hint">Meeting phrase</span>
        <code>{item.pickupCode}</code>
      </div>
      <p className="hint">
        Nobody holds up a name. Whoever speaks first, the other answers.
      </p>
      {freshCard && (
        <div className="trip-card-link">
          <span className="hint">Send this to the driver — shown once:</span>
          <code>{window.location.origin}{freshCard}</code>
        </div>
      )}
      <div className="code-actions">
        <button className="btn btn-sm" type="button" onClick={() => onArm(item.id)}>
          New phrase and link
        </button>
        <button className="btn btn-danger btn-sm" type="button" onClick={() => onDisarm(item.id)}>
          Turn off
        </button>
      </div>
    </div>
  );
}

function TripDetail({ ownerId, tripId, arrangements, onBack, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [cards, setCards] = useState({});

  function load() {
    return api.get(`/trips/${ownerId}/${tripId}`).then(setData).catch((e) => setError(e.message));
  }
  useEffect(() => { load(); }, [tripId]);

  async function act(fn) {
    setError('');
    try { await fn(); load(); onChanged?.(); } catch (e) { setError(e.message); }
  }

  async function arm(itemId) {
    setError('');
    try {
      const d = await api.post(`/itinerary/${ownerId}/items/${itemId}/pickup`);
      setCards((c) => ({ ...c, [itemId]: d.cardPath }));
      load();
    } catch (e) { setError(e.message); }
  }

  const disarm = (itemId) => act(async () => {
    await api.del(`/itinerary/${ownerId}/items/${itemId}/pickup`);
    setCards((c) => ({ ...c, [itemId]: null }));
  });

  if (!data) return <p className="hint">Loading…</p>;
  const { trip, items, travellers, contacts, documentWarnings } = data;
  const label = (id) => arrangements.find((a) => a.id === id)?.label || id;

  return (
    <div className="trip-detail">
      <button className="link-button" type="button" onClick={onBack}>← All trips</button>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card trip-head">
        <div>
          <h2>{trip.name}</h2>
          <div className="meta">
            {trip.destination || 'No destination set'} · {trip.startsOn} → {trip.endsOn}
            {' · '}{dayCount(trip.startsOn, trip.endsOn)} days
          </div>
          {trip.destinationTimezone && (
            <p className="hint">
              While confirmed, days in this range are drawn in{' '}
              <strong>{trip.destinationTimezone}</strong> rather than the home zone.
            </p>
          )}
        </div>
        <StatusPill status={trip.status} />
      </div>

      {trip.status !== 'confirmed' && (
        <button
          className="btn btn-primary btn-sm"
          type="button"
          onClick={() => act(() => api.patch(`/trips/${ownerId}/${tripId}`, { status: 'confirmed' }))}
        >
          Confirm this trip
        </button>
      )}

      {/* Checked against the trip's own dates. A passport with four months left
          is in date this morning and still turns somebody away at check-in,
          because much of the world wants six months beyond arrival. */}
      {documentWarnings.length > 0 && (
        <div className="alert alert-warning">
          <strong>Documents worth checking before this trip.</strong>
          <ul className="trip-warnings">
            {documentWarnings.map((w) => (
              <li key={w.essentialId}>
                {w.label || w.field} — {w.severity === 'expired'
                  ? `expires ${w.expiresOn}, before the trip ends`
                  : `expires ${w.expiresOn}, under six months after arrival`}
              </li>
            ))}
          </ul>
        </div>
      )}

      <h3 className="ess-heading">The journey</h3>
      {items.length === 0 && <div className="empty-state">Nothing added to this trip yet.</div>}
      {items.map((i) => (
        <div className="card trip-item" key={i.id}>
          <div className="trip-item-head">
            <span className="trip-kind">{i.kind}</span>
            <strong>{i.title}</strong>
            {i.status !== 'confirmed' && <StatusPill status={i.status} />}
          </div>
          <div className="meta">
            {new Date(i.startAt).toLocaleString()}
            {i.terminal && ` · Terminal ${i.terminal}`}
            {i.seat && ` · Seat ${i.seat}`}
            {i.reference && ` · ${i.reference}`}
          </div>
          {i.location && <div className="meta">{i.location}{i.destination ? ` → ${i.destination}` : ''}</div>}

          {/* Who is meeting them, and on whose number. Away from home there is
              no household driver — the whole reason this exists. */}
          {i.kind === 'car' && (
            <div className="trip-arrangement">
              <div className="meta">
                <strong>{i.arrangement ? label(i.arrangement) : 'No arrangement recorded'}</strong>
                {i.provider && ` · ${i.provider}`}
              </div>
              {(i.contactName || i.contactPhone) && (
                <div className="meta">
                  Call {i.contactName || 'them'}{i.contactPhone ? ` on ${i.contactPhone}` : ''}
                </div>
              )}
              {i.arrangement !== 'own_way' && (
                <Pickup item={i} freshCard={cards[i.id]} onArm={arm} onDisarm={disarm} />
              )}
            </div>
          )}
        </div>
      ))}

      <h3 className="ess-heading">Who else is going</h3>
      {travellers.length === 0 && <div className="empty-state">Travelling alone.</div>}
      {travellers.map((t) => (
        <div className="card ess-row" key={t.id}>
          <div><strong>{t.name}</strong>{t.role && <span className="meta"> · {t.role}</span>}</div>
          <button
            className="btn btn-danger btn-sm" type="button"
            onClick={() => act(() => api.del(`/trips/${ownerId}/${tripId}/travellers/${t.id}`))}
          >
            Remove
          </button>
        </div>
      ))}
      <AddRow
        fields={[['name', 'Name'], ['role', 'Spouse, aide, security…']]}
        submitLabel="Add traveller"
        onSubmit={(body) => act(() => api.post(`/trips/${ownerId}/${tripId}/travellers`, body))}
      />

      <h3 className="ess-heading">Who to call there</h3>
      {contacts.length === 0 && <div className="empty-state">No local contacts yet.</div>}
      {contacts.map((c) => (
        <div className="card ess-row" key={c.id}>
          <div>
            <strong>{c.name}</strong>
            {c.role && <span className="meta"> · {c.role}</span>}
            {c.phone && <div className="meta">{c.phone}</div>}
          </div>
          <button
            className="btn btn-danger btn-sm" type="button"
            onClick={() => act(() => api.del(`/trips/${ownerId}/${tripId}/contacts/${c.id}`))}
          >
            Remove
          </button>
        </div>
      ))}
      <AddRow
        fields={[['name', 'Name'], ['role', 'The office, the host…'], ['phone', 'Phone']]}
        submitLabel="Add contact"
        onSubmit={(body) => act(() => api.post(`/trips/${ownerId}/${tripId}/contacts`, body))}
      />
    </div>
  );
}

/** A one-line form, because these are all name-plus-a-detail. */
function AddRow({ fields, submitLabel, onSubmit }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({});
  if (!open) {
    return (
      <button className="btn btn-sm" type="button" onClick={() => setOpen(true)}>{submitLabel}</button>
    );
  }
  return (
    <form
      className="card trip-add"
      onSubmit={(e) => { e.preventDefault(); onSubmit(form); setForm({}); setOpen(false); }}
    >
      {fields.map(([key, placeholder]) => (
        <input
          key={key} type="text" placeholder={placeholder} aria-label={placeholder}
          value={form[key] || ''} required={key === 'name'}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        />
      ))}
      <button className="btn btn-primary btn-sm" type="submit">{submitLabel}</button>
      <button className="btn btn-sm" type="button" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}

export default function Trips() {
  const { user } = useAuth();
  const [ownerId, setOwnerId] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', destination: '', destinationTimezone: '', startsOn: '', endsOn: '' });

  // Which principal this is for — an assistant may support several, and the
  // shell's switcher decides.
  useEffect(() => { resolveActivePrincipal(user).then(setOwnerId); }, [user]);

  function load() {
    if (!ownerId) return Promise.resolve();
    return api.get(`/trips/${ownerId}`).then(setData).catch((e) => setError(e.message));
  }
  useEffect(() => { load(); }, [ownerId]);

  async function create(e) {
    e.preventDefault();
    setError('');
    try {
      const d = await api.post(`/trips/${ownerId}`, form);
      setCreating(false);
      setForm({ name: '', destination: '', destinationTimezone: '', startsOn: '', endsOn: '' });
      await load();
      setOpenId(d.trip.id);
    } catch (err) { setError(err.message); }
  }

  if (!data) return <AppShell title="Trips" active="trips"><p className="hint">Loading…</p></AppShell>;

  return (
    <AppShell
      title="Trips"
      active="trips"
      actions={!openId && !creating
        ? <button className="btn btn-primary btn-sm" type="button" onClick={() => setCreating(true)}>Plan a trip</button>
        : null}
    >
      {error && <div className="alert alert-error">{error}</div>}

      {openId ? (
        <TripDetail
          ownerId={ownerId}
          tripId={openId}
          arrangements={data.arrangements || []}
          onBack={() => { setOpenId(null); load(); }}
          onChanged={load}
        />
      ) : (
        <>
          {creating && (
            <form className="card trip-form" onSubmit={create}>
              <div className="field">
                <label htmlFor="trip-name">What to call it</label>
                <input
                  id="trip-name" type="text" required placeholder="London, board week"
                  value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="code-row">
                <div className="field">
                  <label htmlFor="trip-dest">Where</label>
                  <input
                    id="trip-dest" type="text" placeholder="London"
                    value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="trip-tz">Timezone there</label>
                  <input
                    id="trip-tz" type="text" placeholder="Europe/London"
                    value={form.destinationTimezone}
                    onChange={(e) => setForm({ ...form, destinationTimezone: e.target.value })}
                  />
                  <p className="hint">
                    Once the trip is confirmed, your days in this range are drawn in this zone
                    instead of your home one.
                  </p>
                </div>
              </div>
              <div className="code-row">
                <div className="field">
                  <label htmlFor="trip-from">First day</label>
                  <input
                    id="trip-from" type="date" required
                    value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="trip-to">Last day</label>
                  <input
                    id="trip-to" type="date" required
                    value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })}
                  />
                </div>
              </div>
              <div className="code-actions">
                <button className="btn btn-primary btn-sm" type="submit">Create</button>
                <button className="btn btn-sm" type="button" onClick={() => setCreating(false)}>Cancel</button>
              </div>
            </form>
          )}

          {data.trips.length === 0 && !creating && (
            <div className="empty-state">
              No trips yet. A trip holds the flights, the cars, who is meeting you at the far end,
              and the timezone your days should be drawn in while you are there.
            </div>
          )}

          {data.trips.map((t) => (
            <button className="card trip-row" key={t.id} type="button" onClick={() => setOpenId(t.id)}>
              <div>
                <strong>{t.name}</strong>
                <div className="meta">
                  {t.destination || '—'} · {t.startsOn} → {t.endsOn}
                  {t.destinationTimezone ? ` · ${t.destinationTimezone}` : ''}
                </div>
              </div>
              <StatusPill status={t.status} />
            </button>
          ))}
        </>
      )}
    </AppShell>
  );
}
