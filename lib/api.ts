const BASE_URL = 'http://127.0.0.1:8000';

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

export interface SafetyContextSummary {
  context: 'none' | 'sensitive' | 'potentially_unsafe' | 'urgent_safety_context';
  confidence: string;
  urgency: 'none' | 'elevated' | 'urgent';
  indicators: SafetyIndicatorSummary[];
  sourceIds: string[];
  assessmentStatus: 'system_inferred';
  recommendedSafetyPrompt?: string | null;
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
  assumptions: string[];
  conflicts: string[];
  metadata: CaseMetadata;
  analysis?: CaseAnalysis | null;
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
  | 'CLAIM'
  | 'DOCUMENT'
  | 'EVIDENCE'
  | 'LEGAL_ISSUE'
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

export async function transcribeVoiceAudio(audio: Blob): Promise<VoiceTranscriptResponse> {
  const form = new FormData();
  form.append('file', audio, 'voice-input.webm');
  const res = await fetch(`${BASE_URL}/cases/voice/transcribe`, {
    method: 'POST',
    body: form,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : res.statusText;
    throw new Error(`Failed to transcribe audio: ${detail}`);
  }
  return body as VoiceTranscriptResponse;
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

export async function getClarificationQuestions(id: string): Promise<ClarificationQuestions> {
  const res = await fetch(`${BASE_URL}/cases/${encodeURIComponent(id)}/clarification`, {
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
