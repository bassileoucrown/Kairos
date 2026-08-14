import { useEffect, useMemo, useRef, useState } from 'react';
import { detectTimezone, listTimezones } from '../lib/timezones.js';

// Choosing a timezone without already knowing its name.
//
// The list itself was never the problem — the runtime has had it all along
// (Intl.supportedValuesOf, four hundred-odd zones, updated with the platform's
// own tzdata rather than a copy of it going stale in this repo). What was
// wrong was every way we asked for one.
//
// A dropdown of four hundred alphabetical entries is a list you scroll, and
// "Europe/London" sorts between Lisbon and Luxembourg, nowhere near where
// anybody looks. Worse, the trip form asked for the zone as free text with
// "Europe/London" as a placeholder — which is a spelling test. Type "London",
// or "GMT", or "UK", and the server correctly refuses all three, having been
// given no way to say what the right answer would have looked like.
//
// So: type where you are going. "Lagos", "London", "Dubai", "+1" — the search
// covers the city, the region, the zone's own name, its current offset, and a
// short list of aliases for places whose zone is named after a different city.
// Nobody should have to know that Abuja keeps Lagos time to book a flight.

// Cities people search for that are not themselves zone names, and countries
// they type instead of a city. Deliberately short and weighted to the routes
// this market actually flies: a search aid, not a geography dataset, and no
// part of what gets stored.
const ALIASES = {
  'Africa/Lagos': ['Abuja', 'Kano', 'Port Harcourt', 'Ibadan', 'Benin City', 'Nigeria', 'WAT'],
  'Africa/Accra': ['Ghana', 'Kumasi'],
  'Africa/Nairobi': ['Kenya', 'Mombasa'],
  'Africa/Johannesburg': ['Cape Town', 'Pretoria', 'Durban', 'South Africa'],
  'Africa/Cairo': ['Egypt'],
  'Europe/London': ['UK', 'United Kingdom', 'England', 'Britain', 'Manchester', 'Edinburgh',
    'Birmingham', 'GMT', 'BST'],
  'Europe/Dublin': ['Ireland'],
  'Europe/Paris': ['France'],
  'Europe/Berlin': ['Germany', 'Frankfurt', 'Munich', 'Hamburg'],
  'Europe/Zurich': ['Geneva', 'Switzerland', 'Basel'],
  'Europe/Rome': ['Italy', 'Milan'],
  'Europe/Madrid': ['Spain', 'Barcelona'],
  'Europe/Lisbon': ['Portugal'],
  'Europe/Amsterdam': ['Netherlands', 'Holland', 'Rotterdam'],
  'Europe/Istanbul': ['Turkey', 'Ankara'],
  'America/New_York': ['USA', 'United States', 'Washington', 'Boston', 'Miami', 'Atlanta', 'EST'],
  'America/Chicago': ['Houston', 'Dallas', 'Texas', 'CST'],
  'America/Los_Angeles': ['San Francisco', 'Seattle', 'California', 'PST'],
  'America/Toronto': ['Canada', 'Ottawa'],
  'America/Sao_Paulo': ['Brazil', 'Rio de Janeiro'],
  'Asia/Dubai': ['UAE', 'Emirates', 'Abu Dhabi', 'Sharjah'],
  'Asia/Qatar': ['Doha'],
  'Asia/Riyadh': ['Saudi Arabia', 'Jeddah', 'Mecca'],
  'Asia/Kolkata': ['India', 'Mumbai', 'Bombay', 'Delhi', 'New Delhi', 'Bangalore', 'Chennai'],
  'Asia/Shanghai': ['China', 'Beijing', 'Shenzhen', 'Guangzhou'],
  'Asia/Hong_Kong': ['HK'],
  'Asia/Tokyo': ['Japan', 'Osaka'],
  'Asia/Singapore': ['SG'],
  'Australia/Sydney': ['Australia', 'Melbourne', 'Canberra'],
  UTC: ['GMT', 'Zulu', 'Coordinated Universal Time'],
};

// Offered before anybody types, because an empty search box that answers with
// four hundred rows is the dropdown again. The detected zone goes first: it is
// right most of the time, and it is the one nobody should have to search for.
const COMMON = [
  'Africa/Lagos', 'Europe/London', 'America/New_York', 'Asia/Dubai',
  'Europe/Paris', 'Africa/Johannesburg', 'Asia/Singapore', 'America/Los_Angeles', 'UTC',
];

const cityOf = (zone) => zone.split('/').pop().replace(/_/g, ' ');
const regionOf = (zone) => (zone.includes('/') ? zone.split('/')[0].replace(/_/g, ' ') : '');

function offsetOf(zone) {
  try {
    return new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value || '';
  } catch { return ''; }
}

// Every zone's offset, computed once and only when the panel is first opened.
// Four hundred formatters is a few milliseconds — worth paying once for a
// search that can match "+1", not worth paying on every keystroke, and not
// worth paying at all on a page where nobody opens the picker.
let offsetCache = null;
function offsets() {
  if (offsetCache) return offsetCache;
  offsetCache = new Map(listTimezones().map((zone) => [zone, offsetOf(zone)]));
  return offsetCache;
}

function clockIn(zone) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, hour: '2-digit', minute: '2-digit',
    }).format(new Date());
  } catch { return ''; }
}

function haystack(zone) {
  return [zone, cityOf(zone), regionOf(zone), offsets().get(zone) || '', ...(ALIASES[zone] || [])]
    .join(' ')
    .toLowerCase();
}

// Somewhere people plausibly go, as opposed to somewhere that merely exists.
//
// There is no population figure in the platform's list, so alphabetical order
// is all a naive match has to fall back on — and alphabetically, "lon" is
// Longyearbyen (an Arctic settlement of about two thousand) before it is
// London. This is the honest proxy: the zones this product has had a reason to
// name are the zones its users mean. Everything else still matches, just below.
const PROMINENT = new Set([...COMMON, ...Object.keys(ALIASES)]);

function search(query) {
  const q = query.trim().toLowerCase();
  const all = listTimezones();
  if (!q) {
    const detected = detectTimezone();
    return [detected, ...COMMON.filter((z) => z !== detected)].filter((z) => all.includes(z));
  }

  // Five bands, best first: the city typed in full; cities that begin with
  // what was typed, somewhere likely before somewhere obscure; then anything
  // else that matched at all — a country, an alias, an offset — on the same
  // likely-first rule.
  const exact = [];
  const startsMajor = [];
  const startsRest = [];
  const alsoMajor = [];
  const also = [];
  for (const zone of all) {
    const city = cityOf(zone).toLowerCase();
    if (city === q) exact.push(zone);
    else if (city.startsWith(q)) (PROMINENT.has(zone) ? startsMajor : startsRest).push(zone);
    else if (haystack(zone).includes(q)) (PROMINENT.has(zone) ? alsoMajor : also).push(zone);
  }
  return [...exact, ...startsMajor, ...startsRest, ...alsoMajor, ...also];
}

const SHOWN = 60;

export default function TimezonePicker({
  id, value, onChange, emptyLabel = '', placeholder = 'Search a city or country…',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const box = useRef(null);
  const field = useRef(null);

  const matches = useMemo(() => search(query), [query]);
  const shown = matches.slice(0, SHOWN);

  useEffect(() => { setCursor(0); }, [query]);
  useEffect(() => { if (open) field.current?.focus(); }, [open]);

  // Clicking away is how people close things they have changed their mind
  // about, and they should not have to find the button that opened it.
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  function choose(zone) {
    onChange(zone);
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === 'Enter' && shown[cursor]) { e.preventDefault(); choose(shown[cursor]); }
    else if (e.key === 'Escape') { setOpen(false); }
  }

  return (
    <div className="tz-picker" ref={box}>
      <button
        type="button" id={id} className="tz-current"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open} aria-haspopup="listbox"
      >
        <span className="tz-current-name">
          {value ? cityOf(value) : (emptyLabel || 'Choose a timezone')}
          {value && <span className="tz-current-zone">{value}</span>}
        </span>
        <span className="tz-current-meta">
          {value && `${clockIn(value)} · ${offsetOf(value)}`}
        </span>
        {/* The search affordance, on the thing being searched. */}
        <span className="tz-search-icon" aria-hidden="true">🔍</span>
      </button>

      {open && (
        <div className="tz-panel">
          <div className="tz-search">
            <input
              ref={field} type="text" value={query} placeholder={placeholder}
              onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown}
              aria-label="Search timezones" aria-controls={`${id}-list`}
            />
          </div>

          {!query && <p className="tz-panel-hint">Where you are, and the places most often needed.</p>}
          {query && matches.length === 0 && (
            <p className="tz-panel-hint">
              Nothing matches “{query}”. Try the nearest large city — Abuja keeps Lagos time.
            </p>
          )}

          <ul className="tz-list" id={`${id}-list`} role="listbox">
            {emptyLabel && !query && (
              <li>
                <button
                  type="button" className={`tz-option${value === '' ? ' is-current' : ''}`}
                  onClick={() => choose('')}
                >
                  <span className="tz-option-city">{emptyLabel}</span>
                </button>
              </li>
            )}
            {shown.map((zone, i) => (
              <li key={zone}>
                <button
                  type="button" role="option" aria-selected={zone === value}
                  className={`tz-option${i === cursor ? ' is-cursor' : ''}${zone === value ? ' is-current' : ''}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => choose(zone)}
                >
                  <span className="tz-option-city">{cityOf(zone)}</span>
                  <span className="tz-option-zone">{regionOf(zone) || zone}</span>
                  <span className="tz-option-time">{clockIn(zone)} · {offsets().get(zone)}</span>
                </button>
              </li>
            ))}
          </ul>

          {matches.length > SHOWN && (
            <p className="tz-panel-hint">
              {matches.length - SHOWN} more — keep typing to narrow it.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
