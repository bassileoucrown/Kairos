import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

const TIER_LABELS = { inner_circle: 'Inner Circle', close: 'Close', professional: 'Professional' };
const MONTH_DAY_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function ContactCard({ contact, ownerId, onSaved }) {
  const [notes, setNotes] = useState(contact.notes);
  const [tier, setTier] = useState(contact.relationshipTier);
  const [birthday, setBirthday] = useState(contact.birthday || '');
  const [anniversary, setAnniversary] = useState(contact.anniversary || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = notes !== contact.notes || tier !== contact.relationshipTier
    || birthday !== (contact.birthday || '') || anniversary !== (contact.anniversary || '');

  async function save() {
    if (birthday && !MONTH_DAY_RE.test(birthday)) return setError('Birthday must be MM-DD, e.g. 03-21.');
    if (anniversary && !MONTH_DAY_RE.test(anniversary)) return setError('Anniversary must be MM-DD, e.g. 09-14.');
    setError('');
    setSaving(true);
    try {
      const data = await api.patch(`/pa/${ownerId}/contacts/${contact.id}`, { notes, relationshipTier: tier, birthday, anniversary });
      onSaved(data.contact);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div className="meeting-type-card" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div className="name">{contact.name || contact.email}</div>
          <div className="meta">
            {contact.email} · {contact.meetingCount} meeting{contact.meetingCount === 1 ? '' : 's'}
            {contact.lastMeetingAt ? ` · last ${new Date(contact.lastMeetingAt).toLocaleDateString()}` : ''}
          </div>

          {error && <div className="alert alert-error" style={{ marginTop: 8 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10, marginBottom: 8 }}>
            <select aria-label={`Relationship tier for ${contact.name || contact.email}`} value={tier} onChange={(e) => setTier(e.target.value)} style={{ width: 'auto', fontSize: '0.82rem', padding: '6px 8px' }}>
              {Object.entries(TIER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input
              type="text"
              aria-label={`Birthday for ${contact.name || contact.email}`}
              placeholder="Birthday MM-DD"
              value={birthday}
              onChange={(e) => setBirthday(e.target.value)}
              style={{ width: 130, fontSize: '0.82rem', padding: '6px 8px' }}
            />
            <input
              type="text"
              aria-label={`Anniversary for ${contact.name || contact.email}`}
              placeholder="Anniversary MM-DD"
              value={anniversary}
              onChange={(e) => setAnniversary(e.target.value)}
              style={{ width: 150, fontSize: '0.82rem', padding: '6px 8px' }}
            />
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="PA notes — preferences, context, anything worth remembering"
            style={{ minHeight: 50 }}
          />
        </div>
      </div>
      {dirty && (
        <button className="btn btn-primary btn-sm" type="button" onClick={save} disabled={saving} style={{ marginTop: 10 }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      )}
    </div>
  );
}

function NewContactForm({ ownerId, onCreated }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const data = await api.post(`/pa/${ownerId}/contacts`, { email, name });
      onCreated(data.contact);
      setEmail('');
      setName('');
      setOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button className="btn btn-secondary btn-sm" type="button" onClick={() => setOpen(true)} style={{ marginBottom: 16 }}>
        + Add contact
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card" style={{ marginBottom: 16 }}>
      <div className="meeting-type-card" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
        <input
          type="email"
          placeholder="Email"
          aria-label="New contact email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{ width: 220 }}
        />
        <input
          type="text"
          placeholder="Name (optional)"
          aria-label="New contact name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ width: 200 }}
        />
        <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>
          {saving ? 'Adding…' : 'Add'}
        </button>
        <button className="btn btn-secondary btn-sm" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {error && <div className="alert alert-error" style={{ marginTop: 8 }}>{error}</div>}
    </form>
  );
}

export default function ContactsTab({ ownerId }) {
  const [contacts, setContacts] = useState(null);
  const [error, setError] = useState('');

  function load() {
    api.get(`/pa/${ownerId}/contacts`).then((data) => setContacts(data.contacts)).catch((err) => setError(err.message));
  }

  useEffect(load, [ownerId]);

  function handleSaved(updated) {
    setContacts((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }

  function handleCreated(created) {
    setContacts((prev) => [created, ...(prev || [])]);
  }

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      {contacts !== null && <NewContactForm ownerId={ownerId} onCreated={handleCreated} />}
      {contacts === null && <p className="hint">Loading…</p>}
      {contacts && contacts.length === 0 && (
        <div className="empty-state">No contacts yet — add one above, or they'll appear automatically the first time someone books.</div>
      )}
      {contacts && contacts.map((c) => (
        <ContactCard key={c.id} contact={c} ownerId={ownerId} onSaved={handleSaved} />
      ))}
    </div>
  );
}
