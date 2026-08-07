import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

export default function CommsTab({ ownerId }) {
  const [messages, setMessages] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [toEmail, setToEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState(null);

  function load() {
    api.get(`/pa/${ownerId}/comms`).then((data) => setMessages(data.messages)).catch((err) => setError(err.message));
  }

  useEffect(load, [ownerId]);

  async function handleSend(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      await api.post(`/pa/${ownerId}/comms`, { toEmail, subject, body });
      setSuccess('Sent.');
      setToEmail('');
      setSubject('');
      setBody('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <form onSubmit={handleSend} className="card" style={{ marginBottom: 16 }}>
        <p className="tz-note" style={{ marginBottom: 12 }}>Send on the principal's behalf — logged here and in the Outbox.</p>
        <div className="field">
          <label htmlFor="comms-to">To</label>
          <input id="comms-to" type="email" value={toEmail} onChange={(e) => setToEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="comms-subject">Subject</label>
          <input id="comms-subject" type="text" value={subject} onChange={(e) => setSubject(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="comms-body">Message</label>
          <textarea id="comms-body" value={body} onChange={(e) => setBody(e.target.value)} required style={{ minHeight: 100 }} />
        </div>
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? 'Sending…' : 'Send'}
        </button>
      </form>

      {messages === null && <p className="hint">Loading…</p>}
      {messages && messages.length === 0 && <div className="empty-state">No messages sent yet.</div>}
      {messages && messages.map((m) => (
        <div className="card" key={m.id} style={{ cursor: 'pointer' }} onClick={() => setExpanded(expanded === m.id ? null : m.id)}>
          <div className="booking-row">
            <div>
              <div className="when">{m.subject}</div>
              <div className="meta">To {m.toEmail} · sent by {m.sentBy}</div>
            </div>
            <span className="pill">{new Date(m.createdAt).toLocaleString()}</span>
          </div>
          {expanded === m.id && (
            <pre style={{ whiteSpace: 'pre-wrap', marginTop: 12, fontSize: '0.85rem', color: 'var(--text-muted)' }}>{m.body}</pre>
          )}
        </div>
      ))}
    </div>
  );
}
