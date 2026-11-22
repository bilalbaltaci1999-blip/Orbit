import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { UserProfile, UserSettings } from '../shared/types.ts';
import { apiFetch, getStoredToken, setStoredToken } from './api.ts';
import { signOutFirebase } from './firebase.ts';
import { wsClient } from './wsClient.ts';

interface AuthContextValue {
  profile: UserProfile | null;
  settings: UserSettings | null;
  pendingVerificationToken: string | null;
  loading: boolean;
  setSession: (token: string, profile: UserProfile, settings: UserSettings, verificationToken?: string | null) => void;
  refreshMe: () => Promise<void>;
  updateProfileState: (profile: UserProfile) => void;
  updateSettingsState: (settings: UserSettings) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function applyThemeAndAccessibility(settings: UserSettings | null) {
  const root = document.documentElement;
  const theme = settings?.theme || 'dark';
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
  const isDark = theme === 'dark' || (theme === 'system' && prefersDark);
  root.classList.toggle('dark', isDark);

  root.classList.toggle('reduce-motion', Boolean(settings?.reducedMotion));

  const sizeMap = { sm: '14px', md: '15px', lg: '17px' };
  root.style.fontSize = sizeMap[settings?.fontSize || 'md'];
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [pendingVerificationToken, setPendingVerificationToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshMe = useCallback(async () => {
    try {
      const data = await apiFetch<{
        profile: UserProfile;
        settings: UserSettings;
        pendingVerificationToken?: string | null;
      }>('/auth/me');
      setProfile(data.profile);
      setSettings(data.settings);
      setPendingVerificationToken(data.pendingVerificationToken || null);
      applyThemeAndAccessibility(data.settings);
      wsClient.connect();
    } catch {
      setProfile(null);
      setSettings(null);
      setStoredToken(null);
      wsClient.disconnect();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (getStoredToken()) {
      void refreshMe();
    } else {
      // Check cookie session as fallback
      void refreshMe();
    }
  }, [refreshMe]);

  useEffect(() => {
    applyThemeAndAccessibility(settings);
  }, [settings]);

  const setSession = useCallback(
    (token: string, nextProfile: UserProfile, nextSettings: UserSettings, verificationToken?: string | null) => {
      setStoredToken(token);
      setProfile(nextProfile);
      setSettings(nextSettings);
      if (verificationToken !== undefined) {
        setPendingVerificationToken(verificationToken);
      }
      applyThemeAndAccessibility(nextSettings);
      wsClient.connect();
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {
      // Ignore
    }
    try {
      await signOutFirebase();
    } catch {
      // Ignore
    }
    setStoredToken(null);
    wsClient.disconnect();
    setProfile(null);
    setSettings(null);
    setPendingVerificationToken(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        profile,
        settings,
        pendingVerificationToken,
        loading,
        setSession,
        refreshMe,
        updateProfileState: setProfile,
        updateSettingsState: setSettings,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
