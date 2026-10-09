import { jurisdictionMatch, resolveSourceVersion, sourceVersionCoversDate } from './applicability.ts';
import { isDateOnly, isTimestamp, sameOfficialReference, validateOfficialReference, validateProvenance } from './validation.ts';
import type {
  LegalApplicability,
  LegalKnowledgePolicy,
  LegalKnowledgeSnapshot,
  LegalProvision,
} from './types.ts';

export type LegalUseRefusalReason =
  | 'missing_issue'
  | 'missing_jurisdiction'
  | 'missing_effective_date'
  | 'rule_not_registered'
  | 'issue_not_linked'
  | 'basis_provision_missing'
  | 'source_missing'
  | 'source_unverified'
  | 'source_not_fresh'
  | 'authority_missing'
  | 'authority_mismatch'
  | 'authority_level_unknown'
  | 'official_reference_unconfigured'
  | 'provenance_insufficient'
  | 'version_unknown'
  | 'version_ambiguous'
  | 'version_not_effective'
  | 'jurisdiction_unknown'
  | 'jurisdiction_mismatch'
  | 'applicability_requires_review'
  | 'applicability_not_confirmed';

export interface LegalUseRequest {
  legalIssueId?: string | null;
  jurisdictionId?: string | null;
  asOf?: string | null;
  ruleId: string;
}

export type LegalUseGateResult =
  | { status: 'eligible_for_review'; ruleId: string; provisionIds: string[] }
  | { status: 'refused'; ruleId: string; reasons: LegalUseRefusalReason[] };

function applicabilityMatches(
  applicability: LegalApplicability,
  jurisdictionId: string,
  asOf: string,
): 'confirmed' | 'not_confirmed' | 'different_context' {
  if (applicability.state !== 'applicable') return 'not_confirmed';
  if (
    applicability.jurisdictionId !== jurisdictionId ||
    applicability.asOf !== asOf ||
    applicability.method !== 'human_review' ||
    !isTimestamp(applicability.assessedAt) ||
    !applicability.assessedBy?.trim() ||
    !applicability.basisReferences?.some((item) => item.trim())
  ) {
    return 'different_context';
  }
  return 'confirmed';
}

function addApplicabilityReason(
  reasons: Set<LegalUseRefusalReason>,
  applicability: LegalApplicability,
  jurisdictionId: string,
  asOf: string,
): void {
  const result = applicabilityMatches(applicability, jurisdictionId, asOf);
  if (result === 'not_confirmed') reasons.add('applicability_requires_review');
  if (result === 'different_context') reasons.add('applicability_not_confirmed');
}

function addProvenanceReasons(
  reasons: Set<LegalUseRefusalReason>,
  errors: string[],
): void {
  if (errors.length > 0) reasons.add('provenance_insufficient');
}

function matchesSourceProvenance(provision: LegalProvision, sourceId: string, officialReference: { catalogId: string; recordId: string }): boolean {
  return provision.sourceId === sourceId && provision.provenance.some((item) => sameOfficialReference(item.reference, officialReference));
}

/**
 * This gate never produces legal advice. It only allows a downstream reviewer to inspect
 * a rule when authority, source, provenance, version, jurisdiction, and applicability exist.
 */
export function evaluateRuleUse(
  request: LegalUseRequest,
  snapshot: LegalKnowledgeSnapshot,
  policy: LegalKnowledgePolicy,
): LegalUseGateResult {
  const reasons = new Set<LegalUseRefusalReason>();
  if (!request.legalIssueId?.trim()) reasons.add('missing_issue');
  if (!request.jurisdictionId?.trim()) reasons.add('missing_jurisdiction');
  if (!isDateOnly(request.asOf)) reasons.add('missing_effective_date');

  const rule = snapshot.rules.find((item) => item.id === request.ruleId);
  if (!rule) reasons.add('rule_not_registered');
  if (rule && request.legalIssueId && (
    !rule.legalIssueIds.includes(request.legalIssueId) ||
    !snapshot.issues.some((issue) => issue.id === request.legalIssueId)
  )) reasons.add('issue_not_linked');
  if (!rule?.provisionIds.length) reasons.add('basis_provision_missing');

  if (!request.jurisdictionId || !request.asOf || !rule) {
    return { status: 'refused', ruleId: request.ruleId, reasons: [...reasons] };
  }

  if (rule) {
    addApplicabilityReason(reasons, rule.applicability, request.jurisdictionId, request.asOf);
    addProvenanceReasons(reasons, validateProvenance(rule.provenance, policy, 'rule'));
    if (!rule.title.trim() || !rule.proposition.trim()) reasons.add('provenance_insufficient');
  }
  const provisions = (rule?.provisionIds ?? []).map((id) => snapshot.provisions.find((item) => item.id === id));
  if (provisions.some((item) => !item)) reasons.add('basis_provision_missing');

  for (const provision of provisions) {
    if (!provision) continue;
    addApplicabilityReason(reasons, provision.applicability, request.jurisdictionId, request.asOf);
    if (!provision.locator.trim() || !provision.text.trim()) reasons.add('provenance_insufficient');

    const source = snapshot.sources.find((item) => item.id === provision.sourceId);
    if (!source || source.version.id !== provision.sourceVersionId) {
      reasons.add('source_missing');
      continue;
    }
    if (source.verification.state !== 'verified_official') reasons.add('source_unverified');
    if (source.freshness.state !== 'fresh') reasons.add('source_not_fresh');
    if (
      !isTimestamp(source.freshness.checkedAt) ||
      !isTimestamp(source.verification.checkedAt) ||
      !source.verification.checkedBy?.trim()
    ) reasons.add('source_not_fresh');

    const authority = snapshot.authorities.find((item) => item.id === source.authorityId);
    if (!authority) {
      reasons.add('authority_missing');
    } else {
      if (authority.id !== provision.authorityId) reasons.add('authority_mismatch');
      if (authority.authorityLevel === 'unknown') reasons.add('authority_level_unknown');
      if (
        authority.authorityLevel !== 'unknown' &&
        (authority.authorityLevelEvidence.length === 0 || authority.authorityLevelEvidence.some(
          (reference) => validateOfficialReference(reference, policy, 'authority level evidence').length > 0,
        ))
      ) reasons.add('official_reference_unconfigured');
      const authorityScope = jurisdictionMatch(source.jurisdictionId, authority.jurisdictionId, snapshot.jurisdictions);
      if (authorityScope === 'mismatch') {
        reasons.add('authority_mismatch');
      }
      if (authorityScope === 'unknown') reasons.add('jurisdiction_unknown');
      if (
        validateOfficialReference(authority.officialReference, policy, 'authority').length ||
        validateProvenance(authority.provenance, policy, 'authority').length ||
        !authority.provenance.some((item) => sameOfficialReference(item.reference, authority.officialReference))
      ) {
        reasons.add('official_reference_unconfigured');
      }
    }

    const referenceErrors = validateOfficialReference(source.officialReference, policy, 'source');
    const verificationReferenceErrors = source.verification.evidenceReference
      ? validateOfficialReference(source.verification.evidenceReference, policy, 'verification evidence')
      : ['verification evidence missing'];
    if (referenceErrors.length || verificationReferenceErrors.length) reasons.add('official_reference_unconfigured');
    addProvenanceReasons(reasons, validateProvenance(source.provenance, policy, 'source'));
    if (!source.provenance.some((item) => sameOfficialReference(item.reference, source.officialReference))) {
      reasons.add('provenance_insufficient');
    }
    addProvenanceReasons(reasons, validateProvenance(provision.provenance, policy, 'provision'));
    if (!matchesSourceProvenance(provision, source.id, source.officialReference)) reasons.add('provenance_insufficient');
    if (!rule?.provenance.some((item) => sameOfficialReference(item.reference, source.officialReference))) {
      reasons.add('provenance_insufficient');
    }
    for (const documentId of provision.documentIds) {
      const document = snapshot.documents.find((item) => item.id === documentId);
      if (
        !document ||
        document.sourceId !== source.id ||
        document.sourceVersionId !== source.version.id ||
        validateProvenance(document.provenance, policy, 'document').length
      ) reasons.add('provenance_insufficient');
    }

    const version = sourceVersionCoversDate(source, request.asOf);
    if (version === null) reasons.add('version_unknown');
    if (version === false) reasons.add('version_not_effective');
    const series = resolveSourceVersion(snapshot.sources, source.canonicalKey, request.asOf);
    if (series.state === 'unknown') reasons.add('version_unknown');
    if (series.state === 'ambiguous') reasons.add('version_ambiguous');
    if (series.state === 'resolved' && series.source.id !== source.id) reasons.add('version_not_effective');

    const geographicMatch = jurisdictionMatch(request.jurisdictionId, source.jurisdictionId, snapshot.jurisdictions);
    if (geographicMatch === 'unknown') reasons.add('jurisdiction_unknown');
    if (geographicMatch === 'mismatch') reasons.add('jurisdiction_mismatch');
    const provisionScope = jurisdictionMatch(request.jurisdictionId, provision.jurisdictionId, snapshot.jurisdictions);
    if (provisionScope === 'unknown') reasons.add('jurisdiction_unknown');
    if (provisionScope === 'mismatch') reasons.add('jurisdiction_mismatch');
  }

  if (reasons.size > 0) return { status: 'refused', ruleId: request.ruleId, reasons: [...reasons] };
  return {
    status: 'eligible_for_review',
    ruleId: request.ruleId,
    provisionIds: rule?.provisionIds ?? [],
  };
}
