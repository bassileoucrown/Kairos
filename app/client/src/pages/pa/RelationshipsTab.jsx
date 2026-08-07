import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

const TIER_LABELS = { inner_circle: 'Inner Circle', close: 'Close', professional: 'Professional' };
const KIND_LABELS = { birthday: 'Birthday', anniversary: 'Anniversary' };

function whenLabel(daysUntil) {
  if (daysUntil === 0) return 'Today';
  if (daysUntil === 1) return 'Tomorrow';
  return `In ${daysUntil} days`;
}

export default function RelationshipsTab({ ownerId }) {
  const [upcoming, setUpcoming] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/pa/${ownerId}/relationships/upcoming`).then((data) => setUpcoming(data.upcoming)).catch((err) => setError(err.message));
  }, [ownerId]);

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      <p className="tz-note" style={{ marginBottom: 16 }}>
        Birthdays and anniversaries set on Contacts, sorted by what's coming up next. Inner Circle
        contacts are the ones worth never missing.
      </p>

      {upcoming === null && <p className="hint">Loading…</p>}
      {upcoming && upcoming.length === 0 && (
        <div className="empty-state">Nothing yet — add a birthday or anniversary from the Contacts tab.</div>
      )}
      {upcoming && upcoming.map((u) => (
        <div className="card" key={`${u.contactId}-${u.kind}`}>
          <div className="booking-row">
            <div>
              <div className="when">
                {u.relationshipTier === 'inner_circle' && <span className="pill" style={{ marginRight: 8 }}>Inner Circle</span>}
                {KIND_LABELS[u.kind]} · {u.name}
              </div>
              <div className="meta">{u.email} · {TIER_LABELS[u.relationshipTier]}</div>
            </div>
            <span className={'pill' + (u.daysUntil <= 7 ? '' : ' is-off')}>{whenLabel(u.daysUntil)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
