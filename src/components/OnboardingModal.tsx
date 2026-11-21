import { useState } from 'react';
import { Check, ShieldCheck, Sparkles, X } from 'lucide-react';
import { apiFetch, ApiError } from '../client/api.ts';
import { useToast } from '../client/ToastContext.tsx';
import type { OnboardingState } from '../shared/types.ts';

interface Props {
  serverName: string;
  onboarding: OnboardingState;
  onClose: () => void;
  onCompleted: () => void;
}

export function OnboardingModal({ serverName, onboarding, onClose, onCompleted }: Props) {
  const { showToast } = useToast();
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>(onboarding.myRoleIds);
  const [rulesChecked, setRulesChecked] = useState(onboarding.accepted);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const toggleRole = async (roleId: string) => {
    if (onboarding.accepted) {
      try {
        const res = await apiFetch<{ assigned: boolean }>(`/servers/${onboarding.serverId}/onboarding/toggle-role`, {
          method: 'POST',
          body: JSON.stringify({ roleId }),
        });
        setSelectedRoleIds((prev) => (res.assigned ? [...prev, roleId] : prev.filter((id) => id !== roleId)));
        onCompleted();
      } catch (err) {
        showToast(err instanceof ApiError ? err.message : 'Rol güncellenemedi.', 'error');
      }
      return;
    }

    setSelectedRoleIds((prev) => (prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId]));
  };

  const handleAccept = async () => {
    if (!rulesChecked) {
      setRulesError('Devam etmek için topluluk kurallarını onaylayın.');
      return;
    }
    setRulesError(null);
    setSubmitting(true);
    try {
      await apiFetch(`/servers/${onboarding.serverId}/onboarding/accept`, {
        method: 'POST',
        body: JSON.stringify({ roleIds: selectedRoleIds }),
      });
      showToast(`${serverName} karşılama adımları tamamlandı!`, 'success');
      onCompleted();
      onClose();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Tamamlanamadı.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#151522] border border-slate-200 dark:border-[#29293D] p-5 sm:p-6 space-y-5 shadow-2xl max-h-[88dvh] overflow-y-auto animate-orbit-enter"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-[#7C3AED]/20 border border-[#A855F7]/30 flex items-center justify-center text-[#C084FC]">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold font-display">{onboarding.promptTitle}</h3>
              <p className="text-xs text-slate-500 dark:text-[#A1A1B5]">{serverName}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-[#F8FAFC] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {onboarding.rulesText && (
          <div className="rounded-xl border border-slate-200 dark:border-[#29293D] bg-slate-50 dark:bg-[#10111B] p-4 space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-[#C084FC] flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              Topluluk Kuralları
            </p>
            <p className="text-xs text-slate-600 dark:text-[#F8FAFC] whitespace-pre-wrap leading-relaxed">
              {onboarding.rulesText}
            </p>
          </div>
        )}

        {onboarding.roles.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#A1A1B5]">
              Kendine Rol Seç ({onboarding.roles.length})
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {onboarding.roles.map((r) => {
                const active = selectedRoleIds.includes(r.roleId);
                return (
                  <button
                    key={r.roleId}
                    type="button"
                    onClick={() => void toggleRole(r.roleId)}
                    className={`p-3 rounded-xl border text-left transition-all flex items-start justify-between gap-2 ${
                      active
                        ? 'border-[#A855F7] bg-[#7C3AED]/15'
                        : 'border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A]/70 hover:border-slate-400 dark:hover:border-[#A855F7]/50'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-bold flex items-center gap-1.5">
                        <span>{r.emoji || '✨'}</span>
                        <span style={r.roleColor ? { color: r.roleColor } : undefined}>{r.label || r.roleName}</span>
                      </p>
                      {r.description && (
                        <p className="text-[11px] text-slate-500 dark:text-[#A1A1B5] mt-0.5 line-clamp-2">
                          {r.description}
                        </p>
                      )}
                    </div>
                    <span
                      className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 border ${
                        active ? 'bg-[#7C3AED] border-[#A855F7] text-white' : 'border-slate-300 dark:border-[#29293D]'
                      }`}
                    >
                      {active && <Check className="w-3 h-3" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {!onboarding.accepted ? (
          <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-[#29293D]">
            <div className="space-y-1">
              <label
                className={`flex items-center gap-2.5 text-xs font-medium cursor-pointer p-2.5 rounded-xl border transition-colors ${
                  rulesError
                    ? 'border-[#EF4444] bg-[#EF4444]/5'
                    : 'border-transparent hover:bg-slate-100 dark:hover:bg-[#19192A]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={rulesChecked}
                  onChange={(e) => {
                    setRulesChecked(e.target.checked);
                    if (e.target.checked && rulesError) setRulesError(null);
                  }}
                />
                <span>Topluluk kurallarını okudum ve kabul ediyorum.</span>
              </label>
              {rulesError && (
                <p role="alert" className="text-xs text-[#EF4444] px-1">
                  {rulesError}
                </p>
              )}
            </div>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleAccept()}
              className="w-full h-10 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-50 text-white text-xs font-semibold transition-colors"
            >
              {submitting ? 'Kaydediliyor...' : 'Kuralları Onayla ve Katıl'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onClose}
            className="w-full h-10 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold transition-colors"
          >
            Tamam
          </button>
        )}
      </div>
    </div>
  );
}
