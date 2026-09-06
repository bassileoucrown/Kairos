import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

/**
 * A place field: still an ordinary text box, with the map's opinion offered.
 *
 * DESIGNED SO THE MAP CAN BE IGNORED. Everything an assistant could type
 * before, they can still type — the field saves free text and always did.
 * Picking a suggestion additionally records the place id, which is what makes
 * a distance lookup mean one point on the earth instead of a phrase Google
 * interprets afresh each time. If the maps key is unset, or the provider is
 * down, or the place has no entry, this is exactly the input it replaced.
 *
 * THE ID FOLLOWS THE WORDS, AND IS DROPPED THE MOMENT THEY DIVERGE. Typing
 * after picking clears it. That looks wasteful and is the point: an id that
 * outlives the text it described puts one place on the screen and a different
 * one in every route calculation, and nothing on screen would show the two had
 * parted company.
 *
 * NOT SHOWN AT ALL FOR PERSONAL TIME OR A PRIVATE TRIP. Autocomplete sends a
 * request per keystroke, so a search box that stayed live there would leak
 * what the distance rule refuses — the beginning of a private destination,
 * then a bit more of it. The server refuses these too; this is the half that
 * stops the request being made in the first place.
 */
export default function PlaceField({
  id, label, value, placeId, onChange, placeholder, ownerId,
  kind, tripId, disabled = false, personal = false,
}) {
  const [hits, setHits] = useState([]);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  // One token per edit, so the provider bills a session rather than every
  // letter of one. Regenerated after a pick, which ends the session.
  const session = useRef(cryptoToken());
  const box = useRef(null);
  const latest = useRef(0);

  useEffect(() => {
    if (personal || disabled) { setHits([]); setOpen(false); return undefined; }
    const text = String(value || '').trim();
    if (text.length < 2 || placeId) { setHits([]); setOpen(false); return undefined; }
    const mine = ++latest.current;
    const t = setTimeout(async () => {
      const params = new URLSearchParams({ q: text, session: session.current });
      if (kind) params.set('kind', kind);
      if (tripId) params.set('tripId', tripId);
      // Swallowed on purpose. An unconfigured deployment answers 501 and a
      // provider outage answers 400, and neither is a reason to put an error
      // under a field somebody is still typing into — the field works without
      // the map, which is the whole design.
      const r = await api.get(`/itinerary/${ownerId}/places?${params}`).catch(() => null);
      // A late answer to an earlier keystroke must not overwrite a newer one.
      if (mine !== latest.current) return;
      const found = r?.places || [];
      setHits(found);
      setCursor(-1);
      setOpen(found.length > 0);
    }, 220);
    return () => clearTimeout(t);
  }, [value, placeId, ownerId, kind, tripId, disabled, personal]);

  useEffect(() => {
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const pick = (hit) => {
    onChange(hit.description, hit.placeId);
    session.current = cryptoToken();
    setOpen(false);
    setHits([]);
  };

  const onKeyDown = (e) => {
    if (!open || !hits.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, hits.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, -1)); }
    else if (e.key === 'Enter' && cursor >= 0) { e.preventDefault(); pick(hits[cursor]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div className="place-field" ref={box}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        // Typing by hand is an edit of the words, so the id stops applying.
        onChange={(e) => onChange(e.target.value, null)}
        onKeyDown={onKeyDown}
      />
      {placeId && (
        <p className="place-pinned" title="This will be looked up as an exact place.">
          Pinned on the map
        </p>
      )}
      {open && (
        <ul className="place-hits" role="listbox">
          {hits.map((h, i) => (
            <li key={h.placeId}>
              <button
                type="button"
                className={`place-hit${i === cursor ? ' is-on' : ''}`}
                // mousedown, not click: the input's blur would close the list
                // first and the click would land on nothing.
                onMouseDown={(e) => { e.preventDefault(); pick(h); }}
              >
                <span className="place-hit-main">{h.primary}</span>
                {h.secondary && <span className="place-hit-sub">{h.secondary}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function cryptoToken() {
  try { return crypto.randomUUID(); } catch { return String(Math.random()).slice(2); }
}
