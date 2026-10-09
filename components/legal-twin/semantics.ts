import type { TwinEvidenceStatus, TwinNodeCategory, TwinTemporalValue } from './types';

export const TWIN_COLORS = {
  neutral: '#94a3b8',
  event: '#22d3ee',
  supported: '#34d399',
  userReported: '#60a5fa',
  uncertain: '#fbbf24',
  unknown: '#94a3b8',
  conflict: '#fb7185',
  procedure: '#818cf8',
  action: '#a3e635',
} as const;

export function categoryColor(category: TwinNodeCategory): string {
  switch (category) {
    case 'EVENT':
      return TWIN_COLORS.event;
    case 'LEGAL_ISSUE':
    case 'LAW':
    case 'PROCEDURE':
    case 'AUTHORITY':
      return TWIN_COLORS.procedure;
    case 'ACTION':
      return TWIN_COLORS.action;
    case 'EVIDENCE':
    case 'FACT':
    case 'CLAIM':
      return TWIN_COLORS.unknown;
    case 'PERSON':
    case 'PARTY':
    case 'DOCUMENT':
      return TWIN_COLORS.neutral;
  }
}

export function statusColor(status: TwinEvidenceStatus | undefined): string | undefined {
  switch (status) {
    case 'supported':
      return TWIN_COLORS.supported;
    case 'user_reported':
      return TWIN_COLORS.userReported;
    case 'uncertain':
      return TWIN_COLORS.uncertain;
    case 'unknown':
      return TWIN_COLORS.unknown;
    case 'conflict':
    case 'safety':
      return TWIN_COLORS.conflict;
    default:
      return undefined;
  }
}

export function nodeColor(category: TwinNodeCategory, status?: TwinEvidenceStatus): string {
  return statusColor(status) ?? categoryColor(category);
}

export function parseTwinTime(value: TwinTemporalValue | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && Math.abs(value) <= 8.64e15 ? value : null;
  }
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isActiveAt(
  from: TwinTemporalValue | undefined,
  to: TwinTemporalValue | undefined,
  currentTime: TwinTemporalValue | null | undefined,
): boolean {
  const now = parseTwinTime(currentTime);
  if (now === null) return true;

  const start = parseTwinTime(from);
  const end = parseTwinTime(to);
  return (start === null || start <= now) && (end === null || now < end);
}

export function formatTwinTime(value: TwinTemporalValue | null | undefined): string {
  const timestamp = parseTwinTime(value);
  if (timestamp === null) return 'Time not specified';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(timestamp) + ' UTC';
}
