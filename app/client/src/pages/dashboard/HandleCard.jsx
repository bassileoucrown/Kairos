import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';

/**
 * Your handle, after setup is over.
 *
 * NOBODY IS WITHOUT ONE. Signup derives a handle from the name — Adaeze
 * Okonkwo becomes @adaeze-okonkwo — so an account has had one since before it
 * finished onboarding, and @ has always resolved for everybody. What was
 * missing was anywhere to LOOK at it or change it: the onboarding step that
 * asks is behind a guard that closes the moment setup is done, so a name
 * derived from a full legal name was permanent by accident rather than by
 * decision.
 *
 * The consequence of changing it is stated rather than discovered. A handle is
 * also the booking address, so anybody holding the old link — in an email
 * thread, in somebody's calendar, on a card — finds nothing after the change.
 * That is a fair trade if you know you are making it and an unpleasant
 * surprise if you do not.
 */
export default function HandleCard() {
  const { user, updateUser } = useAuth();
  const [value, setValue] = useState(user?.slug || '');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const current = user?.slug || '';
  const cleaned = value.trim().replace(/^@+/, '').toLowerCase();
  const changed = cleaned && cleaned !== current;

  async function save(e) {
    e.preventDefault();
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      const { user: updated } = await api.patch('/profile', { slug: cleaned });
      updateUser(updated);
      setValue(updated.slug);
      setEditing(false);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally { setSaving(false); }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Your handle</h3>
      <p className="hint" style={{ marginTop: -6 }}>
        How people name you here — in a message, on a booking link, when someone adds you
        to their team.
      </p>

      {error && <div className="alert alert-error">{error}</div>}
      {saved && !editing && (
        <div className="alert alert-success" role="status">
          Your handle is now @{current}. Your booking link changed with it.
        </div>
      )}

      {!editing && (
        <div className="handle-row">
          <span className="handle-current">@{current}</span>
          <span className="hint">{window.location.origin}/book/{current}</span>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setEditing(true); setSaved(false); }}>
            Change
          </button>
        </div>
      )}

      {editing && (
        <form onSubmit={save}>
          <div className="field">
            <label htmlFor="handle-input">New handle</label>
            <input
              id="handle-input"
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="ada"
              autoFocus
            />
            <p className="hint">
              Letters, numbers and hyphens. At least three characters.
            </p>
          </div>

          {/* Shown only once there is a real change to warn about, so the
              warning means something when it appears. */}
          {changed && (
            <div className="alert alert-error" role="status">
              <strong>@{current} will stop working.</strong> Anyone holding your old booking
              link — in an email, a calendar invite, on a card — will find nothing at{' '}
              /book/{current}. Your new one will be /book/{cleaned}.
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" type="submit" disabled={saving || !changed}>
              {saving ? 'Saving…' : 'Change my handle'}
            </button>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => { setEditing(false); setValue(current); setError(''); }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <Discoverable />
    </div>
  );
}

/**
 * Whether an exact handle resolves to your name for somebody not connected.
 *
 * ON BY DEFAULT, because a network where you cannot tell whether the person
 * you are trying to reach is even here is not a network — somebody types a
 * colleague's handle, gets nothing, and cannot tell a typo from an absence.
 *
 * AND THE SWITCH IS WHAT MAKES THAT HONEST. A default that cannot be turned
 * off is not a default, it is a policy dressed as one. Off puts you back to
 * answering exactly as a stranger does.
 */
function Discoverable() {
  const { user, updateUser } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const on = user?.discoverable !== false;

  async function toggle() {
    setSaving(true);
    setError('');
    try {
      const { user: updated } = await api.patch('/profile', { discoverable: !on });
      updateUser(updated);
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }

  return (
    <div className="handle-discoverable">
      {error && <div className="alert alert-error">{error}</div>}
      <p className="hint">
        {on
          ? 'Somebody who types your exact handle can see your name, so they know they have '
            + 'the right person before asking to connect. There is still no directory and no search.'
          : 'Your handle resolves to nothing for anyone you are not connected to. They cannot '
            + 'tell whether you are on Kairos at all.'}
      </p>
      <button className="btn btn-sm" type="button" onClick={toggle} disabled={saving}>
        {saving ? 'Saving…' : on ? 'Stop being findable by handle' : 'Let people find me by handle'}
      </button>
    </div>
  );
}
