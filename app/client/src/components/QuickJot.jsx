import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';

/**
 * Write it down without leaving what you are doing.
 *
 * The pad has its own screen, but the moment a thought arrives is almost never
 * the moment you are looking at the pad — it is halfway through an appointment
 * page, or scanning the day. Making somebody navigate first is how the thought
 * gets lost, which is the entire failure this feature exists to prevent.
 *
 * `about` is what makes this more than a text box in two places: a line
 * written here remembers what was on screen, so "chase Chidi about the draft"
 * jotted on his appointment keeps a way back to that appointment instead of
 * becoming a sentence you have to re-attach by memory a week later.
 */
export default function QuickJot({
  ownerId, about = null, placeholder = 'Something to come back to…', onAdded,
}) {
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function save(e) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/pad', {
        body,
        visibility,
        ownerId,
        aboutKind: about?.kind || null,
        aboutId: about?.id || null,
      });
      setBody('');
      setSaved(true);
      onAdded?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <form className="pad-jot" onSubmit={save}>
      {error && <div className="alert alert-error" style={{ flexBasis: '100%' }}>{error}</div>}
      <textarea
        aria-label="Note it on the pad"
        rows={1}
        value={body}
        onChange={(e) => { setBody(e.target.value); setSaved(false); }}
        placeholder={placeholder}
      />
      <select aria-label="Who can see this note" value={visibility}
        onChange={(e) => setVisibility(e.target.value)} style={{ width: 'auto' }}>
        <option value="private">Only me</option>
        <option value="office">The office</option>
      </select>
      <button className="btn btn-secondary btn-sm" type="submit" disabled={busy || !body.trim()}>
        {busy ? 'Saving…' : 'Note it'}
      </button>
      {/* Confirmed in place rather than by a banner that moves the page: the
          point of this box is that using it costs nothing. */}
      {saved && !body && (
        <span className="hint" style={{ margin: 0 }}>On <Link to="/pad">the pad</Link>.</span>
      )}
    </form>
  );
}
