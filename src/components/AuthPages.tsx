import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  Crown,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  Loader2,
  Lock,
  Mail,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { apiFetch, ApiError, setStoredToken } from '../client/api.ts';
import { useAuth } from '../client/AuthContext.tsx';
import { signInWithFirebaseGoogle, syncUserToFirestore } from '../client/firebase.ts';
import { useToast } from '../client/ToastContext.tsx';
import type { UserProfile, UserSettings } from '../shared/types.ts';
import { OrbitLogo } from './OrbitLogo.tsx';

type AuthMode = 'login' | 'register' | 'reset' | 'founder_activate' | 'two_factor';
type ResetStep = 'request' | 'verify' | 'done';
type FieldErrors = Record<string, string>;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AuthScreen({ initialMode = 'login' }: { initialMode?: 'login' | 'register' | 'reset' }) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const { setSession } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlResetToken = (searchParams.get('token') || searchParams.get('resetToken') || '').trim();

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // Founder quick-activation status
  const [founderStatus, setFounderStatus] = useState<{ emailHint: string; needsActivation: boolean } | null>(null);

  // Username availability check
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);

  // Password reset state (distinct Cyan / Sapphire flow)
  const [resetStep, setResetStep] = useState<ResetStep>(urlResetToken ? 'verify' : 'request');
  const [resetToken, setResetToken] = useState(urlResetToken);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [issuedResetToken, setIssuedResetToken] = useState<string | null>(null);
  const [issuedResetLink, setIssuedResetLink] = useState<string | null>(null);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [resetTokenValidating, setResetTokenValidating] = useState(false);
  const [resetTokenValid, setResetTokenValid] = useState<boolean | null>(null);
  const [resetTokenEmailHint, setResetTokenEmailHint] = useState<string | null>(null);
  const [resetTokenError, setResetTokenError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [copiedResetItem, setCopiedResetItem] = useState<'link' | 'code' | null>(null);

  // Two-factor authentication login challenge
  const [twoFactorChallenge, setTwoFactorChallenge] = useState<{ challengeToken: string; userHint: string } | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [googleConfigured, setGoogleConfigured] = useState<boolean>(true);
  const [googleMode, setGoogleMode] = useState<'firebase' | 'oauth' | 'none'>('firebase');
  const [googleLoading, setGoogleLoading] = useState(false);

  const clearFieldError = (field: string) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  useEffect(() => {
    setMode(initialMode);
    setError('');
    setFieldErrors({});
  }, [initialMode]);

  // Auto-validate ?token=... when opening /reset-password?token=...
  useEffect(() => {
    if (initialMode !== 'reset' || !urlResetToken) return;
    setMode('reset');
    setResetStep('verify');
    setResetToken(urlResetToken);
    setResetTokenValidating(true);
    setResetTokenError('');
    apiFetch<{ valid: boolean; emailHint?: string; error?: string }>(
      `/auth/reset-password/validate?token=${encodeURIComponent(urlResetToken)}`
    )
      .then((res) => {
        setResetTokenValid(Boolean(res.valid));
        setResetTokenEmailHint(res.emailHint || null);
      })
      .catch((err) => {
        setResetTokenValid(false);
        setResetTokenError(
          err instanceof ApiError ? err.message : 'Şifre sıfırlama bağlantısı geçersiz veya süresi dolmuş.'
        );
      })
      .finally(() => {
        setResetTokenValidating(false);
      });
  }, [initialMode, urlResetToken]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = window.setTimeout(() => setResendCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [resendCooldown]);

  useEffect(() => {
    apiFetch<{ emailHint: string; needsActivation: boolean }>('/auth/founder-status')
      .then((res) => setFounderStatus(res))
      .catch(() => {});
    apiFetch<{ configured: boolean; mode?: 'firebase' | 'oauth' | 'none' }>('/auth/google/status')
      .then((res) => {
        setGoogleConfigured(Boolean(res.configured));
        if (res.mode) setGoogleMode(res.mode);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handleGoogleMessage = async (event: MessageEvent) => {
      const origin = event.origin || '';
      const isTrustedOrigin =
        origin === window.location.origin ||
        origin.endsWith('.run.app') ||
        origin.includes('localhost') ||
        origin.includes('127.0.0.1');
      if (!isTrustedOrigin) return;

      const data = event.data as { type?: string; token?: string; error?: string } | null;
      if (!data) return;

      if (data.type === 'ORBIT_GOOGLE_AUTH_ERROR') {
        setGoogleLoading(false);
        setError(data.error || 'Google ile giriş tamamlanamadı.');
        return;
      }

      if (data.type === 'ORBIT_GOOGLE_AUTH_SUCCESS' && data.token) {
        try {
          setStoredToken(data.token);
          const meRes = await apiFetch<{
            profile: UserProfile;
            settings: UserSettings;
            pendingVerificationToken?: string | null;
          }>('/auth/me');
          setSession(data.token, meRes.profile, meRes.settings, meRes.pendingVerificationToken);
          showToast(`Google ile hoş geldiniz, ${meRes.profile.displayName}.`, 'success');
          navigate('/channels/@me');
        } catch (err) {
          setStoredToken(null);
          setError(err instanceof ApiError ? err.message : 'Google oturumu doğrulanamadı.');
        } finally {
          setGoogleLoading(false);
        }
      }
    };

    window.addEventListener('message', handleGoogleMessage);
    return () => window.removeEventListener('message', handleGoogleMessage);
  }, [navigate, setSession, showToast]);

  useEffect(() => {
    if (mode !== 'register' || username.trim().length < 3) {
      setUsernameAvailable(null);
      return;
    }
    const timer = window.setTimeout(async () => {
      setCheckingUsername(true);
      try {
        const res = await apiFetch<{ available: boolean }>(
          `/users/check-username?username=${encodeURIComponent(username.trim())}`
        );
        setUsernameAvailable(res.available);
      } catch {
        setUsernameAvailable(null);
      } finally {
        setCheckingUsername(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [username, mode]);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError('');
    setFieldErrors({});
    if (nextMode === 'reset') {
      setResetStep(urlResetToken ? 'verify' : 'request');
      setResetTokenValid(null);
      setResetTokenError('');
      setNewPassword('');
      setConfirmNewPassword('');
      navigate('/reset-password');
      return;
    }
    if (nextMode === 'login') navigate('/login');
    else if (nextMode === 'register') navigate('/register');
  };

  const handleGoogleConnect = async () => {
    setError('');
    setGoogleLoading(true);
    try {
      if (googleMode === 'firebase' || googleMode === 'none') {
        const { idToken } = await signInWithFirebaseGoogle();
        const res = await apiFetch<{
          token: string;
          profile: UserProfile;
          settings: UserSettings;
        }>('/auth/firebase-google', {
          method: 'POST',
          body: JSON.stringify({ idToken }),
        });
        setSession(res.token, res.profile, res.settings);
        void syncUserToFirestore(res.profile, res.settings).catch(() => {});
        showToast(`Google ile hoş geldiniz, ${res.profile.displayName}.`, 'success');
        navigate('/channels/@me');
        setGoogleLoading(false);
        return;
      }

      const res = await apiFetch<{ url: string }>(`/auth/google/url?origin=${encodeURIComponent(window.location.origin)}`);
      const w = 520;
      const h = 650;
      const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - w) / 2));
      const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - h) / 2));
      const popup = window.open(
        res.url,
        'orbit_google_oauth',
        `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`
      );
      if (!popup) {
        setGoogleLoading(false);
        setError('Açılır pencere (popup) tarayıcınız tarafından engellendi. Lütfen bu site için açılır pencerelere izin verin.');
        return;
      }
      const watchClosed = window.setInterval(() => {
        if (popup.closed) {
          window.clearInterval(watchClosed);
          setGoogleLoading(false);
        }
      }, 600);
    } catch (err: unknown) {
      setGoogleLoading(false);
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setError('Google oturum açma penceresi kapatıldı.');
      } else if (code === 'auth/popup-blocked') {
        setError('Açılır pencere tarayıcınız tarafından engellendi. Lütfen popup izni verin.');
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Google ile giriş başlatılamadı.');
      }
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const errs: FieldErrors = {};
    if (!email.trim()) {
      errs.email = 'Lütfen e-posta adresinizi girin.';
    } else if (!EMAIL_REGEX.test(email.trim())) {
      errs.email = 'Geçerli bir e-posta adresi girin.';
    }
    if (!password) {
      errs.password = 'Lütfen şifrenizi girin.';
    }
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setError('Lütfen işaretli zorunlu alanları doldurun.');
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      const res = await apiFetch<{
        token?: string;
        profile?: UserProfile;
        settings?: UserSettings;
        requiresTwoFactor?: boolean;
        challengeToken?: string;
        userHint?: string;
      }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      });

      if (res.requiresTwoFactor && res.challengeToken) {
        setTwoFactorChallenge({
          challengeToken: res.challengeToken,
          userHint: res.userHint || email.trim(),
        });
        setTwoFactorCode('');
        setFieldErrors({});
        setMode('two_factor');
        showToast('İki adımlı doğrulama kodu gerekli.', 'info');
        return;
      }

      if (res.token && res.profile && res.settings) {
        setSession(res.token, res.profile, res.settings);
        showToast(`Hoş geldiniz, ${res.profile.displayName}.`, 'success');
        navigate('/channels/@me');
      }
    } catch (err) {
      if (err instanceof ApiError && (err.data as { needsFounderActivation?: boolean })?.needsFounderActivation) {
        setMode('founder_activate');
        setDisplayName('Bilal (Kurucu)');
        setPassword('');
        setError('');
        setFieldErrors({});
        showToast('Kurucu hesabınız hazır! İlk kullanım şifrenizi belirleyin.', 'info');
      } else {
        setError(err instanceof ApiError ? err.message : 'Giriş yapılamadı. Bilgilerinizi kontrol edin.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyTwoFactor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!twoFactorChallenge) return;
    setError('');
    if (!twoFactorCode.trim()) {
      setFieldErrors({ twoFactorCode: 'Lütfen 6 haneli doğrulama veya kurtarma kodunu girin.' });
      setError('Doğrulama kodu alanı boş bırakılamaz.');
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      const res = await apiFetch<{ token: string; profile: UserProfile; settings: UserSettings }>('/auth/login/2fa', {
        method: 'POST',
        body: JSON.stringify({
          challengeToken: twoFactorChallenge.challengeToken,
          code: twoFactorCode.trim(),
        }),
      });
      setSession(res.token, res.profile, res.settings);
      setTwoFactorChallenge(null);
      showToast(`Hoş geldiniz, ${res.profile.displayName}.`, 'success');
      navigate('/channels/@me');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Doğrulama kodu geçersiz.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleActivateFounder = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const effectiveEmail = (email || founderStatus?.emailHint || '').trim();
    const errs: FieldErrors = {};
    if (!effectiveEmail) errs.email = 'Kurucu e-posta adresi gereklidir.';
    if (displayName.trim().length < 2) errs.displayName = 'Görünen ad en az 2 karakter olmalıdır.';
    if (password.length < 8) errs.password = 'Kurucu şifreniz en az 8 karakter olmalıdır.';
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setError('Lütfen eksik veya geçersiz alanları düzeltin.');
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      const res = await apiFetch<{ token: string; profile: UserProfile; settings: UserSettings }>(
        '/auth/activate-founder',
        {
          method: 'POST',
          body: JSON.stringify({
            email: effectiveEmail,
            password,
            displayName: displayName.trim() || 'Bilal (Kurucu)',
          }),
        }
      );
      setSession(res.token, res.profile, res.settings);
      showToast('Kurucu hesabınız aktifleştirildi. Hoş geldiniz!', 'success');
      navigate('/channels/@me');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kurucu hesabı aktifleştirilemedi.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const errs: FieldErrors = {};
    if (!email.trim()) {
      errs.email = 'Lütfen e-posta adresinizi girin.';
    } else if (!EMAIL_REGEX.test(email.trim())) {
      errs.email = 'Geçerli bir e-posta adresi girin.';
    }
    if (displayName.trim().length < 2) {
      errs.displayName = 'Görünen ad en az 2 karakter olmalıdır.';
    }
    if (username.trim().length < 3) {
      errs.username = 'Kullanıcı adı en az 3 karakter olmalıdır.';
    }
    if (password.length < 8) {
      errs.password = 'Şifreniz en az 8 karakter olmalıdır.';
    }
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setError('Lütfen işaretli zorunlu alanları doldurun.');
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      const res = await apiFetch<{
        token: string;
        profile: UserProfile;
        settings: UserSettings;
        verificationToken: string | null;
      }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim(),
          username: username.trim(),
          displayName: displayName.trim(),
          password,
        }),
      });
      setSession(res.token, res.profile, res.settings, res.verificationToken);
      showToast('ORBIT hesabınız oluşturuldu.', 'success');
      navigate('/channels/@me');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kayıt tamamlanamadı.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestReset = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError('');
    setResetTokenError('');
    if (!email.trim()) {
      setFieldErrors({ email: 'Lütfen kayıtlı e-posta adresinizi girin.' });
      setError('E-posta adresi boş bırakılamaz.');
      return;
    }
    if (!EMAIL_REGEX.test(email.trim())) {
      setFieldErrors({ email: 'Geçerli bir e-posta adresi girin.' });
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      const res = await apiFetch<{
        ok: boolean;
        message?: string;
        emailSent: boolean;
        smtpConfigured: boolean;
        resetToken: string | null;
        resetLink: string | null;
      }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      });

      setResetEmailSent(Boolean(res.emailSent));
      setIssuedResetToken(res.resetToken || null);
      setIssuedResetLink(res.resetLink || null);
      if (res.resetToken) {
        setResetToken(res.resetToken);
        setResetTokenValid(true);
      } else {
        setResetToken('');
        setResetTokenValid(null);
      }
      setResetStep('verify');
      setResendCooldown(30);
      showToast(
        res.emailSent
          ? 'Şifre sıfırlama bağlantısı e-posta adresinize gönderildi.'
          : 'Şifre sıfırlama bağlantısı ve kodu hazırlandı.',
        res.emailSent ? 'success' : 'info'
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'İstek gönderilemedi.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const errs: FieldErrors = {};
    if (!resetToken.trim()) errs.resetToken = 'Lütfen e-postadaki sıfırlama kodunu girin.';
    if (newPassword.length < 8) errs.newPassword = 'Yeni şifre en az 8 karakter olmalıdır.';
    if (confirmNewPassword && confirmNewPassword !== newPassword) {
      errs.confirmNewPassword = 'Yeni şifreler eşleşmiyor.';
    }
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setError('Lütfen işaretli alanları kontrol edin.');
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      await apiFetch('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: resetToken.trim(), newPassword }),
      });
      showToast('Şifreniz başarıyla güncellendi!', 'success');
      setIssuedResetToken(null);
      setIssuedResetLink(null);
      setResetEmailSent(false);
      setResetStep('done');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Şifre sıfırlanamadı.');
    } finally {
      setSubmitting(false);
    }
  };

  const copyResetValue = (kind: 'link' | 'code', val: string) => {
    void navigator.clipboard?.writeText(val);
    setCopiedResetItem(kind);
    showToast(kind === 'link' ? 'Sıfırlama bağlantısı kopyalandı.' : 'Sıfırlama kodu kopyalandı.', 'info');
    window.setTimeout(() => setCopiedResetItem(null), 1600);
  };

  const isResetMode = mode === 'reset';
  const passwordHasLen = password.length >= 8;
  const passwordHasNumOrSym = /[0-9!@#$%^&*._-]/.test(password);

  const newPassHasLen = newPassword.length >= 8;
  const newPassHasUpper = /[A-ZÇĞİÖŞÜ]/.test(newPassword);
  const newPassHasNumOrSym = /[0-9!@#$%^&*._-]/.test(newPassword);
  const newPassScore = [newPassHasLen, newPassHasUpper, newPassHasNumOrSym].filter(Boolean).length;

  const inputClass = (field?: string, accent: 'violet' | 'cyan' = isResetMode ? 'cyan' : 'violet') =>
    `w-full h-11 px-3.5 rounded-xl bg-white dark:bg-[#19192A] border ${
      field && fieldErrors[field]
        ? 'border-[#EF4444] focus:ring-[#EF4444]'
        : accent === 'cyan'
        ? 'border-cyan-200 dark:border-cyan-900/60 focus:ring-cyan-500'
        : 'border-slate-200 dark:border-[#29293D] focus:ring-[#A855F7]'
    } focus:outline-none focus:ring-2 text-sm text-slate-900 dark:text-[#F8FAFC] placeholder:text-slate-400 dark:placeholder:text-[#A1A1B5]/70 transition-colors`;

  const resetStepIndex = resetStep === 'request' ? 1 : resetStep === 'verify' ? 2 : 3;

  return (
    <div
      className={`min-h-[100dvh] grid lg:grid-cols-12 transition-colors ${
        isResetMode
          ? 'bg-gradient-to-br from-[#F0F9FF] via-[#ECFEFF] to-[#EFF6FF] dark:from-[#06121E] dark:via-[#071826] dark:to-[#0B1020]'
          : 'bg-[#F7F8FC] dark:bg-[#0B0B12]'
      } text-slate-900 dark:text-[#F8FAFC]`}
    >
      {/* Left Brand Showcase (Dynamic Cyan/Sapphire Aurora on Reset, Cosmic Violet on Auth) */}
      <div
        className={`hidden lg:flex lg:col-span-6 relative overflow-hidden border-r flex-col justify-between p-10 ${
          isResetMode
            ? 'bg-[#071524] border-cyan-950/60'
            : 'bg-[#10111B] border-slate-200 dark:border-[#29293D]'
        }`}
      >
        <img
          src="/src/assets/images/orbit_auth_backdrop_1795144633219.jpg"
          alt="ORBIT uzay ve yörünge arka planı"
          className={`absolute inset-0 w-full h-full object-cover transition-all duration-500 ${
            isResetMode ? 'opacity-30 hue-rotate-[175deg] saturate-150' : 'opacity-55'
          }`}
          referrerPolicy="no-referrer"
        />
        <div
          className={`absolute inset-0 transition-all duration-500 ${
            isResetMode
              ? 'bg-gradient-to-br from-[#06B6D4]/25 via-[#071524]/85 to-[#2563EB]/30'
              : 'bg-gradient-to-t from-[#0B0B12] via-[#0B0B12]/70 to-[#7C3AED]/18'
          }`}
        />

        {/* Animated Orbital Glow */}
        <div
          className={`pointer-events-none absolute -top-24 -right-24 w-96 h-96 rounded-full blur-3xl transition-colors duration-500 ${
            isResetMode ? 'bg-cyan-400/20' : 'bg-[#7C3AED]/20'
          }`}
        />
        <div
          className={`pointer-events-none absolute -bottom-24 -left-16 w-80 h-80 rounded-full blur-3xl transition-colors duration-500 ${
            isResetMode ? 'bg-blue-500/20' : 'bg-fuchsia-500/15'
          }`}
        />

        <div className="relative z-10 flex items-center justify-between gap-4">
          <OrbitLogo
            size={42}
            showWordmark
            subtitle={isResetMode ? 'Güvenli Hesap Kurtarma Merkezi' : 'Topluluk & İletişim Evreni'}
          />
          {isResetMode && (
            <span className="text-[11px] font-mono font-semibold text-cyan-300 border border-cyan-400/35 bg-cyan-500/15 px-3 py-1 rounded-lg">
              TLS + Scrypt Korumalı
            </span>
          )}
        </div>

        {isResetMode ? (
          <div className="relative z-10 max-w-lg space-y-6">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-cyan-300">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              E-posta Bağlantılı Şifre Kurtarma
            </div>
            <h1 className="text-4xl font-bold font-display tracking-tight text-white leading-tight [text-wrap:balance]">
              Hesabınıza güvenli ve hızlı şekilde yeniden erişin.
            </h1>
            <p className="text-sky-100/80 text-sm leading-relaxed">
              E-posta adresinize tek kullanımlık, 1 saat geçerli bir sıfırlama bağlantısı gönderilir. Bağlantıya
              tıkladığınızda yeni şifre ekranı otomatik olarak açılır.
            </p>

            <div className="grid grid-cols-1 gap-3 pt-2">
              <div className="p-3.5 rounded-2xl bg-cyan-500/10 border border-cyan-400/25 flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/20 text-cyan-300 flex items-center justify-center shrink-0">
                  <Mail className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-bold text-white">Doğrudan Tıklanabilir E-posta Bağlantısı</p>
                  <p className="text-[11px] text-sky-200/75 mt-0.5">
                    SMTP sunucusu üzerinden HTML doğrulama postası ve tek tıkla sıfırlama bağlantısı.
                  </p>
                </div>
              </div>
              <div className="p-3.5 rounded-2xl bg-sky-500/10 border border-sky-400/25 flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-sky-500/20 text-sky-300 flex items-center justify-center shrink-0">
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-bold text-white">Otomatik Oturum Temizleme</p>
                  <p className="text-[11px] text-sky-200/75 mt-0.5">
                    Şifre yenilendiğinde tüm eski cihaz oturumları anında geçersiz kılınır.
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="relative z-10 max-w-lg space-y-6">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[#C084FC]">
                <span className="w-2 h-2 rounded-full bg-[#A855F7]" />
                Yörüngeye Bağlan
              </div>
              <h1 className="text-4xl font-bold font-display tracking-tight text-[#F8FAFC] leading-tight [text-wrap:balance]">
                Sade, hızlı ve topluluğunuza özel iletişim alanı.
              </h1>
              <p className="text-[#A1A1B5] text-sm leading-relaxed">
                Metin kanalları, anlık ses ve görüntülü sohbetler, özel roller ve rozetler tek bir galaktik arayüzde.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="p-3 rounded-2xl bg-[#7C3AED]/15 border border-[#A855F7]/25 space-y-1">
                <Radio className="w-4 h-4 text-[#C084FC]" />
                <p className="text-xs font-bold text-white">Ses & Sahne</p>
                <p className="text-[11px] text-[#A1A1B5]">Canlı yayın ve mini oyunlar</p>
              </div>
              <div className="p-3 rounded-2xl bg-sky-500/15 border border-sky-400/25 space-y-1">
                <ShieldCheck className="w-4 h-4 text-sky-400" />
                <p className="text-xs font-bold text-white">2FA & Rol İzni</p>
                <p className="text-[11px] text-[#A1A1B5]">Kanal bazlı tam güvenlik</p>
              </div>
              <div className="p-3 rounded-2xl bg-emerald-500/15 border border-emerald-400/25 space-y-1">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <p className="text-xs font-bold text-white">Nitro & Rozetler</p>
                <p className="text-[11px] text-[#A1A1B5]">Efektler ve sunucu takviyesi</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right Auth Form */}
      <div className="lg:col-span-6 relative flex items-center justify-center p-5 sm:p-10 overflow-hidden">
        <div
          className={`pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full blur-3xl hidden dark:block transition-colors duration-500 ${
            isResetMode ? 'bg-cyan-500/18' : 'bg-[#7C3AED]/14'
          }`}
        />

        <motion.div
          key={mode}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className={`relative z-10 w-full max-w-md space-y-5 ${
            isResetMode
              ? 'p-6 sm:p-7 rounded-3xl bg-white/90 dark:bg-[#0C1929]/90 border border-cyan-200/80 dark:border-cyan-500/25 shadow-2xl shadow-cyan-500/10 backdrop-blur-md'
              : ''
          }`}
        >
          <div className="flex items-center justify-between lg:hidden">
            <OrbitLogo size={38} showWordmark wordmarkClassName="text-xl text-slate-900 dark:text-[#F8FAFC]" />
          </div>

          {/* Clean Tab Switcher for Login / Register */}
          {(mode === 'login' || mode === 'register') && (
            <div className="grid grid-cols-2 p-1 rounded-2xl bg-slate-200/80 dark:bg-[#151522] border border-slate-200 dark:border-[#29293D]">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className={`h-10 rounded-xl text-sm font-semibold transition-colors ${
                  mode === 'login'
                    ? 'bg-white dark:bg-[#7C3AED] text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-[#A1A1B5] hover:text-slate-900 dark:hover:text-[#F8FAFC]'
                }`}
              >
                Giriş Yap
              </button>
              <button
                type="button"
                onClick={() => switchMode('register')}
                className={`h-10 rounded-xl text-sm font-semibold transition-colors ${
                  mode === 'register'
                    ? 'bg-white dark:bg-[#7C3AED] text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-[#A1A1B5] hover:text-slate-900 dark:hover:text-[#F8FAFC]'
                }`}
              >
                Kayıt Ol
              </button>
            </div>
          )}

          {/* Distinct Reset Header + Step Progress */}
          {isResetMode ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-cyan-600 dark:text-cyan-300">
                  <KeyRound className="w-3.5 h-3.5" />
                  Şifre Kurtarma Akışı
                </span>
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="text-xs font-medium text-sky-600 dark:text-sky-300 hover:underline inline-flex items-center gap-1"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Girişe dön
                </button>
              </div>

              <div>
                <h2 className="text-2xl font-bold font-display tracking-tight bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-600 bg-clip-text text-transparent">
                  {resetStep === 'request' && 'Şifrenizi Sıfırlayın'}
                  {resetStep === 'verify' && 'Yeni Şifre Belirleyin'}
                  {resetStep === 'done' && 'Şifreniz Güncellendi!'}
                </h2>
                <p className="text-sm text-slate-600 dark:text-sky-100/75 mt-1">
                  {resetStep === 'request' &&
                    'Kayıtlı e-posta adresinizi girin; size tek tıkla sıfırlama bağlantısı gönderelim.'}
                  {resetStep === 'verify' &&
                    (resetTokenEmailHint
                      ? `${resetTokenEmailHint} hesabı için güçlü bir yeni şifre belirleyin.`
                      : 'E-postanızdaki bağlantıya tıklayın veya doğrulama kodunu aşağıya girin.')}
                  {resetStep === 'done' && 'Artık yeni şifrenizle ORBIT hesabınıza güvenle giriş yapabilirsiniz.'}
                </p>
              </div>

              {/* 3-Step Visual Progress Bar */}
              <div className="grid grid-cols-3 gap-2 pt-1">
                {[
                  { step: 1, label: '1. E-posta' },
                  { step: 2, label: '2. Bağlantı' },
                  { step: 3, label: '3. Tamam' },
                ].map((s) => {
                  const active = resetStepIndex === s.step;
                  const done = resetStepIndex > s.step || resetStep === 'done';
                  return (
                    <div key={s.step} className="space-y-1">
                      <div
                        className={`h-1.5 rounded-full transition-colors ${
                          done
                            ? 'bg-emerald-500'
                            : active
                            ? 'bg-gradient-to-r from-cyan-400 to-blue-500'
                            : 'bg-slate-200 dark:bg-slate-800'
                        }`}
                      />
                      <p
                        className={`text-[11px] font-semibold ${
                          done
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : active
                            ? 'text-cyan-600 dark:text-cyan-300'
                            : 'text-slate-400 dark:text-slate-500'
                        }`}
                      >
                        {s.label}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div>
              <h2 className="text-2xl font-bold font-display tracking-tight">
                {mode === 'login' && 'Tekrar hoş geldiniz'}
                {mode === 'register' && 'Yeni hesap oluşturun'}
                {mode === 'founder_activate' && 'Kurucu Hesabını Aktifleştir'}
                {mode === 'two_factor' && 'İki Adımlı Doğrulama (2FA)'}
              </h2>
              <p className="text-sm text-slate-500 dark:text-[#A1A1B5] mt-1">
                {mode === 'login' && 'Devam etmek için e-posta adresiniz ve şifrenizle giriş yapın.'}
                {mode === 'register' && 'Kullanıcı adınızı seçin ve birkaç saniyede başlayın.'}
                {mode === 'founder_activate' && 'Size özel kurucu hesabınız hazır. İlk giriş şifrenizi belirleyin.'}
                {mode === 'two_factor' &&
                  `${twoFactorChallenge?.userHint || 'Hesabınız'} için doğrulayıcı uygulamanızdaki 6 haneli kodu veya kurtarma kodunu girin.`}
              </p>
            </div>
          )}

          {/* Dedicated Founder Account Activation Card (shown until claimed) */}
          {founderStatus?.needsActivation && mode !== 'founder_activate' && !isResetMode && (
            <div className="rounded-2xl border border-[#F59E0B]/40 bg-[#F59E0B]/10 p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold text-amber-600 dark:text-[#F59E0B] flex items-center gap-1.5">
                  <Crown className="w-4 h-4 shrink-0" />
                  Özel Kurucu Hesabınız Hazır
                </p>
                <p className="text-xs text-slate-600 dark:text-[#A1A1B5] mt-0.5 truncate font-mono">
                  {founderStatus.emailHint}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEmail(founderStatus.emailHint);
                  setDisplayName('Bilal (Kurucu)');
                  setPassword('');
                  setError('');
                  setFieldErrors({});
                  setMode('founder_activate');
                }}
                className="h-9 px-3.5 rounded-xl bg-[#F59E0B] hover:bg-amber-400 text-slate-950 font-semibold text-xs shrink-0 transition-colors"
              >
                Aktifleştir
              </button>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-[#EF4444]/40 bg-[#EF4444]/10 px-4 py-3 text-sm text-red-600 dark:text-red-300 flex items-start gap-2.5"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#EF4444]" />
              <span>{error}</span>
            </div>
          )}

          {(mode === 'login' || mode === 'register') && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => void handleGoogleConnect()}
                disabled={googleLoading || submitting}
                className="w-full h-11 rounded-xl bg-white dark:bg-[#19192A] hover:bg-slate-50 dark:hover:bg-[#1F1F35] border border-slate-200 dark:border-[#29293D] text-slate-800 dark:text-[#F8FAFC] font-semibold text-sm flex items-center justify-center gap-2.5 transition-all shadow-sm disabled:opacity-60"
              >
                {googleLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#A855F7]" />
                ) : (
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#4285F4"
                      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                    />
                  </svg>
                )}
                <span>Google ile Devam Et</span>
                {!googleConfigured && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#151522] text-slate-400">
                    Ayar Gerekli
                  </span>
                )}
              </button>

              <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-slate-400 dark:text-[#A1A1B5]/80">
                <div className="h-px flex-1 bg-slate-200 dark:bg-[#29293D]" />
                <span>veya e-posta ile</span>
                <div className="h-px flex-1 bg-slate-200 dark:bg-[#29293D]" />
              </div>
            </div>
          )}

          {mode === 'founder_activate' && (
            <form onSubmit={handleActivateFounder} noValidate className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-600 dark:text-[#A1A1B5]">Kurucu E-postası</label>
                <input
                  type="email"
                  value={email || founderStatus?.emailHint || ''}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    clearFieldError('email');
                  }}
                  aria-invalid={Boolean(fieldErrors.email)}
                  className={inputClass('email')}
                />
                {fieldErrors.email && (
                  <p role="alert" className="text-xs text-[#EF4444]">
                    {fieldErrors.email}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-600 dark:text-[#A1A1B5]">Görünen Ad</label>
                <input
                  type="text"
                  maxLength={40}
                  value={displayName}
                  onChange={(e) => {
                    setDisplayName(e.target.value);
                    clearFieldError('displayName');
                  }}
                  placeholder="Bilal (Kurucu)"
                  aria-invalid={Boolean(fieldErrors.displayName)}
                  className={inputClass('displayName')}
                />
                {fieldErrors.displayName && (
                  <p role="alert" className="text-xs text-[#EF4444]">
                    {fieldErrors.displayName}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-600 dark:text-[#A1A1B5]">
                  Kurucu Hesap Şifreniz (en az 8 karakter)
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      clearFieldError('password');
                    }}
                    placeholder="Güçlü bir şifre belirleyin"
                    aria-invalid={Boolean(fieldErrors.password)}
                    className={`${inputClass('password')} pr-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label="Şifreyi göster veya gizle"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-[#F8FAFC]"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {fieldErrors.password && (
                  <p role="alert" className="text-xs text-[#EF4444]">
                    {fieldErrors.password}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full h-11 rounded-xl bg-[#F59E0B] hover:bg-amber-400 disabled:opacity-60 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 transition-colors"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                <Crown className="w-4 h-4" />
                Kurucu Hesabımı Başlat
              </button>

              <button
                type="button"
                onClick={() => switchMode('login')}
                className="w-full text-center text-xs text-slate-500 dark:text-[#A1A1B5] hover:text-slate-900 dark:hover:text-[#F8FAFC]"
              >
                Normal giriş ekranına dön
              </button>
            </form>
          )}

          {mode === 'two_factor' && twoFactorChallenge && (
            <form onSubmit={handleVerifyTwoFactor} noValidate className="space-y-4">
              <div className="rounded-xl border border-[#7C3AED]/35 bg-[#7C3AED]/10 p-3 text-xs text-purple-700 dark:text-[#C084FC] flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 shrink-0 text-[#7C3AED] dark:text-[#A855F7]" />
                <span>Authenticator kodunu (6 haneli) veya tek kullanımlık yedek kurtarma kodunu girin.</span>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-600 dark:text-[#A1A1B5]">Doğrulama Kodu</label>
                <input
                  type="text"
                  autoFocus
                  value={twoFactorCode}
                  onChange={(e) => {
                    setTwoFactorCode(e.target.value);
                    clearFieldError('twoFactorCode');
                  }}
                  placeholder="123456 veya XXXX-XXXX"
                  aria-invalid={Boolean(fieldErrors.twoFactorCode)}
                  className={`${inputClass('twoFactorCode')} font-mono tracking-widest text-center`}
                />
                {fieldErrors.twoFactorCode && (
                  <p role="alert" className="text-xs text-[#EF4444]">
                    {fieldErrors.twoFactorCode}
                  </p>
                )}
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full h-11 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Doğrula ve Giriş Yap
              </button>
              <button
                type="button"
                onClick={() => {
                  setTwoFactorChallenge(null);
                  setTwoFactorCode('');
                  switchMode('login');
                }}
                className="w-full text-center text-xs text-slate-500 dark:text-[#A1A1B5] hover:text-slate-800 dark:hover:text-[#F8FAFC]"
              >
                Giriş ekranına dön
              </button>
            </form>
          )}

          {mode === 'login' && (
            <form onSubmit={handleLogin} noValidate className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-600 dark:text-[#A1A1B5]">E-posta</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    clearFieldError('email');
                  }}
                  placeholder="ornek@alanadi.com"
                  aria-invalid={Boolean(fieldErrors.email)}
                  className={inputClass('email')}
                />
                {fieldErrors.email && (
                  <p role="alert" className="text-xs text-[#EF4444]">
                    {fieldErrors.email}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-slate-600 dark:text-[#A1A1B5]">Şifre</label>
                  <button
                    type="button"
                    onClick={() => switchMode('reset')}
                    className="text-xs font-semibold text-cyan-600 dark:text-cyan-400 hover:underline"
                  >
                    Şifremi unuttum
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      clearFieldError('password');
                    }}
                    placeholder="••••••••"
                    aria-invalid={Boolean(fieldErrors.password)}
                    className={`${inputClass('password')} pr-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label="Şifreyi göster veya gizle"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-slate-600 dark:hover:text-[#F8FAFC]"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {fieldErrors.password && (
                  <p role="alert" className="text-xs text-[#EF4444]">
                    {fieldErrors.password}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full h-11 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors shadow-sm shadow-[#7C3AED]/25"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Giriş Yap
              </button>
            </form>
          )}

          {mode === 'register' && (
            <form onSubmit={handleRegister} noValidate className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-600 dark:text-[#A1A1B5]">E-posta</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    clearFieldError('email');
                  }}
                  placeholder="ornek@alanadi.com"
                  aria-invalid={Boolean(fieldErrors.email)}
                  className={inputClass('email')}
                />
                {fieldErrors.email && (
                  <p role="alert" className="text-xs text-[#EF4444]">
                    {fieldErrors.email}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-600 dark:text-[#A1A1B5]">Görünen Ad</label>
                  <input
                    type="text"
                    maxLength={40}
                    value={displayName}
                    onChange={(e) => {
                      setDisplayName(e.target.value);
                      clearFieldError('displayName');
                    }}
                    placeholder="Deniz Yılmaz"
                    aria-invalid={Boolean(fieldErrors.displayName)}
                    className={inputClass('displayName')}
                  />
                  {fieldErrors.displayName && (
                    <p role="alert" className="text-xs text-[#EF4444]">
                      {fieldErrors.displayName}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-600 dark:text-[#A1A1B5]">Kullanıcı Adı</label>
                  <div className="relative">
                    <input
                      type="text"
                      maxLength={24}
                      value={username}
                      onChange={(e) => {
                        setUsername(e.target.value.replace(/[^a-zA-Z0-9_.-]/g, ''));
                        clearFieldError('username');
                      }}
                      placeholder="deniz_y"
                      aria-invalid={Boolean(fieldErrors.username)}
                      className={`${inputClass('username')} pr-9 font-mono`}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2">
                      {checkingUsername && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
                      {!checkingUsername && usernameAvailable === true && <Check className="w-4 h-4 text-[#22C55E]" />}
                      {!checkingUsername && usernameAvailable === false && <X className="w-4 h-4 text-[#EF4444]" />}
                    </span>
                  </div>
                  {usernameAvailable === false && (
                    <p className="text-xs text-[#EF4444]">Bu kullanıcı adı kullanımda.</p>
                  )}
                  {fieldErrors.username && (
                    <p role="alert" className="text-xs text-[#EF4444]">
                      {fieldErrors.username}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-600 dark:text-[#A1A1B5]">Şifre</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      clearFieldError('password');
                    }}
                    placeholder="En az 8 karakter"
                    aria-invalid={Boolean(fieldErrors.password)}
                    className={`${inputClass('password')} pr-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label="Şifreyi göster veya gizle"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-slate-600 dark:hover:text-[#F8FAFC]"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {fieldErrors.password && (
                  <p role="alert" className="text-xs text-[#EF4444]">
                    {fieldErrors.password}
                  </p>
                )}
                {password.length > 0 && (
                  <div className="flex items-center gap-3 text-[11px] pt-0.5">
                    <span className={passwordHasLen ? 'text-[#22C55E]' : 'text-slate-400 dark:text-[#A1A1B5]'}>
                      {passwordHasLen ? '✓' : '·'} En az 8 karakter
                    </span>
                    <span className={passwordHasNumOrSym ? 'text-[#22C55E]' : 'text-slate-400 dark:text-[#A1A1B5]'}>
                      {passwordHasNumOrSym ? '✓' : '·'} Rakam veya sembol önerilir
                    </span>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={submitting || usernameAvailable === false}
                className="w-full h-11 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors shadow-sm shadow-[#7C3AED]/25"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Hesap Oluştur
              </button>
            </form>
          )}

          {mode === 'reset' && (
            <div className="space-y-4">
              {resetStep === 'request' && (
                <form onSubmit={handleRequestReset} noValidate className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-slate-700 dark:text-sky-100/80">
                      Kayıtlı E-posta Adresiniz
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        clearFieldError('email');
                      }}
                      placeholder="ornek@alanadi.com"
                      aria-invalid={Boolean(fieldErrors.email)}
                      className={inputClass('email', 'cyan')}
                    />
                    {fieldErrors.email && (
                      <p role="alert" className="text-xs text-[#EF4444]">
                        {fieldErrors.email}
                      </p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full h-11 rounded-xl bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all shadow-md shadow-cyan-500/25"
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                    Sıfırlama Bağlantısı Gönder
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setResetStep('verify');
                      setError('');
                    }}
                    className="w-full text-center text-xs text-cyan-600 dark:text-cyan-300 hover:underline font-medium"
                  >
                    Zaten bir sıfırlama kodum var
                  </button>
                </form>
              )}

              {resetStep === 'verify' && (
                <div className="space-y-4">
                  {resetTokenValidating && (
                    <div className="rounded-2xl border border-cyan-500/35 bg-cyan-500/10 p-3.5 text-xs text-cyan-700 dark:text-cyan-200 flex items-center gap-2.5">
                      <Loader2 className="w-4 h-4 animate-spin shrink-0 text-cyan-500" />
                      <span>E-posta sıfırlama bağlantınız doğrulanıyor...</span>
                    </div>
                  )}

                  {!resetTokenValidating && resetTokenValid === false && (
                    <div className="rounded-2xl border border-[#EF4444]/40 bg-[#EF4444]/10 p-3.5 text-xs text-red-700 dark:text-red-200 space-y-2">
                      <p className="font-semibold flex items-center gap-1.5">
                        <AlertCircle className="w-4 h-4 text-[#EF4444] shrink-0" />
                        {resetTokenError || 'Sıfırlama bağlantısı geçersiz veya süresi dolmuş.'}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setResetStep('request');
                          setResetToken('');
                          setResetTokenValid(null);
                          setResetTokenError('');
                          navigate('/reset-password');
                        }}
                        className="text-xs font-semibold text-cyan-600 dark:text-cyan-300 hover:underline"
                      >
                        Yeni sıfırlama bağlantısı iste →
                      </button>
                    </div>
                  )}

                  {!resetTokenValidating && resetTokenValid === true && urlResetToken && (
                    <div className="rounded-2xl border border-emerald-500/35 bg-emerald-500/10 p-3.5 text-xs text-emerald-700 dark:text-emerald-200 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 font-semibold">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        E-posta bağlantısı doğrulandı{resetTokenEmailHint ? ` · ${resetTokenEmailHint}` : ''}
                      </span>
                    </div>
                  )}

                  {resetEmailSent && (
                    <div className="rounded-2xl border border-cyan-500/35 bg-cyan-500/10 p-4 text-xs space-y-2.5">
                      <div className="flex items-start gap-2.5">
                        <Mail className="w-4 h-4 text-cyan-500 shrink-0 mt-0.5" />
                        <div className="space-y-1 flex-1 min-w-0">
                          <p className="font-bold text-cyan-700 dark:text-cyan-200">
                            E-postanız gönderildi!
                          </p>
                          <p className="text-slate-600 dark:text-sky-100/80 leading-relaxed">
                            <span className="font-mono font-semibold">{email}</span> adresinin gelen kutusunu (ve gereksiz/spam
                            klasörünü) kontrol edin. Postadaki bağlantıya tıklayabilir veya kodu aşağıya yapıştırabilirsiniz.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-1 border-t border-cyan-500/20">
                        <button
                          type="button"
                          onClick={() => {
                            setResetStep('request');
                            setResetEmailSent(false);
                          }}
                          className="text-[11px] text-slate-500 dark:text-sky-200/75 hover:underline"
                        >
                          E-postayı değiştir
                        </button>
                        <button
                          type="button"
                          disabled={resendCooldown > 0 || submitting}
                          onClick={() => void handleRequestReset()}
                          className="text-[11px] font-semibold text-cyan-600 dark:text-cyan-300 hover:underline disabled:opacity-50 inline-flex items-center gap-1 tabular-nums"
                        >
                          <RefreshCw className="w-3 h-3" />
                          {resendCooldown > 0 ? `Tekrar gönder (${resendCooldown}sn)` : 'Bağlantıyı tekrar gönder'}
                        </button>
                      </div>
                    </div>
                  )}

                  {!resetEmailSent && (issuedResetLink || issuedResetToken) && (
                    <div className="rounded-2xl border border-sky-500/35 bg-sky-500/10 p-3.5 text-xs space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-sky-700 dark:text-sky-200 flex items-center gap-1.5">
                          <Link2 className="w-3.5 h-3.5 text-cyan-500" />
                          Hazır Şifre Sıfırlama Bağlantısı (Önizleme Modu)
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setIssuedResetToken(null);
                            setIssuedResetLink(null);
                            setResetStep('request');
                          }}
                          className="text-[11px] text-cyan-600 dark:text-cyan-300 hover:underline"
                        >
                          Yenile
                        </button>
                      </div>
                      {issuedResetLink && (
                        <div className="flex flex-wrap items-center gap-2">
                          <a
                            href={issuedResetLink}
                            className="flex-1 min-w-[180px] h-8 px-2.5 rounded-lg bg-white/80 dark:bg-[#071524] border border-cyan-500/30 text-[11px] font-mono text-cyan-700 dark:text-cyan-300 truncate flex items-center gap-1.5 hover:border-cyan-400"
                          >
                            <ExternalLink className="w-3 h-3 shrink-0" />
                            <span className="truncate">{issuedResetLink}</span>
                          </a>
                          <button
                            type="button"
                            onClick={() => copyResetValue('link', issuedResetLink)}
                            className="h-8 px-2.5 rounded-lg bg-cyan-500/15 text-cyan-700 dark:text-cyan-200 font-semibold text-[11px] inline-flex items-center gap-1 shrink-0"
                          >
                            {copiedResetItem === 'link' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            Linki Kopyala
                          </button>
                        </div>
                      )}
                      {issuedResetToken && (
                        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-sky-100/80">
                          <span className="font-mono truncate">Kod: {issuedResetToken}</span>
                          <button
                            type="button"
                            onClick={() => copyResetValue('code', issuedResetToken)}
                            className="text-cyan-600 dark:text-cyan-300 hover:underline shrink-0 inline-flex items-center gap-1"
                          >
                            {copiedResetItem === 'code' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            Kopyala
                          </button>
                        </div>
                      )}
                      <p className="text-[11px] text-slate-500 dark:text-sky-200/70">
                        Canlı e-posta gönderimi için <code className="font-mono">SMTP_HOST</code>,{' '}
                        <code className="font-mono">SMTP_USER</code> ve <code className="font-mono">SMTP_PASS</code> ortam
                        değişkenlerini ekleyin.
                      </p>
                    </div>
                  )}

                  {resetTokenValid !== false && (
                    <form onSubmit={handleConfirmReset} noValidate className="space-y-3.5">
                      {!urlResetToken && (
                        <div className="space-y-1.5">
                          <label className="block text-xs font-medium text-slate-700 dark:text-sky-100/80">
                            Sıfırlama Kodu
                          </label>
                          <input
                            type="text"
                            value={resetToken}
                            onChange={(e) => {
                              setResetToken(e.target.value);
                              clearFieldError('resetToken');
                            }}
                            placeholder="E-postadaki kodu yapıştırın"
                            aria-invalid={Boolean(fieldErrors.resetToken)}
                            className={`${inputClass('resetToken', 'cyan')} font-mono`}
                          />
                          {fieldErrors.resetToken && (
                            <p role="alert" className="text-xs text-[#EF4444]">
                              {fieldErrors.resetToken}
                            </p>
                          )}
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-slate-700 dark:text-sky-100/80">
                          Yeni Şifre
                        </label>
                        <div className="relative">
                          <input
                            type={showPassword ? 'text' : 'password'}
                            value={newPassword}
                            onChange={(e) => {
                              setNewPassword(e.target.value);
                              clearFieldError('newPassword');
                            }}
                            placeholder="En az 8 karakter"
                            aria-invalid={Boolean(fieldErrors.newPassword)}
                            className={`${inputClass('newPassword', 'cyan')} pr-11`}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            aria-label="Şifreyi göster veya gizle"
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-slate-600 dark:hover:text-[#F8FAFC]"
                          >
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                        {newPassword.length > 0 && (
                          <div className="space-y-1 pt-0.5">
                            <div className="grid grid-cols-3 gap-1">
                              {[1, 2, 3].map((lvl) => (
                                <div
                                  key={lvl}
                                  className={`h-1 rounded-full transition-colors ${
                                    newPassScore >= lvl
                                      ? newPassScore === 3
                                        ? 'bg-emerald-500'
                                        : newPassScore === 2
                                        ? 'bg-cyan-500'
                                        : 'bg-amber-500'
                                      : 'bg-slate-200 dark:bg-slate-800'
                                  }`}
                                />
                              ))}
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-sky-200/75">
                              {newPassHasLen ? '✓ 8+ karakter' : '· En az 8 karakter'}{' '}
                              {newPassHasUpper ? '· ✓ Büyük harf' : '· Büyük harf'}{' '}
                              {newPassHasNumOrSym ? '· ✓ Rakam/sembol' : '· Rakam/sembol'}
                            </p>
                          </div>
                        )}
                        {fieldErrors.newPassword && (
                          <p role="alert" className="text-xs text-[#EF4444]">
                            {fieldErrors.newPassword}
                          </p>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-slate-700 dark:text-sky-100/80">
                          Yeni Şifre (Tekrar)
                        </label>
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={confirmNewPassword}
                          onChange={(e) => {
                            setConfirmNewPassword(e.target.value);
                            clearFieldError('confirmNewPassword');
                          }}
                          placeholder="Yeni şifrenizi tekrar yazın"
                          aria-invalid={Boolean(fieldErrors.confirmNewPassword)}
                          className={inputClass('confirmNewPassword', 'cyan')}
                        />
                        {fieldErrors.confirmNewPassword && (
                          <p role="alert" className="text-xs text-[#EF4444]">
                            {fieldErrors.confirmNewPassword}
                          </p>
                        )}
                      </div>

                      <button
                        type="submit"
                        disabled={submitting}
                        className="w-full h-11 rounded-xl bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all shadow-md shadow-cyan-500/25"
                      >
                        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                        Şifremi Güncelle
                      </button>
                    </form>
                  )}
                </div>
              )}

              {resetStep === 'done' && (
                <div className="rounded-2xl border border-emerald-500/35 bg-emerald-500/10 p-5 text-center space-y-4">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-500 text-white flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/25">
                    <CheckCircle2 className="w-7 h-7" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-base font-bold font-display text-emerald-700 dark:text-emerald-300">
                      Yeni Şifreniz Aktif!
                    </p>
                    <p className="text-xs text-slate-600 dark:text-sky-100/80">
                      Güvenliğiniz için diğer cihazlardaki açık oturumlar kapatıldı.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setResetStep('request');
                      setResetToken('');
                      setNewPassword('');
                      setConfirmNewPassword('');
                      switchMode('login');
                    }}
                    className="w-full h-11 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-600 hover:from-emerald-400 hover:to-cyan-500 text-white font-semibold text-sm transition-all shadow-md shadow-emerald-500/20"
                  >
                    Yeni Şifremle Giriş Yap
                  </button>
                </div>
              )}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}

export function EmailVerificationBanner() {
  const { profile, pendingVerificationToken, refreshMe } = useAuth();
  const { showToast } = useToast();
  const [tokenInput, setTokenInput] = useState(pendingVerificationToken || '');
  const [verifying, setVerifying] = useState(false);
  const [tokenError, setTokenError] = useState('');

  useEffect(() => {
    if (pendingVerificationToken) {
      setTokenInput(pendingVerificationToken);
      setTokenError('');
    }
  }, [pendingVerificationToken]);

  if (!profile || profile.emailVerified) return null;

  const handleVerify = async () => {
    if (!tokenInput.trim()) {
      setTokenError('Lütfen doğrulama kodunu girin.');
      showToast('Lütfen doğrulama kodunu girin.', 'error');
      return;
    }
    setTokenError('');
    setVerifying(true);
    try {
      await apiFetch('/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ token: tokenInput.trim() }),
      });
      await refreshMe();
      showToast('E-posta adresiniz doğrulandı.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Doğrulama başarısız.', 'error');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="bg-[#7C3AED]/15 border-b border-[#7C3AED]/30 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
      <div className="flex items-center gap-2 text-purple-800 dark:text-[#C084FC]">
        <ShieldCheck className="w-4 h-4 shrink-0" />
        <span>
          E-posta adresiniz henüz doğrulanmadı.
          {pendingVerificationToken && (
            <span className="ml-1 font-mono select-all opacity-90">Kod: {pendingVerificationToken}</span>
          )}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={tokenInput}
            onChange={(e) => {
              setTokenInput(e.target.value);
              if (tokenError) setTokenError('');
            }}
            placeholder="Doğrulama kodu"
            aria-invalid={Boolean(tokenError)}
            className={`h-8 px-2.5 rounded-lg bg-white/85 dark:bg-[#151522] border ${
              tokenError ? 'border-[#EF4444]' : 'border-[#7C3AED]/35'
            } font-mono text-xs w-40 text-slate-900 dark:text-[#F8FAFC]`}
          />
          <button
            type="button"
            onClick={handleVerify}
            disabled={verifying}
            className="h-8 px-3 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-medium whitespace-nowrap transition-colors"
          >
            Doğrula
          </button>
        </div>
        {tokenError && (
          <span role="alert" className="text-[11px] font-medium text-[#EF4444]">
            {tokenError}
          </span>
        )}
      </div>
    </div>
  );
}
