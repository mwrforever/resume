import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  userType: 'user' | 'employee' | null;
  userId: string | null;
  /** 当前员工是否管理员（控制侧边栏管理类菜单显隐）；user 端恒为 false */
  isAdmin: boolean;
  setTokens: (access: string, refresh: string) => void;
  setUserInfo: (userType: 'user' | 'employee', userId: string, isAdmin?: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      userType: null,
      userId: null,
      isAdmin: false,
      setTokens: (access, refresh) => set({ accessToken: access, refreshToken: refresh }),
      setUserInfo: (userType, userId, isAdmin = false) => set({ userType, userId, isAdmin }),
      logout: () => {
        // 先保存用户类型，清除状态后用于跳转到对应登录页
        const currentType = useAuthStore.getState().userType;
        set({ accessToken: null, refreshToken: null, userType: null, userId: null, isAdmin: false });
        const loginPath = currentType === 'employee' ? '/employee/login' : '/user/login';
        window.location.href = loginPath;
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        userType: state.userType,
        userId: state.userId,
        isAdmin: state.isAdmin,
      }),
    }
  )
);
