import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { AlertCircle, Check, Crown, Eye, EyeOff, KeyRound, Loader2, Mail, ShieldCheck, X } from 'lucide-react';
import { apiFetch, ApiError, setStoredToken } from '../client/api.ts';
import { useAuth } from '../client/AuthContext.tsx';
import { useToast } from '../client/ToastContext.tsx';
import type { UserProfile, UserSettings } from '../shared/types.ts';
import { OrbitLogo } from './OrbitLogo.tsx';

type AuthMode = 'login' | 'register' | 'reset' | 'founder_activate' | 'two_factor';
type FieldErrors = Record<string, string>;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AuthScreen({ initialMode = 'login' }: { initialMode?: 'login' | 'register' | 'reset' }) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const { setSession } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

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

  // Password reset state
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [issuedResetToken, setIssuedResetToken] = useState<string | null>(null);

  // Two-factor authentication login challenge
  const [twoFactorChallenge, setTwoFactorChallenge] = useState<{ challengeToken: string; userHint: string } | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [googleConfigured, setGoogleConfigured] = useState<boolean>(false);
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

  useEffect(() => {
    apiFetch<{ emailHint: string; needsActivation: boolean }>('/auth/founder-status')
      .then((res) => setFounderStatus(res))
      .catch(() => {});
    apiFetch<{ configured: boolean }>('/auth/google/status')
      .then((res) => setGoogleConfigured(Boolean(res.configured)))
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
    if (nextMode === 'login') navigate('/login');
    else if (nextMode === 'register') navigate('/register');
    else if (nextMode === 'reset') navigate('/reset-password');
  };

  const handleGoogleConnect = async () => {
    setError('');
    setGoogleLoading(true);
    try {
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
    } catch (err) {
      setGoogleLoading(false);
      setError(
        err instanceof ApiError
          ? err.message
          : 'Google ile giriş başlatılamadı.'
      );
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

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
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
      const res = await apiFetch<{ resetToken: string | null; smtpConfigured: boolean }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.resetToken) {
        setIssuedResetToken(res.resetToken);
        setResetToken(res.resetToken);
      }
      showToast('Şifre sıfırlama kodu oluşturuldu.', 'info');
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
    if (!resetToken.trim()) errs.resetToken = 'Lütfen sıfırlama kodunu girin.';
    if (newPassword.length < 8) errs.newPassword = 'Yeni şifre en az 8 karakter olmalıdır.';
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setError('Lütfen eksik alanları doldurun.');
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      await apiFetch('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: resetToken.trim(), newPassword }),
      });
      showToast('Şifreniz güncellendi. Yeni şifrenizle giriş yapabilirsiniz.', 'success');
      setIssuedResetToken(null);
      switchMode('login');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Şifre sıfırlanamadı.');
    } finally {
      setSubmitting(false);
    }
  };

  const passwordHasLen = password.length >= 8;
  const passwordHasNumOrSym = /[0-9!@#$%^&*._-]/.test(password);

  const inputClass = (field?: string) =>
    `w-full h-11 px-3.5 rounded-xl bg-white dark:bg-[#19192A] border ${
      field && fieldErrors[field]
        ? 'border-[#EF4444] focus:ring-[#EF4444]'
        : 'border-slate-200 dark:border-[#29293D] focus:ring-[#A855F7]'
    } focus:outline-none focus:ring-2 text-sm text-slate-900 dark:text-[#F8FAFC] placeholder:text-slate-400 dark:placeholder:text-[#A1A1B5]/70 transition-colors`;

  return (
    <div className="min-h-[100dvh] grid lg:grid-cols-12 bg-[#F7F8FC] dark:bg-[#0B0B12] text-slate-900 dark:text-[#F8FAFC]">
      {/* Left Brand Showcase */}
      <div className="hidden lg:flex lg:col-span-6 relative overflow-hidden bg-[#10111B] border-r border-slate-200 dark:border-[#29293D] flex-col justify-between p-10">
        <img
          src="/src/assets/images/orbit_auth_backdrop_1795144633219.jpg"
          alt="ORBIT uzay ve yörünge arka planı"
          className="absolute inset-0 w-full h-full object-cover opacity-55"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0B0B12] via-[#0B0B12]/70 to-[#7C3AED]/15" />

        <div className="relative z-10 flex items-center">
          <OrbitLogo size={42} showWordmark subtitle="Topluluk & İletişim Evreni" />
        </div>

        <div className="relative z-10 max-w-lg space-y-4">
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[#C084FC]">
            <span className="w-2 h-2 rounded-full bg-[#A855F7]" />
            Yörüngeye Bağlan
          </div>
          <h1 className="text-4xl font-bold font-display tracking-tight text-[#F8FAFC] leading-tight [text-wrap:balance]">
            Sade, hızlı ve topluluğunuza özel iletişim alanı.
          </h1>
          <p className="text-[#A1A1B5] text-base leading-relaxed">
            Metin kanalları, anlık ses ve görüntülü sohbetler, özel roller ve rozetler tek bir galaktik arayüzde.
          </p>
        </div>
      </div>

      {/* Right Auth Form */}
      <div className="lg:col-span-6 relative flex items-center justify-center p-5 sm:p-10 overflow-hidden">
        <div className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-[#7C3AED]/12 blur-3xl hidden dark:block" />

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 w-full max-w-md space-y-6"
        >
          <div className="flex items-center lg:hidden">
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

          <div>
            <h2 className="text-2xl font-bold font-display tracking-tight">
              {mode === 'login' && 'Tekrar hoş geldiniz'}
              {mode === 'register' && 'Yeni hesap oluşturun'}
              {mode === 'reset' && 'Şifrenizi sıfırlayın'}
              {mode === 'founder_activate' && 'Kurucu Hesabını Aktifleştir'}
              {mode === 'two_factor' && 'İki Adımlı Doğrulama (2FA)'}
            </h2>
            <p className="text-sm text-slate-500 dark:text-[#A1A1B5] mt-1">
              {mode === 'login' && 'Devam etmek için e-posta adresiniz ve şifrenizle giriş yapın.'}
              {mode === 'register' && 'Kullanıcı adınızı seçin ve birkaç saniyede başlayın.'}
              {mode === 'reset' && 'E-posta adresinizle yeni bir sıfırlama kodu oluşturun.'}
              {mode === 'founder_activate' && 'Size özel kurucu hesabınız hazır. İlk giriş şifrenizi belirleyin.'}
              {mode === 'two_factor' &&
                `${twoFactorChallenge?.userHint || 'Hesabınız'} için doğrulayıcı uygulamanızdaki 6 haneli kodu veya kurtarma kodunu girin.`}
            </p>
          </div>

          {/* Dedicated Founder Account Activation Card (shown until claimed) */}
          {founderStatus?.needsActivation && mode !== 'founder_activate' && (
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
                    className="text-xs text-[#7C3AED] dark:text-[#C084FC] hover:underline"
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
              {!issuedResetToken ? (
                <form onSubmit={handleRequestReset} noValidate className="space-y-4">
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
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full h-11 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
                  >
                    <Mail className="w-4 h-4" />
                    Sıfırlama Kodu Oluştur
                  </button>
                </form>
              ) : (
                <form onSubmit={handleConfirmReset} noValidate className="space-y-4">
                  <div className="rounded-xl border border-[#7C3AED]/35 bg-[#7C3AED]/10 p-3 text-xs text-purple-700 dark:text-[#C084FC] space-y-1">
                    <p className="font-medium">SMTP yapılandırılmadığı için sıfırlama kodu doğrudan üretildi:</p>
                    <p className="font-mono select-all text-slate-900 dark:text-[#F8FAFC]">{issuedResetToken}</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-slate-600 dark:text-[#A1A1B5]">
                      Sıfırlama Kodu
                    </label>
                    <input
                      type="text"
                      value={resetToken}
                      onChange={(e) => {
                        setResetToken(e.target.value);
                        clearFieldError('resetToken');
                      }}
                      aria-invalid={Boolean(fieldErrors.resetToken)}
                      className={`${inputClass('resetToken')} font-mono`}
                    />
                    {fieldErrors.resetToken && (
                      <p role="alert" className="text-xs text-[#EF4444]">
                        {fieldErrors.resetToken}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-slate-600 dark:text-[#A1A1B5]">Yeni Şifre</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => {
                        setNewPassword(e.target.value);
                        clearFieldError('newPassword');
                      }}
                      aria-invalid={Boolean(fieldErrors.newPassword)}
                      className={inputClass('newPassword')}
                    />
                    {fieldErrors.newPassword && (
                      <p role="alert" className="text-xs text-[#EF4444]">
                        {fieldErrors.newPassword}
                      </p>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full h-11 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
                  >
                    <KeyRound className="w-4 h-4" />
                    Şifreyi Güncelle
                  </button>
                </form>
              )}

              <p className="text-center text-sm text-slate-500 dark:text-[#A1A1B5]">
                <Link to="/login" className="text-[#7C3AED] dark:text-[#C084FC] hover:underline">
                  Giriş ekranına dön
                </Link>
              </p>
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
