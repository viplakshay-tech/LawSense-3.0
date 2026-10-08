import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export type StatusTone = 'neutral' | 'info' | 'success' | 'caution' | 'danger';

export function StatusPill({
  children,
  tone = 'neutral',
  icon: Icon,
  explanation,
  className = '',
}: {
  children: ReactNode;
  tone?: StatusTone;
  icon?: LucideIcon;
  explanation?: string;
  className?: string;
}) {
  return (
    <span
      className={`ls-status ${className}`.trim()}
      data-tone={tone}
      aria-label={explanation ? `${children}: ${explanation}` : undefined}
      title={explanation}
    >
      {Icon && <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />}
      <span>{children}</span>
    </span>
  );
}
