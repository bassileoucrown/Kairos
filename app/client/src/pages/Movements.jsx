import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AppShell, { resolveActivePrincipal } from '../components/AppShell.jsx';
import Tabs from '../components/Tabs.jsx';
import { useAuth } from '../lib/AuthContext.jsx';
import { api } from '../lib/api.js';

// Getting the principal there on the ground, and the cars it is done in.
//
// WHY THIS IS NOT A TAB ON TRIPS. A trip is a flight and a hotel and a week in
// another timezone. Most movements are none of those: the school run, the
// office to a meeting across Lagos, the airport at 5am. Filing them under
// Trips would mean inventing an empty trip to hold the one journey that
// mattered, and the journey that mattered is the one nobody would bother to
// file.
//
// WHAT THE SCREEN HAS TO CARRY THAT OTHERS DO NOT. Two viewers see different
// amounts of the same journey, and the smaller of the two must be able to tell
// that it is the smaller. So the partial view says so at the top, in words,
// with a count — see lib/movement.js. A screen that silently showed a
// stand-in four fields instead of six would have them telling somebody there
// is no escort.

const PERSON_ROLES = [
  ['driver', 'Driver'],
  ['aide', 'Aide'],
  ['escort_lead', 'Escort lead'],
  ['police_escort', 'Police escort'],
  ['other', 'Someone else'],
];

const VEHICLE_ROLES = [
  ['principal', 'Principal’s car'],
  ['lead', 'Lead car'],
  ['backup', 'Backup car'],
];

const PAPER_KINDS = [
  ['insurance', 'Insurance'],
  ['roadworthiness', 'Roadworthiness'],
  ['licence', 'Licence'],
  ['permit', 'Permit'],
];

const DAY_LABELS = [['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'], ['6', 'Sat'], ['0', 'Sun']];

function label(pairs, key) {
  return (pairs.find(([k]) => k === key) || [null, key])[1];
}

function when(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

/** The same verdict a passport gets, said the same way. */
function PaperPill({ paper }) {
  if (!paper.expiresOn) return <span className="hint">No date recorded</span>;
  if (paper.state === 'expired') return <span className="pill is-off">Expired</span>;
  if (paper.state === 'expiring') return <span className="pill is-warn">Expires {paper.expiresOn}</span>;
  return <span className="hint">Valid to {paper.expiresOn}</span>;
}

// --- The cars ----------------------------------------------------------------

function Papers({ ownerId, vehicle, onChanged }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ kind: 'insurance', reference: '', expiresOn: '' });
  const [error, setError] = useState('');

  async function add(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post(`/movement/${ownerId}/vehicles/${vehicle.id}/papers`, form);
      setForm({ kind: 'insurance', reference: '', expiresOn: '' });
      setOpen(false);
      onChanged();
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="movement-papers">
      {vehicle.papers.length === 0 && (
        <p className="hint">No papers recorded. Insurance and roadworthiness lapse quietly.</p>
      )}
      {vehicle.papers.map((p) => (
        <div className="movement-paper" key={p.id}>
          <span>{label(PAPER_KINDS, p.kind)}{p.reference ? ` · ${p.reference}` : ''}</span>
          <PaperPill paper={p} />
        </div>
      ))}
      {error && <div className="alert alert-error">{error}</div>}
      {open ? (
        <form className="movement-inline" onSubmit={add}>
          <select
            aria-label="Kind of paper" value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value })}
          >
            {PAPER_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input
            type="text" placeholder="Reference" aria-label="Reference"
            value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })}
          />
          <input
            type="date" aria-label="Expires on"
            value={form.expiresOn} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })}
          />
          <button className="btn btn-primary btn-sm" type="submit">Record</button>
          <button className="btn btn-sm" type="button" onClick={() => setOpen(false)}>Cancel</button>
        </form>
      ) : (
        <button className="btn btn-sm" type="button" onClick={() => setOpen(true)}>
          Record a paper
        </button>
      )}
    </div>
  );
}

function Fleet({ ownerId }) {
  const [vehicles, setVehicles] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ label: '', plate: '', makeModel: '', colour: '' });
  const [error, setError] = useState('');

  function load() {
    return api.get(`/movement/${ownerId}/vehicles`)
      .then((d) => setVehicles(d.vehicles || []))
      .catch((e) => setError(e.message));
  }
  useEffect(() => { load(); }, [ownerId]);

  async function create(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post(`/movement/${ownerId}/vehicles`, form);
      setForm({ label: '', plate: '', makeModel: '', colour: '' });
      setCreating(false);
      load();
    } catch (err) { setError(err.message); }
  }

  async function archive(v) {
    setError('');
    try { await api.post(`/movement/${ownerId}/vehicles/${v.id}/archive`); load(); }
    catch (err) { setError(err.message); }
  }

  if (!vehicles) return <p className="hint">Loading the cars…</p>;

  return (
    <div className="movement-fleet">
      {error && <div className="alert alert-error">{error}</div>}
      <p className="hint">
        The cars the office moves the principal in. Their papers go on the same expiry watch as a
        passport, so an insurance certificate running out turns up on Today before a police stop
        finds it.
      </p>

      {creating ? (
        <form className="card trip-form" onSubmit={create}>
          <div className="field">
            <label htmlFor="veh-label">What you call it</label>
            <input
              id="veh-label" type="text" required placeholder="The black Prado"
              value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
          </div>
          <div className="code-row">
            <div className="field">
              <label htmlFor="veh-plate">Plate</label>
              <input
                id="veh-plate" type="text" placeholder="ABC-123-XY"
                value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="veh-model">Make and model</label>
              <input
                id="veh-model" type="text" placeholder="Toyota Land Cruiser"
                value={form.makeModel} onChange={(e) => setForm({ ...form, makeModel: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="veh-colour">Colour</label>
              <input
                id="veh-colour" type="text" placeholder="Black"
                value={form.colour} onChange={(e) => setForm({ ...form, colour: e.target.value })}
              />
            </div>
          </div>
          <div className="code-actions">
            <button className="btn btn-primary btn-sm" type="submit">Add the car</button>
            <button className="btn btn-sm" type="button" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="btn btn-primary btn-sm" type="button" onClick={() => setCreating(true)}>
          Add a car
        </button>
      )}

      {vehicles.length === 0 && !creating && (
        <div className="empty-state">No cars on the books yet.</div>
      )}

      {vehicles.map((v) => (
        <div className="card movement-vehicle" key={v.id}>
          <div className="movement-vehicle-head">
            <div>
              <strong>{v.label}</strong>
              <div className="meta">
                {[v.plate, v.colour, v.makeModel].filter(Boolean).join(' · ') || '—'}
              </div>
            </div>
            {/* Put away, not deleted: it is on movements that already happened. */}
            <button className="btn btn-sm" type="button" onClick={() => archive(v)}>
              Put away
            </button>
          </div>
          <Papers ownerId={ownerId} vehicle={v} onChanged={load} />
        </div>
      ))}
    </div>
  );
}


const DRIVER_PAPERS = [
  ['licence', 'Licence'],
  ['permit', 'Permit'],
  ['medical', 'Medical'],
  ['training', 'Training'],
];

// The people who drive, and their papers.
//
// THE CARS HAD PAPERS AND THE PEOPLE DID NOT. A driver used to be a name and a
// number typed onto one journey and retyped onto the next, which meant their
// licence expired somewhere nobody could see it. Same expiry engine as a
// passport and a car's insurance — one idea of "nearly out of date", not three.
function Drivers({ ownerId }) {
  const [list, setList] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '' });
  const [paperFor, setPaperFor] = useState(null);
  const [paper, setPaper] = useState({ kind: 'licence', reference: '', expiresOn: '' });
  const [error, setError] = useState('');

  function load() {
    return api.get(`/movement/${ownerId}/drivers`)
      .then((d) => setList(d.drivers || []))
      .catch((e) => setError(e.message));
  }
  useEffect(() => { load(); }, [ownerId]);

  async function act(fn) {
    setError('');
    try { await fn(); await load(); } catch (e) { setError(e.message); }
  }

  if (!list) return <p className="hint">Loading the drivers…</p>;

  return (
    <div className="movement-fleet">
      {error && <div className="alert alert-error">{error}</div>}
      <p className="hint">
        The people who drive. Their licences go on the same watch as a passport and a car&rsquo;s
        insurance, so one running out turns up on Today rather than at a checkpoint.
      </p>

      {creating ? (
        <form
          className="card trip-form"
          onSubmit={(e) => {
            e.preventDefault();
            act(async () => {
              await api.post(`/movement/${ownerId}/drivers`, form);
              setForm({ name: '', phone: '' });
              setCreating(false);
            });
          }}
        >
          <div className="code-row">
            <div className="field">
              <label htmlFor="drv-name">Name</label>
              <input
                id="drv-name" type="text" required placeholder="Sunday Eze"
                value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="drv-phone">Phone</label>
              <input
                id="drv-phone" type="text" placeholder="+234…"
                value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>
          <div className="code-actions">
            <button className="btn btn-primary btn-sm" type="submit">Add the driver</button>
            <button className="btn btn-sm" type="button" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="btn btn-primary btn-sm" type="button" onClick={() => setCreating(true)}>
          Add a driver
        </button>
      )}

      {list.length === 0 && !creating && (
        <div className="empty-state">No drivers on the books yet.</div>
      )}

      {list.map((d) => (
        <div className="card movement-vehicle" key={d.id}>
          <div className="movement-vehicle-head">
            <div>
              <strong>{d.name}</strong>
              {/* Said once, by the server, rather than worked out here from the
                  list of papers below — three screens want this answer. */}
              {d.lapsed && <span className="pill is-off">Should not be driving</span>}
              <div className="meta">{d.phone || '—'}</div>
            </div>
            <button className="btn btn-sm" type="button"
              onClick={() => act(() => api.post(`/movement/${ownerId}/drivers/${d.id}/archive`))}>
              Put away
            </button>
          </div>
          <div className="movement-papers">
            {d.papers.length === 0 && (
              <p className="hint">No papers recorded. A licence lapses quietly.</p>
            )}
            {d.papers.map((p) => (
              <div className="movement-paper" key={p.id}>
                <span>{label(DRIVER_PAPERS, p.kind)}{p.reference ? ` · ${p.reference}` : ''}</span>
                <PaperPill paper={p} />
              </div>
            ))}
            {paperFor === d.id ? (
              <form
                className="movement-inline"
                onSubmit={(e) => {
                  e.preventDefault();
                  act(async () => {
                    await api.post(`/movement/${ownerId}/drivers/${d.id}/papers`, paper);
                    setPaper({ kind: 'licence', reference: '', expiresOn: '' });
                    setPaperFor(null);
                  });
                }}
              >
                <select aria-label="Kind of paper" value={paper.kind}
                  onChange={(e) => setPaper({ ...paper, kind: e.target.value })}>
                  {DRIVER_PAPERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <input type="text" placeholder="Reference" aria-label="Paper reference"
                  value={paper.reference}
                  onChange={(e) => setPaper({ ...paper, reference: e.target.value })} />
                <input type="date" aria-label="Paper expires on" value={paper.expiresOn}
                  onChange={(e) => setPaper({ ...paper, expiresOn: e.target.value })} />
                <button className="btn btn-primary btn-sm" type="submit">Record</button>
                <button className="btn btn-sm" type="button" onClick={() => setPaperFor(null)}>Cancel</button>
              </form>
            ) : (
              <button className="btn btn-sm" type="button" onClick={() => setPaperFor(d.id)}>
                Record a paper
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- One journey -------------------------------------------------------------

function Grants({ ownerId, movementId }) {
  const [grants, setGrants] = useState(null);
  const [members, setMembers] = useState([]);
  const [pick, setPick] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  // Taking access back mid-journey is worth one deliberate second, but it is
  // not worth a dialog: the button asks for itself and forgets if ignored.
  const [confirming, setConfirming] = useState(null);

  function load() {
    return Promise.all([
      api.get(`/movement/${ownerId}/movements/${movementId}/grants`),
      api.get('/members').catch(() => ({ members: [] })),
    ]).then(([g, m]) => {
      setGrants(g.grants || []);
      setMembers((m.members || []).filter((x) => x.memberUserId));
    }).catch((e) => setError(e.message));
  }
  useEffect(() => { load(); }, [ownerId, movementId]);

  async function add() {
    if (!pick) return;
    setError('');
    try {
      await api.post(`/movement/${ownerId}/movements/${movementId}/grants`,
        { userId: pick, reason });
      setPick('');
      setReason('');
      load();
    } catch (err) { setError(err.message); }
  }

  async function revoke(g) {
    if (confirming !== g.id) { setConfirming(g.id); return; }
    setConfirming(null);
    setError('');
    try {
      await api.del(`/movement/${ownerId}/movements/${movementId}/grants/${g.id}`);
      load();
    } catch (err) { setError(err.message); }
  }

  if (!grants) return <p className="hint">Loading…</p>;

  return (
    <div className="movement-grants">
      <h3>If you cannot be there</h3>
      <p className="hint">
        Open this one journey to one colleague for a day. They get when, from where, the
        principal&rsquo;s car and the driver to ring — not the escort, not the convoy, not your
        notes. It lapses on its own after 24 hours, and the principal can see on their access log
        that you did it.
      </p>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="movement-inline">
        <select
          aria-label="Who is covering" value={pick}
          onChange={(e) => setPick(e.target.value)}
        >
          <option value="">Who is covering…</option>
          {/* memberName/invitedEmail, not name/email — a member row is an
              invitation that may or may not have an account behind it yet, and
              reading the wrong fields renders a list of blank options that
              looks like a working picker. */}
          {members.map((m) => (
            <option key={m.memberUserId} value={m.memberUserId}>
              {m.memberName || m.invitedEmail}
            </option>
          ))}
        </select>
        <input
          type="text" placeholder="Why (optional)" aria-label="Why"
          value={reason} onChange={(e) => setReason(e.target.value)}
        />
        <button className="btn btn-sm" type="button" onClick={add} disabled={!pick}>
          Hand it over
        </button>
      </div>

      {grants.length === 0 && <p className="hint">Nobody has been given this journey.</p>}
      {grants.map((g) => (
        <div className="movement-grant" key={g.id}>
          <span>
            <strong>{g.name || g.email}</strong>
            {g.reason ? ` — ${g.reason}` : ''}
          </span>
          {g.live ? (
            <>
              <span className="pill is-warn">Until {when(g.expiresAt)}</span>
              <button className="btn btn-sm" type="button" onClick={() => revoke(g)}>
                {confirming === g.id ? 'Sure? They lose it now' : 'Take it back'}
              </button>
            </>
          ) : (
            <span className="hint">{g.revokedAt ? 'Taken back' : 'Lapsed'}</span>
          )}
        </div>
      ))}
    </div>
  );
}


// While the journey is happening: the check calls, the card the driver holds,
// and the one signal that means act now.
function EnRoute({ ownerId, movementId, full }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [cardUrl, setCardUrl] = useState('');
  const [cost, setCost] = useState({ kind: 'fuel', amount: '', currency: 'NGN', note: '' });

  const base = `/movement/${ownerId}/movements/${movementId}`;
  function load() {
    return api.get(`${base}/route`).then(setData).catch((e) => setError(e.message));
  }
  useEffect(() => { load(); }, [ownerId, movementId]);

  async function act(fn) {
    setError('');
    try { await fn(); await load(); } catch (e) { setError(e.message); }
  }

  if (!data) return <p className="hint">Loading the journey…</p>;

  return (
    <div className="movement-enroute">
      {error && <div className="alert alert-error">{error}</div>}

      {/* Loudest thing on the screen, deliberately. */}
      {data.duressAt && (
        <div className="alert alert-error">
          <strong>Something is wrong on this journey.</strong>
          {data.duressNote ? <div>{data.duressNote}</div> : null}
          <div className="hint">Signalled {when(data.duressAt)}.</div>
          {full && (
            <button
              className="btn btn-sm" type="button"
              onClick={() => act(() => api.del(`${base}/duress`))}
            >
              Stand it down
            </button>
          )}
        </div>
      )}

      {data.checks.length > 0 && (
        <>
          <h3>Check calls</h3>
          <p className="hint">
            Contact along the way, so a problem is found while somebody can still act on it —
            not at the far end.
          </p>
          {data.checks.map((c) => (
            <div className={`card movement-line${c.missed ? ' is-missed' : ''}`} key={c.id}>
              <span className="pill">{when(c.dueAt)}</span>
              {c.checkedAt
                ? <span>Answered {when(c.checkedAt)}</span>
                : c.missed
                  ? <span><strong>Nobody answered this one.</strong></span>
                  : <span>Not yet due</span>}
              {!c.checkedAt && (
                <button
                  className="btn btn-sm" type="button"
                  onClick={() => act(() => api.post(`${base}/checks/${c.id}`))}
                >
                  Contact made
                </button>
              )}
            </div>
          ))}
        </>
      )}

      {full && (
        <>
          <h3>The driver&rsquo;s card</h3>
          <p className="hint">
            A link the driver opens on their phone with no account. It shows the journey and the
            car and names nobody &mdash; not the principal, not the escort, not your notes &mdash;
            because a link with no password is a link that can be forwarded. They can answer
            check calls, say they have arrived, and raise the alarm.
          </p>
          {cardUrl && (
            <div className="alert alert-success">
              Send them this: <code>{window.location.origin}{cardUrl}</code>
            </div>
          )}
          <div className="movement-inline">
            <button
              className="btn btn-sm" type="button"
              onClick={() => act(async () => {
                const d = await api.post(`${base}/card`);
                setCardUrl(d.url);
              })}
            >
              {data.cardArmed ? 'Make a new link' : 'Give the driver a card'}
            </button>
            {data.cardArmed && (
              <button
                className="btn btn-sm" type="button"
                onClick={() => act(async () => { await api.del(`${base}/card`); setCardUrl(''); })}
              >
                Take it down
              </button>
            )}
          </div>

          <h3>What it cost</h3>
          {(data.costs?.items || []).map((c) => (
            <div className="card movement-line" key={c.id}>
              <span className="pill">{c.kind}</span>
              <span>
                {c.currency} {(c.amountMinor / 100).toLocaleString()}
                {c.note ? ` · ${c.note}` : ''}
              </span>
            </div>
          ))}
          {Object.entries(data.costs?.totals || {}).map(([cur, total]) => (
            <p className="hint" key={cur}>
              <strong>{cur} {(total / 100).toLocaleString()}</strong> on this journey.
            </p>
          ))}
          <form
            className="movement-inline"
            onSubmit={(e) => {
              e.preventDefault();
              act(() => api.post(`${base}/costs`, {
                kind: cost.kind,
                // Entered in whole units, stored in minor ones: a naira held
                // as a float is a rounding error waiting to be argued about.
                amountMinor: Math.round(Number(cost.amount || 0) * 100),
                currency: cost.currency,
                note: cost.note,
              }));
              setCost({ kind: 'fuel', amount: '', currency: 'NGN', note: '' });
            }}
          >
            <select
              aria-label="Kind of cost" value={cost.kind}
              onChange={(e) => setCost({ ...cost, kind: e.target.value })}
            >
              {['fuel', 'toll', 'allowance', 'repair', 'other'].map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
            <input
              type="number" step="0.01" min="0" required placeholder="Amount" aria-label="Amount"
              value={cost.amount} onChange={(e) => setCost({ ...cost, amount: e.target.value })}
            />
            <input
              type="text" placeholder="Currency" aria-label="Currency" maxLength={3}
              value={cost.currency} onChange={(e) => setCost({ ...cost, currency: e.target.value })}
            />
            <input
              type="text" placeholder="Note" aria-label="Cost note"
              value={cost.note} onChange={(e) => setCost({ ...cost, note: e.target.value })}
            />
            <button className="btn btn-sm" type="submit">Record it</button>
          </form>
        </>
      )}
    </div>
  );
}

function MovementDetail({ ownerId, movementId, onBack, onChanged }) {
  const [m, setM] = useState(null);
  const [error, setError] = useState('');
  const [cars, setCars] = useState([]);
  const [roster, setRoster] = useState([]);
  const [vForm, setVForm] = useState({ vehicleId: '', role: 'principal', plate: '' });
  const [pForm, setPForm] = useState({ role: 'driver', name: '', phone: '', driverId: '' });

  function load() {
    return api.get(`/movement/${ownerId}/movements/${movementId}`)
      .then((d) => setM(d.movement))
      .catch((e) => setError(e.message));
  }
  useEffect(() => {
    load();
    api.get(`/movement/${ownerId}/vehicles`).then((d) => setCars(d.vehicles || [])).catch(() => {});
    api.get(`/movement/${ownerId}/drivers`).then((d) => setRoster(d.drivers || [])).catch(() => {});
  }, [ownerId, movementId]);

  async function act(fn) {
    setError('');
    try { const d = await fn(); if (d?.movement) setM(d.movement); else await load(); onChanged?.(); }
    catch (err) { setError(err.message); }
  }

  if (error && !m) {
    return (
      <>
        <button className="btn btn-sm" type="button" onClick={onBack}>← All journeys</button>
        <div className="alert alert-error">{error}</div>
      </>
    );
  }
  if (!m) return <p className="hint">Loading…</p>;

  const full = m.access === 'full';

  return (
    <div className="movement-detail">
      <button className="btn btn-sm" type="button" onClick={onBack}>← All journeys</button>
      <h2>{m.title}</h2>
      {error && <div className="alert alert-error">{error}</div>}

      {/* SAID OUT LOUD. A stand-in who thinks this is the whole journey will
          tell somebody there is no escort. */}
      {!full && (
        <div className="alert alert-warning movement-partial">
          <strong>You are seeing part of this journey.</strong>
          <div>{m.note}</div>
          <div className="hint">
            {m.withheld} {m.withheld === 1 ? 'detail is' : 'details are'} not shown to you.
          </div>
        </div>
      )}

      <div className="card">
        <div className="meta">
          {when(m.departsAt)}
          {m.bufferMinutes ? ` · ${m.bufferMinutes} min buffer` : ''}
        </div>
        <div>
          <strong>{m.departsFrom || '—'}</strong> → <strong>{m.destination || '—'}</strong>
        </div>
        {/* What this journey is part of. Only ever rendered from what the
            server sent: `trip` is null both when there is no trip and when
            this reader is not entitled to its name, and the screen must not be
            able to tell those apart either. */}
        {m.access === 'full' && (
          m.trip
            ? (
              <p className="hint">
                Part of <strong>{m.trip.name}</strong>
                {m.trip.private ? ' (private)' : ''}
                {' · '}
                <button
                  className="btn btn-sm" type="button"
                  onClick={() => act(() => api.patch(
                    `/movement/${ownerId}/movements/${m.id}/trip`, { tripId: null },
                  ))}
                >
                  take it out
                </button>
              </p>
            )
            : (
              <TripPick
                ownerId={ownerId}
                at={m.departsAt}
                value=""
                onChange={(tripId) => tripId && act(() => api.patch(
                  `/movement/${ownerId}/movements/${m.id}/trip`, { tripId },
                ))}
              />
            )
        )}
        {m.arrivedAt
          ? <p className="hint">Arrived {when(m.arrivedAt)}.</p>
          : m.lateByMinutes !== null && m.lateByMinutes !== undefined
            ? (
              <p className="alert alert-warning">
                <strong>No arrival yet.</strong> Should have been there about{' '}
                {m.lateByMinutes} minutes ago.
              </p>
            )
            : m.expectedArrival
              ? <p className="hint">Due to arrive {when(m.expectedArrival)}.</p>
              : <p className="hint">Not marked arrived yet. No expected time was set.</p>}
        {/* Deliberately open to a stand-in too: they are the one most likely to
            be the person who knows. */}
        <button
          className="btn btn-sm" type="button"
          onClick={() => act(() => api.post(`/movement/${ownerId}/movements/${movementId}/arrived`))}
        >
          {m.arrivedAt ? 'Undo arrived' : 'They arrived'}
        </button>
      </div>

      <h3>Cars</h3>
      {m.vehicles.length === 0 && <p className="hint">No car on this journey yet.</p>}
      {m.vehicles.map((v) => (
        <div className="card movement-line" key={v.id}>
          <span className="pill">{label(VEHICLE_ROLES, v.role)}</span>
          <span>{[v.plate, v.description].filter(Boolean).join(' · ') || '—'}</span>
        </div>
      ))}
      {full && (
        <form
          className="movement-inline"
          onSubmit={(e) => {
            e.preventDefault();
            act(() => api.post(`/movement/${ownerId}/movements/${movementId}/vehicles`, vForm));
            setVForm({ vehicleId: '', role: 'principal', plate: '' });
          }}
        >
          <select
            aria-label="Which car" value={vForm.vehicleId}
            onChange={(e) => setVForm({ ...vForm, vehicleId: e.target.value })}
          >
            <option value="">Not from the fleet</option>
            {cars.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <select
            aria-label="Its place in the convoy" value={vForm.role}
            onChange={(e) => setVForm({ ...vForm, role: e.target.value })}
          >
            {VEHICLE_ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input
            type="text" placeholder="Plate, if not from the fleet" aria-label="Plate"
            value={vForm.plate} onChange={(e) => setVForm({ ...vForm, plate: e.target.value })}
          />
          <button className="btn btn-sm" type="submit">Add the car</button>
        </form>
      )}

      <h3>Who is on it</h3>
      {m.people.length === 0 && <p className="hint">Nobody recorded yet.</p>}
      {m.people.map((p) => (
        <div className="card movement-line" key={p.id}>
          <span className="pill">{label(PERSON_ROLES, p.role)}</span>
          <span>{p.name}{p.phone ? ` · ${p.phone}` : ''}</span>
        </div>
      ))}
      {full && (
        <form
          className="movement-inline"
          onSubmit={(e) => {
            e.preventDefault();
            act(() => api.post(`/movement/${ownerId}/movements/${movementId}/people`, pForm));
            setPForm({ role: 'driver', name: '', phone: '', driverId: '' });
          }}
        >
          <select
            aria-label="Their role" value={pForm.role}
            onChange={(e) => setPForm({ ...pForm, role: e.target.value })}
          >
            {PERSON_ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {/* From the roster, so their licence is watched — or typed, because
              an office should not have to enrol somebody to record a one-off
              lift. Choosing one copies the name and number onto the journey. */}
          <select
            aria-label="From the roster" value={pForm.driverId}
            onChange={(e) => setPForm({ ...pForm, driverId: e.target.value })}
          >
            <option value="">Not from the roster</option>
            {roster.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}{d.lapsed ? ' — papers lapsed' : ''}
              </option>
            ))}
          </select>
          <input
            type="text" placeholder="Name" aria-label="Name"
            value={pForm.name} onChange={(e) => setPForm({ ...pForm, name: e.target.value })}
          />
          <input
            type="text" placeholder="Phone" aria-label="Phone"
            value={pForm.phone} onChange={(e) => setPForm({ ...pForm, phone: e.target.value })}
          />
          <button className="btn btn-sm" type="submit">Add them</button>
        </form>
      )}

      {full && m.notes && (
        <>
          <h3>Notes</h3>
          <div className="card"><p>{m.notes}</p></div>
        </>
      )}

      <EnRoute ownerId={ownerId} movementId={movementId} full={full} />

      {full && <Grants ownerId={ownerId} movementId={movementId} />}
    </div>
  );
}

// --- The page ----------------------------------------------------------------

/**
 * Which trip a journey belongs to.
 *
 * WHAT IS OFFERED AND WHAT IS ONLY AVAILABLE. The app volunteers a trip whose
 * dates cover this departure — but only an OFFICE trip, ever. Volunteering
 * "is this part of the Barbados trip?" is the app saying out loud that there
 * is a Barbados trip, which on a private one is the disclosure the whole
 * visibility rule exists to prevent, and it would say it to whoever is booking
 * the CAR rather than to whoever booked the holiday. So a private trip is
 * never proposed. It can still be chosen, deliberately, from the list below —
 * and when it is, the screen says what that means rather than leaving somebody
 * to assume.
 *
 * `value` is a trip id or ''. Every trip listed is one the server has already
 * decided this reader may see; nothing here filters, it only arranges.
 */
function TripPick({ ownerId, at, value, onChange }) {
  const [options, setOptions] = useState(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!ownerId || !at) { setOptions(null); return undefined; }
    let live = true;
    api.get(`/movement/${ownerId}/trip-options?at=${encodeURIComponent(new Date(at).toISOString())}`)
      .then((d) => { if (live) setOptions(d); })
      .catch(() => { /* a suggestion must not be able to fail a form */ });
    return () => { live = false; };
  }, [ownerId, at]);

  // The offer, pre-ticked, until somebody touches this control themselves.
  // Doing it in an effect rather than on render so a deliberate "no" sticks.
  const suggested = options?.covering?.[0] || null;
  useEffect(() => {
    if (!touched && suggested && !value) onChange(suggested.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggested?.id]);

  if (!options) return null;
  const all = [...(options.covering || []), ...(options.other || [])];
  if (all.length === 0) return null;
  const chosen = all.find((t) => t.id === value) || null;

  return (
    <div className="field">
      <label htmlFor="mv-trip">Part of a trip</label>
      <select
        id="mv-trip"
        value={value || ''}
        onChange={(e) => { setTouched(true); onChange(e.target.value); }}
      >
        <option value="">On its own</option>
        {all.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
            {t.destination ? ` — ${t.destination}` : ''}
            {` (${t.startsOn} to ${t.endsOn})`}
            {t.private ? ' · private' : ''}
          </option>
        ))}
      </select>
      {suggested && value === suggested.id && !touched && (
        <p className="hint">
          This leaves during <strong>{suggested.name}</strong>, so it has been filed under it.
          Change it above if that is wrong.
        </p>
      )}
      {chosen?.private && (
        <p className="hint">
          {chosen.name} is a private trip. Filing this journey under it changes nothing about
          who can see the journey — a movement is already only you and the principal — and the
          trip&rsquo;s name is never shown to anybody who cannot already see the trip.
        </p>
      )}
    </div>
  );
}

export default function Movements() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'journeys';
  const [ownerId, setOwnerId] = useState(null);
  const [list, setList] = useState(null);
  const [openId, setOpenId] = useState(params.get('movement') || null);
  const [made, setMade] = useState(null);
  const [creating, setCreating] = useState(false);
  const [repeating, setRepeating] = useState(false);
  const [series, setSeries] = useState({
    title: '', departsFrom: '', destination: '', timeOfDay: '06:40',
    days: [1, 2, 3, 4, 5], expectedMinutes: '',
  });
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    title: '', departsFrom: '', destination: '', departsAt: '', notes: '',
    expectedMinutes: '', tripId: '',
  });

  useEffect(() => { resolveActivePrincipal(user).then(setOwnerId); }, [user]);

  function load() {
    if (!ownerId) return Promise.resolve();
    return api.get(`/movement/${ownerId}/movements`)
      .then((d) => setList(d.movements || []))
      .catch((e) => { setError(e.message); setList([]); });
  }
  useEffect(() => { load(); }, [ownerId]);

  async function create(e) {
    e.preventDefault();
    setError('');
    try {
      const d = await api.post(`/movement/${ownerId}/movements`, {
        ...form,
        // The form collects local wall time; the server stores an instant.
        departsAt: form.departsAt ? new Date(form.departsAt).toISOString() : '',
        // Sent as a number or not at all. An empty string would be stored as
        // zero, which reads as "we know it takes no time" rather than "nobody
        // said" — and zero switches the arrival watch off silently.
        expectedMinutes: form.expectedMinutes
          ? Number.parseInt(form.expectedMinutes, 10) : undefined,
        // '' means on its own. Sent as null so the server stores an absence
        // rather than an empty string that would read as a trip id later.
        tripId: form.tripId || null,
      });
      setCreating(false);
      setForm({
        title: '', departsFrom: '', destination: '', departsAt: '', notes: '',
        expectedMinutes: '', tripId: '',
      });
      await load();
      setOpenId(d.movement.id);
    } catch (err) { setError(err.message); }
  }

  async function createSeries(e) {
    e.preventDefault();
    setError('');
    try {
      const d = await api.post(`/movement/${ownerId}/series`, {
        ...series,
        expectedMinutes: series.expectedMinutes
          ? Number.parseInt(series.expectedMinutes, 10) : undefined,
      });
      setRepeating(false);
      setSeries({
        title: '', departsFrom: '', destination: '', timeOfDay: '06:40',
        days: [1, 2, 3, 4, 5], expectedMinutes: '',
      });
      await load();
      // Said as a number. "We made 20 journeys" and "we made none" look
      // identical on a list that is already long.
      setMade(d.made);
    } catch (err) { setError(err.message); }
  }

  function go(next) {
    const p = new URLSearchParams(params);
    p.set('tab', next);
    p.delete('movement');
    setParams(p, { replace: true });
    setOpenId(null);
  }

  if (!ownerId || (tab === 'journeys' && !list)) {
    return <AppShell title="Movements" active="movements"><p className="hint">Loading…</p></AppShell>;
  }

  return (
    <AppShell
      title="Movements"
      active="movements"
      guide="movements"
      actions={tab === 'journeys' && !openId && !creating && !repeating
        ? (
          <>
            <button className="btn btn-primary btn-sm" type="button" onClick={() => setCreating(true)}>
              Arrange a journey
            </button>
            <button className="btn btn-sm" type="button" onClick={() => setRepeating(true)}>
              One that repeats
            </button>
          </>
        )
        : null}
    >
      <Tabs
        tabs={[
          { id: 'journeys', label: 'Journeys' },
          { id: 'fleet', label: 'The cars' },
          { id: 'drivers', label: 'The drivers' },
        ]}
        active={tab}
        onChange={go}
        label="Movements"
      />

      {error && <div className="alert alert-error">{error}</div>}

      {tab === 'fleet' && <Fleet ownerId={ownerId} />}
      {tab === 'drivers' && <Drivers ownerId={ownerId} />}

      {tab === 'journeys' && (openId ? (
        <MovementDetail
          ownerId={ownerId}
          movementId={openId}
          onBack={() => { setOpenId(null); load(); }}
          onChanged={load}
        />
      ) : (
        <>
          <p className="hint">
            A journey on the ground: leaving here at this time, in that car, with this driver.
            Only you and whoever arranged it can see one — not the wider office — because an
            escort roster is a pattern of somebody&rsquo;s movements.
          </p>

          {made !== null && (
            <div className="alert alert-success">
              {made === 0
                ? 'Nothing was added — those days may already be laid out.'
                : `${made} journeys laid down for the next four weeks.`}
              {' '}
              <button className="btn btn-sm" type="button" onClick={() => setMade(null)}>Right</button>
            </div>
          )}

          {repeating && (
            <form className="card trip-form" onSubmit={createSeries}>
              <div className="field">
                <label htmlFor="sr-title">What to call it</label>
                <input
                  id="sr-title" type="text" required placeholder="The school run"
                  value={series.title}
                  onChange={(e) => setSeries({ ...series, title: e.target.value })}
                />
              </div>
              <div className="code-row">
                <div className="field">
                  <label htmlFor="sr-from">From</label>
                  <input
                    id="sr-from" type="text" placeholder="Ikoyi residence"
                    value={series.departsFrom}
                    onChange={(e) => setSeries({ ...series, departsFrom: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="sr-to">To</label>
                  <input
                    id="sr-to" type="text" placeholder="Grange School"
                    value={series.destination}
                    onChange={(e) => setSeries({ ...series, destination: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="sr-at">Leaving at</label>
                  <input
                    id="sr-at" type="time" required value={series.timeOfDay}
                    onChange={(e) => setSeries({ ...series, timeOfDay: e.target.value })}
                  />
                  {/* A wall time in the principal's zone, not an instant —
                      otherwise the school run drifts by an hour twice a year. */}
                  <p className="hint">In the principal&rsquo;s own timezone.</p>
                </div>
                <div className="field">
                  <label htmlFor="sr-mins">How long it takes</label>
                  <input
                    id="sr-mins" type="number" min="1" max="1440" placeholder="35"
                    value={series.expectedMinutes}
                    onChange={(e) => setSeries({ ...series, expectedMinutes: e.target.value })}
                  />
                </div>
              </div>
              <div className="field">
                <label>Which days</label>
                <div className="movement-days">
                  {DAY_LABELS.map(([n, l]) => {
                    const day = Number(n);
                    const on = series.days.includes(day);
                    return (
                      <button
                        key={n} type="button"
                        className={`btn btn-sm${on ? ' btn-primary' : ''}`}
                        aria-pressed={on}
                        onClick={() => setSeries({
                          ...series,
                          days: on ? series.days.filter((d) => d !== day) : [...series.days, day],
                        })}
                      >
                        {l}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="code-actions">
                <button className="btn btn-primary btn-sm" type="submit">Lay it down</button>
                <button className="btn btn-sm" type="button" onClick={() => setRepeating(false)}>Cancel</button>
              </div>
            </form>
          )}

          {creating && (
            <form className="card trip-form" onSubmit={create}>
              <div className="field">
                <label htmlFor="mv-title">What to call it</label>
                <input
                  id="mv-title" type="text" required placeholder="To the Lekki site"
                  value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </div>
              <div className="code-row">
                <div className="field">
                  <label htmlFor="mv-from">From</label>
                  <input
                    id="mv-from" type="text" placeholder="Ikoyi residence"
                    value={form.departsFrom}
                    onChange={(e) => setForm({ ...form, departsFrom: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="mv-to">To</label>
                  <input
                    id="mv-to" type="text" placeholder="Lekki Phase 1"
                    value={form.destination}
                    onChange={(e) => setForm({ ...form, destination: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="mv-at">Leaving</label>
                  <input
                    id="mv-at" type="datetime-local" required
                    value={form.departsAt}
                    onChange={(e) => setForm({ ...form, departsAt: e.target.value })}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="mv-mins">How long it should take</label>
                <input
                  id="mv-mins" type="number" min="1" max="1440" placeholder="45"
                  value={form.expectedMinutes}
                  onChange={(e) => setForm({ ...form, expectedMinutes: e.target.value })}
                />
                {/* Said plainly, because it is the field that turns this from a
                    logbook into a watch and nobody would guess that. */}
                <p className="hint">
                  In minutes. Leave it blank and Kairos records the journey but cannot
                  tell you when nobody has confirmed they arrived.
                </p>
              </div>
              {/* Only once there is a departure to match against — an empty
                  control offering nothing is a control asking a question it
                  cannot answer. */}
              {form.departsAt && (
                <TripPick
                  ownerId={ownerId}
                  at={form.departsAt}
                  value={form.tripId}
                  onChange={(tripId) => setForm((f) => ({ ...f, tripId }))}
                />
              )}
              <div className="field">
                <label htmlFor="mv-notes">Notes</label>
                <input
                  id="mv-notes" type="text" placeholder="Avoid the coast road"
                  value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
              <div className="code-actions">
                <button className="btn btn-primary btn-sm" type="submit">Arrange it</button>
                <button className="btn btn-sm" type="button" onClick={() => setCreating(false)}>Cancel</button>
              </div>
            </form>
          )}

          {list.length === 0 && !creating && (
            <div className="empty-state">
              No journeys arranged. Add one and it will carry the cars, the driver, the escort,
              and the fact that they arrived.
            </div>
          )}

          {list.map((mv) => (
            <button
              className="card trip-row movement-row" key={mv.id} type="button"
              onClick={() => setOpenId(mv.id)}
            >
              <div>
                <strong>{mv.title}</strong>
                <div className="meta">
                  {when(mv.departsAt)} · {mv.departsFrom || '—'} → {mv.destination || '—'}
                </div>
              </div>
              {mv.access === 'coordination'
                ? <span className="pill is-warn">Partial</span>
                : <span className="pill">{mv.arrivedAt ? 'Arrived' : 'Booked'}</span>}
            </button>
          ))}
        </>
      ))}
    </AppShell>
  );
}
