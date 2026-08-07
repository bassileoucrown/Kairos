import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { useAuth } from './lib/AuthContext.jsx';
import SignUp from './pages/SignUp.jsx';
import Login from './pages/Login.jsx';
import ProfileStep from './pages/onboarding/ProfileStep.jsx';
import AvailabilityStep from './pages/onboarding/AvailabilityStep.jsx';
import MeetingTypeStep from './pages/onboarding/MeetingTypeStep.jsx';
import Dashboard from './pages/Dashboard.jsx';
import PublicBookingPage from './pages/PublicBookingPage.jsx';
import ManageBooking from './pages/ManageBooking.jsx';
import AcceptInvite from './pages/AcceptInvite.jsx';
import PaHome from './pages/pa/PaHome.jsx';

const ONBOARDING_ROUTE = {
  profile: '/onboarding/profile',
  availability: '/onboarding/availability',
  meeting_type: '/onboarding/meeting-type',
  done: '/dashboard',
};

function FullPageSpinner() {
  return <div className="spinner-page">Loading…</div>;
}

function RequireAuth({ children, enforceOnboarding = true }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (enforceOnboarding && user.onboardingStep !== 'done') {
    return <Navigate to={ONBOARDING_ROUTE[user.onboardingStep] || '/onboarding/profile'} replace />;
  }
  return children;
}

function RequireOnboardingStep({ step, children }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.onboardingStep === 'done') return <Navigate to="/dashboard" replace />;
  if (user.onboardingStep !== step) {
    return <Navigate to={ONBOARDING_ROUTE[user.onboardingStep] || '/onboarding/profile'} replace />;
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
    return <Navigate to={ONBOARDING_ROUTE[user.onboardingStep] || '/dashboard'} replace />;
  }
  return children;
}

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={ONBOARDING_ROUTE[user.onboardingStep] || '/dashboard'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/signup" element={<RedirectIfSignedIn><SignUp /></RedirectIfSignedIn>} />
      <Route path="/login" element={<RedirectIfSignedIn><Login /></RedirectIfSignedIn>} />
      <Route path="/accept-invite/:token" element={<AcceptInvite />} />

      <Route path="/onboarding/profile" element={<RequireOnboardingStep step="profile"><ProfileStep /></RequireOnboardingStep>} />
      <Route path="/onboarding/availability" element={<RequireOnboardingStep step="availability"><AvailabilityStep /></RequireOnboardingStep>} />
      <Route path="/onboarding/meeting-type" element={<RequireOnboardingStep step="meeting_type"><MeetingTypeStep /></RequireOnboardingStep>} />

      <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="/pa" element={<RequireAuth><PaHome /></RequireAuth>} />
      <Route path="/pa/:ownerId" element={<RequireAuth><PaHome /></RequireAuth>} />

      <Route path="/book/manage/:id" element={<ManageBooking />} />
      <Route path="/book/:slug" element={<PublicBookingPage />} />
      <Route path="/book/:slug/:meetingSlug" element={<PublicBookingPage />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
