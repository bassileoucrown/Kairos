import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

// One box, from anywhere, for the thing you know exists and cannot find.
//
// WHAT IT IS FOR. An assistant covering three principals knows the Geneva
// lease was agreed in a room somewhere, and knows the visa expiry is on file.
// Finding either one means remembering which screen and then scrolling it.
// That is the daily friction this removes, and it is worth more than any
// single screen in the product.
//
// IT ASKS FOR THE DESK YOU ARE AT, and only that one. The switcher already
// says whose affairs you are looking at; a search that spanned three
// principals would put three people's business in one list, and the first
// time that matters it matters a great deal.
//
// EVERY RULE IS THE SERVER'S. Nothing is filtered here — see lib/search.js,
// where each source asks its own table through the rule that already governs
// it. This component draws what it is handed and knows nothing about who may
// see what, which is deliberate: an access rule that exists in the client is
// an access rule that is one View Source away from being understood, and one
// fetch away from being bypassed.

const DEBOUNCE_MS = 220;

export default function FindBox({ ownerId, open, onClose }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  // Which request is the live one. A slow answer for "ge" must not land on
  // top of a fast answer for "geneva" — the box would then be showing results
  // for something nobody typed, which is worse than showing nothing.
  const latest = useRef(0);

  useEffect(() => {
    if (!open) return undefined;
    setQ('');
    setResult(null);
    setError('');
    setCursor(0);
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  // ESCAPE CLOSES IT FROM THE DOCUMENT, not only from the input.
  //
  // The input has its own key handler and gets focus a moment after the box
  // opens, so hanging Escape on it alone leaves a window — small, but real —
  // where the box is on screen over everything and the key that should dismiss
  // it does nothing. Somebody who opened this by accident presses Escape
  // immediately, which is exactly when that window is open.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !ownerId) return undefined;
    const asked = String(q || '').trim();
    if (asked.length < 2) { setResult(null); setBusy(false); return undefined; }

    const mine = ++latest.current;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const d = await api.get(`/search/${ownerId}?q=${encodeURIComponent(asked)}`);
        if (latest.current !== mine) return;
        setResult(d);
        setError('');
        setCursor(0);
      } catch (err) {
        if (latest.current !== mine) return;
        setError(err.message);
        setResult(null);
      } finally {
        if (latest.current === mine) setBusy(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, open, ownerId]);

  if (!open) return null;

  const hits = (result?.groups || []).flatMap((g) => g.hits.map((h) => ({ ...h, group: g.label })));

  function go(hit) {
    if (!hit) return;
    onClose();
    navigate(hit.href);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(hits.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(hits[cursor]);
    }
  }

  let index = -1;

  return (
    <div className="find-veil" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="find-box" role="dialog" aria-modal="true" aria-label="Find">
        <input
          ref={inputRef}
          className="find-input"
          type="search"
          value={q}
          placeholder="Find a person, a trip, a room, a document…"
          aria-label="Find"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
        />

        <div className="find-results">
          {error && <p className="find-note find-error">{error}</p>}

          {!error && q.trim().length > 0 && q.trim().length < 2 && (
            <p className="find-note">Keep typing — two letters at least.</p>
          )}

          {!error && q.trim().length >= 2 && busy && !result && (
            <p className="find-note">Looking…</p>
          )}

          {/* SAID PLAINLY, AND SAID THE SAME WAY EVERY TIME. "Nothing here"
              is the honest answer both when a word appears nowhere and when
              what it appears in is not this person's to see — the two must
              be indistinguishable, because a different message for the second
              case is the disclosure the whole gate exists to prevent. */}
          {!error && result && !result.tooShort && result.total === 0 && (
            <p className="find-note">Nothing here for “{result.term}”.</p>
          )}

          {!error && (result?.groups || []).map((group) => (
            <div className="find-group" key={group.id}>
              <h3>{group.label}</h3>
              <ul>
                {group.hits.map((hit) => {
                  index += 1;
                  const at = index;
                  return (
                    <li key={`${group.id}-${hit.id}`}>
                      <button
                        type="button"
                        className={`find-hit${at === cursor ? ' is-on' : ''}`}
                        onMouseEnter={() => setCursor(at)}
                        onClick={() => go(hit)}
                      >
                        <span className="find-hit-title">{hit.title}</span>
                        {hit.detail && <span className="find-hit-detail">{hit.detail}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <p className="find-foot">
          <kbd>↑</kbd><kbd>↓</kbd> to move · <kbd>Enter</kbd> to open · <kbd>Esc</kbd> to close
          {result?.principal ? ` · searching ${result.principal.name}’s desk` : ''}
        </p>
      </div>
    </div>
  );
}
