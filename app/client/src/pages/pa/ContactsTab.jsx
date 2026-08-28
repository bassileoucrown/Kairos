import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

const TIER_LABELS = { inner_circle: 'Inner Circle', close: 'Close', professional: 'Professional' };
const MONTH_DAY_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// Month-day, said the way a person says it rather than as the storage format.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
function monthDay(value) {
  if (!MONTH_DAY_RE.test(value || '')) return value || '';
  const [m, d] = value.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
}

/**
 * One person, read before it is edited.
 *
 * Every card used to be a permanently open editing form: a tier dropdown, two
 * date boxes and an empty notes area, per contact, always. Seven contacts made
 * seven of each, so the page was a data-entry sheet where the only thing
 * actually wanted most of the time — who is this, how well do we know them,
 * what did we agree — had to be read out of the gaps between form controls.
 *
 * So it reads as a line, and opens when there is something to change.
 */
function ContactCard({ contact, ownerId, onSaved, onRemoved }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(contact.notes);
  const [tier, setTier] = useState(contact.relationshipTier);
  const [birthday, setBirthday] = useState(contact.birthday || '');
  const [anniversary, setAnniversary] = useState(contact.anniversary || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = notes !== contact.notes || tier !== contact.relationshipTier
    || birthday !== (contact.birthday || '') || anniversary !== (contact.anniversary || '');

  /**
   * Take them out of the book.
   *
   * TWO ROUNDS WHEN THERE IS SOMETHING TO LOSE. The vault hangs documents off a
   * contact — a spouse's passport, a child's yellow fever card — so removing
   * one can destroy papers nobody was thinking about while pressing a button on
   * an address card. The server refuses the first attempt and says what is
   * attached; the second names the number back, so what is being agreed to is
   * a count somebody has actually read rather than a vague "are you sure".
   */
  async function remove() {
    setError('');
    setSaving(true);
    try {
      await api.del(`/pa/${ownerId}/contacts/${contact.id}`);
      onRemoved(contact.id);
      return;
    } catch (err) {
      if (err.status !== 409) { setError(err.message); setSaving(false); return; }
      const { documents = 0, visas = 0 } = err.data || {};
      const held = [
        documents ? `${documents} document${documents === 1 ? '' : 's'}` : null,
        visas ? `${visas} visa${visas === 1 ? '' : 's'}` : null,
      ].filter(Boolean).join(' and ');
      const yes = window.confirm(
        `${contact.name || contact.email} has ${held} kept against their name.\n\n`
        + 'Removing them deletes those too, permanently. Meetings you have already '
        + 'had with them stay.\n\nRemove anyway?',
      );
      if (!yes) { setSaving(false); return; }
      try {
        await api.del(`/pa/${ownerId}/contacts/${contact.id}`, { alsoDelete: documents + visas });
        onRemoved(contact.id);
        return;
      } catch (err2) { setError(err2.message); }
    }
    setSaving(false);
  }

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

  const who = contact.name || contact.email;
  const dates = [
    contact.birthday && `Birthday ${monthDay(contact.birthday)}`,
    contact.anniversary && `Anniversary ${monthDay(contact.anniversary)}`,
  ].filter(Boolean);

  return (
    <div className={'card contact-card' + (open ? ' is-open' : '')}>
      <div className="contact-head">
        <div className="contact-who">
          <span className="name">{who}</span>
          <span className={`pill tier-${contact.relationshipTier}`}>
            {TIER_LABELS[contact.relationshipTier] || contact.relationshipTier}
          </span>
        </div>
        <button
          className="itin-tool"
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Done' : 'Edit'}
        </button>
      </div>

      <div className="meta contact-meta">
        {/* Their username, when they have one — looked up from the account,
            never derived from the name on this record.

            Shown so it can be read and typed after an @, and DELIBERATELY not
            a link. The office needs to know what to call this person; it does
            not get a way into their account from here, and the row says
            nothing else about the account it came from. */}
        {contact.handle && (
          <>
            <span className="contact-handle">@{contact.handle}</span>
            {' · '}
          </>
        )}
        {contact.email} · {contact.meetingCount} meeting{contact.meetingCount === 1 ? '' : 's'}
        {contact.lastMeetingAt ? ` · last ${new Date(contact.lastMeetingAt).toLocaleDateString()}` : ''}
        {dates.length > 0 && ` · ${dates.join(' · ')}`}
      </div>

      {/* What was agreed about this person is the reason the record exists, so
          it is read without opening anything. Absent, it says nothing at all
          rather than showing an empty box. */}
      {!open && contact.notes && <p className="contact-notes">{contact.notes}</p>}

      {error && <div className="alert alert-error" style={{ marginTop: 8 }}>{error}</div>}

      {open && (
        <>
          <div className="contact-fields">
            <select
              aria-label={`Relationship tier for ${who}`}
              value={tier}
              onChange={(e) => setTier(e.target.value)}
            >
              {Object.entries(TIER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input
              type="text"
              aria-label={`Birthday for ${who}`}
              placeholder="Birthday MM-DD"
              value={birthday}
              onChange={(e) => setBirthday(e.target.value)}
            />
            <input
              type="text"
              aria-label={`Anniversary for ${who}`}
              placeholder="Anniversary MM-DD"
              value={anniversary}
              onChange={(e) => setAnniversary(e.target.value)}
            />
          </div>
          <textarea
            value={notes}
            aria-label={`Notes about ${who}`}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="PA notes — preferences, context, anything worth remembering"
            style={{ minHeight: 60 }}
          />
          <div className="code-actions" style={{ marginTop: 10 }}>
            {dirty && (
              <button className="btn btn-primary btn-sm" type="button" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}
            {/* Inside the opened card rather than on the closed row. A delete
                sitting on a list is a delete somebody presses while scrolling,
                and this one can take a passport with it. */}
            <button className="btn btn-danger btn-sm" type="button" onClick={remove} disabled={saving}>
              Remove
            </button>
          </div>
        </>
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

const KIND_LABELS = { birthday: 'Birthday', anniversary: 'Anniversary' };

function whenLabel(daysUntil) {
  if (daysUntil === 0) return 'Today';
  if (daysUntil === 1) return 'Tomorrow';
  return `In ${daysUntil} days`;
}

/**
 * What is coming up, at the top of the people it belongs to.
 *
 * This was its own tab. But it is not a second set of records — it is the
 * birthday and anniversary fields of these same contacts, sorted by which
 * comes next, and both were edited one tab away from where they were read.
 * One dataset behind two doors is how a strip ends up with eleven tabs.
 */
function ComingUp({ upcoming }) {
  if (!upcoming || upcoming.length === 0) return null;
  return (
    <section className="coming-up">
      <h2 className="section-head">Coming up</h2>
      <ul className="coming-list">
        {upcoming.map((u) => (
          <li key={`${u.contactId}-${u.kind}`} className={u.daysUntil <= 7 ? 'is-near' : ''}>
            <span className="coming-when">{whenLabel(u.daysUntil)}</span>
            <span className="coming-what">
              {KIND_LABELS[u.kind]} · <strong>{u.name}</strong>
            </span>
            {u.relationshipTier === 'inner_circle' && (
              <span className="pill tier-inner_circle">Inner Circle</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function ContactsTab({ ownerId }) {
  const [contacts, setContacts] = useState(null);
  const [upcoming, setUpcoming] = useState(null);
  const [error, setError] = useState('');

  function load() {
    api.get(`/pa/${ownerId}/contacts`).then((data) => setContacts(data.contacts)).catch((err) => setError(err.message));
    // Its own request, and a silent failure: a date nobody has set yet is the
    // normal case, and it must not stop the list of people rendering.
    api.get(`/pa/${ownerId}/relationships/upcoming`)
      .then((data) => setUpcoming(data.upcoming))
      .catch(() => setUpcoming([]));
  }

  useEffect(load, [ownerId]);

  function handleSaved(updated) {
    setContacts((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }

  function handleRemoved(id) {
    setContacts((prev) => prev.filter((c) => c.id !== id));
  }

  function handleCreated(created) {
    setContacts((prev) => [created, ...(prev || [])]);
  }

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      <ComingUp upcoming={upcoming} />
      {contacts !== null && <NewContactForm ownerId={ownerId} onCreated={handleCreated} />}
      {contacts === null && <p className="hint">Loading…</p>}
      {contacts && contacts.length === 0 && (
        <div className="empty-state">No contacts yet — add one above, or they'll appear automatically the first time someone books.</div>
      )}
      {contacts && contacts.map((c) => (
        <ContactCard key={c.id} contact={c} ownerId={ownerId}
          onSaved={handleSaved} onRemoved={handleRemoved} />
      ))}
    </div>
  );
}
