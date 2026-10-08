import { Shield } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SensitiveContextBannerProps {
  /** Caller supplies the message. This component does not generate safety determinations. */
  message?: string;
  /** When true, uses a more prominent urgent style. Set only when the backend reports urgent context. */
  urgent?: boolean;
  /** Whether to show a child-sensitive notice */
  childSensitive?: boolean;
  className?: string;
}

const DEFAULT_MESSAGE =
  "Some of what you've described may indicate a potentially unsafe situation. You remain in control of what happens next.";

/**
 * A non-alarming, non-accusatory banner shown when the backend reports a sensitive safety context.
 *
 * Rules enforced by this component:
 * - Does NOT state guilt or definite abuse.
 * - Does NOT automatically contact authorities.
 * - Does NOT fabricate safety indicators.
 * - All content is caller-supplied or a fixed, carefully worded default.
 */
export function SensitiveContextBanner({
  message = DEFAULT_MESSAGE,
  urgent = false,
  childSensitive = false,
  className,
}: SensitiveContextBannerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        'rounded-2xl border p-4 sm:p-5',
        urgent
          ? 'border-rose-300/30 bg-rose-300/[0.04]'
          : 'border-amber-300/25 bg-amber-300/[0.035]',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border',
            urgent
              ? 'border-rose-300/20 bg-rose-300/[0.07] text-rose-200'
              : 'border-amber-300/20 bg-amber-300/[0.07] text-amber-200',
          )}
        >
          <Shield aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'text-[10px] font-semibold uppercase tracking-[0.18em]',
              urgent ? 'text-rose-300/80' : 'text-amber-300/80',
            )}
          >
            Safety context
          </p>
          <p className="mt-1.5 text-sm leading-6 text-zinc-200">{message}</p>
          {childSensitive && (
            <p className="mt-2 rounded-lg border border-white/[0.07] bg-black/10 px-3 py-2 text-xs leading-5 text-zinc-400">
              This case may involve a child or young person. Proceed with additional care and
              consider whether specialist support is appropriate.
            </p>
          )}
          <p className="mt-3 text-xs leading-5 text-zinc-500">
            This is not a legal finding or determination. It does not contact anyone. You decide
            what to do next.
          </p>
        </div>
      </div>
    </div>
  );
}
