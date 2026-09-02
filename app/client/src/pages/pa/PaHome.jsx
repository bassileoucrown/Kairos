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
import AiAssistTab from './AiAssistTab.jsx';
import AvailabilityTab from '../dashboard/AvailabilityTab.jsx';
import MeetingTypesTab from '../dashboard/MeetingTypesTab.jsx';
import BookingsTab from '../dashboard/BookingsTab.jsx';
import CalendarTab from '../dashboard/CalendarTab.jsx';
import Tabs from '../../components/Tabs.jsx';
import DeskOverview from './DeskOverview.jsx';
import WhatThisDoes from '../../components/WhatThisDoes.jsx';

// Scheduling tabs only appear when the principal has delegated them, so an
// assistant is never shown a door that will 403.
//
// Eleven tabs wrapped onto two rows, which was the rail's old filing-cabinet
// problem one level down. Two of them stopped being tabs, for two different
// reasons:
//
//   Relationships was the birthday and anniversary fields of these same
//   contacts, sorted by what comes next — read one tab away from where they
//   are set. One dataset, two doors. It is a band at the head of Contacts now,
//   and /pa/:id?tab=relationships still lands there.
//
//   Calendar is still rendered here, but its door is the rail rather than a
//   button in this strip. That entry used to point at /dashboard, so it opened
//   the signed-in user's own diary; for an assistant that meant their empty
//   one, while the principal's month was reachable only from here. Making it
//   principal-scoped — as Today, Itinerary and Trips already were — gave it a
//   single honest destination and left this tab with nothing to add.
//
// Availability and Meeting Types stay apart on purpose: when you are free and
// what you offer are two different jobs, and merging them to win back a row
// would be tidying the strip at the cost of the idea.
const TABS = [
  { id: 'approvals', label: 'Approvals' },
  { id: 'bookings', label: 'Bookings' },
  { id: 'availability', label: 'Availability', scheduling: true },
  { id: 'meeting_types', label: 'Meeting Types', scheduling: true },
  { id: 'contacts', label: 'Contacts' },
  { id: 'briefs', label: 'Briefs' },
  { id: 'instructions', label: 'Instructions' },
  { id: 'comms', label: 'Comms' },
  { id: 'ai_assist', label: 'AI Assist' },
];

// A link somebody sent last week, or a bookmark, still has to land somewhere
// sensible.
const MOVED = { relationships: 'contacts' };


export default function PaHome() {
  const { ownerId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [principals, setPrincipals] = useState(null);
  const [error, setError] = useState('');
  const [waiting, setWaiting] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();
  // NO TAB IS A REAL STATE NOW, and it is the one you arrive in. It used to
  // default to Approvals, which meant the desk opened on one of its nine
  // sections and said nothing about the other eight — see DeskOverview.jsx.
  const raw = searchParams.get('tab');
  // A bookmark or a link somebody sent last week still lands somewhere true.
  const tab = raw ? (MOVED[raw] || raw) : null;
  const setTab = (t) => setSearchParams({ tab: t }, { replace: true });
  // Back to the overview, and back out of the tab in the URL with it, so the
  // browser's own Back button and this one agree about where they go.
  const clearTab = () => setSearchParams({}, { replace: true });

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
        navigate(`/pa/${preferred.id}${tab ? `?tab=${tab}` : ''}`, { replace: true });
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
  const TAB_LABEL = { ...Object.fromEntries(TABS.map((t) => [t.id, t.label])), calendar: 'Calendar' };
  const title = tab ? (TAB_LABEL[tab] || 'Desk') : 'Desk';
  // Every tab of this page is behind one rail entry now, so they all light
  // the same one. Which section you are in is the tab strip's job.
  const activeNav = tab === 'calendar' ? 'calendar' : 'desk';

  return (
    <AppShell title={title} active={activeNav}>
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

          {/* The strip is for moving BETWEEN sections once you are in one. On
              arrival there is nothing to move between yet, and a row of tabs
              above a page that shows all of them is two answers to one
              question. */}
          {tab && (
            <div className="desk-return">
              <button className="btn btn-sm" type="button" onClick={clearTab}>
                ← The whole desk
              </button>
            </div>
          )}
          {tab && <Tabs tabs={visibleTabs} active={tab} onChange={setTab} label="Desk sections" />}

          {/* Per section, not per page. Nine sections behind one heading do
              nine different jobs, and a single panel above them could only
              describe the heading. On arrival — no tab — it describes the desk
              itself, which is genuinely what somebody is looking at. */}
          <WhatThisDoes id={tab || 'desk'} />

          {!tab && (
            <DeskOverview
              ownerId={ownerId}
              principalName={current.role === 'owner' ? null : current.name}
              onOpen={setTab}
            />
          )}

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
          {tab === 'approvals' && <ApprovalsTab ownerId={ownerId} timezone={current.timezone} />}
          {tab === 'bookings' && <BookingsTab ownerId={ownerId} timezone={current.timezone} />}
          {tab === 'calendar' && <CalendarTab ownerId={ownerId} timezone={current.timezone} />}
          {tab === 'contacts' && <ContactsTab ownerId={ownerId} />}
          {tab === 'briefs' && <BriefsTab ownerId={ownerId} />}
          {tab === 'instructions' && <InstructionsTab ownerId={ownerId} />}
          {tab === 'comms' && <CommsTab ownerId={ownerId} />}
          {tab === 'ai_assist' && <AiAssistTab ownerId={ownerId} />}
        </>
      )}
    </AppShell>
  );
}
