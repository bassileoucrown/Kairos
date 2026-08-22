import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// What the diary says about how somebody works.
//
// Every line carries the count it came from, and the counts are shown whether
// or not there is a finding. That is the whole difference between advice
// somebody can act on and a horoscope: "meetings in the afternoon get moved
// more than any others — 4 moved" invites you to remember those four, and to
// disagree if the reason was a strike or a funeral. A sentence with no number
// behind it can only be believed or ignored.
export default function RhythmRead({ ownerId, principalName = null }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const whose = principalName ? `${principalName}'s` : 'your';

  useEffect(() => {
    if (!ownerId) return;
    setData(null);
    api.get(`/rhythm/${ownerId}/pattern`)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [ownerId]);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!data) return <p className="hint">Reading the diary…</p>;

  const busiest = Math.max(1, ...data.parts.map((p) => p.count));

  return (
    <div>
      {!data.enough && (
        <div className="alert">
          <strong>Not enough diary yet.</strong>{' '}
          Kairos reads {whose} last four months to work out when {principalName || 'you'} work
          best, and there {data.sampleSize === 1 ? 'is' : 'are'} {data.sampleSize} of the {data.needed} it
          needs. It will say something once there is something to say — a pattern drawn from four
          meetings is a coincidence.
        </div>
      )}

      {data.enough && data.findings.length === 0 && (
        <div className="empty-state">
          Nothing stands out — {whose} days are spread evenly enough that there is no honest
          pattern to report.
        </div>
      )}

      {data.findings.length > 0 && (
        <ul className="rhythm-list">
          {data.findings.map((f) => (
            <li className={'rhythm-line' + (f.weight === 'weak' ? ' is-weak' : '')} key={f.id}>
              <span className="rhythm-text">{f.text}</span>
              <span className="rhythm-evidence">{f.evidence}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Shown even when there is no finding, because the counts are the thing
          being reasoned from and hiding them would make the sentences above
          unarguable. */}
      <div className="rhythm-bars">
        {data.parts.map((p) => (
          <div className="rhythm-bar" key={p.id}>
            <span className="rhythm-bar-label">{p.label}</span>
            <span className="rhythm-bar-track">
              <span className="rhythm-bar-fill" style={{ width: `${Math.round((p.count / busiest) * 100)}%` }} />
            </span>
            <span className="rhythm-bar-n">
              {p.count}
              {p.movedAway > 0 ? ` · ${p.movedAway} moved` : ''}
            </span>
          </div>
        ))}
      </div>
      <p className="hint">
        Counted from what has already happened over the last four months — meetings, calls, meals,
        travel — not from what is planned. Nothing here changes {whose} availability on its own.
      </p>
    </div>
  );
}
