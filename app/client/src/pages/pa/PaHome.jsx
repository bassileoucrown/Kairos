import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import ApprovalsTab from './ApprovalsTab.jsx';
import ContactsTab from './ContactsTab.jsx';
import BriefsTab from './BriefsTab.jsx';
import InstructionsTab from './InstructionsTab.jsx';
import CommsTab from './CommsTab.jsx';
import RelationshipsTab from './RelationshipsTab.jsx';
import AiAssistTab from './AiAssistTab.jsx';

const TABS = [
  { id: 'approvals', label: 'Approvals' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'relationships', label: 'Relationships' },
  { id: 'briefs', label: 'Briefs' },
  { id: 'instructions', label: 'Instructions' },
  { id: 'comms', label: 'Comms' },
  { id: 'ai_assist', label: 'AI Assist' },
];

const ROLE_LABELS = { owner: 'You', pa: 'PA', delegate: 'Delegate' };

export default function PaHome() {
  const { ownerId } = useParams();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [principals, setPrincipals] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('approvals');

  useEffect(() => {
    api.get('/pa/principals').then((data) => {
      setPrincipals(data.principals);
      if (!ownerId) {
        // Default to a real PA/delegate relationship over the user's own
        // account — visiting PA Home almost always means acting on someone
        // else's behalf; self is just the always-available fallback.
        const preferred = data.principals.find((p) => p.role !== 'owner') || data.principals[0];
        navigate(`/pa/${preferred.id}`, { replace: true });
      }
    }).catch((err) => setError(err.message));
  }, [ownerId, navigate]);

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  if (error) return <div className="spinner-page">{error}</div>;
  if (!principals || !ownerId) return <div className="spinner-page">Loading…</div>;

  const current = principals.find((p) => p.id === ownerId);

  return (
    <div className="shell">
      <div className="topbar">
        <span className="topbar-brand">Kairos — PA Home</span>
        <div className="topbar-actions">
          <Link to="/dashboard" className="btn btn-secondary btn-sm">My Dashboard</Link>
          <span>{user.name}</span>
          <button className="btn btn-secondary btn-sm" type="button" onClick={handleLogout}>Log out</button>
        </div>
      </div>

      <div className="page">
        <div className="page-header">
          <h1>PA Home</h1>
          {principals.length > 1 && (
            <select
              value={ownerId}
              onChange={(e) => navigate(`/pa/${e.target.value}`)}
              style={{ width: 'auto' }}
              aria-label="Switch principal"
            >
              {principals.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({ROLE_LABELS[p.role]})</option>
              ))}
            </select>
          )}
        </div>

        {!current ? (
          <div className="empty-state">You don't have access to that account.</div>
        ) : (
          <>
            <p className="tz-note" style={{ marginBottom: 16 }}>
              Managing <strong>{current.name}</strong>'s calendar as their {ROLE_LABELS[current.role]}.
              {current.role !== 'owner' && <> Your own calendar is separate — <Link to="/dashboard">open My Dashboard</Link> above.</>}
            </p>

            <div className="tabs">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  className={'tab-btn' + (tab === t.id ? ' is-active' : '')}
                  onClick={() => setTab(t.id)}
                  type="button"
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === 'approvals' && <ApprovalsTab ownerId={ownerId} />}
            {tab === 'contacts' && <ContactsTab ownerId={ownerId} />}
            {tab === 'relationships' && <RelationshipsTab ownerId={ownerId} />}
            {tab === 'briefs' && <BriefsTab ownerId={ownerId} />}
            {tab === 'instructions' && <InstructionsTab ownerId={ownerId} />}
            {tab === 'comms' && <CommsTab ownerId={ownerId} />}
            {tab === 'ai_assist' && <AiAssistTab ownerId={ownerId} />}
          </>
        )}
      </div>
    </div>
  );
}
