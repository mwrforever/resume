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
    {
      name: 'auth-storage',
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        userType: state.userType,
        userId: state.userId,
      }),
    }
  )
);
