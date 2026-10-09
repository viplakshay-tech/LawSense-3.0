export type LegalAuthorityKind =
  | 'legislative_body'
  | 'court'
  | 'tribunal'
  | 'government_department'
  | 'regulator'
  | 'other';

export type LegalAuthorityLevel =
  | 'binding'
  | 'persuasive'
  | 'administrative'
  | 'informational'
  | 'unknown';

export type LegalSourceKind =
  | 'legislation'
  | 'regulation'
  | 'judgment'
  | 'official_guidance'
  | 'official_process'
  | 'other_official_material';

export interface LegalJurisdiction {
  id: string;
  kind: 'country' | 'state' | 'union_territory' | 'district' | 'city' | 'court_territory' | 'other';
  code: string;
  label: string;
  parentId: string | null;
}

export interface OfficialSourceReference {
  catalogId: string;
  recordId: string;
  url?: string | null;
  locator?: string | null;
}

export interface OfficialReferenceCatalog {
  id: string;
  official: boolean;
  allowedHosts: string[];
}

export type LegalProvenanceKind =
  | 'official_reference'
  | 'official_document'
  | 'repository_material'
  | 'review_attestation';

export interface LegalProvenance {
  kind: LegalProvenanceKind;
  reference: OfficialSourceReference;
  capturedAt: string;
  recordedBy: string;
  contentSha256?: string | null;
}

export interface LegalAuthority {
  id: string;
  name: string;
  kind: LegalAuthorityKind;
  authorityLevel: LegalAuthorityLevel;
  authorityLevelEvidence: OfficialSourceReference[];
  jurisdictionId: string;
  officialReference: OfficialSourceReference;
  provenance: LegalProvenance[];
}

export interface LegalSourceVersion {
  id: string;
  label: string;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  sourceRevisionId?: string | null;
}

export interface LegalSourceVerification {
  state: 'unverified' | 'verified_official' | 'rejected';
  checkedAt?: string | null;
  checkedBy?: string | null;
  evidenceReference?: OfficialSourceReference | null;
}

export interface LegalSourceFreshness {
  state: 'unknown' | 'fresh' | 'review_due' | 'stale';
  checkedAt?: string | null;
  reviewDueAt?: string | null;
}

/** One immutable, version-specific record in a canonical source's history. */
export interface LegalSource {
  id: string;
  canonicalKey: string;
  title: string;
  kind: LegalSourceKind;
  authorityId: string;
  jurisdictionId: string;
  officialReference: OfficialSourceReference;
  version: LegalSourceVersion;
  verification: LegalSourceVerification;
  freshness: LegalSourceFreshness;
  provenance: LegalProvenance[];
}

export interface LegalApplicability {
  state: 'unassessed' | 'requires_fact_assessment' | 'applicable' | 'not_applicable';
  jurisdictionId?: string | null;
  asOf?: string | null;
  assessedAt?: string | null;
  assessedBy?: string | null;
  method?: 'scope_check' | 'human_review' | null;
  basisReferences?: string[];
}

export interface LegalIssue {
  id: string;
  domain: string;
  label: string;
  kind: 'topic' | 'case_issue';
}

export interface LegalDocument {
  id: string;
  sourceId: string;
  sourceVersionId: string;
  title: string;
  mediaType: string;
  contentSha256: string;
  officialReference: OfficialSourceReference;
  provenance: LegalProvenance[];
}

export interface LegalProvision {
  id: string;
  sourceId: string;
  sourceVersionId: string;
  authorityId: string;
  jurisdictionId: string;
  locator: string;
  text: string;
  documentIds: string[];
  applicability: LegalApplicability;
  provenance: LegalProvenance[];
}

export interface LegalRule {
  id: string;
  title: string;
  proposition: string;
  legalIssueIds: string[];
  provisionIds: string[];
  applicability: LegalApplicability;
  provenance: LegalProvenance[];
}

export interface LegalProcedureStep {
  id: string;
  instruction: string;
  basisProvisionIds: string[];
  basisDocumentIds: string[];
}

export interface LegalProcedure {
  id: string;
  title: string;
  legalIssueIds: string[];
  sourceId: string;
  sourceVersionId: string;
  authorityId: string;
  jurisdictionId: string;
  steps: LegalProcedureStep[];
  applicability: LegalApplicability;
  provenance: LegalProvenance[];
}

export type LegalNodeType =
  | 'legal_issue'
  | 'source'
  | 'authority'
  | 'provision'
  | 'rule'
  | 'procedure'
  | 'document'
  | 'case_document';

export type LegalRelationshipKind =
  | 'supports'
  | 'issued_by'
  | 'derived_from'
  | 'procedure_for'
  | 'document_of'
  | 'applies_to';

export interface LegalKnowledgeRelationship {
  id: string;
  kind: LegalRelationshipKind;
  from: { type: LegalNodeType; id: string };
  to: { type: LegalNodeType; id: string };
  provenance: LegalProvenance[];
}

export interface LegalKnowledgeSnapshot {
  jurisdictions: LegalJurisdiction[];
  issues: LegalIssue[];
  authorities: LegalAuthority[];
  sources: LegalSource[];
  documents: LegalDocument[];
  provisions: LegalProvision[];
  rules: LegalRule[];
  procedures: LegalProcedure[];
  relationships: LegalKnowledgeRelationship[];
}

export interface LegalKnowledgePackage {
  jurisdictions?: LegalJurisdiction[];
  issues?: LegalIssue[];
  authorities?: LegalAuthority[];
  sources?: LegalSource[];
  documents?: LegalDocument[];
  provisions?: LegalProvision[];
  rules?: LegalRule[];
  procedures?: LegalProcedure[];
  relationships?: LegalKnowledgeRelationship[];
}

export interface LegalKnowledgeRegistry {
  readSnapshot(): Promise<LegalKnowledgeSnapshot>;
  registerPackage(knowledgePackage: LegalKnowledgePackage): Promise<void>;
}

/** Source-specific parsers implement this adapter; reasoning consumes only canonical records. */
export interface OfficialDocumentAdapter<TInput> {
  toLegalKnowledgePackage(input: TInput): Promise<LegalKnowledgePackage> | LegalKnowledgePackage;
}

export interface LegalKnowledgePolicy {
  referenceCatalogs: OfficialReferenceCatalog[];
}
