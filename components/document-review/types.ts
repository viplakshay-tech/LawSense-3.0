export const DOCUMENT_REVIEW_STATUSES = [
  'USER_REPORTED',
  'EVIDENCE_SUPPORTED',
  'SYSTEM_INFERRED',
  'ASSUMPTION',
  'CONFLICTING',
  'UNKNOWN',
  'UNCERTAIN',
  'NEEDS_OCR',
  'TEXT_EXTRACTED',
  'AWAITING_CONFIRMATION',
] as const;

export type DocumentReviewStatus = (typeof DOCUMENT_REVIEW_STATUSES)[number];

export type ExtractedValueKind =
  | 'name'
  | 'date'
  | 'amount'
  | 'address'
  | 'clause'
  | 'document_number'
  | 'other';

/** Confidence is supplied as a percentage in the range 0–100. */
export type ConfidencePercent = number;

export interface DocumentPageContent {
  pageNumber: number;
  /** Page-specific preview URL, when the document service supplies one. */
  previewUrl?: string | null;
  /** Text returned for this page by the extraction service. */
  extractedText?: string | null;
}

export interface DocumentDescriptor {
  id?: string;
  fileName: string;
  mimeType?: string | null;
  documentNumber?: string | null;
  /** A preview URL returned by the document service; this component does not create one. */
  previewUrl?: string | null;
  previewType?: 'pdf' | 'image' | 'unsupported';
}

export interface EvidenceSource {
  documentName?: string | null;
  pageNumber?: number | null;
  excerpt?: string | null;
  locator?: string | null;
}

/** CamelCase response shape from the backend's document-review endpoints. */
export interface DocumentReviewApiFinding {
  id: string;
  category: string;
  value: unknown;
  text?: string | null;
  source: string;
  provenance: Array<{
    source: string;
    documentId?: string | null;
    caseStateId?: string | null;
    pageNumber?: number | null;
    location?: { start: number; end: number } | null;
    extractionMethod?: string | null;
  }>;
  confidence: number;
  nature: 'extraction' | 'interpretation';
  status: 'extracted' | 'candidate' | 'uncertain' | 'potential_conflict';
  note?: string | null;
  upstreamStatus?: string | null;
}

export interface DocumentReviewApiResponse {
  caseId: string;
  status: 'available' | 'partial' | 'unavailable';
  documentId: string;
  processingStatus: string;
  findings: DocumentReviewApiFinding[];
  errors: string[];
}
