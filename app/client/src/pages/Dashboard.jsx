import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { api } from '../lib/api.js';
import { consumePostOnboardingRedirect } from '../lib/postAuthRedirect.js';
import BookingsTab from './dashboard/BookingsTab.jsx';
import CalendarTab from './dashboard/CalendarTab.jsx';
import AvailabilityTab from './dashboard/AvailabilityTab.jsx';
import MeetingTypesTab from './dashboard/MeetingTypesTab.jsx';
import MembersTab from './dashboard/MembersTab.jsx';
import OutboxTab from './dashboard/OutboxTab.jsx';
import SettingsTab from './dashboard/SettingsTab.jsx';

const TABS = [
  { id: 'calendar', label: 'Calendar' },
  { id: 'bookings', label: 'Bookings' },
  { id: 'availability', label: 'Availability' },
  { id: 'meeting_types', label: 'Meeting Types' },
  { id: 'members', label: 'Members' },
  { id: 'outbox', label: 'Outbox' },
  { id: 'settings', label: 'Settings' },
];

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('calendar');
  const [copied, setCopied] = useState(false);
  const [hasAvailability, setHasAvailability] = useState(null);

  const bookingPath = `/book/${user.slug}`;
  const bookingUrl = `${window.location.origin}${bookingPath}`;

  // Catches anyone who lands here right after finishing onboarding with a
  // pending destination stashed (e.g. accepting a PA invite) — the safest
  // single place to do this, since a route-guard re-render can otherwise
  // race and override an explicit navigate() called from onboarding itself.
  useEffect(() => {
    const target = consumePostOnboardingRedirect();
    if (target) navigate(target, { replace: true });
  }, [navigate]);

  // Availability is set here rather than during signup, so a brand-new
  // account has none and its booking page can't offer a single slot. Say so
  // plainly instead of leaving them to discover it from an empty page.
  // Re-checked when leaving the Availability tab so the notice clears as
  // soon as hours are saved.
  useEffect(() => {
    api.get('/availability')
      .then((data) => setHasAvailability(data.rules.length > 0))
      .catch(() => setHasAvailability(null));
  }, [tab]);

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(bookingUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard access can be blocked — link is still visible to copy manually
    }
  }

  return (
    <div className="shell">
      <div className="topbar">
        <span className="topbar-brand">Kairos</span>
        <div className="topbar-actions">
          <Link to="/spaces" className="btn btn-secondary btn-sm">Spaces</Link>
          <Link to="/pa" className="btn btn-secondary btn-sm">PA Home</Link>
          <span>{user.name}</span>
          <button className="btn btn-secondary btn-sm" type="button" onClick={handleLogout}>Log out</button>
        </div>
      </div>

      <div className="page">
        <div className="page-header">
          <h1>Dashboard</h1>
        </div>

        {hasAvailability === false && (
          <div className="alert alert-error" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ flex: 1, minWidth: 240 }}>
              <strong>Your booking page isn't live yet.</strong> You haven't set any available hours,
              so nobody can book you. Set them and you're open.
            </span>
            <button className="btn btn-primary btn-sm" type="button" onClick={() => setTab('availability')}>
              Set your hours
            </button>
          </div>
        )}

        <div className="booking-link-box">
          Your booking page: <code>{bookingUrl}</code>
          <button className="btn btn-secondary btn-sm" type="button" onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy link'}
          </button>
          <a className="btn btn-secondary btn-sm" href={bookingPath} target="_blank" rel="noreferrer">View</a>
        </div>

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

        {tab === 'calendar' && <CalendarTab />}
        {tab === 'bookings' && <BookingsTab />}
        {tab === 'availability' && <AvailabilityTab />}
        {tab === 'meeting_types' && <MeetingTypesTab />}
        {tab === 'members' && <MembersTab />}
        {tab === 'outbox' && <OutboxTab />}
        {tab === 'settings' && <SettingsTab />}
      </div>
    </div>
  );
}
