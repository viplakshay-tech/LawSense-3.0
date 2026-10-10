const BASE_URL = '/api';

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'unknown';

export type InformationStatus =
  | 'user_reported'
  | 'evidence_supported'
  | 'system_inferred'
  | 'assumption'
  | 'conflicting'
  | 'unknown';

export interface EvidenceProvenance {
  documentId: string;
  pageNumber: number;
  confidence: number;
  status: InformationStatus;
  extractionMethod: string;
  source: 'document';
  confirmedByUser?: boolean;
  confirmedAt?: string | null;
}

export interface CaseFact {
  id: string;
  key: string;
  /** The backend permits any JSON value for a fact. */
  value: unknown;
  status: InformationStatus;
  confidence: ConfidenceLevel;
  sourceIds: string[];
  notes?: string | null;
  provenance: EvidenceProvenance[];
}

export interface CaseEvent {
  id: string;
  type: string;
  description: string;
  date?: string | null;
  datePrecision: 'exact' | 'approximate' | 'unknown';
  partyIds: string[];
  evidenceIds: string[];
}

export interface CaseDocumentPage {
  pageNumber: number;
  extractionMethod: string;
  processingStatus: 'extracted' | 'ocr_required' | 'failed';
  textLength: number;
}

export interface CaseDocument {
  id: string;
  filename: string;
  mimeType: 'application/pdf' | 'image/png' | 'image/jpeg';
  extension: '.pdf' | '.png' | '.jpg' | '.jpeg';
  fileSize: number;
  sha256: string;
  pageCount: number;
  processingTimestamp: string;
  processingStatus: 'extracted' | 'ocr_required' | 'failed';
  classification: string;
  classificationConfidence: number;
  classificationSignals: string[];
  pages: CaseDocumentPage[];
  errors: string[];
  reviewStatus: 'awaiting_confirmation' | 'confirmed';
  confirmationHistory: Array<{
    confirmedAt: string;
    findingIds: string[];
  }>;
}

export interface DocumentUploadResponse {
  caseId: string;
  documentId: string;
  processingStatus: 'extracted' | 'ocr_required' | 'failed';
  document: CaseDocument;
  extractedValues: Array<{
    field: string;
    value: unknown;
    provenance: EvidenceProvenance;
  }>;
}

export type EvidenceSource = 'user' | 'document' | 'system';

export interface EvidenceItem {
  id: string;
  type: string;
  title: string;
  source: EvidenceSource;
  status: InformationStatus;
  documentId?: string | null;
  extractedFacts: string[];
  supportsClaimIds: string[];
  conflictsWithClaimIds: string[];
  processingStatus?: 'processing' | 'extracted' | 'ocr_required' | 'failed' | null;
}

export interface LegalIssue {
  id: string;
  category: string;
  subcategory?: string | null;
  confidence: ConfidenceLevel;
  rationale: string[];
}

export interface Jurisdiction {
  country?: string | null;
  state?: string | null;
  district?: string | null;
  city?: string | null;
  locationText?: string | null;
  basis: 'user_reported' | 'document' | 'inferred' | 'unknown';
}

export interface CaseIntent {
  objective: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
}

export interface CaseMetadata {
  createdAt: string;
  updatedAt: string;
  language?: string | null;
}

export interface CasePerson {
  name?: string | null;
  contact?: string | null;
}

export interface CaseParty {
  id: string;
  name?: string | null;
  role: string;
  relationship?: string | null;
  attributes: Record<string, unknown>;
}

export interface CaseClaim {
  id: string;
  text: string;
  status: InformationStatus;
  evidenceIds: string[];
}

export type JourneyStageName =
  | 'UNDERSTAND'
  | 'FACTS'
  | 'EVIDENCE'
  | 'LAW'
  | 'OPTIONS'
  | 'NEXT_STEP';

export interface SafetyIndicatorSummary {
  category: string;
  confidence: string;
  sourceIds: string[];
  status: 'system_inferred';
}

export type WomenSafetyDomain =
  | 'domestic_abuse'
  | 'sexual_violence'
  | 'workplace_sexual_harassment'
  | 'stalking'
  | 'threats_coercion'
  | 'cyber_harassment'
  | 'intimate_image_abuse'
  | 'dowry_related_abuse'
  | 'financial_control_abuse'
  | 'trafficking_exploitation';

export type WomenSafetyUrgency =
  | 'NORMAL'
  | 'CONCERNING'
  | 'URGENT'
  | 'IMMEDIATE_DANGER'
  | 'NOT_SURE';

export interface WomenSafetyContextSummary {
  domains: WomenSafetyDomain[];
  domainEvidence: Array<{
    domain: WomenSafetyDomain;
    triggerCategories: string[];
    status: 'system_inferred';
  }>;
  urgency: WomenSafetyUrgency;
  immediateDangerAnswer?: 'yes' | 'no' | 'not_sure' | null;
  jurisdictionStatus: 'known' | 'unknown';
  jurisdiction?: string | null;
  state?: string | null;
  legalIssueMappings: Array<{
    domain: WomenSafetyDomain;
    status: string;
    candidateIssueCategories: string[];
    matchedCaseIssueIds: string[];
    sourceRecordIds: string[];
  }>;
  procedures: Array<{
    recordId: string;
    title: string;
    jurisdiction?: string | null;
    verificationStatus?: string | null;
    applicabilityStatus?: string | null;
    jurisdictionMatchStatus?: string | null;
    sourceIds: string[];
    status: 'candidate_record_requires_review';
  }>;
  evidencePreservationGuidance: string[];
  actions: Array<{
    id: string;
    type: string;
    status: string;
    condition?: string | null;
    requiresUserChoice: boolean;
    jurisdictionRequired: boolean;
    sourceIds: string[];
    automaticContact: false;
  }>;
  legalSources: Array<{
    recordId: string;
    sourceId: string;
    retrievalTime?: string | null;
    sourceUrl?: string | null;
    provisionId?: string | null;
    pageSectionReference?: string | null;
    jurisdiction?: string | null;
    verificationStatus?: string | null;
    freshnessStatus?: string | null;
    applicabilityStatus?: string | null;
    jurisdictionMatchStatus?: string | null;
  }>;
  contactedAnyone: false;
}

export interface SafetyContextSummary {
  context: 'none' | 'sensitive' | 'potentially_unsafe' | 'urgent_safety_context';
  confidence: string;
  urgency: 'none' | 'elevated' | 'urgent';
  indicators: SafetyIndicatorSummary[];
  sourceIds: string[];
  assessmentStatus: 'system_inferred';
  recommendedSafetyPrompt?: string | null;
  womenSafetyContext?: WomenSafetyContextSummary | null;
}

export interface LegalKnowledgeProvenance {
  sourceId: string;
  retrievalTime: string;
  documentId?: string | null;
  provisionId?: string | null;
  pageSectionReference?: string | null;
  sourceUrl?: string | null;
}

export interface LegalKnowledgeRecordSummary {
  id: string;
  title: string;
  type: string;
  status: string;
  jurisdiction?: string | null;
  authority?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  reference?: string | null;
  version?: string | null;
  effectiveFrom?: string | null;
  authorityTier?: string | null;
  provenance: LegalKnowledgeProvenance[];
  sourceVerificationStatus?: string | null;
  sourceFreshnessStatus?: string | null;
  sourceApplicabilityStatus?: string | null;
  jurisdictionLabel?: string | null;
  jurisdictionMatchStatus?: 'matched' | 'mismatch' | 'unknown' | 'source_jurisdiction_unmapped';
}

export interface LegalKnowledgeSummary {
  status: 'empty' | 'records_found';
  records: LegalKnowledgeRecordSummary[];
  lawMatches: LegalMatchSummary[];
  supportResources: LegalSupportResourceSummary[];
}

export interface LegalMatchSummary {
  candidateId: string;
  relatedIssueIds: string[];
  actTitle: string;
  actVersion?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  provisionTitle: string;
  provisionReference?: string | null;
  whyItMayApply: string;
  evidenceAssessment: 'supported' | 'plausible' | 'unclear';
  assessmentFactors: Record<string, string>;
  assessmentRationale: string[];
  supportingFacts: Array<{ text: string; sourceId: string; status: string }>;
  missingFacts: string[];
  clarifyingQuestions: string[];
  conflictingEvidence: string[];
  jurisdiction: Record<string, unknown>;
  temporalLimitation: string;
  limitations: string[];
  competentAuthority: Record<string, unknown>;
  procedures: Record<string, unknown>;
  requiredDocuments: Record<string, unknown>;
  verifiedDeadlines: Record<string, unknown>;
  officialFilingLinks: Record<string, unknown>;
  officialSourceLinks: Array<{ title: string; url: string; kind: string }>;
  source: Record<string, unknown>;
  notice: string;
}

export interface LegalSupportResourceSummary {
  id: string;
  title: string;
  audience: string;
  url: string;
  phone?: string | null;
  purpose: string;
  verificationStatus: 'official_source_link';
}

export interface IndiaCodeSourceProvenance {
  provider: string;
  providerKind: 'third_party_api';
  providerEndpoint: string;
  retrievedAt: string;
  verificationStatus: 'unverified';
  verificationNote: string;
  officialVerificationPortals: string[];
}

export interface IndiaCodeSearchHit {
  kind?: string | null;
  title?: string | null;
  reference?: string | null;
  snippet?: string | null;
  resultUse: 'discovery_only';
  textStatus: 'snippet_is_not_full_provision_text';
  providerUrl?: string | null;
  officialSourceUrl?: string | null;
  jurisdictionScope: 'central' | 'state_or_ut' | 'unknown';
  jurisdictionRaw?: string | null;
  providerRecord: Record<string, unknown>;
}

export interface IndiaCodeSearchResponse {
  status: 'available';
  query: string;
  total?: number | null;
  count?: number | null;
  results: IndiaCodeSearchHit[];
  source: IndiaCodeSourceProvenance;
}

export interface IndiaCodeAct {
  id?: string | null;
  title?: string | null;
  shortTitle?: string | null;
  actNumber?: string | null;
  actYear?: string | null;
  ministry?: string | null;
  jurisdictionScope: 'central' | 'state_or_ut' | 'unknown';
  jurisdictionRaw?: string | null;
  unit?: string | null;
  sectionCount?: number | null;
  inForce?: boolean | string | null;
  effectiveOrCommencementDate?: string | null;
  providerUrl?: string | null;
  officialSourceUrl?: string | null;
  verificationStatus: 'unverified';
  providerRecord: Record<string, unknown>;
}

export interface IndiaCodeActsResponse {
  status: 'available';
  acts: IndiaCodeAct[];
  returnedCount: number;
  resultLimit: number;
  truncated: boolean;
  source: IndiaCodeSourceProvenance;
}

export interface IndiaCodeProvisionResponse {
  status: 'available';
  actTitle?: string | null;
  actNumber?: string | null;
  actYear?: string | null;
  provisionUnit: 'section' | 'article' | 'rule';
  provisionNumber?: string | null;
  provisionHeading?: string | null;
  provisionText?: string | null;
  jurisdictionScope: 'central' | 'state_or_ut' | 'unknown';
  jurisdictionRaw?: string | null;
  effectiveOrCommencementDate?: string | null;
  providerUrl?: string | null;
  officialSourceUrl?: string | null;
  verificationStatus: 'unverified';
  providerRecord: Record<string, unknown>;
  source: IndiaCodeSourceProvenance;
}

export interface JourneyStepSummary {
  id: string;
  stage: JourneyStageName;
  title: string;
  description: string;
  status: string;
  relatedIds: string[];
}

export interface JourneyUnknownSummary {
  id: string;
  question: string;
  priority: string;
  relatedTo?: string | null;
}

export interface JourneyEvidenceSummary {
  id: string;
  item: string;
  purpose: string;
  availability: string;
}

export interface JourneyDocumentSummary {
  id: string;
  document: string;
  purpose: string;
  availability: string;
}

export interface JourneyPathSummary {
  id: string;
  label: string;
  description: string;
  status: string;
  jurisdictionRequired: boolean;
}

export interface JourneyRiskSummary {
  id: string;
  description: string;
  escalationTrigger: string;
  severity: string;
}

export interface JourneyActionSummary {
  id: string;
  action: string;
  reason: string;
  stage: JourneyStageName;
  condition?: string | null;
}

export interface JourneySummary {
  id: string;
  caseId: string;
  currentSituation: string;
  steps: JourneyStepSummary[];
  unknowns: JourneyUnknownSummary[];
  requiredEvidence: JourneyEvidenceSummary[];
  possiblePaths: JourneyPathSummary[];
  requiredDocuments: JourneyDocumentSummary[];
  nextActions: JourneyActionSummary[];
  escalationPoints: JourneyRiskSummary[];
  jurisdictionStatus: 'known' | 'unknown';
  legalKnowledgeStatus: string;
}

export type JourneyExecutionStageName =
  | 'Problem'
  | 'Clarify'
  | 'Facts'
  | 'Evidence'
  | 'Law'
  | 'Possible Paths'
  | 'Document'
  | 'Official Resource'
  | 'Action'
  | 'Follow-up';

export interface JourneyExecutionStageInput {
  key: string;
  value: unknown;
  source_ids: string[];
  provenance_ids: string[];
  recorded_at: string | null;
}

export interface JourneyExecutionStageProgress {
  stage: JourneyExecutionStageName;
  required_inputs: string[];
  inputs: JourneyExecutionStageInput[];
  completed: boolean;
  completed_at: string | null;
}

export interface JourneyExecutionBlocker {
  code: string;
  stage: JourneyExecutionStageName;
  message: string;
  related_id: string | null;
  action_id: string | null;
}

export interface JourneyExecutionMissingInformation {
  id: string;
  question: string;
  status: 'open' | 'answered' | 'cannot_determine';
  answer: string | null;
  source_ids: string[];
  provenance_ids: string[];
  related_to: string | null;
}

export interface JourneyExecutionEvidenceRequest {
  id: string;
  item: string;
  purpose: string;
  status: 'not_confirmed' | 'available' | 'unavailable' | 'not_applicable';
  notes: string | null;
  source_ids: string[];
  provenance_ids: string[];
}

export interface JourneyExecutionDocumentRequest {
  id: string;
  document: string;
  purpose: string;
  status: 'not_confirmed' | 'available' | 'unavailable' | 'not_applicable';
  notes: string | null;
  source_ids: string[];
  provenance_ids: string[];
}

export interface JourneyExecutionUserAction {
  id: string;
  action: string;
  reason: string;
  stage: JourneyExecutionStageName;
  condition: string | null;
  jurisdiction_required: boolean;
  status: 'proposed' | 'in_progress' | 'waiting' | 'completed' | 'cancelled';
  completion: {
    recorded_at: string;
    user_reported_outcome: string;
    provenance_ids: string[];
  } | null;
}

export interface JourneyExecutionProceduralNextStep {
  id: string;
  description: string;
  reason: string;
  stage: JourneyExecutionStageName;
  condition: string | null;
  jurisdiction_required: boolean;
}

export interface JourneyExecutionTimelineEvent {
  id: string;
  sequence: number;
  event_type: string;
  summary: string;
  actor: string;
  stage: JourneyExecutionStageName | null;
  occurred_at: string | null;
  related_ids: string[];
  provenance_ids: string[];
}

export interface JourneyExecutionProvenance {
  id: string;
  source_type: string;
  source_id: string;
  target_id: string;
  detail: string;
  recorded_at: string | null;
}

export interface JourneyExecutionUncertainty {
  id: string;
  category: string;
  description: string;
  source_ids: string[];
  related_id: string | null;
}

export type JourneyReadinessDimensionName =
  | 'facts'
  | 'evidence'
  | 'jurisdiction'
  | 'legal_grounding'
  | 'documents'
  | 'procedure'
  | 'safety';

export interface JourneyReadinessBlocker {
  id: string;
  code: string;
  dimension: JourneyReadinessDimensionName;
  message: string;
  severity: string;
  related_ids: string[];
  source_ids: string[];
  provenance_ids: string[];
}

export interface JourneyReadinessDimension {
  name: JourneyReadinessDimensionName;
  score: number;
  level: 'ready' | 'partial' | 'blocked' | 'unknown';
  explanation: string;
  blocker_ids: string[];
  source_ids: string[];
}

export interface JourneyCaseReadiness {
  score: number;
  explanation: string;
  dimensions: JourneyReadinessDimension[];
  blockers: JourneyReadinessBlocker[];
}

export interface JourneyExecutionActionHistoryEntry {
  id: string;
  sequence: number;
  event_type: string;
  summary: string;
  actor: string;
  occurred_at: string | null;
  related_ids: string[];
  provenance_ids: string[];
}

export interface JourneyExecutionNextAction {
  id: string;
  action: string;
  reason: string;
  status: 'BLOCKED' | 'AVAILABLE' | 'IN_PROGRESS' | 'WAITING' | 'COMPLETED';
  dimension: JourneyReadinessDimensionName;
  stage: JourneyExecutionStageName;
  priority: number;
  source_type: string;
  source_ids: string[];
  dependencies: string[];
  blocker_ids: string[];
  provenance_ids: string[];
  history: JourneyExecutionActionHistoryEntry[];
}

export interface JourneyExecutionResponseData {
  id: string;
  case_id: string;
  current_stage: JourneyExecutionStageName;
  jurisdiction: Record<string, unknown>;
  jurisdiction_status: string;
  stage_progress: JourneyExecutionStageProgress[];
  missing_information: JourneyExecutionMissingInformation[];
  evidence_requests: JourneyExecutionEvidenceRequest[];
  document_requests: JourneyExecutionDocumentRequest[];
  user_actions: JourneyExecutionUserAction[];
  procedural_next_steps: JourneyExecutionProceduralNextStep[];
  timeline_events: JourneyExecutionTimelineEvent[];
  provenance: JourneyExecutionProvenance[];
  uncertainties: JourneyExecutionUncertainty[];
  completed_stages: JourneyExecutionStageName[];
  blocked_stages: JourneyExecutionStageName[];
  blockers: JourneyExecutionBlocker[];
  recorded_fact_count: number;
  conflicts: string[];
  assumptions: string[];
  pending_evidence_reviews: Array<{
    document_id: string;
    evidence_id: string | null;
    filename: string;
    source_ids: string[];
    provenance_ids: string[];
  }>;
  safety_context: string;
  safety_urgency: string;
  safety_source_ids: string[];
  legal_records_available: boolean;
  case_readiness: JourneyCaseReadiness | null;
  action_plan: JourneyExecutionNextAction[];
  next_best_action: JourneyExecutionNextAction | null;
}

export interface JourneyExecutionResponse {
  caseId: string;
  status: 'available';
  legalKnowledgeStatus: 'available' | 'unavailable';
  execution: JourneyExecutionResponseData;
}

export interface DecisionPathStepSummary {
  id: string;
  action: string;
  reason: string;
  status: string;
  relatedRequirementIds: string[];
}

export interface DecisionPathSummary {
  id: string;
  label: string;
  description: string;
  status: string;
  steps: DecisionPathStepSummary[];
  requiredEvidenceIds: string[];
  requiredDocumentIds: string[];
  blockingConditionIds: string[];
}

export interface DecisionScenarioSummary {
  caseId: string;
  currentState: string;
  paths: DecisionPathSummary[];
  requiredEvidence: Array<{ id: string; item: string; purpose: string; availability: string }>;
  requiredDocuments: Array<{ id: string; document: string; purpose: string; availability: string }>;
  unknowns: Array<{ id: string; question: string; priority: string; relatedTo?: string | null }>;
  risks: Array<{ id: string; description: string; escalationTrigger: string; severity: string }>;
  blockingConditions: Array<{ id: string; description: string; status: string }>;
  nextAction: string;
  nextActionReason: string;
  legalInformationStatus: string;
}

export interface CaseAnalysis {
  safetyContext: SafetyContextSummary;
  legalKnowledge: LegalKnowledgeSummary;
  journey: JourneySummary;
  decisionScenario?: DecisionScenarioSummary | null;
}

export interface CaseState {
  id: string;
  title?: string | null;
  initialStatement?: string | null;
  person: CasePerson;
  parties: CaseParty[];
  facts: CaseFact[];
  events: CaseEvent[];
  evidence: EvidenceItem[];
  documents: CaseDocument[];
  claims: CaseClaim[];
  jurisdiction: Jurisdiction;
  legalIssues: LegalIssue[];
  intent?: CaseIntent | null;
  unknowns: string[];
  skippedClarificationIds: string[];
  assumptions: string[];
  conflicts: string[];
  metadata: CaseMetadata;
  analysis?: CaseAnalysis | null;
}

export type CompiledDocumentType =
  | 'formal_demand_representation'
  | 'complaint_draft'
  | 'grievance_application'
  | 'notice_response'
  | 'supporting_statement_chronology'
  | 'evidence_index'
  | 'filing_checklist';

export type CompiledDocumentFieldStatus =
  | 'user_reported'
  | 'evidence_supported'
  | 'user_authored'
  | 'system_inferred'
  | 'unsupported'
  | 'missing'
  | 'conflicting';

export interface CompiledDocumentProvenance {
  sourceType: string;
  sourceId: string;
  label: string;
  status: string;
  documentId?: string | null;
  pageNumber?: number | null;
  confidence?: number | null;
  sourceUrl?: string | null;
  reference?: string | null;
  confirmedByUser?: boolean | null;
}

export interface CompiledDocumentField {
  id: string;
  label: string;
  value?: string | null;
  status: CompiledDocumentFieldStatus;
  required: boolean;
  material: boolean;
  sourceFactIds: string[];
  sourceEvidenceIds: string[];
  provenance: CompiledDocumentProvenance[];
  conflicts: Array<{ value: string; sourceFactIds: string[]; provenance: CompiledDocumentProvenance[] }>;
  missingMarker?: string | null;
  legalSourceId?: string | null;
}

export interface CompiledDocumentDraft {
  id: string;
  caseId: string;
  templateId: string;
  documentType: CompiledDocumentType;
  title: string;
  fields: Record<string, CompiledDocumentField>;
  factMappings: Array<{
    factId: string;
    factKey: string;
    fieldId: string;
    mappingRule: string;
    fieldStatus: CompiledDocumentFieldStatus;
    provenance: CompiledDocumentProvenance[];
  }>;
  conflicts: Array<{ id: string; summary: string; fieldId?: string | null; sourceIds: string[] }>;
  unsupportedMaterialFactIds: string[];
  missingInformation: string[];
  content: string;
  sourceCaseFingerprint: string;
  sourceCaseUpdatedAt: string;
  reviewState: 'draft' | 'reviewed' | 'stale';
  confirmedAt?: string | null;
  missingInformationAcknowledged: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CompiledDocumentPackage {
  id: string;
  caseId: string;
  title: string;
  documents: CompiledDocumentDraft[];
  sourceCaseFingerprint: string;
  sourceCaseUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExportReadyDocument {
  status: 'ready' | 'blocked';
  documentId: string;
  caseId: string;
  filename: string;
  content: string;
  contentSha256: string;
  sourceCaseFingerprint: string;
  provenance: CompiledDocumentProvenance[];
  blockers: string[];
}

export interface ExportReadyPackage {
  status: 'ready' | 'blocked';
  packageId: string;
  caseId: string;
  filename: string;
  documents: ExportReadyDocument[];
  blockers: string[];
  createdAt: string;
}

export interface CreateDocumentPackagePayload {
  templateIds?: string[];
  fieldValuesByTemplate?: Record<string, Record<string, string>>;
  legalSourceIdsByTemplate?: Record<string, Record<string, string>>;
  includedFactIdsByTemplate?: Record<string, string[]>;
  factEditsByTemplate?: Record<string, Record<string, string>>;
}

export interface TwinProvenance {
  sourceId: string;
  sourceType: string;
  sourcePath: string;
  status: InformationStatus;
  confidence?: number | null;
  pageNumber?: number | null;
  extractionMethod?: string | null;
  details?: string | null;
  confirmedByUser: boolean;
  confirmedAt?: string | null;
}

export type TwinNodeKind =
  | 'PERSON'
  | 'PARTY'
  | 'EVENT'
  | 'FACT'
  | 'CLAIM'
  | 'DOCUMENT'
  | 'EVIDENCE'
  | 'LEGAL_ISSUE'
  | 'LAW'
  | 'PROCEDURE'
  | 'AUTHORITY'
  | 'ACTION';

export interface TwinNodeRecord {
  id: string;
  kind: TwinNodeKind;
  label: string;
  status: InformationStatus;
  provenance: TwinProvenance[];
  properties: Record<string, unknown>;
  occurredAt?: string | null;
  recordedAt?: string | null;
}

export interface TwinEdgeRecord {
  id: string;
  sourceId: string;
  targetId: string;
  kind: string;
  status: InformationStatus;
  provenance: TwinProvenance[];
  recordedAt?: string | null;
}

export interface TwinTimelineEvent {
  id: string;
  kind: string;
  summary: string;
  occurredAt?: string | null;
  dateValue?: string | null;
  datePrecision: 'exact' | 'approximate' | 'unknown';
  relatedNodeIds: string[];
  status: InformationStatus;
  provenance: TwinProvenance[];
}

export interface TwinSnapshotSummary {
  caseId: string;
  asOf: string;
  nodes: TwinNodeRecord[];
  edges: TwinEdgeRecord[];
  timeline: TwinTimelineEvent[];
  context: Record<string, unknown>;
  temporallyUncertainContextKeys: string[];
  unresolvedNodeIds: string[];
  temporallyUncertainNodeIds: string[];
  limitations: string[];
}

export interface LegalTwinSummary {
  caseId: string;
  timeline: TwinTimelineEvent[];
  snapshot: TwinSnapshotSummary;
}

export interface TwinActionReadinessChange {
  id: string;
  beforeStatus?: string | null;
  afterStatus?: string | null;
}

export interface TwinDeltaSummary {
  caseId: string;
  fromAsOf: string;
  toAsOf: string;
  addedNodeIds: string[];
  removedNodeIds: string[];
  changedNodeIds: string[];
  addedEdgeIds: string[];
  removedEdgeIds: string[];
  changedEdgeIds: string[];
  impactedNodeIds: string[];
  impactedEdgeIds: string[];
  affectedActionIds: string[];
  impactedDocumentIds: string[];
  staleDraftDocumentIds: string[];
  actionReadinessChanges: TwinActionReadinessChange[];
}

export interface CreateCaseRequest {
  initialStatement: string;
  title: string | null;
  language: string | null;
  personName: string | null;
  inputMethod?: 'text' | 'voice';
}

export type VoiceProcessingStatus =
  | 'success'
  | 'unsupported'
  | 'provider_unavailable'
  | 'invalid_audio'
  | 'processing_error';

export interface VoiceTranscriptResponse {
  status: VoiceProcessingStatus;
  transcript?: string | null;
  detectedLanguage?: string | null;
  language?: 'english' | 'hindi' | 'hinglish' | null;
  caseState?: CaseState | null;
  detail?: string | null;
}

export interface VoiceCommitResponse {
  status: 'success';
  caseId: string;
  sourceId: string;
  language: 'english' | 'hindi' | 'hinglish';
  transcript: string;
  caseState: CaseState;
}

export interface VoiceProviderAvailability {
  speechToTextAvailable: boolean;
  languageDetectorAvailable: boolean;
  speechToTextProvider?: string | null;
  processingLocation?: 'local' | 'server' | 'none';
  textToSpeechAvailable?: boolean;
  textToSpeechProvider?: string | null;
  textToSpeechProcessingLocation?: 'local' | 'server' | 'none';
  detail?: string | null;
}

export type ClarificationCategory =
  | 'jurisdiction'
  | 'dates'
  | 'parties'
  | 'objective'
  | 'evidence'
  | 'safety'
  | 'other';

export interface ClarificationSource {
  source_id: string;
  source_type: 'case_state' | 'journey';
  source_path: string;
  text: string;
  priority: string;
  related_to?: string | null;
}

export interface ClarificationQuestion {
  id: string;
  case_id: string;
  category: ClarificationCategory;
  target: string;
  question: string;
  language: 'english' | 'hindi' | 'hinglish';
  priority: number;
  sources: ClarificationSource[];
}

export interface ClarificationQuestions {
  case_id: string;
  questions: ClarificationQuestion[];
}

export async function healthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    return res.ok;
  } catch (error) {
    console.error('Health check failed:', error);
    return false;
  }
}

export type GuideChatLanguage = 'english' | 'hindi' | 'hinglish';

export interface GuideChatResponse {
  reply: string;
  status: 'ok' | 'unavailable';
  model: string;
}

/** Sends a reviewed text turn to the same-origin LawSense backend for local Guide assistance. */
export async function sendGuideMessage(
  message: string,
  language: GuideChatLanguage,
): Promise<GuideChatResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 52_000);
  try {
    const response = await fetch(`${BASE_URL}/guide/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, language }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = typeof body?.detail === 'string' ? body.detail : response.statusText;
      throw new Error(`Guide service unavailable: ${detail}`);
    }
    if (
      !body
      || typeof body.reply !== 'string'
      || !body.reply.trim()
      || !['ok', 'unavailable'].includes(body.status)
      || typeof body.model !== 'string'
    ) {
      throw new Error('Guide service returned an invalid response.');
    }
    return body as GuideChatResponse;
  } finally {
    clearTimeout(timeout);
  }
}

export async function createCase(
  data: CreateCaseRequest,
): Promise<CaseState> {
  const res = await fetch(`${BASE_URL}/cases`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    let detail = res.statusText;

    try {
      const body = await res.json();

      if (typeof body?.detail === 'string') {
        detail = body.detail;
      }
    } catch {
      // Keep the HTTP status text when response is not JSON.
    }

    throw new Error(`Failed to create case: ${detail}`);
  }

  return res.json();
}

export async function previewVoiceTranscript(transcript: string): Promise<VoiceTranscriptResponse> {
  const res = await fetch(`${BASE_URL}/cases/voice/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : res.statusText;
    throw new Error(`Failed to review transcript: ${detail}`);
  }
  return body as VoiceTranscriptResponse;
}

export async function addVoiceStatement(
  caseId: string,
  transcript: string,
  inputMethod: 'voice' | 'text' = 'voice',
): Promise<VoiceCommitResponse> {
  const res = await fetch(`${BASE_URL}/cases/${encodeURIComponent(caseId)}/voice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript, inputMethod }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : res.statusText;
    throw new Error(`Failed to add voice statement: ${detail}`);
  }
  return body as VoiceCommitResponse;
}

export async function transcribeVoiceAudio(audio: Blob, signal?: AbortSignal): Promise<VoiceTranscriptResponse> {
  const form = new FormData();
  form.append('file', audio, 'voice-input.webm');
  const res = await fetch(`${BASE_URL}/cases/voice/transcribe`, {
    method: 'POST',
    body: form,
    signal,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : res.statusText;
    throw new Error(`Failed to transcribe audio: ${detail}`);
  }
  return body as VoiceTranscriptResponse;
}

export async function synthesizeVoiceSpeech(
  text: string,
  language: 'english' | 'hindi' | 'hinglish',
  signal?: AbortSignal,
): Promise<Blob> {
  const res = await fetch(`${BASE_URL}/cases/voice/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language }),
    signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = typeof body?.detail === 'string' ? body.detail : res.statusText;
    throw new Error(`Local speech output unavailable: ${detail}`);
  }
  return res.blob();
}

export async function getVoiceProviderAvailability(): Promise<VoiceProviderAvailability> {
  const res = await fetch(`${BASE_URL}/cases/voice/status`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : res.statusText;
    throw new Error(`Failed to check voice availability: ${detail}`);
  }
  return body as VoiceProviderAvailability;
}

export async function getCase(id: string, signal?: AbortSignal): Promise<CaseState> {
  const requestOptions: RequestInit = {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    signal,
  };
  const res = await (encodeURIComponent(id) === id
    ? fetch(`${BASE_URL}/cases/${id}`, requestOptions)
    : fetch(`${BASE_URL}/cases/${encodeURIComponent(id)}`, requestOptions));

  if (!res.ok) {
    let detail = res.statusText;

    try {
      const body = await res.json();

      if (typeof body?.detail === 'string') {
        detail = body.detail;
      }
    } catch {
      // Keep the HTTP status text when response is not JSON.
    }

    throw new Error(`Failed to retrieve case: ${detail}`);
  }

  return res.json();
}

export async function getJourneyExecution(
  caseId: string,
  signal?: AbortSignal,
): Promise<JourneyExecutionResponse> {
  const response = await fetch(
    `${BASE_URL}/cases/${encodeURIComponent(caseId)}/journey/execution`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal,
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : response.statusText;
    throw new Error(`Failed to retrieve journey execution: ${detail}`);
  }
  if (body?.caseId !== caseId || body?.status !== 'available' || !body?.execution) {
    throw new Error('The journey execution response did not match this case.');
  }
  return body as JourneyExecutionResponse;
}

export async function getClarificationQuestions(
  id: string,
  options: { includeSkipped?: boolean } = {},
): Promise<ClarificationQuestions> {
  const query = options.includeSkipped ? '?include_skipped=true' : '';
  const res = await fetch(`${BASE_URL}/cases/${encodeURIComponent(id)}/clarification${query}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : res.statusText;
    throw new Error(`Failed to retrieve clarification questions: ${detail}`);
  }
  return body as ClarificationQuestions;
}

export async function skipClarificationQuestion(
  caseId: string,
  questionId: string,
): Promise<CaseState> {
  const res = await fetch(
    `${BASE_URL}/cases/${encodeURIComponent(caseId)}/clarification/${encodeURIComponent(questionId)}/skip`,
    {
      method: 'POST',
      headers: { Accept: 'application/json' },
    },
  );
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : res.statusText;
    throw new Error(`Failed to skip clarification: ${detail}`);
  }
  return body as CaseState;
}

export async function answerClarificationQuestion(
  caseId: string,
  questionId: string,
  answer: string,
): Promise<CaseState> {
  const res = await fetch(
    `${BASE_URL}/cases/${encodeURIComponent(caseId)}/clarification/${encodeURIComponent(questionId)}/answer`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ answer }),
    },
  );
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : res.statusText;
    throw new Error(`Failed to save clarification: ${detail}`);
  }
  return body as CaseState;
}

export async function getLegalTwin(id: string, signal?: AbortSignal): Promise<LegalTwinSummary> {
  const res = await fetch(`${BASE_URL}/cases/${encodeURIComponent(id)}/twin`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: unknown } | null;
    const detail = typeof body?.detail === 'string' ? body.detail : res.statusText;
    throw new Error(`Failed to retrieve Legal Twin: ${detail}`);
  }
  return res.json();
}

export async function getTwinSnapshot(
  caseId: string,
  asOf: string,
  signal?: AbortSignal,
): Promise<TwinSnapshotSummary> {
  const query = new URLSearchParams({ as_of: asOf });
  const res = await fetch(
    `${BASE_URL}/cases/${encodeURIComponent(caseId)}/twin/snapshot?${query.toString()}`,
    { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store', signal },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: unknown } | null;
    const detail = typeof body?.detail === 'string' ? body.detail : res.statusText;
    throw new Error(`Failed to retrieve Legal Twin snapshot: ${detail}`);
  }
  return res.json();
}

export async function getTwinDelta(
  caseId: string,
  fromAsOf: string,
  toAsOf: string,
  signal?: AbortSignal,
): Promise<TwinDeltaSummary> {
  const query = new URLSearchParams({ from_as_of: fromAsOf, to_as_of: toAsOf });
  const res = await fetch(
    `${BASE_URL}/cases/${encodeURIComponent(caseId)}/twin/delta?${query.toString()}`,
    { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store', signal },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: unknown } | null;
    const detail = typeof body?.detail === 'string' ? body.detail : res.statusText;
    throw new Error(`Failed to retrieve Legal Twin state delta: ${detail}`);
  }
  return res.json();
}

export async function confirmDocumentFindings(
  caseId: string,
  documentId: string,
  findingIds: string[],
): Promise<CaseState> {
  const res = await fetch(
    `${BASE_URL}/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(documentId)}/confirm`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ findingIds }),
    },
  );
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : res.statusText;
    throw new Error(`Failed to confirm document findings: ${detail}`);
  }
  return body as CaseState;
}

export class EvidenceUploadError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'EvidenceUploadError';
    this.status = status;
  }
}

/**
 * Upload a supported document to the case's local document-intelligence route.
 */
export function uploadEvidence(
  caseId: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<DocumentUploadResponse> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `${BASE_URL}/cases/${encodeURIComponent(caseId)}/documents`);
    request.responseType = 'text';
    request.setRequestHeader('Accept', 'application/json');

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    });

    request.addEventListener('load', () => {
      let body: unknown = null;
      if (request.responseText) {
        try {
          body = JSON.parse(request.responseText) as unknown;
        } catch {
          body = request.responseText;
        }
      }

      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve(body as DocumentUploadResponse);
        return;
      }

      const detail =
        typeof body === 'object' && body !== null && 'detail' in body &&
        typeof body.detail === 'string'
          ? body.detail
          : typeof body === 'string' && body.trim()
            ? body
            : request.statusText;
      const message =
        request.status === 404 || request.status === 405
          ? 'The document upload API is not available on this backend yet.'
          : detail || `Upload failed with status ${request.status}.`;
      reject(new EvidenceUploadError(message, request.status));
    });

    request.addEventListener('error', () => {
      reject(new EvidenceUploadError('Could not reach the evidence-upload API. Check the backend connection.'));
    });
    request.addEventListener('timeout', () => {
      reject(new EvidenceUploadError('The upload timed out. Please try again.'));
    });
    request.addEventListener('abort', () => {
      reject(new EvidenceUploadError('The upload was cancelled.'));
    });
    request.timeout = 120_000;

    const body = new FormData();
    body.append('file', file, file.name);
    request.send(body);
  });
}

async function documentApiRequest<T>(url: string, init: RequestInit, action: string): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : response.statusText;
    throw new Error(`${action}: ${detail}`);
  }
  return body as T;
}

async function legalSourceApiRequest<T>(url: string, action: string): Promise<T> {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body?.detail;
    const message = typeof detail === 'string'
      ? detail
      : typeof detail?.message === 'string'
        ? detail.message
        : response.statusText;
    const fallback = typeof detail?.fallback === 'string' ? ` ${detail.fallback}` : '';
    throw new Error(`${action}: ${message}.${fallback}`);
  }
  return body as T;
}

/** Explicit narrow lookup; never prefilled from or sent with a case narrative. */
export async function searchIndiaCode(query: string, limit = 20): Promise<IndiaCodeSearchResponse> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return legalSourceApiRequest(
    `${BASE_URL}/legal-sources/indiacode/search?${params.toString()}`,
    'IndiaCode search failed',
  );
}

/** Retrieve a bounded list of text-bearing third-party API act records. */
export async function getIndiaCodeActs(limit = 100): Promise<IndiaCodeActsResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  return legalSourceApiRequest(
    `${BASE_URL}/legal-sources/indiacode/acts?${params.toString()}`,
    'IndiaCode act list failed',
  );
}

/** Fetch exact provider-served provision text; provider data remains unverified. */
export async function getIndiaCodeProvision(
  actId: string,
  unit: 'section' | 'article' | 'rule',
  number: string,
): Promise<IndiaCodeProvisionResponse> {
  return legalSourceApiRequest(
    `${BASE_URL}/legal-sources/indiacode/acts/${encodeURIComponent(actId)}/${unit}/${encodeURIComponent(number)}`,
    'IndiaCode provision retrieval failed',
  );
}

export async function getDocumentPackages(caseId: string): Promise<CompiledDocumentPackage[]> {
  return documentApiRequest(
    `${BASE_URL}/cases/${encodeURIComponent(caseId)}/document-packages`,
    { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store' },
    'Failed to retrieve document packages',
  );
}

export async function createDocumentPackage(
  caseId: string,
  payload: CreateDocumentPackagePayload,
): Promise<CompiledDocumentPackage> {
  return documentApiRequest(
    `${BASE_URL}/cases/${encodeURIComponent(caseId)}/document-packages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    },
    'Failed to compile document package',
  );
}

export async function confirmDocumentPackage(
  caseId: string,
  packageId: string,
  acknowledgeMissingInformation: boolean,
): Promise<CompiledDocumentPackage> {
  return documentApiRequest(
    `${BASE_URL}/cases/${encodeURIComponent(caseId)}/document-packages/${encodeURIComponent(packageId)}/confirm`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ acknowledgeMissingInformation }),
    },
    'Failed to confirm document review',
  );
}

export async function exportDocumentPackage(caseId: string, packageId: string): Promise<ExportReadyPackage> {
  const response = await fetch(
    `${BASE_URL}/cases/${encodeURIComponent(caseId)}/document-packages/${encodeURIComponent(packageId)}/export`,
    { method: 'POST', headers: { Accept: 'application/json' } },
  );
  const body = await response.json().catch(() => null);
  if (response.ok) return body as ExportReadyPackage;
  const blocked = body?.detail?.export as ExportReadyPackage | undefined;
  if (blocked) return blocked;
  const detail = typeof body?.detail === 'string' ? body.detail : response.statusText;
  throw new Error(`Failed to export document package: ${detail}`);
}
