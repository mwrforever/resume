import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';

// User pages
import UserJobs from '@/pages/user/jobs';
import UserJobDetail from '@/pages/user/job-detail';
import UserMyResumes from '@/pages/user/my-resumes';
import UserMyApplications from '@/pages/user/my-applications';
import UserApplicationDetail from '@/pages/user/application-detail';

// Employee pages
import EmployeeDashboard from '@/pages/employee/dashboard';
import EmployeeJobs from '@/pages/employee/jobs';
import EmployeeJobCreate from '@/pages/employee/job-create';
import EmployeeResumes from '@/pages/employee/resumes';
import EmployeeEvaluations from '@/pages/employee/evaluations';
import EmployeeApplications from '@/pages/employee/applications';

// Shared pages
import Auth from '@/pages/auth';

function ProtectedRoute({ children, userType }: { children: React.ReactNode; userType: 'user' | 'employee' }) {
  const { userType: currentType } = useAuthStore();
  if (currentType !== userType) return <Navigate to={`/${userType}/login`} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* User Routes */}
        <Route path="/user/login" element={<Auth />} />
        <Route path="/user/register" element={<Auth />} />
        <Route path="/user/jobs" element={<ProtectedRoute userType="user"><UserJobs /></ProtectedRoute>} />
        <Route path="/user/jobs/:id" element={<ProtectedRoute userType="user"><UserJobDetail /></ProtectedRoute>} />
        <Route path="/user/my-resumes" element={<ProtectedRoute userType="user"><UserMyResumes /></ProtectedRoute>} />
        <Route path="/user/my-applications" element={<ProtectedRoute userType="user"><UserMyApplications /></ProtectedRoute>} />
        <Route path="/user/my-applications/:id" element={<ProtectedRoute userType="user"><UserApplicationDetail /></ProtectedRoute>} />

        {/* Employee Routes */}
        <Route path="/employee/login" element={<Auth />} />
        <Route path="/employee/register" element={<Auth />} />
        <Route path="/employee/dashboard" element={<ProtectedRoute userType="employee"><EmployeeDashboard /></ProtectedRoute>} />
        <Route path="/employee/jobs" element={<ProtectedRoute userType="employee"><EmployeeJobs /></ProtectedRoute>} />
        <Route path="/employee/jobs/create" element={<ProtectedRoute userType="employee"><EmployeeJobCreate /></ProtectedRoute>} />
        <Route path="/employee/resumes" element={<ProtectedRoute userType="employee"><EmployeeResumes /></ProtectedRoute>} />
        <Route path="/employee/evaluations" element={<ProtectedRoute userType="employee"><EmployeeEvaluations /></ProtectedRoute>} />
        <Route path="/employee/applications" element={<ProtectedRoute userType="employee"><EmployeeApplications /></ProtectedRoute>} />

        <Route path="/" element={<Navigate to="/user/jobs" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
