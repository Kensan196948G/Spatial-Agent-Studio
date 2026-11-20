import { useEffect, type ReactNode } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { LoginScreen } from './screens/LoginScreen';
import { DashboardScreen } from './screens/DashboardScreen';
import { SiteScreen } from './screens/SiteScreen';
import { ApprovalsScreen } from './screens/ApprovalsScreen';
import { AuditScreen } from './screens/AuditScreen';
import { NotFoundScreen } from './screens/NotFoundScreen';

function RequireAuth({ children }: { children: ReactNode }): ReactNode {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="route-loading">
        <span className="spinner" aria-hidden="true" />
        <span>セッションを確認中…</span>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return children;
}

function ScrollToTop(): null {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);
  return null;
}

export function App(): ReactNode {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/login" element={<LoginScreen />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<DashboardScreen />} />
          <Route path="/sites/:id" element={<SiteScreen />} />
          <Route path="/approvals" element={<ApprovalsScreen />} />
          <Route path="/audit" element={<AuditScreen />} />
          <Route path="*" element={<NotFoundScreen />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
