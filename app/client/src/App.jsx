import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { useAuth } from './lib/AuthContext.jsx';
import SignUp from './pages/SignUp.jsx';
import Login from './pages/Login.jsx';
import ProfileStep from './pages/onboarding/ProfileStep.jsx';
import MeetingTypeStep from './pages/onboarding/MeetingTypeStep.jsx';
import ConnectStep from './pages/onboarding/ConnectStep.jsx';
import Dashboard from './pages/Dashboard.jsx';
import PublicBookingPage from './pages/PublicBookingPage.jsx';
import ManageBooking from './pages/ManageBooking.jsx';
import DriverCard from './pages/DriverCard.jsx';
import Concierge from './pages/Concierge.jsx';
import Coming from './pages/Coming.jsx';
import AcceptInvite from './pages/AcceptInvite.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import PaHome from './pages/pa/PaHome.jsx';
import SpacesHome from './pages/spaces/SpacesHome.jsx';
import SpaceDetail from './pages/spaces/SpaceDetail.jsx';
import ThreadView from './pages/spaces/ThreadView.jsx';
import ProjectDetail from './pages/spaces/ProjectDetail.jsx';
import MyTasks from './pages/spaces/MyTasks.jsx';
import Today from './pages/Today.jsx';
import BookingDetail from './pages/BookingDetail.jsx';
import Pad from './pages/Pad.jsx';
import Itinerary from './pages/Itinerary.jsx';
import Trips from './pages/Trips.jsx';
import Movements from './pages/Movements.jsx';
import DriveCard from './pages/DriveCard.jsx';
import Archive from './pages/Archive.jsx';
import Report from './pages/Report.jsx';
import Correspondence from './pages/Correspondence.jsx';
import CatchUp from './pages/CatchUp.jsx';
import Operator from './pages/Operator.jsx';
import Workspace from './pages/Workspace.jsx';
import Connections from './pages/Connections.jsx';
import Household from './pages/Household.jsx';
import MyInstructions from './pages/MyInstructions.jsx';
import Announcements from './pages/Announcements.jsx';

// Every step needs an entry here as well as a <Route>. A step with a route but
// no entry falls through to the '/onboarding/profile' default below, which then
// bounces straight back because that is not the step the account is on — a
// redirect loop that renders as a blank page with nothing in the console.
// This is not theoretical; it happened when the security question was briefly
// a step here.
const ONBOARDING_STEP_ROUTE = {
  profile: '/onboarding/profile',
  connect: '/onboarding/connect',
  meeting_type: '/onboarding/meeting-type',
};

// Availability is no longer an onboarding step — it's set from the dashboard
// once you're in, so you pick real hours instead of rubber-stamping a default
// mid-signup. Accounts left parked on the removed step resume at the next one
// rather than dead-ending; normalizing here (not just in the route table)
// keeps the guard's step comparison from bouncing them in a redirect loop.
function effectiveStep(user) {
  // Two retired steps, mapped rather than deleted so an account that stopped
  // on one is not stranded on a screen that no longer exists. Availability
  // moved to the dashboard; the security question is now a prompt there too.
  if (user.onboardingStep === 'availability') return 'meeting_type';
  if (user.onboardingStep === 'security_question') return 'done';
  return user.onboardingStep;
}

// An assistant and a principal are asking different questions, so they get
// different landing screens rather than one screen with a switcher on it.
// A principal opens on their own day; an assistant opens on their workspace,
// which spans every principal they run. Either can still reach the other.
const ASSISTANT_CATEGORIES = new Set(['pa', 'ea', 'chief_of_staff']);

export function isAssistant(user) {
  return !!user && ASSISTANT_CATEGORIES.has(user.accountCategory);
}
function homeRouteFor(user) {
  if (!user) return '/dashboard';
  const step = effectiveStep(user);
  if (step !== 'done') {
    return ONBOARDING_STEP_ROUTE[step] || '/onboarding/profile';
  }
  // Household staff open on the one screen that concerns them. Checked before
  // the assistant/principal split because it is the narrowest answer: someone
  // who is only a driver has no diary to land on.
  if (user.isHouseholdStaff) return '/instructions';
  return isAssistant(user) ? '/workspace' : '/today';
}

function FullPageSpinner() {
  return <div className="spinner-page">Loading…</div>;
}

function RequireAuth({ children, enforceOnboarding = true }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (enforceOnboarding && effectiveStep(user) !== 'done') {
    return <Navigate to={homeRouteFor(user)} replace />;
  }
  return children;
}

function RequireOnboardingStep({ step, children }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  const current = effectiveStep(user);
  if (current === 'done') return <Navigate to={homeRouteFor(user)} replace />;
  if (current !== step) {
    return <Navigate to={homeRouteFor(user)} replace />;
  }
  return children;
}

function RedirectIfSignedIn({ children }) {
  const { user, loading } = useAuth();
  const [searchParams] = useSearchParams();
  const next = searchParams.get('next');
  if (loading) return <FullPageSpinner />;
  if (user) {
    if (next && user.onboardingStep === 'done') return <Navigate to={next} replace />;
    return <Navigate to={homeRouteFor(user)} replace />;
  }
  return children;
}

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={homeRouteFor(user)} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/signup" element={<RedirectIfSignedIn><SignUp /></RedirectIfSignedIn>} />
      <Route path="/login" element={<RedirectIfSignedIn><Login /></RedirectIfSignedIn>} />
      <Route path="/accept-invite/:token" element={<AcceptInvite />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password/:token" element={<ResetPassword />} />

      <Route path="/onboarding/profile" element={<RequireOnboardingStep step="profile"><ProfileStep /></RequireOnboardingStep>} />
      <Route path="/onboarding/connect" element={<RequireOnboardingStep step="connect"><ConnectStep /></RequireOnboardingStep>} />
      <Route path="/onboarding/meeting-type" element={<RequireOnboardingStep step="meeting_type"><MeetingTypeStep /></RequireOnboardingStep>} />

      <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="/pa" element={<RequireAuth><PaHome /></RequireAuth>} />
      <Route path="/pa/:ownerId" element={<RequireAuth><PaHome /></RequireAuth>} />

      <Route path="/spaces" element={<RequireAuth><SpacesHome /></RequireAuth>} />
      <Route path="/spaces/:spaceId" element={<RequireAuth><SpaceDetail /></RequireAuth>} />
      <Route path="/projects/:projectId" element={<RequireAuth><ProjectDetail /></RequireAuth>} />
      <Route path="/tasks" element={<RequireAuth><MyTasks /></RequireAuth>} />
      <Route path="/archive" element={<RequireAuth><Archive /></RequireAuth>} />
      <Route path="/report" element={<RequireAuth><Report /></RequireAuth>} />
      <Route path="/mail" element={<RequireAuth><Correspondence /></RequireAuth>} />
      <Route path="/catch-up" element={<RequireAuth><CatchUp /></RequireAuth>} />
      <Route path="/operator" element={<RequireAuth><Operator /></RequireAuth>} />
      <Route path="/today" element={<RequireAuth><Today /></RequireAuth>} />
      {/* Whose diary it is travels in the path rather than in stored state:
          an assistant who mails this link to a colleague, or opens it in a
          second tab, must land on the same appointment either way. */}
      <Route path="/appointments/:ownerId/:bookingId" element={<RequireAuth><BookingDetail /></RequireAuth>} />
      <Route path="/itinerary" element={<RequireAuth><Itinerary /></RequireAuth>} />
      <Route path="/pad" element={<RequireAuth><Pad /></RequireAuth>} />
      <Route path="/trips" element={<RequireAuth><Trips /></RequireAuth>} />
      <Route path="/movements" element={<RequireAuth><Movements /></RequireAuth>} />
      <Route path="/concierge" element={<RequireAuth><Concierge /></RequireAuth>} />
      <Route path="/coming" element={<RequireAuth><Coming /></RequireAuth>} />
      <Route path="/workspace" element={<RequireAuth><Workspace /></RequireAuth>} />
      <Route path="/connections" element={<RequireAuth><Connections /></RequireAuth>} />
      <Route path="/household" element={<RequireAuth><Household /></RequireAuth>} />
      <Route path="/instructions" element={<RequireAuth><MyInstructions /></RequireAuth>} />
      <Route path="/notices" element={<RequireAuth><Announcements /></RequireAuth>} />
      <Route path="/threads/:threadId" element={<RequireAuth><ThreadView /></RequireAuth>} />

      {/* No session, deliberately: the driver has no account. See lib/pickup.js. */}
      <Route path="/pickup/:token" element={<DriverCard />} />
      {/* No RequireAuth, deliberately: a driver has no account. The token
          is the whole credential — see routes/driveCard.js. */}
      <Route path="/drive/:token" element={<DriveCard />} />

      <Route path="/book/manage/:id" element={<ManageBooking />} />
      <Route path="/book/:slug" element={<PublicBookingPage />} />
      <Route path="/book/:slug/:meetingSlug" element={<PublicBookingPage />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
