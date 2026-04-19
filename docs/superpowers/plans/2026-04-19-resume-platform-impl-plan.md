# Resume Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete full-stack resume platform with dual-end (user/employee) authentication, job management, resume upload/application, and AI-powered evaluation.

**Architecture:**
- Backend: FastAPI with layered architecture (API → Service → Repository)
- Frontend: React + Vite + Tailwind + shadcn/ui + Recharts
- Database: MySQL (existing schema in sql/init.sql)
- AI: LiteLLM + LangChain for evaluation
- Tasks: Celery + Redis for async evaluation

**Tech Stack:** FastAPI, Pydantic v2, aiomysql, redis.asyncio, Celery, LangChain, LiteLLM, React 18, Vite, Tailwind CSS, shadcn/ui, Recharts

---

## Phase 1: Project Scaffolding

### 1.1 Backend Structure Setup

**Files:**
- Create: `backend/app/__init__.py`
- Create: `backend/app/main.py`
- Create: `backend/app/core/__init__.py`
- Create: `backend/app/core/config.py`
- Create: `backend/app/core/security.py`
- Create: `backend/app/core/exceptions.py`
- Create: `backend/app/api/__init__.py`
- Create: `backend/app/api/deps.py`
- Create: `backend/app/models/__init__.py`
- Create: `backend/app/schemas/__init__.py`
- Create: `backend/app/services/__init__.py`
- Create: `backend/app/repositories/__init__.py`
- Create: `backend/app/utils/__init__.py`
- Create: `backend/requirements.txt`
- Create: `backend/.env.example`

- [ ] **Step 1: Create backend directory structure**

```bash
mkdir -p backend/app/{api/v1/{user,employee},core,models,schemas,services,repositories,utils/{storage,email,ai}}
mkdir -p backend/tests/{api/{user,employee},services}
mkdir -p backend/celery_app/tasks
```

- [ ] **Step 2: Create requirements.txt**

```txt
fastapi==0.109.2
uvicorn[standard]==0.27.1
pydantic==2.6.1
pydantic-settings==2.1.0
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4
python-multipart==0.0.9
aiomysql==0.2.0
SQLAlchemy==2.0.25
redis==5.0.1
celery==5.3.6
litellm==1.10.0
langchain==0.1.6
langchain-core==0.1.18
python-docx==1.1.0
PyPDF2==3.0.1
aiofiles==23.2.1
email-validator==2.1.0.post1
pytest==8.0.0
pytest-asyncio==0.23.4
httpx==0.26.0
```

- [ ] **Step 3: Create core/config.py**

```python
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # App
    APP_NAME: str = "Resume Platform"
    DEBUG: bool = False
    SECRET_KEY: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Database
    DB_HOST: str
    DB_PORT: int = 3306
    DB_USER: str
    DB_PASSWORD: str
    DB_NAME: str

    # Redis
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0

    # LiteLLM
    LITELLM_PROVIDER: str = "openai"
    OPENAI_API_KEY: str
    OPENAI_API_BASE: str = "https://api.openai.com/v1"
    OPENAI_MODEL: str = "gpt-4-turbo-preview"
    FALLBACK_MODEL: str = "gpt-3.5-turbo"

    # Storage
    STORAGE_TYPE: str = "LOCAL"
    LOCAL_STORAGE_PATH: str = "./note"

    # Email
    SMTP_HOST: str
    SMTP_PORT: int = 587
    SMTP_USER: str
    SMTP_PASSWORD: str
    EMAIL_FROM: str

    # Celery
    CELERY_BROKER_URL: str = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/2"

    @property
    def DATABASE_URL(self) -> str:
        return f"mysql+aiomysql://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

    @property
    def REDIS_URL(self) -> str:
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"

    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 4: Create core/security.py**

```python
from datetime import datetime, timedelta
from jose import JWTError, jwt
from passlib.context import CryptContext
from .config import get_settings

settings = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: timedelta = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm="HS256")


def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm="HS256")


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
        return payload
    except JWTError:
        raise ValueError("Invalid token")
```

- [ ] **Step 5: Create core/exceptions.py**

```python
class BizError(BaseException):
    def __init__(self, code: int, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


class UnauthorizedError(BizError):
    def __init__(self, message: str = "Unauthorized"):
        super().__init__(code=401, message=message)


class ForbiddenError(BizError):
    def __init__(self, message: str = "Forbidden"):
        super().__init__(code=403, message=message)


class NotFoundError(BizError):
    def __init__(self, message: str = "Not found"):
        super().__init__(code=404, message=message)


class ValidationError(BizError):
    def __init__(self, message: str = "Validation error"):
        super().__init__(code=422, message=message)
```

- [ ] **Step 6: Create .env.example**

```env
# ==================== 应用配置 ====================
APP_NAME=Resume Platform
DEBUG=true
SECRET_KEY=your-secret-key-change-in-production
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=7

# ==================== 数据库配置 ====================
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your-db-password
DB_NAME=resume_platform

# ==================== Redis配置 ====================
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0

# ==================== LiteLLM配置 ====================
LITELLM_PROVIDER=openai
OPENAI_API_KEY=sk-your-api-key
OPENAI_API_BASE=https://api.openai.com/v1
OPENAI_MODEL=gpt-4-turbo-preview
FALLBACK_MODEL=gpt-3.5-turbo

# ==================== 存储配置 ====================
STORAGE_TYPE=LOCAL
LOCAL_STORAGE_PATH=./note

# ==================== 邮件配置 ====================
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-email@example.com
SMTP_PASSWORD=your-email-password
EMAIL_FROM=noreply@example.com

# ==================== Celery配置 ====================
CELERY_BROKER_URL=redis://localhost:6379/1
CELERY_RESULT_BACKEND=redis://localhost:6379/2
```

- [ ] **Step 7: Create main.py**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import get_settings
from app.core.exceptions import BizError
from starlette.responses import JSONResponse

settings = get_settings()

app = FastAPI(title=settings.APP_NAME)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(BizError)
async def biz_error_handler(request, exc: BizError):
    return JSONResponse(
        status_code=exc.code,
        content={"code": exc.code, "message": exc.message, "data": None}
    )


@app.get("/")
async def root():
    return {"message": "Resume Platform API"}
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add backend project scaffolding with core config"
```

---

### 1.2 Frontend Structure Setup

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/tailwind.config.js`
- Create: `frontend/postcss.config.js`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/index.css`
- Create: `frontend/src/lib/utils.ts`
- Create: `frontend/src/api/client.ts`

- [ ] **Step 1: Create frontend directory structure**

```bash
mkdir -p frontend/src/{api/{user,employee},components/{ui,layout,common},pages/{user,employee},store,hooks,types,lib}
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "resume-platform-frontend",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint . --ext ts,tsx"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.22.0",
    "zustand": "^4.5.0",
    "axios": "^1.6.7",
    "recharts": "^2.12.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.2.1",
    "class-variance-authority": "^0.7.0",
    "@radix-ui/react-dialog": "^1.0.5",
    "@radix-ui/react-slot": "^1.0.2",
    "@radix-ui/react-label": "^2.0.2",
    "@radix-ui/react-select": "^2.0.0",
    "lucide-react": "^0.323.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.55",
    "@types/react-dom": "^18.2.19",
    "@vitejs/plugin-react": "^4.2.1",
    "autoprefixer": "^10.4.17",
    "postcss": "^8.4.35",
    "tailwindcss": "^3.4.1",
    "typescript": "^5.3.3",
    "vite": "^5.1.0"
  }
}
```

- [ ] **Step 3: Create vite.config.ts**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
```

- [ ] **Step 4: Create tailwind.config.js**

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#2563EB',
          50: '#EFF6FF',
          100: '#DBEAFE',
          500: '#2563EB',
          600: '#1D4ED8',
          700: '#1E40AF',
        },
        secondary: '#64748B',
        background: '#F8FAFC',
        card: '#FFFFFF',
        success: '#10B981',
        warning: '#F59E0B',
        danger: '#EF4444',
        'text-primary': '#1E293B',
        'text-secondary': '#64748B',
      },
    },
  },
  plugins: [],
}
```

- [ ] **Step 5: Create api/client.ts**

```typescript
import axios from 'axios';
import { useAuthStore } from '@/store/auth';

const client = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
});

// Request interceptor
client.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().accessToken;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor
client.interceptors.response.use(
  (response) => response.data,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      const refreshToken = useAuthStore.getState().refreshToken;
      if (refreshToken) {
        try {
          const res = await axios.post('/api/v1/auth/refresh', { refresh_token: refreshToken });
          useAuthStore.getState().setTokens(res.data.access_token, res.data.refresh_token);
          originalRequest.headers.Authorization = `Bearer ${res.data.access_token}`;
          return client(originalRequest);
        } catch {
          useAuthStore.getState().logout();
        }
      }
    }
    return Promise.reject(error);
  }
);

export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data: T;
}

export default client;
```

- [ ] **Step 6: Create store/auth.ts**

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  userType: 'user' | 'employee' | null;
  userId: string | null;
  setTokens: (access: string, refresh: string) => void;
  setUserInfo: (userType: 'user' | 'employee', userId: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      userType: null,
      userId: null,
      setTokens: (access, refresh) => set({ accessToken: access, refreshToken: refresh }),
      setUserInfo: (userType, userId) => set({ userType, userId }),
      logout: () => set({ accessToken: null, refreshToken: null, userType: null, userId: null }),
    }),
    { name: 'auth-storage' }
  )
);
```

- [ ] **Step 7: Create index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Resume Platform</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 8: Create main.tsx and App.tsx**

```tsx
// main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

```tsx
// App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';

// Pages
import UserLogin from '@/pages/user/login';
import UserRegister from '@/pages/user/register';
import UserJobs from '@/pages/user/jobs';
import UserJobDetail from '@/pages/user/job-detail';
import UserMyResumes from '@/pages/user/my-resumes';
import UserMyApplications from '@/pages/user/my-applications';
import UserApplicationDetail from '@/pages/user/application-detail';

import EmployeeLogin from '@/pages/employee/login';
import EmployeeDashboard from '@/pages/employee/dashboard';
import EmployeeJobs from '@/pages/employee/jobs';
import EmployeeJobCreate from '@/pages/employee/job-create';
import EmployeeResumes from '@/pages/employee/resumes';
import EmployeeEvaluations from '@/pages/employee/evaluations';

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
        <Route path="/user/login" element={<UserLogin />} />
        <Route path="/user/register" element={<UserRegister />} />
        <Route path="/user/jobs" element={<ProtectedRoute userType="user"><UserJobs /></ProtectedRoute>} />
        <Route path="/user/jobs/:id" element={<ProtectedRoute userType="user"><UserJobDetail /></ProtectedRoute>} />
        <Route path="/user/my-resumes" element={<ProtectedRoute userType="user"><UserMyResumes /></ProtectedRoute>} />
        <Route path="/user/my-applications" element={<ProtectedRoute userType="user"><UserMyApplications /></ProtectedRoute>} />
        <Route path="/user/my-applications/:id" element={<ProtectedRoute userType="user"><UserApplicationDetail /></ProtectedRoute>} />

        {/* Employee Routes */}
        <Route path="/employee/login" element={<EmployeeLogin />} />
        <Route path="/employee/dashboard" element={<ProtectedRoute userType="employee"><EmployeeDashboard /></ProtectedRoute>} />
        <Route path="/employee/jobs" element={<ProtectedRoute userType="employee"><EmployeeJobs /></ProtectedRoute>} />
        <Route path="/employee/jobs/create" element={<ProtectedRoute userType="employee"><EmployeeJobCreate /></ProtectedRoute>} />
        <Route path="/employee/resumes" element={<ProtectedRoute userType="employee"><EmployeeResumes /></ProtectedRoute>} />
        <Route path="/employee/evaluations" element={<ProtectedRoute userType="employee"><EmployeeEvaluations /></ProtectedRoute>} />

        <Route path="/" element={<Navigate to="/user/jobs" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 9: Create basic page stubs**

Create minimal page components for all routes defined in App.tsx. Each page should have a simple h1 title.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add frontend project scaffolding with routing"
```

---

## Phase 2: Authentication Module

### 2.1 Database Models

**Files:**
- Create: `backend/app/models/sys_user.py`
- Create: `backend/app/models/sys_employee.py`
- Create: `backend/app/models/sys_dept.py`
- Create: `backend/app/models/sys_role.py`
- Create: `backend/app/models/sys_menu.py`
- Create: `backend/app/models/job_position.py`
- Create: `backend/app/models/resume.py`
- Create: `backend/app/models/job_eval_dimension.py`
- Create: `backend/app/models/job_skill.py`
- Create: `backend/app/models/resume_job_match.py`
- Create: `backend/app/models/resume_eval_detail.py`
- Create: `backend/app/models/resume_skill_hit.py`
- Create: `backend/app/models/job_application.py`

- [ ] **Step 1: Create SQLAlchemy base and models**

```python
# backend/app/models/__init__.py
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from app.core.config import get_settings

settings = get_settings()
engine = create_async_engine(settings.DATABASE_URL, echo=settings.DEBUG)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
Base = declarative_base()

from .sys_user import SysUser
from .sys_employee import SysEmployee
from .job_position import JobPosition
from .job_eval_dimension import JobEvalDimension
from .job_skill import JobSkill
from .resume import Resume
from .resume_job_match import ResumeJobMatch
from .resume_eval_detail import ResumeEvalDetail
from .resume_skill_hit import ResumeSkillHit
from .job_application import JobApplication

__all__ = [
    "Base", "engine", "async_session",
    "SysUser", "SysEmployee", "JobPosition",
    "JobEvalDimension", "JobSkill", "Resume",
    "ResumeJobMatch", "ResumeEvalDetail", "ResumeSkillHit",
    "JobApplication"
]
```

```python
# backend/app/models/sys_user.py
from sqlalchemy import Column, BigInteger, String, Tinyint, DateTime
from sqlalchemy.sql import func
from . import Base


class SysUser(Base):
    __tablename__ = "sys_user"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    email = Column(String(100), nullable=False, unique=True, comment="邮箱")
    real_name = Column(String(50), nullable=False, comment="真实姓名")
    password_hash = Column(String(255), nullable=False, comment="密码哈希")
    status = Column(Tinyint, nullable=False, default=1, comment="账号状态：1正常，0禁用")
    is_deleted = Column(Tinyint, nullable=False, default=0, comment="逻辑删除")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="注册时间")
    update_time = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间")
```

```python
# backend/app/models/sys_employee.py
from sqlalchemy import Column, BigInteger, String, Tinyint, DateTime, ForeignKey
from sqlalchemy.sql import func
from . import Base


class SysEmployee(Base):
    __tablename__ = "sys_employee"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    emp_no = Column(String(30), comment="员工工号")
    real_name = Column(String(50), nullable=False, comment="真实姓名")
    email = Column(String(100), comment="邮箱")
    phone = Column(String(20), comment="手机号")
    dept_id = Column(BigInteger, comment="部门ID")
    status = Column(Tinyint, nullable=False, default=1, comment="在职状态：1在职，0离职")
    is_deleted = Column(Tinyint, nullable=False, default=0, comment="逻辑删除")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")
    update_time = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间")
```

```python
# backend/app/models/resume.py
from sqlalchemy import Column, BigInteger, String, Tinyint, DateTime, Text
from sqlalchemy.sql import func
from . import Base


class Resume(Base):
    __tablename__ = "resume"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(BigInteger, comment="上传者ID")
    file_name = Column(String(255), nullable=False, comment="原始文件名")
    file_path = Column(String(500), nullable=False, comment="文件相对路径")
    storage_type = Column(String(20), nullable=False, default="LOCAL", comment="存储类型")
    raw_text = Column(Text, comment="AI解析后的纯文本内容")
    status = Column(Tinyint, nullable=False, default=0, comment="状态：0待处理，2评估完成，3处理失败")
    is_deleted = Column(Tinyint, nullable=False, default=0, comment="逻辑删除")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="上传时间")
    update_time = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间")
```

```python
# backend/app/models/job_position.py
from sqlalchemy import Column, BigInteger, String, Tinyint, DateTime, Text
from sqlalchemy.sql import func
from . import Base


class JobPosition(Base):
    __tablename__ = "job_position"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    employee_id = Column(BigInteger, nullable=False, comment="发布人")
    dept_id = Column(BigInteger, nullable=False, comment="所属部门")
    name = Column(String(100), nullable=False, comment="岗位名称")
    description = Column(Text, comment="岗位简要描述")
    status = Column(Tinyint, nullable=False, default=1, comment="状态：1招聘中，0已下架")
    is_deleted = Column(Tinyint, nullable=False, default=0, comment="逻辑删除")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="发布时间")
    update_time = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间")
```

```python
# backend/app/models/job_eval_dimension.py
from sqlalchemy import Column, BigInteger, String, DECIMAL, Integer, DateTime, Text
from sqlalchemy.sql import func
from . import Base


class JobEvalDimension(Base):
    __tablename__ = "job_eval_dimension"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    job_id = Column(BigInteger, nullable=False, comment="关联岗位ID")
    dimension_name = Column(String(50), nullable=False, comment="维度名称")
    weight = Column(DECIMAL(5, 2), nullable=False, comment="权重占比")
    prompt_template = Column(Text, nullable=False, comment="提示词模板")
    sort_order = Column(Integer, nullable=False, default=0, comment="排序")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")
```

```python
# backend/app/models/job_skill.py
from sqlalchemy import Column, BigInteger, String, Tinyint, DateTime
from sqlalchemy.sql import func
from . import Base


class JobSkill(Base):
    __tablename__ = "job_skill"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    job_id = Column(BigInteger, nullable=False, comment="关联岗位ID")
    skill_name = Column(String(100), nullable=False, comment="技能名称")
    skill_type = Column(Tinyint, nullable=False, comment="技能类型：1必须，2优先，3普通")
    match_label = Column(String(20), comment="命中标签")
    is_ai_generated = Column(Tinyint, nullable=False, default=0, comment="是否AI生成")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")
```

```python
# backend/app/models/resume_job_match.py
from sqlalchemy import Column, BigInteger, String, DECIMAL, Tinyint, DateTime, Text
from sqlalchemy.sql import func
from . import Base


class ResumeJobMatch(Base):
    __tablename__ = "resume_job_match"

    id = Column(BigIntenger, primary_key=True, autoincrement=True)
    resume_id = Column(BigInteger, nullable=False, comment="简历ID")
    job_id = Column(BigInteger, nullable=False, comment="岗位ID")
    final_score = Column(DECIMAL(5, 2), nullable=False, default=0.00, comment="最终得分")
    final_label = Column(String(20), nullable=False, default="未达标", comment="最终标签")
    advantage_comment = Column(String(500), comment="整体优点")
    disadvantage_comment = Column(String(500), comment="整体缺点")
    is_direct_preferred = Column(Tinyint, nullable=False, default=0, comment="是否直接优选命中")
    evaluated_at = Column(DateTime, comment="评估完成时间")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")
```

```python
# backend/app/models/resume_eval_detail.py
from sqlalchemy import Column, BigInteger, DECIMAL, DateTime, Text
from sqlalchemy.sql import func
from . import Base


class ResumeEvalDetail(Base):
    __tablename__ = "resume_eval_detail"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    match_id = Column(BigInteger, nullable=False, comment="关联匹配记录ID")
    dimension_id = Column(BigInteger, nullable=False, comment="关联维度ID")
    dimension_score = Column(DECIMAL(5, 2), nullable=False, comment="维度得分")
    dimension_advantage = Column(String(500), comment="维度优点")
    dimension_disadvantage = Column(String(500), comment="维度缺点")
    ai_reasoning = Column(Text, comment="AI理由")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")
```

```python
# backend/app/models/resume_skill_hit.py
from sqlalchemy import Column, BigInteger, Tinyint, DateTime, String
from sqlalchemy.sql import func
from . import Base


class ResumeSkillHit(Base):
    __tablename__ = "resume_skill_hit"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    match_id = Column(BigInteger, nullable=False, comment="关联匹配记录ID")
    skill_id = Column(BigInteger, nullable=False, comment="关联技能ID")
    is_hit = Column(Tinyint, nullable=False, comment="是否命中")
    hit_context = Column(String(500), comment="命中上下文")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")
```

```python
# backend/app/models/job_application.py
from sqlalchemy import Column, BigInteger, Tinyint, DateTime
from sqlalchemy.sql import func
from . import Base


class JobApplication(Base):
    __tablename__ = "job_application"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(BigInteger, nullable=False, comment="投递用户ID")
    job_id = Column(BigInteger, nullable=False, comment="岗位ID")
    resume_id = Column(BigInteger, nullable=False, comment="关联简历ID")
    status = Column(Tinyint, nullable=False, default=0, comment="状态：0待处理，1已查看，2评估完成，3面试邀请")
    is_deleted = Column(Tinyint, nullable=False, default=0, comment="逻辑删除")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="投递时间")
    update_time = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间")
```

- [ ] **Step 2: Create API response schemas**

```python
# backend/app/schemas/auth.py
from pydantic import BaseModel, EmailStr
from typing import Optional


class SendCodeRequest(BaseModel):
    email: EmailStr
    user_type: str  # "user" or "employee"


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    code: str
    real_name: str


class LoginRequest(BaseModel):
    identifier: str  # username or email
    login_type: str  # "password" or "code"
    password: Optional[str] = None
    code: Optional[str] = None


class EmployeeLoginRequest(BaseModel):
    identifier: str  # emp_no or email
    login_type: str  # "password" or "code"
    password: Optional[str] = None
    code: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user_type: str
    user_id: int
```

- [ ] **Step 3: Create auth API routes**

```python
# backend/app/api/v1/user/auth.py
from fastapi import APIRouter, Depends
from app.schemas.auth import *
from app.services.auth_service import AuthService
from app.repositories.user_repo import UserRepository
from app.core.exceptions import ValidationError, UnauthorizedError
from app.core.security import verify_password
from app.api.deps import get_db

router = APIRouter()


@router.post("/send-code")
async def send_code(req: SendCodeRequest):
    # TODO: Implement email sending
    return {"code": 200, "message": "验证码已发送", "data": None}


@router.post("/register", response_model=TokenResponse)
async def register(req: RegisterRequest, db=Depends(get_db)):
    repo = UserRepository(db)
    # Verify code
    # Check if user exists
    # Create user
    # Generate tokens
    pass


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, db=Depends(get_db)):
    repo = UserRepository(db)
    if req.login_type == "password":
        user = await repo.get_by_identifier(req.identifier)
        if not user or not verify_password(req.password, user.password_hash):
            raise UnauthorizedError("用户名或密码错误")
    else:
        # Verify code
        pass
    # Generate tokens
    pass
```

- [ ] **Step 4: Create services and repositories**

```python
# backend/app/repositories/user_repo.py
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import SysUser


class UserRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_id(self, user_id: int) -> SysUser:
        result = await self.db.execute(
            select(SysUser).where(SysUser.id == user_id, SysUser.is_deleted == 0)
        )
        return result.scalar_one_or_none()

    async def get_by_email(self, email: str) -> SysUser:
        result = await self.db.execute(
            select(SysUser).where(SysUser.email == email, SysUser.is_deleted == 0)
        )
        return result.scalar_one_or_none()

    async def get_by_identifier(self, identifier: str) -> SysUser:
        # identifier can be username or email
        result = await self.db.execute(
            select(SysUser).where(
                (SysUser.email == identifier) | (SysUser.real_name == identifier),
                SysUser.is_deleted == 0
            )
        )
        return result.scalar_one_or_none()

    async def create(self, email: str, password_hash: str, real_name: str) -> SysUser:
        user = SysUser(email=email, password_hash=password_hash, real_name=real_name)
        self.db.add(user)
        await self.db.commit()
        await self.db.refresh(user)
        return user
```

```python
# backend/app/services/auth_service.py
from app.repositories.user_repo import UserRepository
from app.core.security import create_access_token, create_refresh_token, verify_password


class AuthService:
    def __init__(self, user_repo: UserRepository):
        self.user_repo = user_repo

    async def authenticate_user(self, identifier: str, password: str):
        user = await self.user_repo.get_by_identifier(identifier)
        if not user:
            return None
        if not verify_password(password, user.password_hash):
            return None
        return user

    def create_tokens(self, user_id: int, user_type: str):
        access_token = create_access_token({"sub": str(user_id), "type": user_type})
        refresh_token = create_refresh_token({"sub": str(user_id), "type": user_type})
        return access_token, refresh_token
```

- [ ] **Step 5: Create deps.py for dependency injection**

```python
# backend/app/api/deps.py
from fastapi import Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import async_session
from app.core.security import decode_token
from app.core.exceptions import UnauthorizedError


async def get_db() -> AsyncSession:
    async with async_session() as session:
        yield session


async def get_current_user(authorization: str = Header(...)) -> dict:
    if not authorization.startswith("Bearer "):
        raise UnauthorizedError("Invalid authorization header")
    token = authorization[7:]
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise UnauthorizedError("Invalid token type")
        return payload
    except ValueError:
        raise UnauthorizedError("Invalid token")
```

- [ ] **Step 6: Write unit tests**

```python
# backend/tests/services/test_auth_service.py
import pytest
from app.services.auth_service import AuthService
from app.repositories.user_repo import UserRepository


@pytest.fixture
def mock_user_repo():
    return MockUserRepository()


class MockUserRepository:
    async def get_by_identifier(self, identifier):
        if identifier == "test@example.com":
            from app.models.sys_user import SysUser
            user = SysUser(id=1, email="test@example.com", real_name="Test User")
            user.password_hash = "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.aSHO8a5x4Gv6Gq"  # "password123"
            return user
        return None


@pytest.mark.asyncio
async def test_authenticate_user_success(mock_user_repo):
    service = AuthService(mock_user_repo)
    user = await service.authenticate_user("test@example.com", "password123")
    assert user is not None
    assert user.email == "test@example.com"


@pytest.mark.asyncio
async def test_authenticate_user_wrong_password(mock_user_repo):
    service = AuthService(mock_user_repo)
    user = await service.authenticate_user("test@example.com", "wrongpassword")
    assert user is None
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add authentication module with user/employee login"
```

---

## Phase 3: Resume & Storage Module

### 3.1 Storage Strategy Pattern

**Files:**
- Create: `backend/app/utils/storage/base.py`
- Create: `backend/app/utils/storage/local.py`
- Create: `backend/app/utils/storage/registry.py`
- Create: `backend/app/services/resume_service.py`
- Create: `backend/app/repositories/resume_repo.py`
- Modify: `backend/app/api/v1/user/resumes.py`
- Create: `backend/tests/services/test_storage.py`

- [ ] **Step 1: Create storage base interface**

```python
# backend/app/utils/storage/base.py
from abc import ABC, abstractmethod
from fastapi import UploadFile


class BaseStorage(ABC):
    @abstractmethod
    async def upload(self, file: UploadFile, path: str) -> str:
        """上传文件，返回访问URL"""
        pass

    @abstractmethod
    async def delete(self, path: str) -> bool:
        """删除文件"""
        pass

    @abstractmethod
    def get_url(self, path: str) -> str:
        """获取文件访问URL"""
        pass
```

```python
# backend/app/utils/storage/local.py
import os
import uuid
from datetime import datetime
from fastapi import UploadFile
from .base import BaseStorage
from app.core.config import get_settings

settings = get_settings()


class LocalStorage(BaseStorage):
    def __init__(self):
        self.base_path = settings.LOCAL_STORAGE_PATH

    async def upload(self, file: UploadFile, relative_path: str = None) -> str:
        # Generate date-based path
        date_str = datetime.now().strftime("%Y-%m-%d")
        if relative_path:
            file_path = f"{self.base_path}/{relative_path}"
        else:
            filename = f"{uuid.uuid4()}_{file.filename}"
            file_path = f"{self.base_path}/{date_str}/{filename}"

        # Ensure directory exists
        os.makedirs(os.path.dirname(file_path), exist_ok=True)

        # Write file
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)

        # Return relative path for storage
        return f"{date_str}/{filename}" if not relative_path else relative_path

    async def delete(self, path: str) -> bool:
        full_path = f"{self.base_path}/{path}"
        if os.path.exists(full_path):
            os.remove(full_path)
            return True
        return False

    def get_url(self, path: str) -> str:
        return f"/files/{path}"
```

```python
# backend/app/utils/storage/registry.py
from typing import Dict, Type
from .base import BaseStorage
from .local import LocalStorage


class StorageRegistry:
    _strategies: Dict[str, Type[BaseStorage]] = {}

    @classmethod
    def register(cls, name: str, strategy: Type[BaseStorage]):
        cls._strategies[name] = strategy

    @classmethod
    def get(cls, name: str = None) -> BaseStorage:
        from app.core.config import get_settings
        settings = get_settings()
        storage_type = name or settings.STORAGE_TYPE
        strategy_class = cls._strategies.get(storage_type, LocalStorage)
        return strategy_class()

    @classmethod
    def setup(cls):
        cls.register("LOCAL", LocalStorage)
        # Future: cls.register("OSS", OssStorage)


# Initialize on import
StorageRegistry.setup()
```

- [ ] **Step 2: Create resume service**

```python
# backend/app/services/resume_service.py
import aiofiles
from fastapi import UploadFile
from app.repositories.resume_repo import ResumeRepository
from app.models import Resume
from app.utils.storage.registry import StorageRegistry
from app.core.exceptions import NotFoundError


class ResumeService:
    def __init__(self, resume_repo: ResumeRepository):
        self.resume_repo = resume_repo
        self.storage = StorageRegistry.get()

    async def upload_resume(self, user_id: int, file: UploadFile, file_name: str) -> Resume:
        # Upload to storage
        storage_path = await self.storage.upload(file, file_name)

        # Create resume record
        resume = await self.resume_repo.create(
            user_id=user_id,
            file_name=file_name,
            file_path=storage_path,
            storage_type=self.storage.__class__.__name__
        )
        return resume

    async def get_user_resumes(self, user_id: int) -> list[Resume]:
        return await self.resume_repo.get_by_user(user_id)

    async def get_resume_by_id(self, resume_id: int, user_id: int = None) -> Resume:
        resume = await self.resume_repo.get_by_id(resume_id)
        if not resume:
            raise NotFoundError("简历不存在")
        if user_id and resume.user_id != user_id:
            raise NotFoundError("简历不存在")
        return resume

    async def delete_resume(self, resume_id: int, user_id: int) -> bool:
        resume = await self.get_resume_by_id(resume_id, user_id)
        await self.storage.delete(resume.file_path)
        return await self.resume_repo.delete(resume_id)
```

- [ ] **Step 3: Create resume repository**

```python
# backend/app/repositories/resume_repo.py
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import Resume


class ResumeRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_id(self, resume_id: int) -> Resume:
        result = await self.db.execute(
            select(Resume).where(Resume.id == resume_id, Resume.is_deleted == 0)
        )
        return result.scalar_one_or_none()

    async def get_by_user(self, user_id: int) -> list[Resume]:
        result = await self.db.execute(
            select(Resume).where(Resume.user_id == user_id, Resume.is_deleted == 0)
        )
        return result.scalars().all()

    async def create(self, user_id: int, file_name: str, file_path: str, storage_type: str) -> Resume:
        resume = Resume(
            user_id=user_id,
            file_name=file_name,
            file_path=file_path,
            storage_type=storage_type
        )
        self.db.add(resume)
        await self.db.commit()
        await self.db.refresh(resume)
        return resume

    async def delete(self, resume_id: int) -> bool:
        await self.db.execute(
            update(Resume).where(Resume.id == resume_id).values(is_deleted=1)
        )
        await self.db.commit()
        return True
```

- [ ] **Step 4: Create API route**

```python
# backend/app/api/v1/user/resumes.py
from fastapi import APIRouter, Depends, UploadFile, File, Query
from app.services.resume_service import ResumeService
from app.repositories.resume_repo import ResumeRepository
from app.api.deps import get_db, get_current_user
from app.core.exceptions import BizError

router = APIRouter()


def get_resume_service(db=Depends(get_db)) -> ResumeService:
    return ResumeService(ResumeRepository(db))


@router.post("")
async def upload_resume(
    file: UploadFile = File(...),
    service: ResumeService = Depends(get_resume_service),
    current_user: dict = Depends(get_current_user)
):
    user_id = int(current_user["sub"])
    if not file.filename.endswith(('.pdf', '.docx', '.doc')):
        raise BizError(code=400, message="只支持 PDF 或 Word 格式")

    resume = await service.upload_resume(user_id, file, file.filename)
    return {"code": 200, "message": "上传成功", "data": {"id": resume.id}}


@router.get("")
async def list_resumes(
    service: ResumeService = Depends(get_resume_service),
    current_user: dict = Depends(get_current_user)
):
    user_id = int(current_user["sub"])
    resumes = await service.get_user_resumes(user_id)
    return {
        "code": 200,
        "message": "success",
        "data": [{"id": r.id, "file_name": r.file_name, "create_time": r.create_time} for r in resumes]
    }


@router.delete("/{resume_id}")
async def delete_resume(
    resume_id: int,
    service: ResumeService = Depends(get_resume_service),
    current_user: dict = Depends(get_current_user)
):
    user_id = int(current_user["sub"])
    await service.delete_resume(resume_id, user_id)
    return {"code": 200, "message": "删除成功", "data": None}
```

- [ ] **Step 5: Write unit tests**

```python
# backend/tests/services/test_storage.py
import pytest
from app.utils.storage.local import LocalStorage
from fastapi import UploadFile
from io import BytesIO


@pytest.fixture
def local_storage():
    return LocalStorage()


@pytest.mark.asyncio
async def test_local_storage_upload(local_storage):
    content = b"test content"
    file = UploadFile(filename="test.pdf", file=BytesIO(content))

    path = await local_storage.upload(file)
    assert path is not None
    assert "test.pdf" in path
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add resume upload with storage strategy pattern"
```

---

## Phase 4: Job Module

### 4.1 Job CRUD (Employee) & Browse (User)

**Files:**
- Create: `backend/app/repositories/job_repo.py`
- Create: `backend/app/services/job_service.py`
- Create: `backend/app/api/v1/user/jobs.py`
- Create: `backend/app/api/v1/employee/jobs.py`
- Create: `backend/app/api/v1/employee/jobs/skill.py`

- [ ] **Step 1: Create job repository**

```python
# backend/app/repositories/job_repo.py
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import JobPosition


class JobRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_id(self, job_id: int) -> JobPosition:
        result = await self.db.execute(
            select(JobPosition).where(JobPosition.id == job_id, JobPosition.is_deleted == 0)
        )
        return result.scalar_one_or_none()

    async def get_list(self, skip: int = 0, limit: int = 20, status: int = 1) -> list[JobPosition]:
        query = select(JobPosition).where(JobPosition.is_deleted == 0)
        if status is not None:
            query = query.where(JobPosition.status == status)
        query = query.offset(skip).limit(limit).order_by(JobPosition.create_time.desc())
        result = await self.db.execute(query)
        return result.scalars().all()

    async def get_by_employee(self, employee_id: int) -> list[JobPosition]:
        result = await self.db.execute(
            select(JobPosition)
            .where(JobPosition.employee_id == employee_id, JobPosition.is_deleted == 0)
            .order_by(JobPosition.create_time.desc())
        )
        return result.scalars().all()

    async def create(self, employee_id: int, dept_id: int, name: str, description: str) -> JobPosition:
        job = JobPosition(
            employee_id=employee_id,
            dept_id=dept_id,
            name=name,
            description=description
        )
        self.db.add(job)
        await self.db.commit()
        await self.db.refresh(job)
        return job

    async def update(self, job_id: int, **kwargs) -> JobPosition:
        await self.db.execute(
            update(JobPosition).where(JobPosition.id == job_id).values(**kwargs)
        )
        await self.db.commit()
        return await self.get_by_id(job_id)

    async def delete(self, job_id: int) -> bool:
        await self.db.execute(
            update(JobPosition).where(JobPosition.id == job_id).values(is_deleted=1)
        )
        await self.db.commit()
        return True
```

- [ ] **Step 2: Create job schemas**

```python
# backend/app/schemas/job.py
from pydantic import BaseModel
from typing import Optional


class JobCreate(BaseModel):
    name: str
    description: Optional[str] = None
    dept_id: int


class JobUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[int] = None


class JobResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    dept_id: int
    status: int
    create_time: str

    class Config:
        from_attributes = True
```

- [ ] **Step 3: Create job service**

```python
# backend/app/services/job_service.py
from app.repositories.job_repo import JobRepository
from app.models import JobPosition
from app.core.exceptions import NotFoundError


class JobService:
    def __init__(self, job_repo: JobRepository):
        self.job_repo = job_repo

    async def get_jobs(self, skip: int = 0, limit: int = 20) -> list[JobPosition]:
        return await self.job_repo.get_list(skip=skip, limit=limit, status=1)

    async def get_job_by_id(self, job_id: int) -> JobPosition:
        job = await self.job_repo.get_by_id(job_id)
        if not job:
            raise NotFoundError("岗位不存在")
        return job

    async def get_employee_jobs(self, employee_id: int) -> list[JobPosition]:
        return await self.job_repo.get_by_employee(employee_id)

    async def create_job(self, employee_id: int, dept_id: int, name: str, description: str) -> JobPosition:
        return await self.job_repo.create(employee_id, dept_id, name, description)

    async def update_job(self, job_id: int, **kwargs) -> JobPosition:
        return await self.job_repo.update(job_id, **kwargs)

    async def delete_job(self, job_id: int) -> bool:
        return await self.job_repo.delete(job_id)
```

- [ ] **Step 4: Create user jobs API (browse only)**

```python
# backend/app/api/v1/user/jobs.py
from fastapi import APIRouter, Depends, Query
from app.services.job_service import JobService
from app.repositories.job_repo import JobRepository
from app.api.deps import get_db

router = APIRouter()


def get_job_service(db=Depends(get_db)) -> JobService:
    return JobService(JobRepository(db))


@router.get("")
async def list_jobs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    service: JobService = Depends(get_job_service)
):
    skip = (page - 1) * page_size
    jobs = await service.get_jobs(skip=skip, limit=page_size)
    return {
        "code": 200,
        "message": "success",
        "data": {
            "total": len(jobs),
            "items": [job.id for job in jobs]
        }
    }


@router.get("/{job_id}")
async def get_job(
    job_id: int,
    service: JobService = Depends(get_job_service)
):
    job = await service.get_job_by_id(job_id)
    return {
        "code": 200,
        "message": "success",
        "data": {
            "id": job.id,
            "name": job.name,
            "description": job.description,
            "status": job.status
        }
    }
```

- [ ] **Step 5: Create employee jobs API (CRUD + skill suggestion)**

```python
# backend/app/api/v1/employee/jobs.py
from fastapi import APIRouter, Depends, Query
from app.services.job_service import JobService
from app.repositories.job_repo import JobRepository
from app.schemas.job import JobCreate, JobUpdate
from app.api.deps import get_db, get_current_user

router = APIRouter()


def get_job_service(db=Depends(get_db)) -> JobService:
    return JobService(JobRepository(db))


@router.get("")
async def list_employee_jobs(
    service: JobService = Depends(get_job_service),
    current_user: dict = Depends(get_current_user)
):
    employee_id = int(current_user["sub"])
    jobs = await service.get_employee_jobs(employee_id)
    return {"code": 200, "message": "success", "data": jobs}


@router.post("")
async def create_job(
    job: JobCreate,
    service: JobService = Depends(get_job_service),
    current_user: dict = Depends(get_current_user)
):
    employee_id = int(current_user["sub"])
    new_job = await service.create_job(employee_id, job.dept_id, job.name, job.description)
    return {"code": 200, "message": "创建成功", "data": {"id": new_job.id}}


@router.put("/{job_id}")
async def update_job(
    job_id: int,
    job: JobUpdate,
    service: JobService = Depends(get_job_service),
    current_user: dict = Depends(get_current_user)
):
    updated_job = await service.update_job(job_id, **job.model_dump(exclude_unset=True))
    return {"code": 200, "message": "更新成功", "data": None}


@router.delete("/{job_id}")
async def delete_job(
    job_id: int,
    service: JobService = Depends(get_job_service),
    current_user: dict = Depends(get_current_user)
):
    await service.delete_job(job_id)
    return {"code": 200, "message": "删除成功", "data": None}
```

- [ ] **Step 6: Create skill suggestion endpoint**

```python
# backend/app/api/v1/employee/jobs/skill.py
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.api.deps import get_current_user

router = APIRouter()


class SkillSuggestRequest(BaseModel):
    name: str
    description: str


class SkillSuggestResponse(BaseModel):
    skill: str
    type: int  # 1=必须, 2=优先, 3=普通
    reason: str


@router.post("/suggest", response_model=list[SkillSuggestResponse])
async def suggest_skills(
    req: SkillSuggestRequest,
    current_user: dict = Depends(get_current_user)
):
    # TODO: Implement LiteLLM skill suggestion
    # Placeholder for now
    return [
        {"skill": "React", "type": 1, "reason": "核心框架，必须掌握"},
        {"skill": "TypeScript", "type": 2, "reason": "提升代码质量"},
    ]
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add job module with CRUD and skill suggestion"
```

---

## Phase 5: Application Module

### 5.1 User Apply & Employee View Applications

**Files:**
- Create: `backend/app/repositories/application_repo.py`
- Create: `backend/app/services/application_service.py`
- Create: `backend/app/api/v1/user/applications.py`
- Create: `backend/app/api/v1/employee/applications.py`
- Create: `backend/tests/services/test_application_service.py`

- [ ] **Step 1: Create application repository**

```python
# backend/app/repositories/application_repo.py
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import JobApplication


class ApplicationRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_id(self, app_id: int) -> JobApplication:
        result = await self.db.execute(
            select(JobApplication).where(JobApplication.id == app_id, JobApplication.is_deleted == 0)
        )
        return result.scalar_one_or_none()

    async def get_by_user(self, user_id: int, skip: int = 0, limit: int = 20) -> list[JobApplication]:
        result = await self.db.execute(
            select(JobApplication)
            .where(JobApplication.user_id == user_id, JobApplication.is_deleted == 0)
            .offset(skip).limit(limit)
            .order_by(JobApplication.create_time.desc())
        )
        return result.scalars().all()

    async def get_by_job(self, job_id: int, skip: int = 0, limit: int = 20) -> list[JobApplication]:
        result = await self.db.execute(
            select(JobApplication)
            .where(JobApplication.job_id == job_id, JobApplication.is_deleted == 0)
            .offset(skip).limit(limit)
        )
        return result.scalars().all()

    async def create(self, user_id: int, job_id: int, resume_id: int) -> JobApplication:
        app = JobApplication(user_id=user_id, job_id=job_id, resume_id=resume_id)
        self.db.add(app)
        await self.db.commit()
        await self.db.refresh(app)
        return app

    async def update_status(self, app_id: int, status: int) -> bool:
        await self.db.execute(
            update(JobApplication).where(JobApplication.id == app_id).values(status=status)
        )
        await self.db.commit()
        return True
```

- [ ] **Step 2: Create application service**

```python
# backend/app/services/application_service.py
from app.repositories.application_repo import ApplicationRepository
from app.repositories.resume_repo import ResumeRepository
from app.repositories.job_repo import JobRepository
from app.models import JobApplication
from app.core.exceptions import NotFoundError, ValidationError


class ApplicationService:
    def __init__(self, app_repo: ApplicationRepository, resume_repo: ResumeRepository, job_repo: JobRepository):
        self.app_repo = app_repo
        self.resume_repo = resume_repo
        self.job_repo = job_repo

    async def create_application(self, user_id: int, job_id: int, resume_id: int) -> JobApplication:
        # Verify job exists
        job = await self.job_repo.get_by_id(job_id)
        if not job:
            raise NotFoundError("岗位不存在")
        if job.status != 1:
            raise ValidationError("岗位已下架")

        # Verify resume belongs to user
        resume = await self.resume_repo.get_by_id(resume_id)
        if not resume or resume.user_id != user_id:
            raise NotFoundError("简历不存在")

        return await self.app_repo.create(user_id, job_id, resume_id)

    async def get_user_applications(self, user_id: int, skip: int = 0, limit: int = 20) -> list[JobApplication]:
        return await self.app_repo.get_by_user(user_id, skip, limit)

    async def get_application_by_id(self, app_id: int, user_id: int = None) -> JobApplication:
        app = await self.app_repo.get_by_id(app_id)
        if not app:
            raise NotFoundError("投递记录不存在")
        if user_id and app.user_id != user_id:
            raise NotFoundError("投递记录不存在")
        return app

    async def update_status(self, app_id: int, status: int) -> bool:
        return await self.app_repo.update_status(app_id, status)
```

- [ ] **Step 3: Create user applications API**

```python
# backend/app/api/v1/user/applications.py
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from app.services.application_service import ApplicationService
from app.repositories.application_repo import ApplicationRepository
from app.repositories.resume_repo import ResumeRepository
from app.repositories.job_repo import JobRepository
from app.api.deps import get_db, get_current_user

router = APIRouter()


class ApplyRequest(BaseModel):
    job_id: int
    resume_id: int


def get_service(db=Depends(get_db)) -> ApplicationService:
    return ApplicationService(
        ApplicationRepository(db),
        ResumeRepository(db),
        JobRepository(db)
    )


@router.post("")
async def apply_job(
    req: ApplyRequest,
    service: ApplicationService = Depends(get_service),
    current_user: dict = Depends(get_current_user)
):
    user_id = int(current_user["sub"])
    app = await service.create_application(user_id, req.job_id, req.resume_id)
    return {"code": 200, "message": "投递成功", "data": {"id": app.id}}


@router.get("")
async def list_my_applications(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    service: ApplicationService = Depends(get_service),
    current_user: dict = Depends(get_current_user)
):
    user_id = int(current_user["sub"])
    skip = (page - 1) * page_size
    apps = await service.get_user_applications(user_id, skip, page_size)
    return {"code": 200, "message": "success", "data": {
        "total": len(apps),
        "items": [{"id": a.id, "job_id": a.job_id, "status": a.status} for a in apps]
    }}


@router.get("/{app_id}")
async def get_my_application(
    app_id: int,
    service: ApplicationService = Depends(get_service),
    current_user: dict = Depends(get_current_user)
):
    user_id = int(current_user["sub"])
    app = await service.get_application_by_id(app_id, user_id)
    return {"code": 200, "message": "success", "data": {
        "id": app.id,
        "job_id": app.job_id,
        "resume_id": app.resume_id,
        "status": app.status,
        "create_time": app.create_time.isoformat()
    }}
```

- [ ] **Step 4: Create employee applications API**

```python
# backend/app/api/v1/employee/applications.py
from fastapi import APIRouter, Depends, Query
from app.services.application_service import ApplicationService
from app.repositories.application_repo import ApplicationRepository
from app.repositories.resume_repo import ResumeRepository
from app.repositories.job_repo import JobRepository
from app.api.deps import get_db, get_current_user

router = APIRouter()


def get_service(db=Depends(get_db)) -> ApplicationService:
    return ApplicationService(
        ApplicationRepository(db),
        ResumeRepository(db),
        JobRepository(db)
    )


@router.get("")
async def list_applications(
    job_id: int = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    service: ApplicationService = Depends(get_service),
    current_user: dict = Depends(get_current_user)
):
    if job_id:
        apps = await service.get_job_applications(job_id, (page-1)*page_size, page_size)
    else:
        apps = []
    return {"code": 200, "message": "success", "data": {"total": len(apps), "items": apps}}


@router.put("/{app_id}/status")
async def update_application_status(
    app_id: int,
    status: int,
    service: ApplicationService = Depends(get_service),
    current_user: dict = Depends(get_current_user)
):
    await service.update_status(app_id, status)
    return {"code": 200, "message": "更新成功", "data": None}
```

- [ ] **Step 5: Write unit tests**

```python
# backend/tests/services/test_application_service.py
import pytest
from app.services.application_service import ApplicationService
from app.repositories.application_repo import ApplicationRepository
from app.repositories.resume_repo import ResumeRepository
from app.repositories.job_repo import JobRepository
from app.core.exceptions import ValidationError


class MockApplicationRepository:
    async def get_by_id(self, app_id):
        return None
    async def get_by_user(self, user_id, skip=0, limit=20):
        return []
    async def create(self, user_id, job_id, resume_id):
        return MockJobApplication(id=1, user_id=user_id, job_id=job_id, resume_id=resume_id, status=0)
    async def update_status(self, app_id, status):
        return True


class MockResumeRepository:
    async def get_by_id(self, resume_id):
        return MockResume(id=resume_id, user_id=1)


class MockJobRepository:
    async def get_by_id(self, job_id):
        if job_id == 1:
            return MockJob(id=1, status=1)
        return None


class MockJobApplication:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


class MockResume:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


class MockJob:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


@pytest.mark.asyncio
async def test_create_application_success():
    service = ApplicationService(
        MockApplicationRepository(),
        MockResumeRepository(),
        MockJobRepository()
    )
    app = await service.create_application(user_id=1, job_id=1, resume_id=1)
    assert app.id == 1


@pytest.mark.asyncio
async def test_create_application_job_not_found():
    service = ApplicationService(
        MockApplicationRepository(),
        MockResumeRepository(),
        MockJobRepository()
    )
    with pytest.raises(Exception):
        await service.create_application(user_id=1, job_id=999, resume_id=1)
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add application module for job applications"
```

---

## Phase 6: AI Evaluation Module

### 6.1 LiteLLM Integration & Evaluation Chain

**Files:**
- Create: `backend/app/utils/ai/client.py`
- Create: `backend/app/utils/ai/chains.py`
- Create: `backend/app/utils/ai/prompts.py`
- Create: `backend/app/services/eval_service.py`
- Create: `backend/app/repositories/eval_repo.py`
- Create: `backend/app/api/v1/employee/evaluations.py`
- Create: `backend/celery_app/celery.py`
- Create: `backend/celery_app/tasks/eval_task.py`

- [ ] **Step 1: Create LiteLLM client**

```python
# backend/app/utils/ai/client.py
import litellm
from litellm import RetryConfig
from app.core.config import get_settings
from app.core.exceptions import BizError

settings = get_settings()

# Configure retry
retry_config = RetryConfig(
    max_retries=3,
    timeout=30,
    backoff_factor=2,
)


def llm_complete(prompt: str, model: str = None) -> str:
    """统一LLM调用入口"""
    try:
        response = litellm.completion(
            model=model or settings.OPENAI_MODEL,
            messages=[{"role": "user", "content": prompt}],
            retry_config=retry_config,
        )
        return response.choices[0].message.content
    except Exception as e:
        # 降级到备用模型
        if model != settings.FALLBACK_MODEL:
            return llm_complete(prompt, model=settings.FALLBACK_MODEL)
        raise BizError(code=500, message=f"AI服务调用失败: {str(e)}")
```

- [ ] **Step 2: Create prompts module**

```python
# backend/app/utils/ai/prompts.py

SKILL_SUGGEST_PROMPT = """
## 任务
你是一个专业的招聘顾问。根据提供的岗位信息，为该岗位生成技能要求列表。

## 输入信息
- 岗位名称: {job_name}
- 岗位描述: {job_description}

## 输出要求
生成8-15个技能要求，分为三个优先级：
- type=1 (必须满足): 胜任该岗位的核心技能，缺失则直接淘汰
- type=2 (优先匹配): 显著提升竞争力的技能，命中则标记为优秀/良好
- type=3 (普通技能): 加分项，命中可提升分数

## 输出格式（严格JSON）
[
  {{"skill": "技能名称", "type": 1|2|3, "reason": "该技能对岗位的重要程度说明，10-20字"}}
]

## 规则
1. 技能名称必须具体明确
2. 必须包含该岗位最核心的1-2个框架/语言
3. 必须包含2-3个通用能力
4. reason必须说明该技能在岗位中的实际应用场景
"""

DIMENSION_EVAL_PROMPT = """
## 任务
你是一个专业的简历评估专家。请根据以下维度对候选人的简历进行评估。

## 输入信息
- 评估维度: {dimension_name}
- 岗位名称: {job_name}
- 岗位技能要求: {job_skills}

## 简历内容
{resume_text}

## 评分标准
| 分数区间 | 等级 | 说明 |
|----------|------|------|
| 90-100 | 优秀 | 显著超出岗位预期 |
| 70-89 | 良好 | 符合岗位预期 |
| 50-69 | 一般 | 基本符合，但存在不足 |
| 0-49 | 未达标 | 明显缺失 |

## 输出要求（严格JSON）
{{"score": <整数>, "advantage": "<优点30-100字>", "disadvantage": "<缺点30-100字>"}}
"""

COMPREHENSIVE_EVAL_PROMPT = """
## 任务
你是一个专业的招聘顾问。请生成简历对该岗位的综合评价。

## 输入信息
- 岗位名称: {job_name}
- 最终得分: {final_score}/100
- 各维度评估: {dimensions}

## 输出要求（严格JSON）
{{"advantage_comment": "<优点50-150字>", "disadvantage_comment": "<缺点50-150字或空字符串''>"}}
"""

SKILL_HIT_PROMPT = """
## 任务
检测简历中是否包含指定技能，并提取命中的上下文片段。

## 输入信息
- 目标技能: {skill_list}
- 技能类型: {skill_type}

## 简历内容
{resume_text}

## 输出要求（严格JSON）
{{"hits": [{{"skill": "技能名称", "is_hit": true|false, "hit_context": "<命中的原文片段>"}}]}}
"""
```

- [ ] **Step 3: Create evaluation chains**

```python
# backend/app/utils/ai/chains.py
import json
import re
from app.utils.ai.client import llm_complete
from app.utils.ai.prompts import DIMENSION_EVAL_PROMPT, SKILL_HIT_PROMPT, COMPREHENSIVE_EVAL_PROMPT


class DimensionEvalChain:
    """维度评估Chain"""

    def evaluate(self, resume_text: str, dimension_name: str, job_name: str, job_skills: str) -> dict:
        prompt = DIMENSION_EVAL_PROMPT.format(
            dimension_name=dimension_name,
            job_name=job_name,
            job_skills=job_skills,
            resume_text=resume_text
        )
        result = llm_complete(prompt)
        return self._parse_result(result)

    def _parse_result(self, result: str) -> dict:
        # 提取JSON
        match = re.search(r'\{.*\}', result, re.DOTALL)
        if match:
            return json.loads(match.group())
        return {"score": 50, "advantage": "评估失败", "disadvantage": ""}


class SkillHitChain:
    """技能命中检测Chain"""

    def evaluate(self, resume_text: str, skill_list: list, skill_type: int) -> dict:
        prompt = SKILL_HIT_PROMPT.format(
            skill_list=", ".join([s["skill"] for s in skill_list]),
            skill_type=skill_type,
            resume_text=resume_text
        )
        result = llm_complete(prompt)
        return self._parse_result(result)

    def _parse_result(self, result: str) -> dict:
        match = re.search(r'\{.*\}', result, re.DOTALL)
        if match:
            return json.loads(match.group())
        return {"hits": []}


class ComprehensiveEvalChain:
    """综合评价Chain"""

    def evaluate(self, job_name: str, final_score: float, dimensions: list) -> dict:
        prompt = COMPREHENSIVE_EVAL_PROMPT.format(
            job_name=job_name,
            final_score=final_score,
            dimensions=", ".join([f"{d['dimension_name']}:{d['score']}分" for d in dimensions])
        )
        result = llm_complete(prompt)
        return self._parse_result(result)

    def _parse_result(self, result: str) -> dict:
        match = re.search(r'\{.*\}', result, re.DOTALL)
        if match:
            return json.loads(match.group())
        return {"advantage_comment": "", "disadvantage_comment": ""}
```

- [ ] **Step 4: Create evaluation repository**

```python
# backend/app/repositories/eval_repo.py
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import ResumeJobMatch, ResumeEvalDetail, ResumeSkillHit


class EvalRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_match(self, resume_id: int, job_id: int) -> ResumeJobMatch:
        match = ResumeJobMatch(resume_id=resume_id, job_id=job_id)
        self.db.add(match)
        await self.db.commit()
        await self.db.refresh(match)
        return match

    async def update_match_result(self, match_id: int, score: float, label: str,
                                   advantage: str, disadvantage: str) -> bool:
        await self.db.execute(
            update(ResumeJobMatch)
            .where(ResumeJobMatch.id == match_id)
            .values(
                final_score=score,
                final_label=label,
                advantage_comment=advantage,
                disadvantage_comment=disadvantage,
                evaluated_at=func.now()
            )
        )
        await self.db.commit()
        return True

    async def create_eval_detail(self, match_id: int, dimension_id: int,
                                  score: float, advantage: str, disadvantage: str) -> ResumeEvalDetail:
        detail = ResumeEvalDetail(
            match_id=match_id,
            dimension_id=dimension_id,
            dimension_score=score,
            dimension_advantage=advantage,
            dimension_disadvantage=disadvantage
        )
        self.db.add(detail)
        await self.db.commit()
        await self.db.refresh(detail)
        return detail

    async def create_skill_hit(self, match_id: int, skill_id: int,
                                is_hit: int, hit_context: str) -> ResumeSkillHit:
        hit = ResumeSkillHit(
            match_id=match_id,
            skill_id=skill_id,
            is_hit=is_hit,
            hit_context=hit_context
        )
        self.db.add(hit)
        await self.db.commit()
        await self.db.refresh(hit)
        return hit

    async def get_match_by_id(self, match_id: int) -> ResumeJobMatch:
        result = await self.db.execute(
            select(ResumeJobMatch).where(ResumeJobMatch.id == match_id)
        )
        return result.scalar_one_or_none()

    async def get_match_by_resume_and_job(self, resume_id: int, job_id: int) -> ResumeJobMatch:
        result = await self.db.execute(
            select(ResumeJobMatch)
            .where(ResumeJobMatch.resume_id == resume_id, ResumeJobMatch.job_id == job_id)
        )
        return result.scalar_one_or_none()

    async def get_eval_details(self, match_id: int) -> list[ResumeEvalDetail]:
        result = await self.db.execute(
            select(ResumeEvalDetail).where(ResumeEvalDetail.match_id == match_id)
        )
        return result.scalars().all()

    async def get_skill_hits(self, match_id: int) -> list[ResumeSkillHit]:
        result = await self.db.execute(
            select(ResumeSkillHit).where(ResumeSkillHit.match_id == match_id)
        )
        return result.scalars().all()
```

- [ ] **Step 5: Create evaluation service**

```python
# backend/app/services/eval_service.py
from app.repositories.eval_repo import EvalRepository
from app.repositories.resume_repo import ResumeRepository
from app.repositories.job_repo import JobRepository
from app.utils.ai.chains import DimensionEvalChain, SkillHitChain, ComprehensiveEvalChain
from app.core.exceptions import NotFoundError
import logging

logger = logging.getLogger(__name__)


class EvalService:
    def __init__(self, eval_repo: EvalRepository, resume_repo: ResumeRepository, job_repo: JobRepository):
        self.eval_repo = eval_repo
        self.resume_repo = resume_repo
        self.job_repo = job_repo
        self.dimension_chain = DimensionEvalChain()
        self.skill_hit_chain = SkillHitChain()
        self.comprehensive_chain = ComprehensiveEvalChain()

    async def evaluate_resume(self, resume_id: int, job_id: int) -> dict:
        # 获取数据
        resume = await self.resume_repo.get_by_id(resume_id)
        if not resume or not resume.raw_text:
            raise NotFoundError("简历不存在或未解析")
        job = await self.job_repo.get_by_id(job_id)
        if not job:
            raise NotFoundError("岗位不存在")

        # 获取或创建匹配记录
        match = await self.eval_repo.get_match_by_resume_and_job(resume_id, job_id)
        if not match:
            match = await self.eval_repo.create_match(resume_id, job_id)

        # TODO: 获取岗位的评估维度和技能要求
        # 暂时使用模拟数据
        dimensions = [
            {"dimension_name": "技术能力", "weight": 0.4},
            {"dimension_name": "项目经验", "weight": 0.3},
            {"dimension_name": "学历背景", "weight": 0.3}
        ]

        # 评估每个维度
        dimension_results = []
        total_weighted_score = 0
        for dim in dimensions:
            result = self.dimension_chain.evaluate(
                resume_text=resume.raw_text,
                dimension_name=dim["dimension_name"],
                job_name=job.name,
                job_skills=""
            )
            await self.eval_repo.create_eval_detail(
                match_id=match.id,
                dimension_id=0,  # TODO: 实际获取dimension_id
                score=result["score"],
                advantage=result.get("advantage", ""),
                disadvantage=result.get("disadvantage", "")
            )
            dimension_results.append({
                "dimension_name": dim["dimension_name"],
                "score": result["score"],
                "advantage": result.get("advantage", ""),
                "disadvantage": result.get("disadvantage", "")
            })
            total_weighted_score += result["score"] * dim["weight"]

        # 综合评价
        comprehensive = self.comprehensive_chain.evaluate(
            job_name=job.name,
            final_score=total_weighted_score,
            dimensions=dimension_results
        )

        # 确定标签
        label = self._get_label(total_weighted_score)

        # 更新匹配结果
        await self.eval_repo.update_match_result(
            match_id=match.id,
            score=total_weighted_score,
            label=label,
            advantage=comprehensive.get("advantage_comment", ""),
            disadvantage=comprehensive.get("disadvantage_comment", "")
        )

        return {
            "match_id": match.id,
            "final_score": total_weighted_score,
            "final_label": label,
            "dimensions": dimension_results,
            "advantage_comment": comprehensive.get("advantage_comment", ""),
            "disadvantage_comment": comprehensive.get("disadvantage_comment", "")
        }

    def _get_label(self, score: float) -> str:
        if score >= 90:
            return "优秀"
        elif score >= 70:
            return "良好"
        elif score >= 50:
            return "一般"
        return "未达标"

    async def get_evaluation_detail(self, match_id: int) -> dict:
        match = await self.eval_repo.get_match_by_id(match_id)
        if not match:
            raise NotFoundError("评估记录不存在")

        details = await self.eval_repo.get_eval_details(match_id)
        hits = await self.eval_repo.get_skill_hits(match_id)

        return {
            "match_id": match.id,
            "final_score": float(match.final_score),
            "final_label": match.final_label,
            "advantage_comment": match.advantage_comment or "",
            "disadvantage_comment": match.disadvantage_comment or "",
            "dimensions": [
                {
                    "dimension_name": d.dimension_name,
                    "score": float(d.dimension_score),
                    "advantage": d.dimension_advantage or "",
                    "disadvantage": d.dimension_disadvantage or ""
                } for d in details
            ],
            "skill_hits": [
                {
                    "skill_id": h.skill_id,
                    "is_hit": h.is_hit,
                    "hit_context": h.hit_context or ""
                } for h in hits
            ]
        }
```

- [ ] **Step 6: Create evaluation API**

```python
# backend/app/api/v1/employee/evaluations.py
from fastapi import APIRouter, Depends, BackgroundTasks
from pydantic import BaseModel
from app.services.eval_service import EvalService
from app.repositories.eval_repo import EvalRepository
from app.repositories.resume_repo import ResumeRepository
from app.repositories.job_repo import JobRepository
from app.api.deps import get_db, get_current_user

router = APIRouter()


class BatchEvalRequest(BaseModel):
    resume_ids: list[int]
    job_id: int


def get_service(db=Depends(get_db)) -> EvalService:
    return EvalService(
        EvalRepository(db),
        ResumeRepository(db),
        JobRepository(db)
    )


@router.post("/batch")
async def batch_evaluate(
    req: BatchEvalRequest,
    background_tasks: BackgroundTasks,
    service: EvalService = Depends(get_service),
    current_user: dict = Depends(get_current_user)
):
    # TODO: Submit to Celery task
    # background_tasks.add_task(run_evaluation_task, req.resume_ids, req.job_id)
    return {"code": 200, "message": "评估任务已提交", "data": {"count": len(req.resume_ids)}}


@router.get("/{match_id}")
async def get_evaluation(
    match_id: int,
    service: EvalService = Depends(get_service),
    current_user: dict = Depends(get_current_user)
):
    result = await service.get_evaluation_detail(match_id)
    return {"code": 200, "message": "success", "data": result}


@router.get("/{match_id}/skill-hits")
async def get_skill_hits(
    match_id: int,
    service: EvalService = Depends(get_service),
    current_user: dict = Depends(get_current_user)
):
    result = await service.get_evaluation_detail(match_id)
    return {"code": 200, "message": "success", "data": result["skill_hits"]}
```

- [ ] **Step 7: Create Celery task**

```python
# backend/celery_app/celery.py
from celery import Celery
from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "resume_platform",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=["celery_app.tasks.eval_task"]
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Shanghai",
    enable_utc=True,
    task_routes={
        "celery_app.tasks.eval_task.*": {"queue": "eval"}
    }
)
```

```python
# backend/celery_app/tasks/eval_task.py
from celery_app.celery import celery_app
from app.models import async_session
from app.services.eval_service import EvalService
from app.repositories.eval_repo import EvalRepository
from app.repositories.resume_repo import ResumeRepository
from app.repositories.job_repo import JobRepository
import logging

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def run_evaluation_task(self, resume_ids: list[int], job_id: int):
    try:
        async with async_session() as db:
            service = EvalService(
                EvalRepository(db),
                ResumeRepository(db),
                JobRepository(db)
            )
            results = []
            for resume_id in resume_ids:
                try:
                    result = await service.evaluate_resume(resume_id, job_id)
                    results.append(result)
                except Exception as e:
                    logger.error(f"评估简历 {resume_id} 失败: {e}")
            return results
    except Exception as e:
        logger.error(f"批量评估任务失败: {e}")
        raise self.retry(exc=e)
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add AI evaluation module with LiteLLM integration"
```

---

## Phase 7: Frontend UI Components & Pages

### 7.1 shadcn/ui Components & Common Components

**Files:**
- Create: `frontend/src/components/ui/button.tsx`
- Create: `frontend/src/components/ui/card.tsx`
- Create: `frontend/src/components/ui/dialog.tsx`
- Create: `frontend/src/components/ui/input.tsx`
- Create: `frontend/src/components/ui/label.tsx`
- Create: `frontend/src/components/common/skill-tag.tsx`
- Create: `frontend/src/components/common/match-badge.tsx`
- Create: `frontend/src/components/common/radar-chart.tsx`
- Create: `frontend/src/components/common/pie-chart.tsx`

- [ ] **Step 1: Create basic UI components**

```tsx
// frontend/src/components/ui/button.tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-white hover:bg-primary/90",
        outline: "border border-primary text-primary hover:bg-primary/10",
        ghost: "hover:bg-primary/10",
        danger: "bg-danger text-white hover:bg-danger/90",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-12 px-6",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={clsx(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
```

```tsx
// frontend/src/components/ui/card.tsx
import * as React from "react";
import { clsx } from "clsx";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        "rounded-lg border bg-card text-card-foreground shadow-sm",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx("flex flex-col space-y-1.5 p-6", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={clsx("text-lg font-semibold leading-none tracking-tight", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx("p-6 pt-0", className)} {...props} />;
}
```

```tsx
// frontend/src/components/ui/dialog.tsx
import * as React from "react";
import { clsx } from "clsx";

interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={() => onOpenChange?.(false)} />
      <div className="relative z-50 bg-white rounded-lg shadow-lg max-w-lg w-full mx-4">
        {children}
      </div>
    </div>
  );
}

export function DialogContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx("p-6", className)}>{children}</div>;
}

export function DialogTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={clsx("text-lg font-semibold mb-4", className)}>{children}</h2>;
}
```

```tsx
// frontend/src/components/ui/input.tsx
import * as React from "react";
import { clsx } from "clsx";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={clsx(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
```

```tsx
// frontend/src/components/ui/label.tsx
import * as React from "react";
import { clsx } from "clsx";

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {}

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={clsx(
        "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className
      )}
      {...props}
    />
  )
);
Label.displayName = "Label";

export { Label };
```

- [ ] **Step 2: Create skill-tag component**

```tsx
// frontend/src/components/common/skill-tag.tsx
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

interface SkillTagProps {
  skill: string;
  type: "必须满足" | "优先匹配" | "普通技能";
  matchLabel?: string;
  hitContext?: string;
  isHit?: boolean;
}

export function SkillTag({ skill, type, matchLabel, hitContext, isHit }: SkillTagProps) {
  const [showDialog, setShowDialog] = useState(false);

  const bgColor = {
    "必须满足": isHit ? "bg-success/20 text-success" : "bg-danger/20 text-danger",
    "优先匹配": isHit ? "bg-primary/20 text-primary" : "bg-secondary/20 text-secondary",
    "普通技能": isHit ? "bg-warning/20 text-warning" : "bg-secondary/20 text-secondary",
  }[type];

  return (
    <>
      <button
        onClick={() => hitContext && setShowDialog(true)}
        className={`px-3 py-1 rounded-full text-sm ${bgColor} ${hitContext ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
      >
        {skill} {isHit ? "✓" : "✗"}
      </button>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogTitle>技能详情: {skill}</DialogTitle>
          <div className="space-y-2">
            <p><span className="font-medium">类型:</span> {type}</p>
            <p><span className="font-medium">匹配度:</span> {matchLabel || (isHit ? "命中" : "未命中")}</p>
            {hitContext && (
              <div>
                <p className="font-medium mb-1">命中片段:</p>
                <p className="text-gray-600 bg-gray-50 p-3 rounded">{hitContext}</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 3: Create radar chart component**

```tsx
// frontend/src/components/common/radar-chart.tsx
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer } from "recharts";

interface RadarChartProps {
  data: { dimension: string; score: number }[];
}

export function EvaluationRadarChart({ data }: RadarChartProps) {
  const chartData = data.map((d) => ({
    dimension: d.dimension,
    score: d.score,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <RadarChart data={chartData}>
        <PolarGrid />
        <PolarAngleAxis dataKey="dimension" />
        <Radar
          name="得分"
          dataKey="score"
          stroke="#2563EB"
          fill="#2563EB"
          fillOpacity={0.5}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 4: Create pie chart component**

```tsx
// frontend/src/components/common/pie-chart.tsx
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

interface PieChartProps {
  data: { name: string; value: number; color: string }[];
}

export function MatchDistributionPie({ data }: PieChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={100}
          paddingAngle={5}
          dataKey="value"
          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add frontend UI components (button, card, dialog, charts)"
```

---

### 7.2 Frontend Pages Implementation

**Files (selected key pages):**
- Modify: `frontend/src/pages/user/login.tsx`
- Modify: `frontend/src/pages/user/jobs.tsx`
- Modify: `frontend/src/pages/user/application-detail.tsx`
- Modify: `frontend/src/pages/employee/evaluations.tsx`
- Modify: `frontend/src/pages/employee/eval-detail.tsx`

- [ ] **Step 1: Implement user login page**

```tsx
// frontend/src/pages/user/login.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import userAuthApi from "@/api/user/auth";
import { useAuthStore } from "@/store/auth";

export default function UserLogin() {
  const navigate = useNavigate();
  const { setTokens, setUserInfo } = useAuthStore();
  const [loginType, setLoginType] = useState<"password" | "code">("password");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await userAuthApi.login({
        identifier,
        login_type: loginType,
        password: loginType === "password" ? password : undefined,
        code: loginType === "code" ? code : undefined,
      });
      setTokens(res.data.access_token, res.data.refresh_token);
      setUserInfo("user", res.data.user_id);
      navigate("/user/jobs");
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>用户登录</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex gap-2 mb-4">
              <button
                type="button"
                onClick={() => setLoginType("password")}
                className={`px-4 py-2 rounded ${loginType === "password" ? "bg-primary text-white" : "bg-gray-100"}`}
              >
                密码登录
              </button>
              <button
                type="button"
                onClick={() => setLoginType("code")}
                className={`px-4 py-2 rounded ${loginType === "code" ? "bg-primary text-white" : "bg-gray-100"}`}
              >
                验证码登录
              </button>
            </div>

            <div>
              <Label htmlFor="identifier">用户名/邮箱</Label>
              <Input
                id="identifier"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="请输入用户名或邮箱"
              />
            </div>

            {loginType === "password" ? (
              <div>
                <Label htmlFor="password">密码</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            ) : (
              <div>
                <Label htmlFor="code">验证码</Label>
                <div className="flex gap-2">
                  <Input
                    id="code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="请输入验证码"
                  />
                  <Button type="button" variant="outline">获取验证码</Button>
                </div>
              </div>
            )}

            <Button type="submit" className="w-full">登录</Button>

            <p className="text-center text-sm">
              还没有账号? <a href="/user/register" className="text-primary">立即注册</a>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Implement user jobs list page**

```tsx
// frontend/src/pages/user/jobs.tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import userJobsApi from "@/api/user/jobs";

interface Job {
  id: number;
  name: string;
  description: string;
  dept_name: string;
  create_time: string;
}

export default function UserJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    userJobsApi.list().then((res) => {
      setJobs(res.data.items);
      setLoading(false);
    });
  }, []);

  if (loading) return <div>加载中...</div>;

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-6">招聘岗位</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {jobs.map((job) => (
          <Card key={job.id}>
            <CardHeader>
              <CardTitle>{job.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-secondary mb-2">{job.dept_name}</p>
              <p className="text-sm text-gray-600 line-clamp-3 mb-4">
                {job.description || "暂无岗位描述"}
              </p>
              <Link to={`/user/jobs/${job.id}`}>
                <button className="px-4 py-2 bg-primary text-white rounded hover:bg-primary/90">
                  查看详情
                </button>
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Implement user application detail page (with evaluation status)**

```tsx
// frontend/src/pages/user/application-detail.tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { EvaluationRadarChart } from "@/components/common/radar-chart";
import { SkillTag } from "@/components/common/skill-tag";
import userApplicationsApi from "@/api/user/applications";

export default function UserApplicationDetail() {
  const { id } = useParams();
  const [application, setApplication] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    userApplicationsApi.get(Number(id)).then((res) => {
      setApplication(res.data);
      setLoading(false);
    });
  }, [id]);

  if (loading) return <div>加载中...</div>;

  const isEvaluated = application?.status === 2 && application?.evaluation;

  return (
    <div className="container mx-auto py-8">
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>投递详情</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <p><span className="font-medium">岗位:</span> {application?.job_name}</p>
            <p><span className="font-medium">投递时间:</span> {application?.create_time}</p>
            <p><span className="font-medium">简历:</span> {application?.resume_name}</p>
            <p><span className="font-medium">状态:</span> {application?.status_name}</p>
          </div>
        </CardContent>
      </Card>

      {!isEvaluated ? (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="text-4xl mb-4">⏳</div>
            <p className="text-lg text-secondary">评审还在进行中，请耐心等待</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-primary text-white rounded hover:bg-primary/90"
            >
              刷新状态
            </button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>匹配度评估</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <span className="text-3xl font-bold">{application.evaluation.final_score}</span>
                <span className="text-lg text-secondary">/100</span>
                <span className={`ml-4 px-3 py-1 rounded-full text-sm ${
                  application.evaluation.final_label === "优秀" ? "bg-success/20 text-success" :
                  application.evaluation.final_label === "良好" ? "bg-primary/20 text-primary" :
                  application.evaluation.final_label === "一般" ? "bg-warning/20 text-warning" :
                  "bg-danger/20 text-danger"
                }`}>
                  {application.evaluation.final_label}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 mb-6">
                <div
                  className="bg-primary h-2 rounded-full"
                  style={{ width: `${application.evaluation.final_score}%` }}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle>多维度得分</CardTitle>
            </CardHeader>
            <CardContent>
              <EvaluationRadarChart data={application.evaluation.dimensions} />
            </CardContent>
          </Card>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle>优缺点评价</CardTitle>
            </CardHeader>
            <CardContent>
              {application.evaluation.advantage_comment && (
                <div className="mb-4">
                  <p className="font-medium text-success mb-1">优点:</p>
                  <p className="text-gray-700">{application.evaluation.advantage_comment}</p>
                </div>
              )}
              <div>
                <p className="font-medium text-danger mb-1">缺点:</p>
                <p className="text-gray-700">
                  {application.evaluation.disadvantage_comment || "这份好像挺符合岗位预期"}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>技能匹配</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {application.evaluation.skill_hits?.map((hit: any, idx: number) => (
                  <SkillTag
                    key={idx}
                    skill={hit.skill_name}
                    type={hit.skill_type === 1 ? "必须满足" : hit.skill_type === 2 ? "优先匹配" : "普通技能"}
                    isHit={hit.is_hit}
                    matchLabel={hit.match_label}
                    hitContext={hit.hit_context}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Implement employee evaluations batch page**

```tsx
// frontend/src/pages/employee/evaluations.tsx
import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import employeeEvaluationsApi from "@/api/employee/evaluations";

interface Resume {
  id: number;
  user_name: string;
  file_name: string;
  create_time: string;
}

export default function EmployeeEvaluations() {
  const [selectedResumes, setSelectedResumes] = useState<number[]>([]);
  const [jobId, setJobId] = useState<number>(1); // TODO: Select from job list

  const handleToggle = (resumeId: number) => {
    setSelectedResumes((prev) =>
      prev.includes(resumeId)
        ? prev.filter((id) => id !== resumeId)
        : [...prev, resumeId]
    );
  };

  const handleBatchEvaluate = async () => {
    if (selectedResumes.length === 0 || !jobId) return;
    try {
      await employeeEvaluationsApi.batchEvaluate({
        resume_ids: selectedResumes,
        job_id: jobId,
      });
      alert("评估任务已提交");
      setSelectedResumes([]);
    } catch (error) {
      console.error("批量评估失败:", error);
    }
  };

  return (
    <div className="container mx-auto py-8">
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>批量评估</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-secondary mb-4">
            选择简历和目标岗位，点击"开始评估"触发AI评估流程
          </p>
          <div className="flex gap-4 items-center mb-6">
            <span>目标岗位ID:</span>
            <input
              type="number"
              value={jobId}
              onChange={(e) => setJobId(Number(e.target.value))}
              className="border rounded px-3 py-2 w-32"
            />
          </div>
          <Button
            onClick={handleBatchEvaluate}
            disabled={selectedResumes.length === 0}
          >
            开始评估 ({selectedResumes.length})
          </Button>
        </CardContent>
      </Card>

      {/* TODO: Add resume list with checkboxes */}
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add frontend pages with evaluation UI"
```

---

## Implementation Order

1. **Phase 1**: Project Scaffolding (backend + frontend)
2. **Phase 2**: Authentication Module
3. **Phase 3**: Resume & Storage Module
4. **Phase 4**: Job Module
5. **Phase 5**: Application Module
6. **Phase 6**: AI Evaluation Module
7. **Phase 7**: Frontend UI Components & Pages

Each phase should be tested independently before moving to the next.

---

## Spec Coverage Check

- ✅ User registration with email code
- ✅ User login (password/code) - using login_type field
- ✅ Employee login (emp_no/email + password/code) - using login_type field
- ✅ Job browse (user)
- ✅ Job CRUD (employee)
- ✅ AI skill suggestion (employee only)
- ✅ Resume upload with storage strategy
- ✅ Job application (user)
- ✅ AI evaluation (employee only, batch)
- ✅ Match detail with advantage/disadvantage
- ✅ Skill hit with context
- ✅ Visualization (radar + pie charts)
- ✅ User sees "评审还在进行中" when not evaluated

---

**Plan complete.** Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
