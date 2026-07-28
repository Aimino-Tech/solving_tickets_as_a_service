import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import Layout from '@/components/Layout';
import ProtectedRoute from '@/components/ProtectedRoute';
import PublicLayout from '@/components/PublicLayout';
import Login from '@/pages/Login';
import DashboardHome from '@/pages/DashboardHome';
import RunsHistory from '@/pages/RunsHistory';
import RunDetail from '@/pages/RunDetail';
import Repos from '@/pages/Repos';
import Credits from '@/pages/Credits';
import Settings from '@/pages/Settings';
import Configuration from '@/pages/Configuration';
import Analytics from '@/pages/Analytics';
import AuditLog from '@/pages/AuditLog';
import Security from '@/pages/Security';
import Privacy from '@/pages/Privacy';
import Status from '@/pages/Status';
import DPAPage from '@/pages/DPAPage';
import Benchmarks from '@/pages/Benchmarks';
import EnterprisePage from '@/pages/EnterprisePage';
import KpiDashboard from '@/pages/KpiDashboard';
import PricingPage from '@/pages/PricingPage';
import VsPage from '@/pages/VsPage';
import AdminRuns from '@/pages/AdminRuns';
import LiveView from '@/pages/LiveView';
import Monitoring from '@/pages/Monitoring';
import NotFound from '@/pages/NotFound';
import Error500 from '@/pages/Error500';
import WizardContainer from '@/pages/onboarding/WizardContainer';

export default function App() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <Routes>
        <Route
          path="/login"
          element={isAuthenticated ? <Navigate to="/" replace /> : <Login />}
        />
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
          <Route path="settings" element={<Settings />} />
          <Route path="configuration" element={<Configuration />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="audit" element={<AuditLog />} />
          <Route path="kpi" element={<KpiDashboard />} /> {/* AIM-3581 */}
          <Route path="admin/runs" element={<AdminRuns />} />
          <Route path="liveview" element={<LiveView />} />
          <Route path="monitoring" element={<Monitoring />} />
        </Route>
        <Route path="/500" element={<Error500 />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </ErrorBoundary>
  );
}
