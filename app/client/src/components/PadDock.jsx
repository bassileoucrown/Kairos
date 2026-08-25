import { useEffect, useRef, useState } from 'react';
import { useLocation, useMatch } from 'react-router-dom';
import { api } from '../lib/api.js';

/**
 * The pad, within reach of wherever you are.
 *
 * WHY IT FLOATS RATHER THAN LIVING IN THE HEADER. The header is not sticky —
 * it scrolls away — so a button up there is only reachable at the top of the
 * page, which is exactly not where you are when a thought arrives halfway down
 * a day sheet. A capture tool you have to scroll to is a capture tool you stop
 * using, and the note ends up on the back of an envelope.
 *
 * WHY BOTTOM-RIGHT, AND HOW IT AVOIDS BEING IN THE WAY.
 *
 *   1. It is the thumb arc. On a phone held one-handed, the bottom corner is
 *      the easiest point on the screen to reach and the top is the hardest.
 *   2. Nothing else is there. Kairos has no bottom navigation bar; the rail is
 *      a drawer on the left. So the corner is genuinely free rather than
 *      merely available.
 *   3. The page reserves room for it. .app-body carries bottom padding wider
 *      than the dock, so the last row of any list clears it — the button never
 *      sits on top of content somebody needs to read or tap.
 *   4. It gets out of the way while you read. Scrolling down collapses it to a
 *      quiet dot; pausing or scrolling up brings the label back. Present when
 *      wanted, nearly absent when not.
 *   5. On a wide screen the body is capped at 1100px, so the dock sits in the
 *      viewport corner, outside the column of text entirely.
 *
 * CAPTURE ONLY. No verbs, no filing, no due dates — writing is the only thing
 * it does. Deciding what a line becomes happens on the pad itself, later, with
 * a clear head. Putting the choices here would make the fast thing slow, which
 * is the one failure this cannot afford.
 */

// Where you are, said in the pad's terms, so a line written while looking at
// an appointment stays attached to it instead of becoming a sentence you have
// to re-attach from memory a week later.
function useAbout() {
  const booking = useMatch('/appointments/:ownerId/:bookingId');
  if (booking) return { kind: 'booking', id: booking.params.bookingId };
  return null;
}

export default function PadDock({ ownerId }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [justSaved, setJustSaved] = useState(false);
  const [shrunk, setShrunk] = useState(false);
  const boxRef = useRef(null);
  const location = useLocation();
  const about = useAbout();

  // Shrink on the way down, restore on the way up. Deliberately ignores tiny
  // movements: a dock that flickers on every wheel tick is more distracting
  // than one that never moves at all.
  useEffect(() => {
    if (open) return undefined;
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - last) < 12) return;
      setShrunk(y > last && y > 120);
      last = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [open]);

  // Close on Escape, and give the box the caret the moment it opens — the
  // whole promise is that you can start typing immediately.
  useEffect(() => {
    if (!open) return undefined;
    boxRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Moving to another screen closes it. An open composer left hanging over a
  // page you have navigated away from is a scrap of the last screen.
  useEffect(() => { setOpen(false); setError(''); }, [location.pathname]);

  async function save(e) {
    e?.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/pad', {
        body,
        visibility,
        ownerId,
        aboutKind: about?.kind || null,
        aboutId: about?.id || null,
      });
      setBody('');
      setJustSaved(true);
      setOpen(false);
      setTimeout(() => setJustSaved(false), 2200);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  if (!open) {
    return (
      <button
        className={'pad-dock-btn' + (shrunk ? ' is-shrunk' : '') + (justSaved ? ' is-saved' : '')}
        type="button"
        aria-label="Note something on the pad"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">✎</span>
        <span className="pad-dock-label">{justSaved ? 'On the pad' : 'Note'}</span>
      </button>
    );
  }

  return (
    <>
      {/* Only on small screens, where the composer covers enough of the page
          that a way out needs to be obvious. */}
      <div className="pad-dock-scrim" onClick={() => setOpen(false)} />
      <form className="pad-dock-open" onSubmit={save}>
        {error && <div className="alert alert-error">{error}</div>}
        <textarea
          ref={boxRef}
          aria-label="Something to come back to"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            // Send without reaching for the mouse. Plain Enter still breaks a
            // line, because a jotted note is often two.
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(e);
          }}
          placeholder={about ? 'About this appointment…' : 'Anything. Sort it out later.'}
        />
        {about && (
          <p className="hint" style={{ margin: '0 0 6px' }}>
            Kept against the appointment you are looking at.
          </p>
        )}
        <div className="pad-dock-row">
          <select aria-label="Who can see this" value={visibility}
            onChange={(e) => setVisibility(e.target.value)}>
            <option value="private">Only me</option>
            <option value="office">The office</option>
          </select>
          <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !body.trim()}>
            {busy ? 'Saving…' : 'Note it'}
          </button>
          <button className="btn btn-sm" type="button" onClick={() => setOpen(false)}>Close</button>
        </div>
      </form>
    </>
  );
}
