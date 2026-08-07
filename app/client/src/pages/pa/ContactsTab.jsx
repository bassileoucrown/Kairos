import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

const TIER_LABELS = { inner_circle: 'Inner Circle', close: 'Close', professional: 'Professional' };

function ContactCard({ contact, ownerId, onSaved }) {
  const [notes, setNotes] = useState(contact.notes);
  const [tier, setTier] = useState(contact.relationshipTier);
  const [saving, setSaving] = useState(false);
  const dirty = notes !== contact.notes || tier !== contact.relationshipTier;

  async function save() {
    setSaving(true);
    try {
      const data = await api.patch(`/pa/${ownerId}/contacts/${contact.id}`, { notes, relationshipTier: tier });
      onSaved(data.contact);
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
          <div className="field" style={{ marginTop: 10, marginBottom: 8 }}>
            <select aria-label={`Relationship tier for ${contact.name || contact.email}`} value={tier} onChange={(e) => setTier(e.target.value)} style={{ width: 'auto', fontSize: '0.82rem', padding: '6px 8px' }}>
              {Object.entries(TIER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
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

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      {contacts === null && <p className="hint">Loading…</p>}
      {contacts && contacts.length === 0 && (
        <div className="empty-state">No contacts yet — they're created automatically the first time someone books.</div>
      )}
      {contacts && contacts.map((c) => (
        <ContactCard key={c.id} contact={c} ownerId={ownerId} onSaved={handleSaved} />
      ))}
    </div>
  );
}
