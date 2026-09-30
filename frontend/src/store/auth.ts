import { create } from "zustand";
import { AuthInfo, Role, setToken } from "../api/client";

interface AuthState extends AuthInfo {
  setAuth: (a: Partial<AuthInfo>) => void;
  logout: () => void;
  restore: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  token: null, role: null, userId: null, email: null,
  setAuth: (a) => {
    if (a.token) setToken(a.token);
    set((s) => ({ ...s, ...a }));
  },
  logout: () => {
    setToken(null);
    set({ token: null, role: null, userId: null, email: null });
  },
  restore: () => {
    // No-op: tokens from localStorage are attached by axios interceptor.
  },
}));
