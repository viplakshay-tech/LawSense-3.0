import {
  AlertTriangle,
  CircleHelp,
  FileCheck2,
  MessageSquareText,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TrustStatus } from './types';

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

const statusLabels: Record<TrustStatus, string> = {
  USER_REPORTED: 'User-reported',
  EVIDENCE_SUPPORTED: 'Evidence-supported',
  SYSTEM_INFERRED: 'System-inferred',
  ASSUMPTION: 'Assumption',
  CONFLICTING: 'Conflicting',
  UNKNOWN: 'Unknown',
};

const statusExplanations: Record<TrustStatus, string> = {
  USER_REPORTED: 'Reported by the user; not independently confirmed.',
  EVIDENCE_SUPPORTED: 'A source is linked to this record; that alone does not prove authenticity or truth.',
  SYSTEM_INFERRED: 'Inferred by the system; not confirmed.',
  ASSUMPTION: 'An assumption that needs confirmation.',
  CONFLICTING: 'Recorded information disagrees and remains unresolved.',
  UNKNOWN: 'Not supplied or not established.',
};

export interface SourceBadgeProps {
  status: TrustStatus;
  className?: string;
}

export function SourceBadge({ status, className = '' }: SourceBadgeProps) {
  const Icon = statusIcons[status];
  const label = statusLabels[status];

  return (
    <span
      aria-label={`${label}: ${statusExplanations[status]}`}
      title={statusExplanations[status]}
      className={`inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyles[status]} ${className}`}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      <span>{label}</span>
    </span>
  );
}
