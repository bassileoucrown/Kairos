import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

const LOCATION_LABELS = { video: 'Video call', phone: 'Phone call', in_person: 'In person' };

export default function MeetingTypesTab() {
  const [meetingTypes, setMeetingTypes] = useState(null);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [locationType, setLocationType] = useState('video');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function load() {
    api.get('/meeting-types').then((data) => setMeetingTypes(data.meetingTypes)).catch((err) => setError(err.message));
  }

  useEffect(load, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.post('/meeting-types', { name, durationMinutes: Number(durationMinutes), locationType, description });
      setName('');
      setDurationMinutes(30);
      setLocationType('video');
      setDescription('');
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(mt) {
    try {
      await api.patch(`/meeting-types/${mt.id}`, { isActive: !mt.isActive });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(mt) {
    if (!window.confirm(`Delete "${mt.name}"? This cannot be undone.`)) return;
    try {
      await api.del(`/meeting-types/${mt.id}`);
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
          <div className="meeting-type-card">
            <div>
              <div className="name">{mt.name} <span className={'pill' + (mt.isActive ? '' : ' is-off')}>{mt.isActive ? 'Active' : 'Off'}</span></div>
              <div className="meta">{mt.durationMinutes} min · {LOCATION_LABELS[mt.locationType]}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => toggleActive(mt)}>
                {mt.isActive ? 'Turn off' : 'Turn on'}
              </button>
              <button className="btn btn-danger btn-sm" type="button" onClick={() => remove(mt)}>Delete</button>
            </div>
          </div>
        </div>
      ))}

      {!showForm && (
        <button className="btn btn-secondary" type="button" onClick={() => setShowForm(true)} style={{ marginTop: 12 }}>
          + Add meeting type
        </button>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="card" style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor="new-mt-name">Name</label>
            <input id="new-mt-name" type="text" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="new-mt-duration">Duration (minutes)</label>
            <input id="new-mt-duration" type="number" min={5} max={480} value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="new-mt-location">Format</label>
            <select id="new-mt-location" value={locationType} onChange={(e) => setLocationType(e.target.value)}>
              <option value="video">Video call</option>
              <option value="phone">Phone call</option>
              <option value="in_person">In person</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="new-mt-description">Description (optional)</label>
            <textarea id="new-mt-description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" type="submit" disabled={submitting}>
              {submitting ? 'Adding…' : 'Add meeting type'}
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
