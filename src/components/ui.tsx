/* Общие UI-примитивы: кнопки и инлайновые SVG-иконки (без внешних библиотек).
 * Цвета — токены темы (acc/acc2/ink/body/mut/dim), определяются в index.css. */

import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const base = (p: IconProps) => ({
  width: p.size ?? 18,
  height: p.size ?? 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...p,
});

export const IconFirst = (p: IconProps) => (
  <svg {...base(p)}><path d="M11 17l-5-5 5-5" /><path d="M18 17l-5-5 5-5" /></svg>
);
export const IconPrev = (p: IconProps) => (
  <svg {...base(p)}><path d="M15 18l-6-6 6-6" /></svg>
);
export const IconNext = (p: IconProps) => (
  <svg {...base(p)}><path d="M9 18l6-6-6-6" /></svg>
);
export const IconLast = (p: IconProps) => (
  <svg {...base(p)}><path d="M13 17l5-5-5-5" /><path d="M6 17l5-5-5-5" /></svg>
);
export const IconPlay = (p: IconProps) => (
  <svg {...base(p)}><path d="M6 4l14 8-14 8z" fill="currentColor" stroke="none" /></svg>
);
export const IconPause = (p: IconProps) => (
  <svg {...base(p)}><path d="M7 5v14M17 5v14" strokeWidth={3} /></svg>
);
export const IconFlip = (p: IconProps) => (
  <svg {...base(p)}><path d="M4 9h13l-3.5-3.5" /><path d="M20 15H7l3.5 3.5" /></svg>
);
export const IconHash = (p: IconProps) => (
  <svg {...base(p)}><path d="M9 4L7 20M17 4l-2 16M4 9h17M3 15h17" /></svg>
);
export const IconPlus = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconCopy = (p: IconProps) => (
  <svg {...base(p)}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 012-2h10" /></svg>
);
export const IconDown = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 4v12m0 0l-5-5m5 5l5-5" /><path d="M5 20h14" /></svg>
);
export const IconLoad = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 20V8m0 0l-5 5m5-5l5 5" /><path d="M5 4h14" /></svg>
);
export const IconBook = (p: IconProps) => (
  <svg {...base(p)}><path d="M4 19.5A2.5 2.5 0 016.5 17H20V3H6.5A2.5 2.5 0 004 5.5v14z" /><path d="M4 19.5A2.5 2.5 0 006.5 22H20v-5" /></svg>
);
export const IconChip = (p: IconProps) => (
  <svg {...base(p)}><rect x="6" y="6" width="12" height="12" rx="1.5" /><rect x="10" y="10" width="4" height="4" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /></svg>
);
export const IconFile = (p: IconProps) => (
  <svg {...base(p)}><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>
);
export const IconCheck = (p: IconProps) => (
  <svg {...base(p)}><path d="M4 12.5l5 5L20 6.5" /></svg>
);
export const IconWarn = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 3l10 18H2z" /><path d="M12 10v4M12 17.5v.5" /></svg>
);

export function ToolButton({
  children, onClick, title, disabled, active, accent, className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
  active?: boolean;
  accent?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={[
        'inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-md border px-2.5',
        'transition-all duration-150 select-none',
        active
          ? 'border-acc/70 bg-acc/15 text-acc2 shadow-[0_0_14px_color-mix(in_oklab,var(--accent)_18%,transparent)]'
          : accent
            ? 'border-acc/50 bg-acc/10 text-acc2 hover:border-acc hover:bg-acc/20'
            : 'border-white/10 bg-white/[.04] text-body hover:border-white/20 hover:bg-white/[.09]',
        disabled ? 'cursor-not-allowed opacity-30 hover:bg-white/[.04]' : 'active:scale-[.94]',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  );
}

export function Dot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2">
      {pulse && (
        <span
          className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
          style={{ background: color }}
        />
      )}
      <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: color }} />
    </span>
  );
}
