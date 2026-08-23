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
        return (
          <span
            key={`${part}-${i}`}
            className={`mention is-${m.kind}`}
            title={m.notified
              ? `${m.name} — they can see this`
              : `${m.name} — a contact, not notified`}
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
 * contacts, marked as not notified, and — where the contact is not already
 * someone the caller can reach — an offer to invite them to connect. That
 * offer is the point. Typing @ for a contact used to find nothing at all,
 * which reads as a bug rather than as "this person has no account yet".
 */
export function MentionPicker({ ownerId, value, onChange, textareaRef }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [found, setFound] = useState({ people: [], contacts: [] });
  const [inviting, setInviting] = useState(null);
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
    if (!open || !ownerId) return undefined;
    let live = true;
    const t = setTimeout(() => {
      api.get(`/mentions/${ownerId}/lookup?q=${encodeURIComponent(q)}`)
        .then((d) => { if (live) setFound(d); })
        .catch(() => {});
    }, 150);
    return () => { live = false; clearTimeout(t); };
  }, [open, q, ownerId]);

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

  if (!open) return notice ? <p className="hint mention-notice">{notice}</p> : null;
  const nothing = found.people.length === 0 && found.contacts.length === 0;

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
      {found.contacts.length > 0 && (
        <>
          <div className="mention-group">Contacts — a reference, nobody is told</div>
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
