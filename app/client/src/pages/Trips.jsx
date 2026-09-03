import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import AppShell, { resolveActivePrincipal } from '../components/AppShell.jsx';
import SignalPanel from '../components/SignalPanel.jsx';
import TimezonePicker from '../components/TimezonePicker.jsx';
import { FlightChainForm, SingleLegForm } from '../components/JourneyForms.jsx';
import SoonButton from '../components/SoonButton.jsx';
import VisaPanel from '../components/VisaPanel.jsx';
import { useSignal } from '../lib/useSignal.js';
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
 * What to look for in the hall, and the tap that ends the search.
 *
 * The phrase below proves who somebody is once two people are face to face.
 * This is the part that gets them face to face: the same colour and shape the
 * driver is holding up, refreshed from the server so both screens change
 * together. See lib/pickupSignal.js.
 */
function Finder({ ownerId, item }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const path = `/itinerary/${ownerId}/items/${item.id}/signal`;
  // Slowly: this screen is often open days before the journey, and the tap
  // that matters is made here rather than learned from elsewhere. The rotation
  // still lands on time — that is scheduled, not polled.
  const { signal, setSignal } = useSignal(path, {
    enabled: !!item.pickupArmed, heartbeatMs: 20000,
  });

  async function found(yes) {
    setBusy(true); setError('');
    try {
      const d = yes ? await api.post(`${path}/found`) : await api.del(`${path}/found`);
      setSignal(d.signal);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  if (!signal) return null;

  return (
    <div className="trip-finder">
      <span className="hint">Look for</span>
      <SignalPanel signal={signal} muted={signal.found} />
      {error && <p className="hint is-error">{error}</p>}
      {signal.found ? (
        <>
          <p className="hint">
            Confirmed — their screen has changed and they will stay put.
          </p>
          <button className="btn btn-sm" type="button" disabled={busy} onClick={() => found(false)}>
            Not them
          </button>
        </>
      ) : (
        <>
          <p className="hint">
            This changes every minute, and so does theirs. Nobody else in the
            hall learns anything from it.
          </p>
          <button className="btn btn-sm" type="button" disabled={busy} onClick={() => found(true)}>
            That&apos;s them
          </button>
        </>
      )}
    </div>
  );
}

/**
 * The phrase, and the card address alongside it exactly once.
 *
 * The address is returned by the server only when a pickup is armed and is
 * never part of reading a trip back — so it lives in component state for as
 * long as this screen is open, and is gone on reload. That is deliberate: it
 * is a credential for a driver, not a property of the journey.
 */
function Pickup({ ownerId, item, freshCard, onArm, onDisarm }) {
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
      {item.pickupArmed && <Finder ownerId={ownerId} item={item} />}
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

/**
 * Who the principal has let in on a private journey.
 *
 * The point of a private trip is that the principal CHOOSES, not that nobody
 * knows — so there has to be a way to name somebody, and a way to take it
 * back. Only people already in the office can be named: sharing a private
 * journey with a stranger is a different act, and not one this control does.
 */
function Shares({ ownerId, tripId }) {
  const [rows, setRows] = useState(null);
  const [members, setMembers] = useState([]);
  const [pick, setPick] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    Promise.all([
      api.get(`/trips/${ownerId}/${tripId}/shares`),
      api.get('/members').catch(() => ({ members: [] })),
    ]).then(([s, m]) => {
      setRows(s.shares || []);
      // Accepted invitations only: an outstanding one has no account behind
      // it, so there is nobody to tell yet.
      setMembers((m.members || []).filter((x) => x.status === 'active' && x.memberUserId));
    }).catch((e) => setError(e.message));
  }, [ownerId, tripId]);
  useEffect(load, [load]);

  async function add() {
    if (!pick) return;
    setError('');
    try { await api.post(`/trips/${ownerId}/${tripId}/shares`, { userId: pick }); setPick(''); load(); }
    catch (e) { setError(e.message); }
  }
  async function drop(userId) {
    setError('');
    try { await api.del(`/trips/${ownerId}/${tripId}/shares/${userId}`); load(); }
    catch (e) { setError(e.message); }
  }

  if (!rows) return <p className="hint">Loading…</p>;
  const told = new Set(rows.map((r) => r.userId));
  const canAdd = members.filter((m) => !told.has(m.memberUserId));

  return (
    <div style={{ marginTop: 10 }}>
      <h4 style={{ marginBottom: 6 }}>Who knows</h4>
      {error && <div className="alert alert-error">{error}</div>}
      {rows.length === 0 ? (
        <p className="hint">
          Only you, and whoever arranged it. Name somebody below if you want them told.
        </p>
      ) : rows.map((r) => (
        <div className="ess-row" key={r.id}>
          <div className="ess-main">
            <div className="ess-label">{r.name}</div>
            <div className="hint">{r.email}</div>
          </div>
          <div className="ess-buttons">
            <button className="btn btn-sm" type="button" onClick={() => drop(r.userId)}>
              Stop telling them
            </button>
          </div>
        </div>
      ))}
      {canAdd.length > 0 && (
        <div className="code-actions" style={{ marginTop: 8 }}>
          <select
            aria-label="Tell somebody about this trip"
            value={pick} onChange={(e) => setPick(e.target.value)}
            style={{ width: 'auto' }}
          >
            <option value="">Tell somebody…</option>
            {canAdd.map((m) => (
              <option key={m.memberUserId} value={m.memberUserId}>{m.memberName || m.invitedEmail}</option>
            ))}
          </select>
          <button className="btn btn-sm" type="button" disabled={!pick} onClick={add}>Add</button>
        </div>
      )}
    </div>
  );
}

function TripDetail({ ownerId, tripId, arrangements, homeTimezone, isPrincipal = false, onBack, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [cards, setCards] = useState({});
  const [adding, setAdding] = useState(null);
  const [deleting, setDeleting] = useState(false);
  // Its own flag rather than borrowing `deleting`, which means something else.
  const [saving, setSaving] = useState(false);

  function load() {
    return api.get(`/trips/${ownerId}/${tripId}`).then(setData).catch((e) => setError(e.message));
  }

  /**
   * Whose business this journey is. Principal only, enforced on the server —
   * this is the request, not the decision.
   */
  async function setVisibility(visibility) {
    setSaving(true); setError('');
    try {
      await api.patch(`/trips/${ownerId}/${tripId}/visibility`, { visibility });
      await load();
      onChanged?.();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
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
  const { trip, items, travellers, contacts, documentWarnings, visa, journeys = [] } = data;
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

      {/* WHOSE JOURNEY THIS IS.
          A board trip is work and the office arranging it is the point. A
          family holiday is not, and an office that can see it holds a pattern
          of a private person's movements. The switch existed on the server and
          nowhere on a screen, so the choice was the principal's in theory and
          nobody's in practice.
          Only the principal is shown it: an assistant who could mark a trip
          private could hide movements from the office that needs them. */}
      {isPrincipal && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="ess-row">
            <div className="ess-main">
              <div className="ess-label">
                {trip.visibility === 'private' ? 'Private journey' : 'The office can see this'}
              </div>
              <p className="hint">
                {trip.visibility === 'private'
                  ? 'Absent from the office entirely — no title, no destination, no dates. '
                    + 'They are told only that the days are unavailable, so nothing is booked over it.'
                  : 'On the office\'s list like any other trip.'}
              </p>
            </div>
            <div className="ess-buttons">
              <button
                className="btn btn-sm" type="button" disabled={saving}
                onClick={() => setVisibility(trip.visibility === 'private' ? 'office' : 'private')}
              >
                {trip.visibility === 'private' ? 'Let the office see it' : 'Make it private'}
              </button>
            </div>
          </div>
          {trip.visibility === 'private' && (
            <Shares ownerId={ownerId} tripId={trip.id} />
          )}
        </div>
      )}

      <div className="code-actions">
        {trip.status !== 'confirmed' && trip.status !== 'cancelled' && (
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={() => act(() => api.patch(`/trips/${ownerId}/${tripId}`, { status: 'confirmed' }))}
          >
            Confirm this trip
          </button>
        )}
        {/* Two ways out, and the difference is the point. Cancelling keeps the
            flight in the diary, because a cancelled trip is exactly when
            somebody still has to ring the airline. */}
        {trip.status !== 'cancelled' && (
          <button
            className="itin-tool"
            type="button"
            onClick={() => act(() => api.post(`/trips/${ownerId}/${tripId}/cancel`))}
          >
            Cancel the trip
          </button>
        )}
        {trip.status === 'cancelled' && (
          <button
            className="itin-tool"
            type="button"
            onClick={() => act(() => api.patch(`/trips/${ownerId}/${tripId}`, { status: 'draft' }))}
          >
            Reinstate it
          </button>
        )}
        <button className="itin-tool is-danger" type="button" onClick={() => setDeleting(true)}>
          Delete
        </button>
      </div>

      {trip.status === 'cancelled' && (
        <div className="alert" style={{ marginTop: 12 }}>
          This trip is cancelled. Its days are drawn in the home timezone again, and
          anything below is still in the diary — cancelling the journey does not
          cancel the bookings, and somebody still has to.
        </div>
      )}

      {deleting && (
        <DeleteTrip
          ownerId={ownerId}
          tripId={tripId}
          name={trip.name}
          onCancel={() => setDeleting(false)}
          onDeleted={() => { setDeleting(false); onBack(); }}
        />
      )}

      {/* Checked against the trip's own dates. A passport with four months left
          is in date this morning and still turns somebody away at check-in,
          because much of the world wants six months beyond arrival. */}
      {documentWarnings.length > 0 && (
        <div className="alert alert-warning">
          <strong>Documents worth checking before this trip.</strong>
          {/* Each line is a summary of a document held elsewhere, and naming a
              passport without offering a way to reach it leaves the reader to
              go and find which one. The link lands on that exact row. */}
          <ul className="trip-warnings">
            {documentWarnings.map((w) => (
              <li key={w.essentialId}>
                <Link to={`/dashboard?tab=essentials&essential=${w.essentialId}`}>
                  {w.label || w.field}
                </Link>
                {' — '}
                {w.severity === 'expired'
                  ? `expires ${w.expiresOn}, before the trip ends`
                  : `expires ${w.expiresOn}, under six months after arrival`}
              </li>
            ))}
          </ul>
        </div>
      )}

      <h3 className="ess-heading">Getting in</h3>
      <VisaPanel ownerId={ownerId} visa={visa} onChanged={load} />
      <div className="code-actions">
        <SoonButton feature="visa_rules" />
        <SoonButton feature="inbound_email" />
      </div>

      <h3 className="ess-heading">The journey</h3>

      {/* This section was read-only, so a trip stayed an empty list and
          everything the screen can draw about a leg — the arrangement, the
          number to ring, the meeting phrase, the signal — never appeared,
          because nothing ever reached the condition that renders it. */}
      {adding === 'flight' && (
        <FlightChainForm
          ownerId={ownerId} trip={trip} homeTimezone={homeTimezone}
          arrangements={arrangements}
          onCancel={() => setAdding(null)}
          onDone={(d) => {
            setAdding(null);
            // The arrival pickup is armed as part of building the chain, and
            // its card address is returned exactly once. Hold it the same way
            // arming by hand does, so it can be sent to the driver now.
            if (d?.arrivalPickup?.itemId) {
              setCards((c) => ({ ...c, [d.arrivalPickup.itemId]: d.arrivalPickup.cardPath }));
            }
            load(); onChanged?.();
          }}
        />
      )}
      {adding === 'one' && (
        <SingleLegForm
          ownerId={ownerId} trip={trip} homeTimezone={homeTimezone}
          arrangements={arrangements}
          onCancel={() => setAdding(null)}
          onDone={() => { setAdding(null); load(); onChanged?.(); }}
        />
      )}
      {!adding && (
        <div className="code-actions">
          <button className="btn btn-primary btn-sm" type="button" onClick={() => setAdding('flight')}>
            Add a flight
          </button>
          <button className="btn btn-sm" type="button" onClick={() => setAdding('one')}>
            Add something else
          </button>
        </div>
      )}

      {items.length === 0 && !adding && (
        <div className="empty-state">
          Nothing in this trip yet. Adding the flight also builds the car to the airport,
          the transfer at the far end, and the phrase that meets you there.
        </div>
      )}
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
          {i.kind === 'flight' && (
            <div className="code-actions"><SoonButton feature="flight_status" /></div>
          )}
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
                <Pickup ownerId={ownerId} item={i} freshCard={cards[i.id]} onArm={arm} onDisarm={disarm} />
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

      {/* GETTING THERE AND AROUND.
          The cars, on the trip, which until now they never were: the column
          linking them has existed since movements were built and nothing ever
          filled it, so a trip to Abuja and the car to the airport for it were
          two records that did not know about each other.
          SHOWN TO FEWER PEOPLE THAN THE TRIP IS. A movement admits the
          principal and whoever arranged it — deliberately narrower than the
          office — so somebody the principal has shared this trip with sees the
          trip in full and the cars not at all. The server filters; this only
          arranges what it is given, and an empty list here is not evidence
          that there are no journeys. */}
      <h3 className="ess-heading">Getting there and around</h3>
      {journeys.length === 0
        ? (
          <div className="empty-state">
            No cars filed under this trip yet.{' '}
            <Link to="/movements?tab=journeys">Arrange one on Movements</Link> and it will
            offer to file it here.
          </div>
        )
        : journeys.map((j) => (
          <div className="card ess-row" key={j.id}>
            <div>
              <strong>{j.title}</strong>
              <div className="meta">
                {new Date(j.departsAt).toLocaleString(undefined, {
                  weekday: 'short', day: 'numeric', month: 'short',
                  hour: '2-digit', minute: '2-digit',
                })}
                {' · '}
                {j.departsFrom || '—'} → {j.destination || '—'}
              </div>
              {/* The one fact that matters after the fact. */}
              <div className="meta">
                {j.arrivedAt ? 'Arrived' : 'No arrival recorded yet'}
              </div>
            </div>
            <Link className="btn btn-sm" to={`/movements?tab=journeys&movement=${j.id}`}>
              Open
            </Link>
          </div>
        ))}

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

/**
 * Deleting a trip, having first said what that takes with it.
 *
 * The count is fetched rather than guessed, because "this also removes 6
 * things from the diary" is the whole reason somebody would stop and choose
 * Cancel instead. A confirmation that says "are you sure?" and nothing else
 * is a button with an extra step.
 */
function DeleteTrip({ ownerId, tripId, name, onCancel, onDeleted }) {
  const [what, setWhat] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/trips/${ownerId}/${tripId}/deletion`).then(setWhat).catch((e) => setError(e.message));
  }, [ownerId, tripId]);

  async function go() {
    setBusy(true); setError('');
    try {
      await api.del(`/trips/${ownerId}/${tripId}`);
      onDeleted();
    } catch (e) { setError(e.message); setBusy(false); }
  }

  const parts = what ? [
    what.items && `${what.items} thing${what.items === 1 ? '' : 's'} in the diary`,
    what.travellers && `${what.travellers} traveller${what.travellers === 1 ? '' : 's'}`,
    what.contacts && `${what.contacts} local contact${what.contacts === 1 ? '' : 's'}`,
  ].filter(Boolean) : [];

  return (
    <div className="card danger-zone" style={{ marginTop: 12 }}>
      <strong>Delete “{name}”?</strong>
      {error && <div className="alert alert-error" style={{ marginTop: 8 }}>{error}</div>}
      {!what && !error && <p className="hint">Checking what this would remove…</p>}
      {what?.needsPrincipal && (
        <p className="hint">
          This trip is confirmed, so it is drawing their days in another timezone —
          only the principal can delete it. Cancel it instead, or ask them.
        </p>
      )}
      {what && !what.needsPrincipal && (
        <p className="hint">
          {parts.length === 0
            ? 'Nothing else goes with it — the trip is empty.'
            : `This also removes ${parts.join(', ')}. Cancelling instead keeps all of it and just marks the journey as not happening.`}
        </p>
      )}
      <div className="code-actions">
        <button
          className="btn btn-danger btn-sm"
          type="button"
          disabled={busy || !what || what.needsPrincipal}
          onClick={go}
        >
          {busy ? 'Deleting…' : 'Delete it'}
        </button>
        <button className="btn btn-sm" type="button" onClick={onCancel}>Keep it</button>
      </div>
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
      guide="trips"
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
          homeTimezone={user?.timezone || 'UTC'}
          // Only the principal may make a journey private or say who knows.
          // Decided here where the viewer is known, rather than by the detail
          // component guessing from an id it was handed.
          isPrincipal={!!user && user.id === ownerId}
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
                  {/* This used to be free text with "Europe/London" for a
                      placeholder, which is a spelling test: type "London" and
                      the server correctly refuses, having no way to say what
                      the right answer would have looked like. */}
                  <TimezonePicker
                    id="trip-tz"
                    value={form.destinationTimezone}
                    onChange={(tz) => setForm({ ...form, destinationTimezone: tz })}
                    emptyLabel="Same as home"
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
