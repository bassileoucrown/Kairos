import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

/**
 * @ on screen: two things, drawn so nobody confuses them.
 *
 * An ADDRESS is a person who will be told. A MENTION is a record about
 * somebody who will not. If those looked alike, an assistant would write
 * "@tunde will confirm" believing Tunde had been asked, and find out at the
 * airport that he had not. So the mention is quieter, carries a dotted
 * underline rather than a solid one, and says "not notified" on hover.
 *
 * A handle matching neither stays as plain text, because people write
 * "email me @ 9" and that must not become a broken link.
 */
function titleFor(m) {
  if (m.notified) return `${m.name} — they were told`;
  if (m.reason === 'no-access') return `${m.name} — not in this space, so not told`;
  return `${m.name} — in your contacts, but you cannot reach them here`;
}

export function MentionText({ body, mentions = [] }) {
  if (!body) return null;
  const byHandle = new Map(mentions.map((m) => [m.handle.toLowerCase(), m]));
  // The same lookbehind the server parses with, so what is drawn and what is
  // resolved can never disagree — an email address must not become a mention
  // of its domain.
  const parts = String(body).split(/(?<![\w.%+-])(@[a-z0-9][a-z0-9-]{1,38}[a-z0-9])/gi);

  return (
    <>
      {parts.map((part, i) => {
        if (!part.startsWith('@')) return part;
        const m = byHandle.get(part.slice(1).toLowerCase());
        if (!m || m.kind === 'unknown') return part;
        // Three states, not two. A person outside this space is a real person
        // and worth naming, but nothing reached them — so they are drawn like
        // a mention rather than like an address, and say why.
        const reached = m.notified;
        return (
          <span
            key={`${part}-${i}`}
            className={`mention is-${reached ? m.kind : 'quiet'}`}
            title={titleFor(m)}
          >
            @{m.handle}
          </span>
        );
      })}
    </>
  );
}

/**
 * The picker.
 *
 * Opens on "@" and offers two groups. The second group is the interesting one:
 * contacts who hold a Kairos account, written by the username they chose,
 * marked as not notified, with an offer to connect. That offer is the point:
 * the username exists, so the person is reachable in principle — they just are
 * not reachable by you yet.
 *
 * A contact with no account is not offered, because there is no username to
 * type. Kairos does not mint one on their behalf.
 */
export function MentionPicker({ ownerId, spaceId, value, onChange, textareaRef }) {
  // Inside a space the answer to "who can I address" is narrower — the people
  // in the room — and is authorised by access to the space rather than by
  // being somebody's assistant. Two endpoints, one component, because the
  // difference is in who may be offered, not in how choosing one works.
  const source = spaceId ? `/mentions/space/${spaceId}/lookup` : (ownerId && `/mentions/${ownerId}/lookup`);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [found, setFound] = useState({ people: [], contacts: [], nearby: [], canAddMembers: false });
  const [inviting, setInviting] = useState(null);
  const [adding, setAdding] = useState(null);
  const [notice, setNotice] = useState('');
  const anchor = useRef(0);

  // Watch what is being typed for a live "@word" at the caret.
  useEffect(() => {
    const el = textareaRef?.current;
    if (!el) return undefined;
    const check = () => {
      const upto = String(value || '').slice(0, el.selectionStart ?? 0);
      const m = upto.match(/@([a-z0-9-]*)$/i);
      if (!m) { setOpen(false); return; }
      anchor.current = upto.length - m[0].length;
      setQ(m[1] || '');
      setOpen(true);
    };
    el.addEventListener('keyup', check);
    el.addEventListener('click', check);
    return () => {
      el.removeEventListener('keyup', check);
      el.removeEventListener('click', check);
    };
  }, [value, textareaRef]);

  useEffect(() => {
    if (!open || !source) return undefined;
    let live = true;
    const t = setTimeout(() => {
      api.get(`${source}?q=${encodeURIComponent(q)}`)
        .then((d) => { if (live) setFound(d); })
        .catch(() => {});
    }, 150);
    return () => { live = false; clearTimeout(t); };
  }, [open, q, source]);

  function insert(handle) {
    const before = String(value || '').slice(0, anchor.current);
    const after = String(value || '').slice(anchor.current).replace(/^@[a-z0-9-]*/i, '');
    onChange(`${before}@${handle} ${after}`.replace(/\s+$/, ' '));
    setOpen(false);
  }

  async function invite(c) {
    setInviting(c.contactId);
    setNotice('');
    try {
      const d = await api.post(`/mentions/${ownerId}/contacts/${c.contactId}/invite`, {});
      setNotice(d.message || 'Invitation sent.');
    } catch (e) {
      setNotice(e.message);
    } finally { setInviting(null); }
  }

  /**
   * Bring somebody into the room, from inside the sentence about them.
   *
   * A SEPARATE TAP FROM NAMING THEM, deliberately. It would be neater for @
   * alone to add people, and it would be wrong: a room holds everything said
   * in it before you arrived, so adding somebody discloses a history, and that
   * is not something to do as a side effect of typing a name. It would also
   * break the one distinction this component exists to keep — that naming a
   * person and reaching them are different things. So the picker offers, says
   * what it will do, and waits to be asked.
   */
  async function addToRoom(p) {
    setAdding(p.id);
    setNotice('');
    try {
      await api.post(`/spaces/${spaceId}/members`, { handle: p.handle });
      setNotice(`${p.name} is in this room now, and can read what was said before.`);
      insert(p.handle);
    } catch (e) {
      setNotice(e.message);
    } finally { setAdding(null); }
  }

  if (!open) return notice ? <p className="hint mention-notice">{notice}</p> : null;
  const nearby = found.nearby || [];
  const nothing = found.people.length === 0 && found.contacts.length === 0 && nearby.length === 0;

  return (
    <div className="mention-picker">
      {found.people.length > 0 && (
        <>
          <div className="mention-group">People — they will see it</div>
          {found.people.map((p) => (
            <button className="mention-option" type="button" key={p.handle} onClick={() => insert(p.handle)}>
              <strong>{p.name}</strong> <span className="hint">@{p.handle}</span>
            </button>
          ))}
        </>
      )}
      {nearby.length > 0 && (
        <>
          <div className="mention-group">
            {found.canAddMembers
              ? 'You work with them — not in this room yet'
              : 'You work with them — not in this room, so naming them tells them nothing'}
          </div>
          {nearby.map((p) => (
            <div className="mention-row" key={p.handle}>
              <button className="mention-option" type="button" onClick={() => insert(p.handle)}>
                <strong>{p.name}</strong> <span className="hint">@{p.handle}</span>
              </button>
              {found.canAddMembers && (
                <button
                  className="itin-tool"
                  type="button"
                  disabled={adding === p.id}
                  onClick={() => addToRoom(p)}
                >
                  {adding === p.id ? 'Adding…' : 'Add to room'}
                </button>
              )}
            </div>
          ))}
        </>
      )}
      {found.contacts.length > 0 && (
        <>
          <div className="mention-group">In your contacts — naming them tells them nothing</div>
          {found.contacts.map((c) => (
            <div className="mention-row" key={c.handle}>
              <button className="mention-option" type="button" onClick={() => insert(c.handle)}>
                <strong>{c.name}</strong> <span className="hint">@{c.handle}</span>
              </button>
              {c.canInvite && (
                <button
                  className="itin-tool"
                  type="button"
                  disabled={inviting === c.contactId}
                  onClick={() => invite(c)}
                >
                  {inviting === c.contactId ? 'Inviting…' : 'Invite to connect'}
                </button>
              )}
            </div>
          ))}
        </>
      )}
      {nothing && <p className="hint" style={{ padding: '8px 10px' }}>Nobody by that name.</p>}
      {notice && <p className="hint mention-notice">{notice}</p>}
    </div>
  );
}
