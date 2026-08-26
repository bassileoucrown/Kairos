import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

/**
 * What happens when you click somebody's name.
 *
 * THE NAME IS WHERE THE INTENTION STARTS. Names are on every message, every
 * note, every task in this product, and until now none of them did anything —
 * so a principal reading "Ngozi Bello" above a line about Thursday had to leave
 * the page, find a room, and hope she was in it before saying a word back. The
 * verbs belong where the thought happens.
 *
 * WHAT IS ON IT, AND WHY THOSE:
 *
 *   Message them — the ask. Opens a room for the two of you, made on demand.
 *   Hand them something — the pad's own verb, reachable from the moment you
 *     think of it rather than three screens later, which is where it was lost.
 *   Where you stand — what is open between you, in numbers. This is what an
 *     office actually wants from a name: not a profile, but "where are we with
 *     this person".
 *   Their remit — for a principal looking at their own assistant. Who may do
 *     what on your behalf is the question this product has been asked most, and
 *     the honest place to answer it is against the person's name.
 *   Copy their handle — because the next thing after reading a name is often
 *     writing it, and @handles are typed wrong.
 *
 * WHAT IS NOT ON IT. No email address, no phone number, nothing from anybody's
 * vault. A name is not a directory lookup, and the card returns only what the
 * reader already had in front of them plus the state of their own working
 * relationship. Somebody with no connection gets the same "no such person" a
 * missing account gets — whether a stranger holds a Kairos account is not a
 * fact this will confirm.
 */

const RELATION = {
  assistant: 'Works with you',
  principal: 'You work with them',
  colleague: 'Same office',
  connection: 'Connected',
};

const ROLE_LABEL = {
  pa: 'PA', ea: 'EA', chief_of_staff: 'Chief of Staff', delegate: 'Delegate',
};

export default function PersonMenu({ userId, name, ownerId = null, onClose }) {
  const navigate = useNavigate();
  const [card, setCard] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [handing, setHanding] = useState(false);
  const [note, setNote] = useState('');
  const [said, setSaid] = useState('');
  const boxRef = useRef(null);

  useEffect(() => {
    api.get(`/people/${userId}`)
      .then(setCard)
      .catch((err) => setError(err.message));
  }, [userId]);

  // Closes on a click anywhere else and on Escape. A menu that can only be
  // dismissed by finding its own small × is a menu people leave open.
  useEffect(() => {
    function away(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) onClose();
    }
    function key(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);

  async function message() {
    setBusy(true);
    setError('');
    try {
      const { threadId } = await api.post(`/people/${userId}/direct`);
      onClose();
      navigate(`/threads/${threadId}`);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function hand(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post(`/people/${userId}/hand`, { body: note, ownerId: ownerId || undefined });
      setNote('');
      setHanding(false);
      setSaid(`${card?.person.name || 'They'} will be told.`);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function copyHandle() {
    try {
      await navigator.clipboard.writeText(`@${card.person.handle}`);
      setSaid(`@${card.person.handle} copied.`);
    } catch {
      // Refused in plenty of ordinary situations, and the handle is on screen
      // to be read. A convenience failing is not the task failing.
      setSaid(`Their handle is @${card.person.handle}`);
    }
  }

  const p = card?.person;
  const b = card?.between;

  return (
    <div className="person-menu" ref={boxRef} role="dialog" aria-label={`About ${name}`}>
      <div className="person-head">
        <span className="person-name">{p?.name || name}</span>
        {p?.handle && <span className="person-handle">@{p.handle}</span>}
        {p && <span className="pill is-off person-relation">{RELATION[p.relation]}</span>}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {said && <p className="hint person-said">{said}</p>}
      {!card && !error && <p className="hint">Loading…</p>}

      {p?.relation === 'assistant' && (
        // The security question this product gets asked most, answered against
        // the person it is about rather than three screens away under Team.
        <p className="hint person-remit">
          {ROLE_LABEL[p.role] || 'Assistant'} on your account
          {p.canManageScheduling
            ? ' · may set your hours and meeting types'
            : ' · cannot change your hours or meeting types'}
        </p>
      )}

      {b && (b.youHandedThem > 0 || b.theyHandedYou > 0 || b.theirOpenTasks > 0) && (
        <ul className="person-between">
          {b.theyHandedYou > 0 && (
            <li><strong>{b.theyHandedYou}</strong> {b.theyHandedYou === 1 ? 'note' : 'notes'} they handed you, still open</li>
          )}
          {b.youHandedThem > 0 && (
            <li><strong>{b.youHandedThem}</strong> you handed them, still open</li>
          )}
          {b.theirOpenTasks > 0 && (
            <li><strong>{b.theirOpenTasks}</strong> live {b.theirOpenTasks === 1 ? 'task' : 'tasks'} of theirs you can see</li>
          )}
        </ul>
      )}

      {card && (
        <div className="person-actions">
          <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={message}>
            {card.directThreadId ? 'Open your line' : 'Message them'}
          </button>
          <button className="btn btn-secondary btn-sm" type="button"
            onClick={() => { setHanding((h) => !h); setSaid(''); }}>
            {handing ? 'Never mind' : 'Hand them something'}
          </button>
          <button className="btn btn-secondary btn-sm" type="button" onClick={copyHandle}>
            Copy handle
          </button>
        </div>
      )}

      {handing && (
        <form className="person-hand" onSubmit={hand}>
          <input
            type="text"
            aria-label={`Something for ${p?.name || name}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Chase the visa people…"
            autoFocus
          />
          <p className="hint">
            Goes on their pad, and tells them. Only the two of you can read it.
          </p>
          <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !note.trim()}>
            {busy ? 'Handing…' : 'Hand it over'}
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * A name that can be clicked, wherever one is shown.
 *
 * Renders as a button rather than a link because it opens something in place
 * rather than going somewhere — and as plain text, with no menu at all, for
 * your own name and for anybody with no account behind them. A name that looks
 * clickable and does nothing is worse than one that does not.
 */
export function PersonName({ userId, name, viewerId = null, ownerId = null, className = '' }) {
  const [open, setOpen] = useState(false);
  if (!userId || userId === viewerId) return <span className={className}>{name}</span>;
  return (
    <span className="person-anchor">
      <button
        type="button"
        className={`person-link ${className}`.trim()}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {name}
      </button>
      {open && (
        <PersonMenu userId={userId} name={name} ownerId={ownerId} onClose={() => setOpen(false)} />
      )}
    </span>
  );
}
