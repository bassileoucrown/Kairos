import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import BookingsTab from './dashboard/BookingsTab.jsx';
import AvailabilityTab from './dashboard/AvailabilityTab.jsx';
import MeetingTypesTab from './dashboard/MeetingTypesTab.jsx';

const TABS = [
  { id: 'bookings', label: 'Bookings' },
  { id: 'availability', label: 'Availability' },
  { id: 'meeting_types', label: 'Meeting Types' },
];

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('bookings');
  const [copied, setCopied] = useState(false);

  const bookingPath = `/book/${user.slug}`;
  const bookingUrl = `${window.location.origin}${bookingPath}`;

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
          <span>{user.name}</span>
          <button className="btn btn-secondary btn-sm" type="button" onClick={handleLogout}>Log out</button>
        </div>
      </div>

      <div className="page">
        <div className="page-header">
          <h1>Dashboard</h1>
        </div>

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

        {tab === 'bookings' && <BookingsTab />}
        {tab === 'availability' && <AvailabilityTab />}
        {tab === 'meeting_types' && <MeetingTypesTab />}
      </div>
    </div>
  );
}
