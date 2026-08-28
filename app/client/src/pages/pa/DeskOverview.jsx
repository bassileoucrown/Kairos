import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

// The desk, before you have picked a drawer.
//
// WHAT THIS REPLACED. Arriving at the desk put you in Approvals and hid the
// other eight sections behind a tab strip — which on a phone is a menu, so the
// desk's contents were a thing you had to already know about to find. An
// assistant could not see that two requests were waiting AND a brief was
// unwritten AND an instruction was outstanding without opening three drawers
// to check.
//
// NOT NINE SECTIONS STACKED. That was the obvious reading of "show me
// everything", and it is nine full features each loading its own data onto one
// page — slow, and on a phone a scroll nobody finishes. What somebody needs on
// arrival is not nine screens but nine answers to "is there anything in here
// for me". So this shows the answer and keeps the screen one tap away.

function Card({ section, onOpen }) {
  return (
    <button
      type="button"
      className={'desk-card' + (section.attention ? ' needs-you' : '')}
      onClick={() => onOpen(section.id)}
    >
      <div className="desk-card-head">
        <span className="desk-card-label">{section.label}</span>
        {/* The dot, not a number in a badge: which drawer needs opening today
            is a yes-or-no question, and the count below already says how much. */}
        {section.attention && <span className="desk-dot" aria-label="needs attention" />}
      </div>
      {section.count === null ? (
        <div className="desk-card-count is-tool">Open</div>
      ) : (
        <div className="desk-card-count">
          <strong>{section.count}</strong> <span>{section.unit}</span>
        </div>
      )}
      <div className="desk-card-note">{section.note}</div>
    </button>
  );
}

export default function DeskOverview({ ownerId, principalName, onOpen }) {
  const [sections, setSections] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!ownerId) return;
    setSections(null);
    api.get(`/pa/${ownerId}/desk`)
      .then((d) => setSections(d.sections))
      .catch((e) => setError(e.message));
  }, [ownerId]);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!sections) return <p className="hint">Loading…</p>;

  const needing = sections.filter((s) => s.attention);

  return (
    <div className="desk-overview">
      <p className="hint desk-intro">
        {needing.length === 0
          ? `Everything on ${principalName ? `${principalName}'s` : 'this'} desk is in hand.`
          : `${needing.length === 1 ? 'One thing needs' : `${needing.length} things need`} you`
            + `: ${needing.map((s) => s.label.toLowerCase()).join(', ')}.`}
      </p>
      <div className="desk-grid">
        {sections.map((s) => <Card key={s.id} section={s} onOpen={onOpen} />)}
      </div>
    </div>
  );
}
