import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../lib/api.js';

// One tap to say something is wrong, from wherever it went wrong.
//
// WHY A PROTOTYPE NEEDS THIS AND A FINISHED PRODUCT DOES NOT. A pilot whose
// findings arrive as voice notes an hour later produces impressions and loses
// evidence — the screen somebody was on, and what they were trying to do, are
// exactly the details that do not survive being retold. Taken here, the report
// carries the route with it and costs the tester nothing.
//
// THREE BUTTONS, NOT A TEXT BOX WITH A LABEL. "Confusing", "wrong" and "idea"
// are different reports and a pilot reads them differently: confusing is a
// design problem, wrong is a bug, an idea is neither and should not be triaged
// as one. Asking first also does most of the writing — somebody who has
// pressed "This is wrong" has already said the hard part.
//
// It sits beside the Pad button rather than in a menu, because a thing you
// have to go and find is a thing that gets reported to nobody.

const KINDS = [
  { id: 'confusing', label: 'I was confused', hint: 'You could not tell what to do, or what happened.' },
  { id: 'wrong', label: 'Something is wrong', hint: 'It did the wrong thing, or nothing at all.' },
  { id: 'idea', label: 'I have an idea', hint: 'Something that would have helped you here.' },
];

export default function TellUs() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(null);
  const [body, setBody] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function close() {
    setOpen(false); setKind(null); setBody(''); setSent(false); setError('');
  }

  async function send(e) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true); setError('');
    try {
      await api.post('/feedback', { kind, body, route: location.pathname });
      setSent(true);
      // Long enough to be seen, short enough not to be in the way.
      setTimeout(close, 1800);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  if (!open) {
    return (
      <button className="tellus-tab" type="button" onClick={() => setOpen(true)}>
        Tell us
      </button>
    );
  }

  return (
    <div className="tellus-scrim" role="presentation" onMouseDown={(e) => {
      if (e.target === e.currentTarget) close();
    }}>
      <div className="tellus-card" role="dialog" aria-modal="true" aria-label="Tell us something">
        {sent ? (
          <p className="tellus-thanks">Thank you — that went straight through.</p>
        ) : !kind ? (
          <>
            <h3>What happened?</h3>
            {KINDS.map((k) => (
              <button className="tellus-kind" type="button" key={k.id} onClick={() => setKind(k.id)}>
                <span className="tellus-kind-label">{k.label}</span>
                <span className="hint">{k.hint}</span>
              </button>
            ))}
            <button className="btn btn-sm" type="button" onClick={close}>Never mind</button>
          </>
        ) : (
          <form onSubmit={send}>
            <h3>{KINDS.find((k) => k.id === kind)?.label}</h3>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="field">
              <label htmlFor="tellus-body">In your own words</label>
              <textarea
                id="tellus-body" rows={5} value={body} autoFocus
                onChange={(e) => setBody(e.target.value)}
                placeholder="What were you trying to do?"
              />
              {/* Said plainly. Somebody whose profession is discretion should
                  know what leaves with a report before they write it. */}
              <p className="hint">
                Sent with your name and which screen you were on. Nothing else from
                this page goes with it.
              </p>
            </div>
            <div className="code-actions">
              <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !body.trim()}>
                {busy ? 'Sending…' : 'Send'}
              </button>
              <button className="btn btn-sm" type="button" onClick={() => setKind(null)}>Back</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
