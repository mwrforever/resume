import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';

// User pages
import UserJobs from '@/pages/user/jobs';
import UserJobDetail from '@/pages/user/job-detail';
import UserMyResumes from '@/pages/user/my-resumes';
import UserMyApplications from '@/pages/user/my-applications';

// Employee pages
import EmployeeDashboard from '@/pages/employee/dashboard';
import EmployeeJobs from '@/pages/employee/jobs';
import EmployeeJobCreate from '@/pages/employee/job-create';
import EmployeeJobEdit from '@/pages/employee/job-edit';
import EmployeeJobPreview from '@/pages/employee/job-preview';
import EmployeeTags from '@/pages/employee/tags';
import EmployeeEvalTemplates from '@/pages/employee/eval-templates';
import EmployeeEvalDimensions from '@/pages/employee/eval-dimensions';
import EmployeeResumes from '@/pages/employee/resumes';
import EmployeeApplications from '@/pages/employee/applications';
import EmployeeEvaluations from '@/pages/employee/evaluations';
import EmployeeEvalDetail from '@/pages/employee/eval-detail';
import EmployeeAccountManagement from '@/pages/employee/account-management';
import EmployeeDeptManagement from '@/pages/employee/dept-management';
import EmployeeAgent from '@/pages/employee/agent';
import EmployeeLlmConfigs from '@/pages/employee/llm-configs';

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

        {/* Employee Routes */}
        <Route path="/employee/login" element={<Auth />} />
        <Route path="/employee/register" element={<Auth />} />
        <Route path="/employee/dashboard" element={<ProtectedRoute userType="employee"><EmployeeDashboard /></ProtectedRoute>} />
        <Route path="/employee/jobs" element={<ProtectedRoute userType="employee"><EmployeeJobs /></ProtectedRoute>} />
        <Route path="/employee/jobs/create" element={<ProtectedRoute userType="employee"><EmployeeJobCreate /></ProtectedRoute>} />
        <Route path="/employee/jobs/:id/preview" element={<ProtectedRoute userType="employee"><EmployeeJobPreview /></ProtectedRoute>} />
        <Route path="/employee/jobs/:id/edit" element={<ProtectedRoute userType="employee"><EmployeeJobEdit /></ProtectedRoute>} />
        <Route path="/employee/tags" element={<ProtectedRoute userType="employee"><EmployeeTags /></ProtectedRoute>} />
        <Route path="/employee/eval-templates" element={<ProtectedRoute userType="employee"><EmployeeEvalTemplates /></ProtectedRoute>} />
        <Route path="/employee/eval-dimensions" element={<ProtectedRoute userType="employee"><EmployeeEvalDimensions /></ProtectedRoute>} />
        <Route path="/employee/resumes" element={<ProtectedRoute userType="employee"><EmployeeResumes /></ProtectedRoute>} />
        <Route path="/employee/applications" element={<ProtectedRoute userType="employee"><EmployeeApplications /></ProtectedRoute>} />
        <Route path="/employee/evaluations" element={<ProtectedRoute userType="employee"><EmployeeEvaluations /></ProtectedRoute>} />
        <Route path="/employee/evaluations/:id" element={<ProtectedRoute userType="employee"><EmployeeEvalDetail /></ProtectedRoute>} />
        <Route path="/employee/user-management" element={<ProtectedRoute userType="employee"><EmployeeAccountManagement tab="users" /></ProtectedRoute>} />
        <Route path="/employee/employee-management" element={<ProtectedRoute userType="employee"><EmployeeAccountManagement tab="employees" /></ProtectedRoute>} />
        <Route path="/employee/dept-management" element={<ProtectedRoute userType="employee"><EmployeeDeptManagement /></ProtectedRoute>} />
        <Route path="/employee/agent" element={<ProtectedRoute userType="employee"><EmployeeAgent /></ProtectedRoute>} />
        <Route path="/employee/llm-configs" element={<ProtectedRoute userType="employee"><EmployeeLlmConfigs /></ProtectedRoute>} />
        <Route path="/employee/account-management" element={<Navigate to="/employee/user-management" replace />} />

        <Route path="/" element={<Navigate to="/user/jobs" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
