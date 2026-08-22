import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import { consumePostOnboardingRedirect } from '../../lib/postAuthRedirect.js';
import AppShell, { getActivePrincipal } from '../../components/AppShell.jsx';
import ApprovalsTab from './ApprovalsTab.jsx';
import ContactsTab from './ContactsTab.jsx';
import BriefsTab from './BriefsTab.jsx';
import InstructionsTab from './InstructionsTab.jsx';
import CommsTab from './CommsTab.jsx';
import RelationshipsTab from './RelationshipsTab.jsx';
import AiAssistTab from './AiAssistTab.jsx';
import AvailabilityTab from '../dashboard/AvailabilityTab.jsx';
import MeetingTypesTab from '../dashboard/MeetingTypesTab.jsx';
import BookingsTab from '../dashboard/BookingsTab.jsx';
import Tabs from '../../components/Tabs.jsx';

// Scheduling tabs only appear when the principal has delegated them, so an
// assistant is never shown a door that will 403.
const TABS = [
  { id: 'approvals', label: 'Approvals' },
  { id: 'bookings', label: 'Bookings' },
  { id: 'availability', label: 'Availability', scheduling: true },
  { id: 'meeting_types', label: 'Meeting Types', scheduling: true },
  { id: 'contacts', label: 'Contacts' },
  { id: 'relationships', label: 'Relationships' },
  { id: 'briefs', label: 'Briefs' },
  { id: 'instructions', label: 'Instructions' },
  { id: 'comms', label: 'Comms' },
  { id: 'ai_assist', label: 'AI Assist' },
];


export default function PaHome() {
  const { ownerId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [principals, setPrincipals] = useState(null);
  const [error, setError] = useState('');
  const [waiting, setWaiting] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'approvals';
  const setTab = (t) => setSearchParams({ tab: t }, { replace: true });

  // Assistant-category users land here straight out of onboarding (never
  // through Dashboard), so this is the other place a stashed post-onboarding
  // destination (e.g. accepting a PA invite) needs to be consumed. Guarded
  // with a ref because consumePostOnboardingRedirect() is a one-shot,
  // non-idempotent read (it deletes from localStorage) — StrictMode's dev-only
  // double-invoke of effects would otherwise run the *second* invocation
  // straight into the fetch-and-navigate-to-self branch below, which fires
  // after and silently overwrites the redirect from the first invocation.
  const handledEntry = useRef(false);

  useEffect(() => {
    if (handledEntry.current) return;
    handledEntry.current = true;

    const target = consumePostOnboardingRedirect();
    if (target) {
      navigate(target, { replace: true });
      return;
    }
    api.get('/pa/principals').then((data) => {
      setPrincipals(data.principals);
      if (!ownerId) {
        // Default to a real PA/delegate relationship over the user's own
        // account — visiting PA Home almost always means acting on someone
        // else's behalf; self is just the always-available fallback.
        // Follow whichever principal the shell is set to, so the switcher in
        // the nav and this page never disagree.
        const stored = getActivePrincipal();
        const preferred = data.principals.find((p) => p.id === stored)
          || data.principals.find((p) => p.role !== 'owner')
          || data.principals[0];
        navigate(`/pa/${preferred.id}?tab=${tab}`, { replace: true });
      }
    }).catch((err) => setError(err.message));
  }, [ownerId, navigate]);

  useEffect(() => {
    if (!ownerId) return;
    api.get(`/attention?principalId=${ownerId}`)
      .then((d) => setWaiting(d.counts.approvals))
      .catch(() => {});
  }, [ownerId, tab]);

  if (error) return <div className="spinner-page">{error}</div>;
  if (!principals || !ownerId) return <div className="spinner-page">Loading…</div>;

  const current = principals.find((p) => p.id === ownerId);

  const canSchedule = !!current?.canManageScheduling;
  // The rail already says this principal has requests waiting; the tab strip
  // is where somebody standing on this page finds out which section they are
  // in. Both read from the same endpoint, so they cannot disagree.
  const visibleTabs = TABS.filter((t) => !t.scheduling || canSchedule)
    .map((t) => (t.id === 'approvals' ? { ...t, attention: waiting > 0 } : t));
  const TAB_LABEL = Object.fromEntries(TABS.map((t) => [t.id, t.label]));
  const activeNav = {
    contacts: 'people', relationships: 'people', approvals: 'approvals', briefs: 'briefs',
    bookings: 'approvals',
    availability: 'scheduling', meeting_types: 'scheduling',
  }[tab] || 'people';

  return (
    <AppShell title={TAB_LABEL[tab] || 'PA Home'} active={activeNav}>
      {!current ? (
        <div className="empty-state">You don't have access to that account.</div>
      ) : (
        <>
          {current.role === 'owner' && user.accountCategory !== 'principal' && principals.length === 1 && (
            <div className="alert" style={{ marginBottom: 16 }}>
              No principal has invited you yet — this is your own account, shown here so the
              approval queue and AI Assist work solo in the meantime. Once someone invites you as
              their PA, EA, or delegate and you accept, they'll appear in the switcher in the nav.
            </div>
          )}

          <Tabs tabs={visibleTabs} active={tab} onChange={setTab} label="Desk sections" />

          {tab === 'availability' && (canSchedule
            ? <AvailabilityTab ownerId={ownerId} principalName={current.role === 'owner' ? null : current.name} />
            : <div className="empty-state">
                {current.name} hasn't given you access to their availability.
              </div>)}
          {tab === 'meeting_types' && (canSchedule
            ? <MeetingTypesTab ownerId={ownerId} ownerSlug={current.slug} />
            : <div className="empty-state">
                {current.name} hasn't given you access to their meeting types.
              </div>)}
          {tab === 'approvals' && <ApprovalsTab ownerId={ownerId} />}
          {tab === 'bookings' && <BookingsTab ownerId={ownerId} timezone={current.timezone} />}
          {tab === 'contacts' && <ContactsTab ownerId={ownerId} />}
          {tab === 'relationships' && <RelationshipsTab ownerId={ownerId} />}
          {tab === 'briefs' && <BriefsTab ownerId={ownerId} />}
          {tab === 'instructions' && <InstructionsTab ownerId={ownerId} />}
          {tab === 'comms' && <CommsTab ownerId={ownerId} />}
          {tab === 'ai_assist' && <AiAssistTab ownerId={ownerId} />}
        </>
      )}
    </AppShell>
  );
}
