import React from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './client/AuthContext.tsx';
import { ErrorBoundary } from './client/ErrorBoundary.tsx';
import { ToastProvider } from './client/ToastContext.tsx';
import { VoiceProvider } from './client/VoiceContext.tsx';
import { AuthScreen } from './components/AuthPages.tsx';
import { InviteAcceptView } from './components/FriendsAndDiscoverView.tsx';
import { OrbitLogo } from './components/OrbitLogo.tsx';
import { OrbitWorkspace } from './components/OrbitWorkspace.tsx';

function LoadingScreen() {
  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-[#F7F8FC] dark:bg-[#0B0B12] text-slate-900 dark:text-[#F8FAFC] gap-4">
      <div className="relative flex items-center justify-center">
        <div className="absolute -inset-4 rounded-full bg-[#7C3AED]/20 blur-xl animate-pulse" />
        <OrbitLogo size={56} className="relative" />
      </div>
      <p className="text-sm font-medium text-slate-500 dark:text-[#A1A1B5]">ORBIT yükleniyor...</p>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!profile) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (profile) return <Navigate to="/channels/@me" replace />;
  return <>{children}</>;
}

function InviteRouteWrapper() {
  const navigate = useNavigate();
  return <InviteAcceptView onJoined={(serverId) => navigate(`/channels/${serverId}`)} />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <VoiceProvider>
            <BrowserRouter>
            <Routes>
              <Route
                path="/login"
                element={
                  <PublicOnlyRoute>
                    <AuthScreen initialMode="login" />
                  </PublicOnlyRoute>
                }
              />
              <Route
                path="/register"
                element={
                  <PublicOnlyRoute>
                    <AuthScreen initialMode="register" />
                  </PublicOnlyRoute>
                }
              />
              <Route
                path="/reset-password"
                element={
                  <PublicOnlyRoute>
                    <AuthScreen initialMode="reset" />
                  </PublicOnlyRoute>
                }
              />
              <Route
                path="/invite/:code"
                element={
                  <ProtectedRoute>
                    <InviteRouteWrapper />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/discover"
                element={
                  <ProtectedRoute>
                    <OrbitWorkspace viewMode="discover" />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/channels/@me"
                element={
                  <ProtectedRoute>
                    <OrbitWorkspace viewMode="home" />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/channels/@me/:conversationId"
                element={
                  <ProtectedRoute>
                    <OrbitWorkspace viewMode="home" />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/channels/:serverId"
                element={
                  <ProtectedRoute>
                    <OrbitWorkspace viewMode="server" />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/channels/:serverId/:channelId"
                element={
                  <ProtectedRoute>
                    <OrbitWorkspace viewMode="server" />
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<Navigate to="/channels/@me" replace />} />
            </Routes>
            </BrowserRouter>
          </VoiceProvider>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
