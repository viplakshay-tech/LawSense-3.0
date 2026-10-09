import type { LegalApplicability, LegalJurisdiction, LegalSource } from './types.ts';
import { isDateOnly } from './validation.ts';

export type JurisdictionMatch = 'matched' | 'mismatch' | 'unknown';

/** Returns whether a case location is the recorded source scope or one of its descendants. */
export function jurisdictionMatch(
  caseJurisdictionId: string | null | undefined,
  sourceJurisdictionId: string | null | undefined,
  jurisdictions: LegalJurisdiction[],
): JurisdictionMatch {
  if (!caseJurisdictionId || !sourceJurisdictionId) return 'unknown';
  const byId = new Map(jurisdictions.map((item) => [item.id, item]));
  if (!byId.has(caseJurisdictionId) || !byId.has(sourceJurisdictionId)) return 'unknown';

  let current = byId.get(caseJurisdictionId);
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    if (current.id === sourceJurisdictionId) return 'matched';
    visited.add(current.id);
    if (current.parentId && !byId.has(current.parentId)) return 'unknown';
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return 'mismatch';
}

export function sourceVersionCoversDate(source: LegalSource, asOf: string): boolean | null {
  const { effectiveFrom, effectiveUntil } = source.version;
  if (!isDateOnly(asOf) || !isDateOnly(effectiveFrom) || (effectiveUntil && !isDateOnly(effectiveUntil))) {
    return null;
  }
  return effectiveFrom <= asOf && (!effectiveUntil || asOf <= effectiveUntil);
}

export function resolveSourceVersion(
  sources: LegalSource[],
  canonicalKey: string,
  asOf: string,
): { state: 'resolved'; source: LegalSource } | { state: 'unknown' | 'ambiguous' } {
  const versions = sources.filter((source) => source.canonicalKey === canonicalKey);
  const matches = versions.filter((source) => sourceVersionCoversDate(source, asOf) === true);
  if (matches.length === 1) return { state: 'resolved', source: matches[0] };
  if (matches.length > 1) return { state: 'ambiguous' };
  return { state: 'unknown' };
}

/** Automated checks only screen geography and dates; they never confirm legal application to facts. */
export function assessRecordedApplicability(
  source: LegalSource,
  context: { jurisdictionId?: string | null; asOf?: string | null; evaluatedAt: string },
  jurisdictions: LegalJurisdiction[],
): LegalApplicability {
  if (!context.jurisdictionId || !context.asOf || !isDateOnly(context.asOf)) {
    return { state: 'unassessed' };
  }

  const geographicMatch = jurisdictionMatch(context.jurisdictionId, source.jurisdictionId, jurisdictions);
  if (geographicMatch === 'unknown') return { state: 'unassessed' };
  if (geographicMatch === 'mismatch') {
    return {
      state: 'not_applicable',
      jurisdictionId: context.jurisdictionId,
      asOf: context.asOf,
      assessedAt: context.evaluatedAt,
      assessedBy: 'scope-check',
      method: 'scope_check',
      basisReferences: [source.id],
    };
  }

  const dateMatch = sourceVersionCoversDate(source, context.asOf);
  if (dateMatch === false) {
    return {
      state: 'not_applicable',
      jurisdictionId: context.jurisdictionId,
      asOf: context.asOf,
      assessedAt: context.evaluatedAt,
      assessedBy: 'scope-check',
      method: 'scope_check',
      basisReferences: [source.id],
    };
  }
  if (dateMatch === null) return { state: 'unassessed' };

  return {
    state: 'requires_fact_assessment',
    jurisdictionId: context.jurisdictionId,
    asOf: context.asOf,
    assessedAt: context.evaluatedAt,
    assessedBy: 'scope-check',
    method: 'scope_check',
    basisReferences: [source.id],
  };
}
