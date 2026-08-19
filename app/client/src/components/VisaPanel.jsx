import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// Whether the visas on file cover this trip.
//
// Deliberately never says whether a visa is REQUIRED. That is a different
// question — forty thousand nationality-by-destination pairs, revised without
// notice — and a wrong "no visa needed" strands somebody at a check-in desk.
// So the absence of a visa on file is reported as an absence, in those words,
// and the screen says outright that it is not the same as being told none is
// needed. See server/lib/visas.js.

const STATE = {
  covers: {
    tone: 'ok',
    title: 'Covered',
    say: (v) => `Your ${v.kindLabel.toLowerCase()} visa is valid through the trip.`,
  },
  expires: {
    tone: 'bad',
    title: 'Expires during the trip',
    // The one people miss: valid on the day you fly out, invalid on the day
    // you were meant to fly home.
    say: (v) => `Valid on the way out and not on the way back — it lapses on ${v.lastGoodDay}.`,
  },
  expired: {
    tone: 'bad',
    title: 'Expired',
    say: (v) => `It lapsed on ${v.validTo}, before the trip begins.`,
  },
  not_yet: {
    tone: 'warn',
    title: 'Not valid yet',
    say: (v) => `It does not start until ${v.firstGoodDay}, after the trip begins.`,
  },
  spent: {
    tone: 'bad',
    title: 'Already used',
    say: (v) => `A ${v.kindLabel.toLowerCase()} visa, and its ${v.entriesTotal} entr${v.entriesTotal === 1 ? 'y has' : 'ies have'} been used.`,
  },
};

function Lead({ processing }) {
  if (!processing) return null;
  return (
    <p className="hint">
      Typically about <strong>{processing.days} working days</strong> for a Nigerian applicant
      {processing.note ? ` — ${processing.note}` : '.'}
      {' '}Guidance only, last reviewed {processing.reviewedOn}; confirm with the mission.
    </p>
  );
}

export default function VisaPanel({ ownerId, visa, onChanged }) {
  const [kinds, setKinds] = useState([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ kind: 'multi', country: '', validFrom: '', validTo: '', entriesTotal: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/visas/${ownerId}`).then((d) => setKinds(d.kinds)).catch(() => {});
  }, [ownerId]);

  if (!visa || visa.state === 'no_destination') {
    return (
      <p className="hint">Give the trip a destination and Kairos can check it against your visas.</p>
    );
  }

  async function add(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post(`/visas/${ownerId}`, { ...form, country: form.country || visa.country });
      setAdding(false);
      setForm({ kind: 'multi', country: '', validFrom: '', validTo: '', entriesTotal: '' });
      onChanged?.();
    } catch (err) { setError(err.message); }
  }

  const spec = STATE[visa.state];

  return (
    <div className="visa-panel">
      {error && <div className="alert alert-error">{error}</div>}

      {visa.state === 'none' ? (
        <div className="visa-state tone-warn">
          <strong>No visa on file for {visa.country}.</strong>
          <p className="hint">
            That is what we know, and not the same as being told you need one — whether a
            visa is required for your passport is a separate lookup, and it is not
            configured here. If you hold one, add it and Kairos will check it against
            every trip.
          </p>
          <Lead processing={visa.processing} />
        </div>
      ) : (
        <div className={`visa-state tone-${spec.tone}`}>
          <strong>{spec.title} — {visa.country}</strong>
          {visa.visas.map((v) => (
            <p key={v.id} className="hint">
              {(STATE[v.state] || spec).say(v)}
              {v.validTo && v.state === 'covers' && ` Valid to ${v.validTo}.`}
            </p>
          ))}
          {visa.state !== 'covers' && <Lead processing={visa.processing} />}
        </div>
      )}

      {adding ? (
        <form className="card visa-form" onSubmit={add}>
          <div className="code-row">
            <div className="field">
              <label htmlFor="visa-country">Country</label>
              <input
                id="visa-country" type="text" placeholder={visa.country}
                value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="visa-kind">Kind</label>
              <select id="visa-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {kinds.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="visa-from">Valid from</label>
              <input id="visa-from" type="date" value={form.validFrom}
                onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="visa-to">Valid to</label>
              <input id="visa-to" type="date" value={form.validTo}
                onChange={(e) => setForm({ ...form, validTo: e.target.value })} />
            </div>
          </div>
          <p className="hint">
            The number itself belongs in Essentials, where it is encrypted and asks for a
            second factor. This is only the shape, so trips can be checked against it.
          </p>
          <div className="code-actions">
            <button className="btn btn-primary btn-sm" type="submit">Add visa</button>
            <button className="btn btn-sm" type="button" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="btn btn-sm" type="button" onClick={() => setAdding(true)}>
          Add a visa
        </button>
      )}
    </div>
  );
}
