import { useEffect, useState } from 'react';
import DeleteAccount from '../../components/DeleteAccount.jsx';
import { api } from '../../lib/api.js';
import { BRAND_SHORT } from '../../lib/brand.js';

function IntegrationRow({ name, description, status, configured, onConnect, onDisconnect }) {
  return (
    <div className="card">
      <div className="meeting-type-card">
        <div>
          <div className="name">
            {name} <span className={'pill' + (status === 'connected' ? '' : ' is-off')}>{status === 'connected' ? 'Connected' : 'Not connected'}</span>
          </div>
          <div className="meta">{description}</div>
          {!configured && (
            <div className="meta" style={{ color: 'var(--danger)', marginTop: 4 }}>
              Not configured on this deployment — needs real API credentials first.
            </div>
          )}
        </div>
        {status === 'connected' ? (
          <button className="btn btn-secondary btn-sm" type="button" onClick={onDisconnect}>Disconnect</button>
        ) : (
          <button className="btn btn-secondary btn-sm" type="button" onClick={onConnect}>Connect</button>
        )}
      </div>
    </div>
  );
}

export default function SettingsTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  function load() {
    api.get('/integrations').then(setData).catch((err) => setError(err.message));
  }

  useEffect(load, []);

  async function handleConnect(path) {
    setError('');
    setInfo('');
    try {
      await api.post(path);
      load();
    } catch (err) {
      // Expected in this environment — no real credentials configured yet.
      setInfo(err.message);
    }
  }

  async function handleDisconnect(path) {
    try {
      await api.del(path);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!data) return <p className="hint">Loading…</p>;

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      {info && <div className="alert alert-success">{info}</div>}

      <p className="tz-note" style={{ marginBottom: 16 }}>
        Two-way calendar sync and WhatsApp notifications are architected but inactive until real
        provider credentials are configured on this deployment.
      </p>

      <IntegrationRow
        name="Google Calendar"
        description="Two-way sync: read your existing busy time, write {BRAND_SHORT} bookings back out."
        status={data.calendar.google.status}
        configured={data.calendar.google.configured}
        onConnect={() => handleConnect('/integrations/calendar/google/connect')}
        onDisconnect={() => handleDisconnect('/integrations/calendar/google')}
      />
      <IntegrationRow
        name="Outlook Calendar"
        description="Two-way sync via Microsoft Graph."
        status={data.calendar.outlook.status}
        configured={data.calendar.outlook.configured}
        onConnect={() => handleConnect('/integrations/calendar/outlook/connect')}
        onDisconnect={() => handleDisconnect('/integrations/calendar/outlook')}
      />
      <IntegrationRow
        name="WhatsApp notifications"
        description="Booking confirmations and reminders over WhatsApp Business API."
        status={data.whatsapp.status}
        configured={data.whatsapp.configured}
        onConnect={() => handleConnect('/integrations/whatsapp/connect')}
        onDisconnect={() => handleDisconnect('/integrations/whatsapp')}
      />

      <DeleteAccount />
    </div>
  );
}
