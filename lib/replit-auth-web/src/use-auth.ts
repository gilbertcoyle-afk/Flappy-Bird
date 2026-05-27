import { useState, useEffect, useCallback } from "react";
import type { AuthUser } from "@workspace/api-client-react";

export type { AuthUser };

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<{ error?: string }>;
  register: (username: string, password: string) => Promise<{ error?: string }>;
  logout: () => Promise<void>;
  refetch: () => void;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    fetch("/api/auth/user", { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ user: AuthUser | null }>;
      })
      .then((data) => {
        if (!cancelled) {
          setUser(data.user ?? null);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
          setIsLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, []);

  const refetch = useCallback(() => {
    fetch("/api/auth/user", { credentials: "include" })
      .then((res) => res.json() as Promise<{ user: AuthUser | null }>)
      .then((data) => setUser(data.user ?? null))
      .catch(() => setUser(null));
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<{ error?: string }> => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json() as { error?: string; user?: AuthUser };
      if (!res.ok) return { error: data.error ?? "Login failed" };
      if (data.user) setUser(data.user as AuthUser);
      return {};
    } catch {
      return { error: "Network error" };
    }
  }, []);

  const register = useCallback(async (username: string, password: string): Promise<{ error?: string }> => {
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json() as { error?: string; user?: AuthUser };
      if (!res.ok) return { error: data.error ?? "Registration failed" };
      if (data.user) setUser(data.user as AuthUser);
      return {};
    } catch {
      return { error: "Network error" };
    }
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
  }, []);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    register,
    logout,
    refetch,
  };
}
