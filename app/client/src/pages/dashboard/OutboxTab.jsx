import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

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
        Every email Kairos sends lands here too — useful since no real email provider is
        configured in this environment. Set <code>RESEND_API_KEY</code> to also deliver for real.
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
            <span className="pill">{new Date(e.createdAt).toLocaleString()}</span>
          </div>
          {expanded === e.id && (
            <pre style={{ whiteSpace: 'pre-wrap', marginTop: 12, fontSize: '0.85rem', color: 'var(--text-muted)' }}>{e.body}</pre>
          )}
        </div>
      ))}
    </div>
  );
}
