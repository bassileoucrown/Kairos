import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { api } from '../lib/api.js';
import { consumePostOnboardingRedirect } from '../lib/postAuthRedirect.js';
import AppShell from '../components/AppShell.jsx';
import BookingsTab from './dashboard/BookingsTab.jsx';
import CalendarTab from './dashboard/CalendarTab.jsx';
import AvailabilityTab from './dashboard/AvailabilityTab.jsx';
import MeetingTypesTab from './dashboard/MeetingTypesTab.jsx';
import MembersTab from './dashboard/MembersTab.jsx';
import EssentialsTab from './dashboard/EssentialsTab.jsx';
import SecurityTab from './dashboard/SecurityTab.jsx';
import OutboxTab from './dashboard/OutboxTab.jsx';
import SettingsTab from './dashboard/SettingsTab.jsx';
import Tabs from '../components/Tabs.jsx';

const TABS = [
  { id: 'calendar', label: 'Calendar' },
  { id: 'bookings', label: 'Bookings' },
  { id: 'availability', label: 'Availability' },
  { id: 'meeting_types', label: 'Meeting Types' },
  { id: 'members', label: 'Members' },
  { id: 'essentials', label: 'Essentials' },
  { id: 'security', label: 'Security' },
  { id: 'outbox', label: 'Outbox' },
  { id: 'settings', label: 'Settings' },
];

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // The tab lives in the URL so the nav can link straight to it and so a view
  // can be bookmarked or sent to someone.
  const tab = searchParams.get('tab') || 'calendar';
  const setTab = (t) => setSearchParams({ tab: t }, { replace: true });
  const [copied, setCopied] = useState(false);
  const [hasAvailability, setHasAvailability] = useState(null);
  const [hasQuestion, setHasQuestion] = useState(null);

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
  // The security question guards signing a lost device out, and the moment it
  // is needed is the moment nobody is browsing settings. Prompted here so it is
  // decided in advance, and only until it is set.
  useEffect(() => {
    api.get('/security/question')
      .then((d) => setHasQuestion(d.question.isSet))
      .catch(() => setHasQuestion(null));
  }, [tab]);

  useEffect(() => {
    api.get('/availability')
      .then((data) => setHasAvailability(data.rules.length > 0))
      .catch(() => setHasAvailability(null));
  }, [tab]);

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
    <AppShell
      title="My account"
      active={tab === 'settings' ? 'settings' : 'calendar'}
      actions={
        <a className="btn btn-secondary btn-sm" href={bookingPath} target="_blank" rel="noreferrer">
          View booking page
        </a>
      }
    >
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

      {hasQuestion === false && (
        <div className="alert alert-warning sq-prompt" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 240 }}>
            <strong>You have no security question yet.</strong> It is what lets you sign a lost
            phone out from whatever device you still have — deliberately not your authenticator
            code, since that is often on the phone that went missing.
          </span>
          <button className="btn btn-primary btn-sm" type="button" onClick={() => setTab('security')}>
            Set your question
          </button>
        </div>
      )}

      <div className="booking-link-box">
        Your booking page: <code>{bookingUrl}</code>
        <button className="btn btn-secondary btn-sm" type="button" onClick={handleCopy}>
          {copied ? 'Copied!' : 'Copy link'}
        </button>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} label="Account sections" />

      {tab === 'calendar' && <CalendarTab />}
      {tab === 'bookings' && <BookingsTab />}
      {tab === 'availability' && <AvailabilityTab />}
      {tab === 'meeting_types' && <MeetingTypesTab />}
      {tab === 'members' && <MembersTab />}
      {tab === 'essentials' && <EssentialsTab ownerId={user?.id} />}
      {tab === 'security' && <SecurityTab />}
      {tab === 'outbox' && <OutboxTab />}
      {tab === 'settings' && <SettingsTab ownerId={user?.id} />}
    </AppShell>
  );
}
