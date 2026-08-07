import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

export default function InstructionsTab({ ownerId }) {
  const [instructions, setInstructions] = useState(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [priority, setPriority] = useState('normal');
  const [submitting, setSubmitting] = useState(false);
  const [showDone, setShowDone] = useState(false);

  function load() {
    api.get(`/pa/${ownerId}/instructions`).then((data) => setInstructions(data.instructions)).catch((err) => setError(err.message));
  }

  useEffect(load, [ownerId]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await api.post(`/pa/${ownerId}/instructions`, { text, priority });
      setText('');
      setPriority('normal');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleStatus(instr) {
    try {
      await api.patch(`/pa/${ownerId}/instructions/${instr.id}`, { status: instr.status === 'open' ? 'done' : 'open' });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const visible = instructions ? instructions.filter((i) => showDone || i.status === 'open') : [];

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}

      <form onSubmit={handleAdd} className="card" style={{ marginBottom: 16 }}>
        <div className="field">
          <label htmlFor="instr-text">New instruction</label>
          <textarea
            id="instr-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Always leave 15 minutes before board calls. Never schedule Fridays after 3pm."
            required
          />
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} style={{ width: 'auto' }}>
            <option value="normal">Normal</option>
            <option value="urgent">Urgent</option>
          </select>
          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? 'Adding…' : 'Add instruction'}
          </button>
        </div>
      </form>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 12 }}>
        <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} style={{ width: 'auto' }} />
        Show done
      </label>

      {instructions === null && <p className="hint">Loading…</p>}
      {instructions && visible.length === 0 && <div className="empty-state">Nothing here.</div>}
      {visible.map((i) => (
        <div className="card" key={i.id}>
          <div className="booking-row">
            <div>
              <div className="when" style={{ textDecoration: i.status === 'done' ? 'line-through' : 'none' }}>
                {i.priority === 'urgent' && <span className="pill" style={{ background: 'var(--danger-soft)', color: 'var(--danger)', marginRight: 8 }}>Urgent</span>}
                {i.text}
              </div>
              <div className="meta">Logged by {i.createdBy} · {new Date(i.createdAt).toLocaleDateString()}</div>
            </div>
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => toggleStatus(i)}>
              {i.status === 'open' ? 'Mark done' : 'Reopen'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
