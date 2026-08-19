import { useEffect, useState } from 'react';
import DeleteAccount from '../../components/DeleteAccount.jsx';
import ConnectorsPanel from './ConnectorsPanel.jsx';
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

export default function SettingsTab({ ownerId }) {
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

      <ConnectorsPanel ownerId={ownerId} />

      <DeleteAccount />
    </div>
  );
}
