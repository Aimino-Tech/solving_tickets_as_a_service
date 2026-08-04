import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import Layout from '@/components/Layout';
import ProtectedRoute from '@/components/ProtectedRoute';
import PublicLayout from '@/components/PublicLayout';
import { useAuth } from '@/context/AuthContext';
import Error500 from '@/pages/Error500';
// Eager: Login is the first paint on mobile — never block it.
import Login from '@/pages/Login';
import Logout from '@/pages/Logout';
import NotFound from '@/pages/NotFound';

// Lazy: heavy pages (recharts via Billing, large trees) load on demand.
const DashboardHome = lazy(() => import('@/pages/DashboardHome'));
const RunsHistory = lazy(() => import('@/pages/RunsHistory'));
const RunDetail = lazy(() => import('@/pages/RunDetail'));
const Repos = lazy(() => import('@/pages/Repos'));
const Credits = lazy(() => import('@/pages/Credits'));
const Settings = lazy(() => import('@/pages/Settings'));
const Billing = lazy(() => import('@/pages/Billing'));
const AuditLog = lazy(() => import('@/pages/AuditLog'));
// AIM-4643
const Referral = lazy(() => import('@/pages/Referral'));
const Security = lazy(() => import('@/pages/Security'));
const Privacy = lazy(() => import('@/pages/Privacy'));
const Status = lazy(() => import('@/pages/Status'));
const DPAPage = lazy(() => import('@/pages/DPAPage'));
const Benchmarks = lazy(() => import('@/pages/Benchmarks'));
const EnterprisePage = lazy(() => import('@/pages/EnterprisePage'));
const PricingPage = lazy(() => import('@/pages/PricingPage'));
const VsPage = lazy(() => import('@/pages/VsPage'));
const LiveView = lazy(() => import('@/pages/LiveView'));
const AdminSteering = lazy(() => import('@/pages/AdminSteering'));
const WizardContainer = lazy(() => import('@/pages/onboarding/WizardContainer'));
const ForgotPassword = lazy(() => import('@/pages/ForgotPassword'));
const ResetPassword = lazy(() => import('@/pages/ResetPassword'));

function PageFallback() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
    </div>
  );
}

export default function App() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <PageFallback />;
  }

  return (
    <ErrorBoundary>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <Login />} />
          <Route path="/logout" element={<Logout />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/auth/reset-password" element={<ResetPassword />} />
          <Route element={<PublicLayout />}>
            <Route path="/security" element={<Security />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/status" element={<Status />} />
            <Route path="/dpa" element={<DPAPage />} />
            <Route path="/benchmarks" element={<Benchmarks />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/vs/:competitor" element={<VsPage />} />
            <Route path="/vs" element={<VsPage />} />
            <Route path="/enterprise" element={<EnterprisePage />} />
          </Route>
          <Route
            path="/onboarding"
            element={
              <ProtectedRoute>
                <WizardContainer />
              </ProtectedRoute>
            }
          />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardHome />} />
            <Route path="runs" element={<RunsHistory />} />
            <Route path="runs/:id" element={<RunDetail />} />
            <Route path="repos" element={<Repos />} />
            <Route path="credits" element={<Credits />} />
            <Route path="billing" element={<Billing />} />
            <Route path="audit" element={<AuditLog />} />
            {/* AIM-4643 */}
            <Route path="referral" element={<Referral />} />
            <Route path="liveview" element={<LiveView />} />
            <Route path="admin" element={<AdminSteering />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="/500" element={<Error500 />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
