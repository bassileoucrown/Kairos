import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { BRAND_SHORT } from '../../lib/brand.js';

const CATEGORY_LABELS = { transactional: 'System', invite: 'Invite', comms: 'Comms' };

export default function OutboxTab() {
  const [emails, setEmails] = useState(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    api.get('/emails').then((data) => setEmails(data.emails)).catch((err) => setError(err.message));
  }, []);

  return (
    <div>
      <p className="tz-note" style={{ marginBottom: 16 }}>
        Every email {BRAND_SHORT} sends is recorded here, whether or not it was delivered. With
        no provider configured this is the only copy; with one, each message says whether it
        actually left.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      {emails === null && <p className="hint">Loading…</p>}
      {emails && emails.length === 0 && <div className="empty-state">No emails sent yet.</div>}
      {emails && emails.map((e) => (
        <div className="card" key={e.id} style={{ cursor: 'pointer' }} onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
          <div className="booking-row">
            <div>
              <div className="when">{e.subject}</div>
              <div className="meta">To {e.toEmail} · {CATEGORY_LABELS[e.category] || e.category}</div>
            </div>
            <div className="mail-state">
              {e.deliveryStatus === 'failed' && <span className="pill is-off">Not delivered</span>}
              {e.deliveryStatus === 'sent' && <span className="pill">Delivered</span>}
              {e.deliveryStatus === 'outbox' && <span className="pill is-off">Outbox only</span>}
              <span className="pill">{new Date(e.createdAt).toLocaleString()}</span>
            </div>
          </div>
          {/* The provider's own words. A message that silently went nowhere is
              worse than one that failed loudly — whoever is waiting for it has
              no idea they are waiting. */}
          {e.deliveryStatus === 'failed' && e.deliveryError && (
            <div className="alert alert-error" style={{ marginTop: 10, marginBottom: 0 }}>
              The provider refused this: {e.deliveryError}
            </div>
          )}
          {expanded === e.id && (
            <pre style={{ whiteSpace: 'pre-wrap', marginTop: 12, fontSize: '0.85rem', color: 'var(--text-muted)' }}>{e.body}</pre>
          )}
        </div>
      ))}
    </div>
  );
}
