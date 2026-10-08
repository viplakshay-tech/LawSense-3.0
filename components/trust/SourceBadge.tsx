import {
  AlertTriangle,
  CircleHelp,
  FileCheck2,
  MessageSquareText,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { formatTrustStatus, type TrustStatus } from './types';

const statusStyles: Record<TrustStatus, string> = {
  USER_REPORTED: 'border-violet-300/25 bg-violet-300/[0.08] text-violet-100',
  EVIDENCE_SUPPORTED: 'border-emerald-300/25 bg-emerald-300/[0.08] text-emerald-100',
  SYSTEM_INFERRED: 'border-sky-300/25 bg-sky-300/[0.08] text-sky-100',
  ASSUMPTION: 'border-amber-300/25 bg-amber-300/[0.08] text-amber-100',
  CONFLICTING: 'border-rose-300/25 bg-rose-300/[0.08] text-rose-100',
  UNKNOWN: 'border-zinc-400/20 bg-zinc-400/[0.06] text-zinc-300',
};

const statusIcons: Record<TrustStatus, LucideIcon> = {
  USER_REPORTED: MessageSquareText,
  EVIDENCE_SUPPORTED: FileCheck2,
  SYSTEM_INFERRED: Sparkles,
  ASSUMPTION: TriangleAlert,
  CONFLICTING: AlertTriangle,
  UNKNOWN: CircleHelp,
};

export interface SourceBadgeProps {
  status: TrustStatus;
  className?: string;
}

export function SourceBadge({ status, className = '' }: SourceBadgeProps) {
  const Icon = statusIcons[status];

  return (
    <span
      aria-label={`Source status: ${formatTrustStatus(status)}`}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[0.08em] ${statusStyles[status]} ${className}`}
    >
      <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />
      <span>{formatTrustStatus(status)}</span>
    </span>
  );
}
