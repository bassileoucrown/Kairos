import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { useAuth } from './lib/AuthContext.jsx';
import SignUp from './pages/SignUp.jsx';
import Login from './pages/Login.jsx';
import ProfileStep from './pages/onboarding/ProfileStep.jsx';
import MeetingTypeStep from './pages/onboarding/MeetingTypeStep.jsx';
import Dashboard from './pages/Dashboard.jsx';
import PublicBookingPage from './pages/PublicBookingPage.jsx';
import ManageBooking from './pages/ManageBooking.jsx';
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
import Itinerary from './pages/Itinerary.jsx';

const ONBOARDING_STEP_ROUTE = {
  profile: '/onboarding/profile',
  meeting_type: '/onboarding/meeting-type',
};

// Availability is no longer an onboarding step — it's set from the dashboard
// once you're in, so you pick real hours instead of rubber-stamping a default
// mid-signup. Accounts left parked on the removed step resume at the next one
// rather than dead-ending; normalizing here (not just in the route table)
// keeps the guard's step comparison from bouncing them in a redirect loop.
function effectiveStep(user) {
  return user.onboardingStep === 'availability' ? 'meeting_type' : user.onboardingStep;
}

// PA/EA/Chief of Staff accounts land in PA Home by default — that's where
// their day-to-day work lives — while principals land on their own
// calendar. Either can still reach the other view via the nav.
function homeRouteFor(user) {
  if (!user) return '/dashboard';
  const step = effectiveStep(user);
  if (step !== 'done') {
    return ONBOARDING_STEP_ROUTE[step] || '/onboarding/profile';
  }
  // Everyone lands on Today — the one screen that answers "what needs me now"
  // regardless of whether you're the principal or the person running their day.
  return '/today';
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
      <Route path="/onboarding/meeting-type" element={<RequireOnboardingStep step="meeting_type"><MeetingTypeStep /></RequireOnboardingStep>} />

      <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="/pa" element={<RequireAuth><PaHome /></RequireAuth>} />
      <Route path="/pa/:ownerId" element={<RequireAuth><PaHome /></RequireAuth>} />

      <Route path="/spaces" element={<RequireAuth><SpacesHome /></RequireAuth>} />
      <Route path="/spaces/:spaceId" element={<RequireAuth><SpaceDetail /></RequireAuth>} />
      <Route path="/projects/:projectId" element={<RequireAuth><ProjectDetail /></RequireAuth>} />
      <Route path="/tasks" element={<RequireAuth><MyTasks /></RequireAuth>} />
      <Route path="/today" element={<RequireAuth><Today /></RequireAuth>} />
      <Route path="/itinerary" element={<RequireAuth><Itinerary /></RequireAuth>} />
      <Route path="/threads/:threadId" element={<RequireAuth><ThreadView /></RequireAuth>} />

      <Route path="/book/manage/:id" element={<ManageBooking />} />
      <Route path="/book/:slug" element={<PublicBookingPage />} />
      <Route path="/book/:slug/:meetingSlug" element={<PublicBookingPage />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
