import {
  AlertTriangle,
  BadgeCheck,
  CircleHelp,
  FileCheck2,
  MapPin,
  MessageSquareText,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import type { InformationStatus } from '@/lib/api';
import { StatusPill, type StatusTone } from './StatusPill';

export type InformationDisplayStatus = InformationStatus
  | 'uncertain'
  | 'verification_required'
  | 'applicability_not_established';

const STATUS_PRESENTATION: Record<InformationDisplayStatus, {
  label: string;
  tone: StatusTone;
  icon: typeof MessageSquareText;
  explanation: string;
}> = {
  user_reported: {
    label: 'User-reported', tone: 'info', icon: MessageSquareText,
    explanation: 'This detail was reported by the user and has not been independently confirmed.',
  },
  evidence_supported: {
    label: 'Evidence-supported', tone: 'success', icon: FileCheck2,
    explanation: 'A source is linked to this record. That does not prove the source is authentic or every statement is true.',
  },
  system_inferred: {
    label: 'Uncertain · inferred', tone: 'caution', icon: Sparkles,
    explanation: 'The system inferred this detail; it has not been confirmed.',
  },
  assumption: {
    label: 'Uncertain · assumption', tone: 'caution', icon: TriangleAlert,
    explanation: 'This detail is an assumption and needs confirmation.',
  },
  uncertain: {
    label: 'Uncertain', tone: 'caution', icon: CircleHelp,
    explanation: 'The available information does not establish this detail.',
  },
  conflicting: {
    label: 'Conflicting', tone: 'danger', icon: AlertTriangle,
    explanation: 'Recorded information disagrees and the conflict remains unresolved.',
  },
  unknown: {
    label: 'Unknown', tone: 'neutral', icon: CircleHelp,
    explanation: 'This detail was not supplied or has not been established.',
  },
  verification_required: {
    label: 'Verification-required', tone: 'caution', icon: BadgeCheck,
    explanation: 'Check the source identity and current text before relying on it.',
  },
  applicability_not_established: {
    label: 'Applicability not established', tone: 'neutral', icon: MapPin,
    explanation: 'A source match does not establish that the law applies to these facts or this jurisdiction.',
  },
};

export function InformationStatusPill({
  status,
  className,
}: {
  status: InformationDisplayStatus;
  className?: string;
}) {
  const presentation = STATUS_PRESENTATION[status];

  return (
    <StatusPill
      tone={presentation.tone}
      icon={presentation.icon}
      explanation={presentation.explanation}
      className={className}
    >
      {presentation.label}
    </StatusPill>
  );
}
