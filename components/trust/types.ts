export const TRUST_STATUSES = [
  'USER_REPORTED',
  'EVIDENCE_SUPPORTED',
  'SYSTEM_INFERRED',
  'ASSUMPTION',
  'CONFLICTING',
  'UNKNOWN',
] as const;

export type TrustStatus = (typeof TRUST_STATUSES)[number];

/** Source metadata supplied by the caller. This type does not create citations. */
export interface TrustSource {
  label?: string | null;
  documentName?: string | null;
  pageNumber?: number | null;
  locator?: string | null;
  excerpt?: string | null;
  url?: string | null;
}

export interface EvidenceTraceItem {
  id?: string;
  statement: string;
  status: TrustStatus;
  source?: TrustSource | null;
}

export interface ConflictValue {
  label: string;
  value: string | null;
  source?: TrustSource | null;
}

export interface ConflictEntry {
  id?: string;
  label: string;
  values: readonly ConflictValue[];
}

/** Citation fields must come from a supplied legal source record. */
export interface LegalCitation {
  title?: string | null;
  citation?: string | null;
  jurisdiction?: string | null;
  pinpoint?: string | null;
  url?: string | null;
}

export interface TrustSignal {
  id?: string;
  label: string;
  status: TrustStatus;
  detail?: string | null;
}

export function formatTrustStatus(status: TrustStatus): string {
  return status.replaceAll('_', ' ');
}

export function hasTrustSource(source?: TrustSource | null): boolean {
  return Boolean(
    source?.label?.trim() ||
      source?.documentName?.trim() ||
      source?.locator?.trim() ||
      source?.excerpt?.trim() ||
      source?.url?.trim() ||
      source?.pageNumber != null,
  );
}

export function getHttpUrl(value?: string | null): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}
