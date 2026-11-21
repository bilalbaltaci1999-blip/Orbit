import React, { useEffect, useRef, useState } from 'react';
import { Palette, Check } from 'lucide-react';

interface SingleColorPickerButtonProps {
  value: string;
  onChange: (hex: string) => void;
  label?: string;
  compact?: boolean;
  align?: 'left' | 'right';
}

export function SingleColorPickerButton({
  value,
  onChange,
  label = 'Renk Seç',
  compact = false,
  align = 'left',
}: SingleColorPickerButtonProps) {
  const [open, setOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState(value);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHexDraft(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const applyHex = (raw: string) => {
    setHexDraft(raw);
    if (/^#[0-9a-fA-F]{6}$/.test(raw.trim())) {
      onChange(raw.trim().toUpperCase());
    }
  };

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        title={`${label} (${value})`}
        className={`inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-[#29293D] bg-white dark:bg-[#19192A] hover:border-[#A855F7]/60 transition-colors min-h-[40px] ${
          compact ? 'px-2.5 py-1.5' : 'px-3 py-1.5'
        }`}
      >
        <span
          className="w-5 h-5 rounded-full border border-white/40 shadow-sm shrink-0"
          style={{ backgroundColor: value }}
        />
        {!compact && <span className="text-xs font-medium text-slate-700 dark:text-[#F8FAFC]">{label}</span>}
        <span className="text-[11px] font-mono text-slate-500 dark:text-[#A1A1B5] uppercase">{value}</span>
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={`absolute top-full mt-2 z-50 w-60 rounded-2xl bg-white dark:bg-[#151522] border border-slate-200 dark:border-[#29293D] shadow-2xl p-3 space-y-3 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-[#F8FAFC]">
            <span className="flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-[#A855F7]" />
              {label}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-2 py-0.5 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-[11px] inline-flex items-center gap-1 transition-colors"
            >
              <Check className="w-3 h-3" />
              Tamam
            </button>
          </div>

          <label className="block cursor-pointer space-y-1.5">
            <span className="text-[11px] text-slate-500 dark:text-[#A1A1B5]">Tam Spektrum Renk Seçici</span>
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#7C3AED'}
              onChange={(e) => {
                const next = e.target.value.toUpperCase();
                setHexDraft(next);
                onChange(next);
              }}
              className="w-full h-11 rounded-xl border border-slate-200 dark:border-[#29293D] bg-transparent cursor-pointer p-0.5"
            />
          </label>

          <div className="space-y-1">
            <label className="text-[11px] text-slate-500 dark:text-[#A1A1B5]">Hex Kodu (#RRGGBB)</label>
            <input
              type="text"
              maxLength={7}
              value={hexDraft}
              onChange={(e) => applyHex(e.target.value)}
              placeholder="#7C3AED"
              className="w-full h-9 px-2.5 rounded-xl bg-slate-100 dark:bg-[#19192A] border border-slate-200 dark:border-[#29293D] font-mono text-xs uppercase outline-none focus:border-[#A855F7]"
            />
          </div>
        </div>
      )}
    </div>
  );
}
