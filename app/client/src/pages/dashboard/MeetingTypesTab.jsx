import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

const TIER_LABELS = {
  1: 'Tier 1 · Public — auto-confirmed',
  2: 'Tier 2 · Standard — auto-confirmed',
  3: 'Tier 3 · Priority — needs approval',
  4: 'Tier 4 · Inner Circle — needs approval',
};
const TIER_SHORT = { 1: 'Public', 2: 'Standard', 3: 'Priority', 4: 'Inner Circle' };
const USUAL_PHRASE = {
  video: 'usually a video call',
  phone: 'usually a phone call',
  in_person: 'usually in person',
};

const BLANK = { name: '', durationMinutes: 30, locationType: 'video', accessTier: 1, description: '' };

// One form, two jobs. Creating and editing ask for exactly the same things, so
// a separate edit form would only be a copy waiting to fall behind this one.
function MeetingTypeForm({ initial, submitLabel, busyLabel, onSubmit, onCancel, idPrefix, nameHint = null }) {
  const [draft, setDraft] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const set = (key) => (e) => setDraft({ ...draft, [key]: e.target.value });

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit({
        name: draft.name,
        durationMinutes: Number(draft.durationMinutes),
        locationType: draft.locationType,
        accessTier: Number(draft.accessTier),
        description: draft.description,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card" style={{ marginTop: 12 }}>
      <div className="field">
        <label htmlFor={`${idPrefix}-name`}>Name</label>
        <input id={`${idPrefix}-name`} type="text" value={draft.name} onChange={set('name')} required />
        {nameHint && <p className="hint">{nameHint}</p>}
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-duration`}>Duration (minutes)</label>
        <input id={`${idPrefix}-duration`} type="number" min={5} max={480} value={draft.durationMinutes} onChange={set('durationMinutes')} required />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-location`}>Usual format</label>
        <select id={`${idPrefix}-location`} value={draft.locationType} onChange={set('locationType')}>
          <option value="video">Video call</option>
          <option value="phone">Phone call</option>
          <option value="in_person">In person</option>
        </select>
        <p className="hint">
          What you normally do. Whoever books can ask for something else — that turns their booking
          into a request you agree to, counter, or decline.
        </p>
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-tier`}>Access tier</label>
        <select id={`${idPrefix}-tier`} value={draft.accessTier} onChange={set('accessTier')}>
          {Object.entries(TIER_LABELS).map(([tier, label]) => (
            <option key={tier} value={tier}>{label}</option>
          ))}
        </select>
        <p className="hint">Tier 3 and 4 bookings wait for approval in your Approval Queue instead of confirming instantly.</p>
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-description`}>Description (optional)</label>
        <textarea id={`${idPrefix}-description`} value={draft.description || ''} onChange={set('description')} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? busyLabel : submitLabel}
        </button>
        <button className="btn btn-secondary" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// Serves both paths: the principal editing their own, and an assistant
// editing a principal's. Passing ownerId switches the endpoints; everything
// else — validation, layout, copy — is deliberately identical.
export default function MeetingTypesTab({ ownerId = null, ownerSlug = null }) {
  const base = ownerId ? `/pa/${ownerId}` : '';
  const [meetingTypes, setMeetingTypes] = useState(null);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  function load() {
    api.get(`${base}/meeting-types`).then((data) => setMeetingTypes(data.meetingTypes)).catch((err) => setError(err.message));
  }

  useEffect(load, [ownerId]);

  // The link people actually send. One per meeting type, because a link to the
  // whole page makes whoever you sent it to choose between things you may not
  // have meant to offer them — and the tier that gates a meeting type is on
  // the type, not on the page.
  const linkFor = (mt) => `${window.location.origin}/book/${ownerSlug}/${mt.slug}`;

  async function copyLink(mt) {
    try {
      await navigator.clipboard.writeText(linkFor(mt));
      setCopiedId(mt.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // Clipboard access can be blocked — the link is on screen either way.
    }
  }

  async function handleCreate(body) {
    setError('');
    try {
      await api.post(`${base}/meeting-types`, body);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleEdit(id, body) {
    setError('');
    try {
      await api.patch(`${base}/meeting-types/${id}`, body);
      setEditingId(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleActive(mt) {
    try {
      await api.patch(`${base}/meeting-types/${mt.id}`, { isActive: !mt.isActive });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function changeTier(mt, tier) {
    try {
      await api.patch(`${base}/meeting-types/${mt.id}`, { accessTier: tier });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(mt) {
    if (!window.confirm(`Delete "${mt.name}"? This cannot be undone.`)) return;
    try {
      await api.del(`${base}/meeting-types/${mt.id}`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}

      {meetingTypes === null && <p className="hint">Loading…</p>}

      {meetingTypes && meetingTypes.map((mt) => (
        <div className="card" key={mt.id}>
          {editingId === mt.id ? (
            <MeetingTypeForm
              idPrefix={`edit-${mt.id}`}
              initial={{
                name: mt.name,
                durationMinutes: mt.durationMinutes,
                locationType: mt.locationType,
                accessTier: mt.accessTier,
                description: mt.description || '',
              }}
              submitLabel="Save changes"
              busyLabel="Saving…"
              nameHint="Renaming leaves the link alone, so anything already sent out keeps working."
              onSubmit={(body) => handleEdit(mt.id, body)}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <>
              <div className="meeting-type-card">
                <div>
                  <div className="name">
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: mt.color, marginRight: 6 }} />
                    {mt.name} <span className={'pill' + (mt.isActive ? '' : ' is-off')}>{mt.isActive ? 'Active' : 'Off'}</span>
                  </div>
                  <div className="meta">{mt.durationMinutes} min · {USUAL_PHRASE[mt.locationType]} · {TIER_SHORT[mt.accessTier]}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select
                    aria-label={`Access tier for ${mt.name}`}
                    value={mt.accessTier}
                    onChange={(e) => changeTier(mt, Number(e.target.value))}
                    style={{ width: 'auto', padding: '6px 8px', fontSize: '0.82rem' }}
                  >
                    {Object.entries(TIER_LABELS).map(([tier, label]) => (
                      <option key={tier} value={tier}>{label}</option>
                    ))}
                  </select>
                  <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setShowForm(false); setEditingId(mt.id); }}>
                    Edit
                  </button>
                  <button className="btn btn-secondary btn-sm" type="button" onClick={() => toggleActive(mt)}>
                    {mt.isActive ? 'Turn off' : 'Turn on'}
                  </button>
                  <button className="btn btn-danger btn-sm" type="button" onClick={() => remove(mt)}>Delete</button>
                </div>
              </div>

              {ownerSlug && (
                <div className="mt-link">
                  <code>{linkFor(mt)}</code>
                  <button className="btn btn-secondary btn-sm" type="button" onClick={() => copyLink(mt)}>
                    {copiedId === mt.id ? 'Copied!' : 'Copy link'}
                  </button>
                  <a className="btn btn-secondary btn-sm" href={linkFor(mt)} target="_blank" rel="noreferrer">Open</a>
                  {!mt.isActive && <span>Turned off — this link won't open for anyone.</span>}
                </div>
              )}
            </>
          )}
        </div>
      ))}

      {!showForm && editingId === null && (
        <button className="btn btn-secondary" type="button" onClick={() => setShowForm(true)} style={{ marginTop: 12 }}>
          + Add meeting type
        </button>
      )}

      {showForm && (
        <MeetingTypeForm
          idPrefix="new-mt"
          initial={BLANK}
          submitLabel="Add meeting type"
          busyLabel="Adding…"
          onSubmit={handleCreate}
          onCancel={() => setShowForm(false)}
        />
      )}
    </div>
  );
}
