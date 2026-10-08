'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, KeyboardEvent, ReactNode } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Check,
  ChevronRight,
  CircleHelp,
  FileCheck2,
  FileSearch,
  FileText,
  Loader2,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  EvidenceUploadError,
  confirmDocumentFindings,
  uploadEvidence,
  type CaseDocument,
  type CaseState,
  type EvidenceItem,
} from '@/lib/api';
import { DocumentViewer } from './DocumentViewer';
import { OCRStatus, type OCRProcessingStatus } from './OCRStatus';
import { StatusBadge } from './StatusBadge';
import type { DocumentReviewApiFinding, DocumentReviewApiResponse, DocumentReviewStatus } from './types';
import { useCaseState } from '@/app/case/[id]/CaseStateProvider';
import type { EvidenceMapFocusRequest } from '@/components/evidence-map/types';

const API_BASE_URL = 'http://127.0.0.1:8000';
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ACCEPTED_FILE_TYPES = '.pdf,.jpg,.jpeg,.png';

type Phase = 'idle' | 'uploading' | 'processing' | 'reviewing' | 'complete';

interface ConfirmationReceipt {
  documentId: string;
  findingIds: string[];
  findingSummaries: Array<{
    id: string;
    title: string;
    value: string;
    afterStatus: DocumentReviewStatus;
  }>;
  before: CaseState;
  after: CaseState;
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value.trim() || 'No value supplied';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return 'No value supplied';
  try {
    return JSON.stringify(value, null, 2) ?? 'Value could not be displayed';
  } catch {
    return 'Value could not be displayed';
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function percent(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
    : 'Not supplied';
}

function formatTimestamp(value: string | undefined): string {
  if (!value) return 'Not supplied';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : 'Not supplied';
}

function getReviewError(response: Response, body: unknown): string {
  if (typeof body === 'object' && body !== null && 'detail' in body && typeof body.detail === 'string') {
    return body.detail;
  }
  return response.status === 404 || response.status === 405
    ? 'The document-review API is not available on this backend yet.'
    : response.statusText || `Review request failed with status ${response.status}.`;
}

async function getStoredDocumentReview(caseId: string, documentId: string): Promise<DocumentReviewApiResponse> {
  const response = await fetch(
    `${API_BASE_URL}/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(documentId)}/review`,
    { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store' },
  );
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(getReviewError(response, body));
  if (typeof body !== 'object' || body === null || !('findings' in body) || !Array.isArray(body.findings)) {
    throw new Error('The document-review API returned an incomplete response.');
  }
  return body as DocumentReviewApiResponse;
}

function statusForDocument(document: CaseDocument): DocumentReviewStatus {
  if (document.processingStatus === 'extracted') return 'TEXT_EXTRACTED';
  if (document.processingStatus === 'ocr_required') return 'NEEDS_OCR';
  return 'UNCERTAIN';
}

function ocrStatus(document: CaseDocument): OCRProcessingStatus {
  if (document.processingStatus === 'ocr_required') return 'UNAVAILABLE';
  if (document.processingStatus === 'failed') return 'FAILED';
  // "extracted" reports that the local text extractor ran. It does not say that OCR ran.
  return 'NOT_REPORTED';
}

function statusForFinding(finding: DocumentReviewApiFinding): DocumentReviewStatus {
  if (finding.status === 'potential_conflict') return 'CONFLICTING';
  if (finding.status === 'uncertain') {
    const result = typeof finding.value === 'object' && finding.value !== null && 'result' in finding.value
      ? finding.value.result
      : null;
    return result === 'ocr_required' ? 'NEEDS_OCR' : 'UNCERTAIN';
  }
  if (finding.upstreamStatus === 'user_reported') return 'USER_REPORTED';
  if (finding.nature === 'extraction') return 'TEXT_EXTRACTED';
  if (finding.status === 'candidate') return 'UNCERTAIN';
  return 'UNCERTAIN';
}

function factMatchesFinding(
  fact: CaseState['facts'][number],
  finding: DocumentReviewApiFinding,
  documentId: string,
): boolean {
  const sourcePages = finding.provenance
    .filter((source) => source.source === 'document' && source.documentId === documentId)
    .map((source) => source.pageNumber)
    .filter((page): page is number => page != null);
  const hasConfirmedSource = fact.provenance.some((source) =>
    source.documentId === documentId && source.confirmedByUser,
  );
  const expectedKey = finding.category === 'date'
    ? 'document_date'
    : `document_${finding.category}`;
  const keyMatches = fact.key === expectedKey
    || (finding.category === 'amount' && ['document_amount', 'amount_inr', 'document_currency'].includes(fact.key));
  const valueMatches = displayValue(fact.value).trim() === displayValue(finding.value).trim();
  const pageMatches = sourcePages.length === 0 || fact.provenance.some((source) =>
    source.documentId === documentId && sourcePages.includes(source.pageNumber),
  );

  return hasConfirmedSource && keyMatches && valueMatches && pageMatches;
}

function caseStatusForFinding(
  finding: DocumentReviewApiFinding,
  confirmed: boolean,
  documentId: string,
  caseData: CaseState,
): DocumentReviewStatus {
  if (!confirmed) return statusForFinding(finding);
  const matchingFacts = caseData.facts.filter((fact) => factMatchesFinding(fact, finding, documentId));
  if (matchingFacts.some((fact) => fact.status === 'conflicting')) return 'CONFLICTING';
  if (matchingFacts.some((fact) => fact.status === 'evidence_supported')) return 'EVIDENCE_SUPPORTED';
  return statusForFinding(finding);
}

function factsFromConfirmation(receipt: ConfirmationReceipt): CaseState['facts'] {
  const document = receipt.after.documents.find((item) => item.id === receipt.documentId);
  const confirmedAt = document?.confirmationHistory.at(-1)?.confirmedAt;
  if (!confirmedAt) return [];
  return receipt.after.facts.filter((fact) => fact.provenance.some((source) =>
    source.documentId === receipt.documentId
      && source.confirmedByUser
      && source.confirmedAt === confirmedAt,
  ));
}

function findingTitle(finding: DocumentReviewApiFinding): string {
  if (finding.category === 'document_type') return 'Document classification';
  if (finding.category === 'extraction_gap' && typeof finding.value === 'object' && finding.value !== null && 'category' in finding.value) {
    return `${humanize(String(finding.value.category))} coverage`;
  }
  return humanize(finding.category);
}

function Stage({
  label,
  detail,
  state,
}: {
  label: string;
  detail: string;
  state: 'complete' | 'active' | 'ready' | 'pending' | 'unavailable';
}) {
  const icon = state === 'complete'
    ? <Check aria-hidden="true" className="h-3.5 w-3.5" />
    : state === 'active'
      ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
      : state === 'ready'
        ? <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
        : state === 'unavailable'
        ? <CircleHelp aria-hidden="true" className="h-3.5 w-3.5" />
        : <span className="h-1.5 w-1.5 rounded-full bg-current" />;
  const tone = state === 'complete'
    ? 'border-emerald-400/20 bg-emerald-400/[0.055] text-emerald-200'
    : state === 'active'
      ? 'border-blue-400/25 bg-blue-400/[0.07] text-blue-200'
        : state === 'ready'
          ? 'border-amber-300/20 bg-amber-300/[0.05] text-amber-100'
      : state === 'unavailable'
        ? 'border-amber-400/15 bg-amber-400/[0.035] text-amber-100/80'
        : 'border-white/[0.07] bg-white/[0.018] text-zinc-500';

  return (
    <div className={`min-w-0 rounded-xl border p-3 transition-[border-color,background-color,opacity] duration-500 ease-out motion-reduce:transition-none ${state === 'active' ? 'animate-pulse motion-reduce:animate-none' : ''} ${tone}`}>
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.11em]">
        {icon}<span className="truncate">{label}</span>
      </div>
      <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-zinc-400">{detail}</p>
    </div>
  );
}

function ProvenanceLine({
  finding,
  onSelect,
}: {
  finding: DocumentReviewApiFinding;
  onSelect: (pageNumber?: number) => void;
}) {
  if (finding.provenance.length === 0) {
    return <p className="mt-3 text-[11px] text-zinc-500">Source location was not returned.</p>;
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {finding.provenance.map((source, index) => (
        <div
          key={`${finding.id}-${source.source}-${source.pageNumber ?? 'page'}-${index}`}
          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-white/[0.07] bg-black/10 px-2.5 py-2 text-[10px] text-zinc-400"
        >
          <span className="font-medium text-zinc-300">
            {source.source === 'case_state' ? 'Case record' : 'Document'}
          </span>
          {source.documentId && <span>Document {source.documentId}</span>}
          {source.caseStateId && <span>CaseState {source.caseStateId}</span>}
          {source.pageNumber != null && source.source === 'document' && (
            <button
              type="button"
              onClick={() => onSelect(source.pageNumber!)}
              aria-label={`Select finding and open source page ${source.pageNumber}`}
              className="inline-flex items-center gap-1 text-blue-200 underline decoration-blue-200/30 underline-offset-2 hover:text-blue-100"
            >
              <MapPin aria-hidden="true" className="h-3 w-3" />Page {source.pageNumber}
            </button>
          )}
          {source.location && (
            <span title="Zero-based character offsets">
              Offset {source.location.start}–{source.location.end}
            </span>
          )}
          {source.extractionMethod && <span>{humanize(source.extractionMethod)}</span>}
          {source.source === 'case_state' && <span>Compared with this case</span>}
        </div>
      ))}
    </div>
  );
}

function FindingCard({
  finding,
  onSelect,
  checked,
  confirmed,
  status,
  selected,
  onToggle,
}: {
  finding: DocumentReviewApiFinding;
  onSelect: (pageNumber?: number) => void;
  checked?: boolean;
  confirmed?: boolean;
  status?: DocumentReviewStatus;
  selected?: boolean;
  onToggle?: (findingId: string, checked: boolean) => void;
}) {
  const isConflict = finding.status === 'potential_conflict';
  const conflict = typeof finding.value === 'object' && finding.value !== null
    ? finding.value as Record<string, unknown>
    : null;

  return (
    <article className={`rounded-xl border p-4 transition-[border-color,background-color,box-shadow] duration-300 motion-reduce:transition-none ${isConflict ? 'border-rose-400/20 bg-rose-400/[0.035]' : selected ? 'border-amber-200/40 bg-amber-200/[0.045] shadow-[0_0_0_1px_rgba(253,230,138,0.12)]' : 'border-white/[0.07] bg-[#0d121b]'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => onSelect()}
          aria-pressed={Boolean(selected)}
          className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-amber-200/70"
        >
          <span className="block text-[10px] font-semibold uppercase tracking-[0.13em] text-zinc-300">{findingTitle(finding)}</span>
          <span className="mt-1 block text-[9px] uppercase tracking-wide text-zinc-600">
            {finding.nature === 'interpretation' ? 'Review interpretation' : 'Extracted value'} · {selected ? 'Source selected' : 'Select to inspect source'}
          </span>
        </button>
        <div className="flex items-center gap-2">
          {onToggle && (
            <label className={`flex items-center gap-1.5 text-[10px] ${confirmed ? 'text-emerald-200' : 'text-zinc-400'}`}>
              <input
                type="checkbox"
                checked={confirmed || Boolean(checked)}
                disabled={confirmed}
                onChange={(event) => onToggle(finding.id, event.currentTarget.checked)}
                aria-label={`${confirmed ? 'Confirmed' : 'Select'} finding: ${findingTitle(finding)}`}
                className="h-3.5 w-3.5 rounded border-white/20 bg-black/20 accent-emerald-400"
              />
              {confirmed ? 'Confirmed' : 'Confirm'}
            </label>
          )}
          <StatusBadge status={status ?? statusForFinding(finding)} />
        </div>
      </div>

      {isConflict && conflict ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-white/[0.07] bg-black/15 p-3">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-zinc-500">Document value</p>
            <p className="mt-1 break-words text-sm text-zinc-100">{displayValue(conflict.document_value)}</p>
          </div>
          <div className="rounded-lg border border-rose-400/10 bg-rose-400/[0.025] p-3">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-zinc-500">Case record value</p>
            <p className="mt-1 break-words text-sm text-zinc-100">{displayValue(conflict.case_state_value)}</p>
          </div>
        </div>
      ) : (
        <p className="mt-3 break-words text-sm leading-6 text-zinc-100">
          {finding.text || displayValue(finding.value)}
        </p>
      )}

      {finding.note && <p className="mt-3 text-xs leading-5 text-zinc-400">{finding.note}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/[0.055] pt-3 text-[10px] text-zinc-500">
        <span>Confidence {percent(finding.confidence)}</span>
        {finding.upstreamStatus && <span>Source status {humanize(finding.upstreamStatus)}</span>}
      </div>
      <ProvenanceLine finding={finding} onSelect={onSelect} />
    </article>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-white/[0.1] px-4 py-5 text-sm leading-6 text-zinc-500">{children}</p>;
}

function EvidenceMapping({
  evidence,
  caseData,
  document,
  onPage,
}: {
  evidence: EvidenceItem | null;
  caseData: CaseState;
  document: CaseDocument | null;
  onPage: (page: number) => void;
}) {
  const linkedClaimIds = evidence
    ? [...new Set([...evidence.supportsClaimIds, ...evidence.conflictsWithClaimIds])]
    : [];
  const linkedClaims = linkedClaimIds
    .map((id) => ({ claim: caseData.claims.find((claim) => claim.id === id), id }))
    .filter((item) => item.claim);
  const linkedFacts = (evidence?.extractedFacts ?? [])
    .map((id) => caseData.facts.find((fact) => fact.id === id))
    .filter((fact) => fact !== undefined);
  const reportedFacts = caseData.facts.filter((fact) => fact.status === 'user_reported');

  return (
    <section aria-labelledby="evidence-mapping-title" className="rounded-2xl border border-white/[0.07] bg-[#111722] p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-lg border border-blue-400/15 bg-blue-400/[0.06] p-2 text-blue-200"><FileSearch aria-hidden="true" className="h-4 w-4" /></div>
        <div>
          <h2 id="evidence-mapping-title" className="text-sm font-semibold text-zinc-100">Evidence mapping</h2>
          <p className="mt-1 text-xs leading-5 text-zinc-500">Links below come from the case service and review provenance.</p>
        </div>
      </div>

      {evidence ? (
        <div className="mt-4 rounded-xl border border-white/[0.06] bg-black/10 p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-medium text-zinc-200">{evidence.title}</p>
            <StatusBadge status={document?.reviewStatus === 'awaiting_confirmation' && evidence.status === 'unknown'
              ? 'AWAITING_CONFIRMATION'
              : evidence.status.toUpperCase() as DocumentReviewStatus} />
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            {linkedFacts.length > 0
              ? `${linkedFacts.length} user-confirmed fact link${linkedFacts.length === 1 ? '' : 's'}`
              : document?.reviewStatus === 'confirmed'
                ? 'No facts were mapped from the confirmed findings'
                : 'Findings remain provisional until you confirm them'}
          </p>
          {linkedFacts.length > 0 && (
            <ul className="mt-3 space-y-2">
              {linkedFacts.map((fact) => (
                <li key={fact.id} className="rounded-lg border border-emerald-400/10 bg-emerald-400/[0.025] px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-emerald-200/70">{humanize(fact.key)}</p>
                    <StatusBadge status={fact.status.toUpperCase() as DocumentReviewStatus} />
                  </div>
                  <p className="mt-1 break-words text-xs leading-5 text-zinc-200">{displayValue(fact.value)}</p>
                  {fact.provenance.map((source, index) => (
                    <p key={`${fact.id}-${index}`} className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[10px] text-zinc-500">
                      <button
                        type="button"
                        onClick={() => onPage(source.pageNumber)}
                        className="text-blue-200 underline decoration-blue-200/30 underline-offset-2 hover:text-blue-100"
                        aria-label={`Open confirmed source page ${source.pageNumber}`}
                      >
                        Page {source.pageNumber}
                      </button>
                      <span aria-hidden="true">·</span>
                      <span>{humanize(source.extractionMethod)} · {percent(source.confidence)} confidence</span>
                      {source.confirmedAt && <span>· confirmed {formatTimestamp(source.confirmedAt)}</span>}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          )}
          {linkedClaims.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {linkedClaims.map(({ claim, id }) => (
                <li key={id} className="rounded-lg border border-white/[0.055] px-3 py-2 text-xs leading-5 text-zinc-300">
                  <span className="mr-2 text-[9px] uppercase tracking-wide text-zinc-600">
                    {evidence.conflictsWithClaimIds.includes(id) ? 'Conflicts with claim' : 'Supports claim'}
                  </span>
                  {claim?.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-zinc-500">No claim links were returned for this document.</p>
          )}
        </div>
      ) : (
        <p className="mt-4 text-xs leading-5 text-zinc-500">The case service has not returned an evidence record for this document.</p>
      )}

      {reportedFacts.length > 0 && (
        <div className="mt-4 border-t border-white/[0.06] pt-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">User reported case facts</p>
          <ul className="space-y-2">
            {reportedFacts.map((fact) => (
              <li key={fact.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-white/[0.02] px-3 py-2.5">
                <p className="min-w-0 flex-1 break-words text-xs leading-5 text-zinc-300">
                  {fact.key !== 'statement' && <span className="text-zinc-500">{humanize(fact.key)}: </span>}
                  {displayValue(fact.value)}
                </p>
                <StatusBadge status="USER_REPORTED" />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function DocumentReviewWorkspace({ caseId, embedded = false, focusRequest = null }: { caseId: string; embedded?: boolean; focusRequest?: EvidenceMapFocusRequest | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    caseState: caseData,
    loading: isLoading,
    error: caseError,
    refreshCaseState,
    replaceCaseState,
  } = useCaseState();
  const initialReviewLoadedRef = useRef(false);
  const handledFocusRequestRef = useRef(0);
  const reviewRequestSequenceRef = useRef(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [requestedEvidenceId, setRequestedEvidenceId] = useState<string | null>(null);
  const [recentDocument, setRecentDocument] = useState<CaseDocument | null>(null);
  const [review, setReview] = useState<{ storedDocumentId: string; result: DocumentReviewApiResponse } | null>(null);
  const [reviewError, setReviewError] = useState<{ documentId: string; message: string } | null>(null);
  const [previewFile, setPreviewFile] = useState<{ documentId: string; file: File; url: string } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [selectedFindingIds, setSelectedFindingIds] = useState<string[]>([]);
  const [confirmationReceipt, setConfirmationReceipt] = useState<ConfirmationReceipt | null>(null);
  const [activeFindingId, setActiveFindingId] = useState<string | null>(null);

  const documents = useMemo(() => {
    const saved = caseData?.documents ?? [];
    if (!recentDocument || saved.some((document) => document.id === recentDocument.id)) return saved;
    return [...saved, recentDocument];
  }, [caseData?.documents, recentDocument]);
  const selectedDocument = documents.find((document) => document.id === selectedDocumentId) ?? documents.at(-1) ?? null;
  const requestedEvidence = caseData?.evidence.find((item) => item.id === requestedEvidenceId) ?? null;
  // The review endpoint processes a transient copy and assigns its own ID. Keep that
  // response associated with the upload request that supplied the same file bytes.
  const selectedReview = review && selectedDocument && review.storedDocumentId === selectedDocument.id ? review.result : null;
  const selectedReviewError = reviewError && selectedDocument && reviewError.documentId === selectedDocument.id ? reviewError.message : null;
  const selectedEvidence = selectedDocument && caseData
    ? caseData.evidence.find((item) => item.documentId === selectedDocument.id) ?? null
    : null;
  const regularFindings = selectedReview?.findings.filter((finding) => finding.category !== 'conflict') ?? [];
  const uncertaintyFindings = selectedReview?.findings.filter((finding) => finding.status === 'uncertain') ?? [];
  const conflictFindings = selectedReview?.findings.filter((finding) => finding.status === 'potential_conflict') ?? [];
  const confirmableFindings = selectedReview?.findings.filter((finding) =>
    finding.nature === 'extraction'
      && finding.upstreamStatus !== undefined
      && finding.upstreamStatus !== null
      && (finding.status === 'extracted' || finding.status === 'candidate'),
  ) ?? [];
  const confirmedFindingIds = new Set(
    selectedDocument?.confirmationHistory.flatMap((entry) => entry.findingIds) ?? [],
  );
  const selectedFinding = selectedReview?.findings.find((finding) => finding.id === activeFindingId) ?? null;
  const selectedFindingSource = selectedFinding?.provenance.find((source) =>
    source.source === 'document' && source.documentId === selectedDocument?.id,
  ) ?? null;
  const receiptForDocument = confirmationReceipt?.documentId === selectedDocument?.id
    ? confirmationReceipt
    : null;
  const receiptFacts = receiptForDocument ? factsFromConfirmation(receiptForDocument) : [];
  const receiptSupportedFacts = receiptFacts.filter((fact) => fact.status === 'evidence_supported');
  const receiptConflictingFacts = receiptFacts.filter((fact) => fact.status === 'conflicting');

  useEffect(() => {
    if (!caseData || initialReviewLoadedRef.current) return;
    initialReviewLoadedRef.current = true;
    const search = new URLSearchParams(window.location.search);
    const requestedEvidenceId = search.get('evidenceId');
    setRequestedEvidenceId(requestedEvidenceId);
    const evidenceDocumentId = caseData.evidence.find((item) => item.id === requestedEvidenceId)?.documentId;
    const requestedDocumentId = search.get('documentId') ?? evidenceDocumentId ?? null;
    const document = caseData.documents.find((item) => item.id === requestedDocumentId) ?? caseData.documents.at(-1);
    if (!document) return;
    const requestSequence = ++reviewRequestSequenceRef.current;
    const selectionFrame = requestedDocumentId === document.id
      ? window.requestAnimationFrame(() => setSelectedDocumentId(document.id))
      : null;

    let alive = true;
    void getStoredDocumentReview(caseId, document.id).then((result) => {
      if (alive && requestSequence === reviewRequestSequenceRef.current) {
        setReview({ storedDocumentId: document.id, result });
        setPhase('complete');
      }
    }).catch((error: unknown) => {
      if (alive && requestSequence === reviewRequestSequenceRef.current) {
        setReviewError({
          documentId: document.id,
          message: error instanceof Error ? error.message : 'The review result could not be retrieved.',
        });
        setPhase('complete');
      }
    });
    return () => {
      alive = false;
      if (selectionFrame !== null) window.cancelAnimationFrame(selectionFrame);
    };
  }, [caseData, caseId]);

  const documentFocusHandledRef = useRef(false);
  useEffect(() => {
    if (documentFocusHandledRef.current) return;
    const search = new URLSearchParams(window.location.search);
    const requestedDocumentId = search.get('documentId') ?? requestedEvidence?.documentId ?? null;
    if (requestedEvidence && (!requestedEvidence.documentId || !documents.some((item) => item.id === requestedEvidence.documentId))) {
      documentFocusHandledRef.current = true;
      window.requestAnimationFrame(() => {
        const target = document.getElementById('requested-evidence-record');
        target?.focus({ preventScroll: true });
        target?.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
          block: 'start',
        });
      });
      return;
    }
    if (!selectedDocument || requestedDocumentId !== selectedDocument.id) return;
    documentFocusHandledRef.current = true;
    window.requestAnimationFrame(() => {
      const fragment = window.location.hash.slice(1);
      const target = fragment ? document.getElementById(fragment) : null;
      (target ?? document.getElementById('document-preview'))?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      });
    });
  }, [documents, requestedEvidence, selectedDocument]);

  useEffect(() => {
    const url = previewFile?.url;
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [previewFile]);

  function acceptFile(file?: File) {
    if (!file) return;
    setSelectedFile(null);
    setValidationError(null);
    setActionError(null);
    if (!/\.(pdf|jpg|jpeg|png)$/i.test(file.name)) {
      setValidationError('Choose a PDF, JPG, or PNG image.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setValidationError('Files must be 25 MiB or smaller.');
      return;
    }
    setSelectedFile(file);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    acceptFile(event.currentTarget.files?.[0]);
    event.currentTarget.value = '';
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    acceptFile(event.dataTransfer.files[0]);
  }

  function onUploadKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      inputRef.current?.click();
    }
  }

  const loadReview = useCallback(async (documentId: string) => {
    const requestSequence = ++reviewRequestSequenceRef.current;
    setReview(null);
    setReviewError(null);
    setSelectedFindingIds([]);
    setActiveFindingId(null);
    setPhase('reviewing');
    try {
      const result = await getStoredDocumentReview(caseId, documentId);
      if (requestSequence !== reviewRequestSequenceRef.current) return;
      setReview({ storedDocumentId: documentId, result });
      setPhase('complete');
    } catch (error) {
      if (requestSequence !== reviewRequestSequenceRef.current) return;
      setReviewError({
        documentId,
        message: error instanceof Error ? error.message : 'The review result could not be retrieved.',
      });
      setPhase('complete');
    }
  }, [caseId]);

  async function submitDocument() {
    if (!selectedFile || phase === 'uploading' || phase === 'processing' || reviewIsActive) return;
    const file = selectedFile;
    setPhase('uploading');
    setUploadProgress(0);
    setActionError(null);
    setReviewError(null);
    setReview(null);
    setActionError(null);

    try {
      const upload = await uploadEvidence(caseId, file, setUploadProgress);
      setRecentDocument(upload.document);
      setSelectedDocumentId(upload.document.id);
      setPreviewFile({ documentId: upload.document.id, file, url: URL.createObjectURL(file) });
      setCurrentPage(1);
      setSelectedFile(null);
      setSelectedFindingIds([]);
      setActiveFindingId(null);
      setConfirmationReceipt(null);

      setPhase('processing');
      try {
        await refreshCaseState();
      } catch {
        // Upload response remains authoritative for the newly stored document metadata.
      }

      setPhase('reviewing');
      const requestSequence = ++reviewRequestSequenceRef.current;
      try {
        const result = await getStoredDocumentReview(caseId, upload.document.id);
        if (requestSequence !== reviewRequestSequenceRef.current) return;
        setReview({ storedDocumentId: upload.document.id, result });
        setPhase('complete');
      } catch (error) {
        if (requestSequence !== reviewRequestSequenceRef.current) return;
        setReviewError({
          documentId: upload.document.id,
          message: error instanceof Error ? error.message : 'The review result could not be retrieved.',
        });
        setPhase('complete');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The document could not be uploaded.';
      setActionError(error instanceof EvidenceUploadError && error.status === 404
        ? 'The document upload API is not available on this backend yet.'
        : message);
      setPhase('idle');
    }
  }

  async function refreshCase() {
    setIsRefreshing(true);
    try {
      await refreshCaseState();
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'The case could not be refreshed.');
    } finally {
      setIsRefreshing(false);
    }
  }

  function selectDocument(document: CaseDocument) {
    setSelectedDocumentId(document.id);
    setCurrentPage(1);
    setActiveFindingId(null);
    if (previewFile?.documentId !== document.id) setPreviewFile(null);
    void loadReview(document.id);
  }

  function selectFinding(finding: DocumentReviewApiFinding, pageOverride?: number) {
    setActiveFindingId(finding.id);
    const source = finding.provenance.find((item) =>
      item.source === 'document'
        && item.documentId === selectedDocument?.id
        && (pageOverride == null || item.pageNumber === pageOverride),
    );
    const page = pageOverride ?? source?.pageNumber;
    if (page != null) {
      jumpToPage(page);
      return;
    }
    document.getElementById('document-preview')?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center',
    });
  }

  async function confirmSelectedFindings() {
    if (!caseData || !selectedDocument || !selectedReview || selectedFindingIds.length === 0 || isConfirming) return;
    const findingIds = [...selectedFindingIds];
    const selectedFindings = selectedReview.findings.filter((finding) => findingIds.includes(finding.id));
    const caseBefore = caseData;
    setIsConfirming(true);
    setActionError(null);
    try {
      const updated = await confirmDocumentFindings(caseId, selectedDocument.id, findingIds);
      let caseAfter = updated;
      if (!replaceCaseState(updated)) {
        caseAfter = caseBefore;
        try {
          caseAfter = await refreshCaseState();
        } catch {
          // Keep the last accepted state in the UI if this response is stale.
        }
      }
      const findingSummaries = selectedFindings.map((finding) => ({
        id: finding.id,
        title: findingTitle(finding),
        value: displayValue(finding.text || finding.value),
        afterStatus: caseStatusForFinding(finding, true, selectedDocument.id, caseAfter),
      }));
      setConfirmationReceipt({
        documentId: selectedDocument.id,
        findingIds,
        findingSummaries,
        before: caseBefore,
        after: caseAfter,
      });
      setActiveFindingId(findingIds[0] ?? null);
      setSelectedFindingIds([]);
      const reviewRequestSequence = ++reviewRequestSequenceRef.current;
      try {
        const refreshedReview = await getStoredDocumentReview(caseId, selectedDocument.id);
        if (reviewRequestSequence !== reviewRequestSequenceRef.current) return;
        setReview({ storedDocumentId: selectedDocument.id, result: refreshedReview });
        setReviewError(null);
      } catch (error) {
        if (reviewRequestSequence !== reviewRequestSequenceRef.current) return;
        setReviewError({
          documentId: selectedDocument.id,
          message: error instanceof Error ? error.message : 'The updated review could not be retrieved.',
        });
      }
      setPhase('complete');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The selected findings could not be confirmed.');
    } finally {
      setIsConfirming(false);
    }
  }

  function jumpToPage(page: number) {
    setCurrentPage(page);
    document.getElementById('document-preview')?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center',
    });
  }

  useEffect(() => {
    if (!focusRequest || handledFocusRequestRef.current === focusRequest.requestId) return;
    const targetDocument = documents.find((document) => document.id === focusRequest.documentId);
    if (!targetDocument) return;
    let scrollFrame: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      if (handledFocusRequestRef.current === focusRequest.requestId) return;
      handledFocusRequestRef.current = focusRequest.requestId;
      setRequestedEvidenceId(focusRequest.evidenceId ?? null);
      setSelectedDocumentId(targetDocument.id);
      setActiveFindingId(null);
      setCurrentPage(focusRequest.pageNumber ?? 1);
      if (selectedDocument?.id !== targetDocument.id) void loadReview(targetDocument.id);
      scrollFrame = window.requestAnimationFrame(() => {
        const preview = document.getElementById('document-preview');
        preview?.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
          block: 'start',
        });
        preview?.focus({ preventScroll: true });
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (scrollFrame != null) window.cancelAnimationFrame(scrollFrame);
    };
  }, [documents, focusRequest, loadReview, selectedDocument?.id]);

  if (isLoading) {
    return (
      <main className="min-h-screen bg-[#090d14] px-4 py-16 text-zinc-100 sm:px-8">
        <div className="mx-auto flex max-w-4xl items-center gap-3 rounded-2xl border border-white/[0.07] bg-[#111722] p-6 text-sm text-zinc-400">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-blue-300 motion-reduce:animate-none" /> Loading case documents…
        </div>
      </main>
    );
  }

  if (!caseData) {
    return (
      <main className="min-h-screen bg-[#090d14] px-4 py-12 text-zinc-100 sm:px-8">
        <div className="mx-auto max-w-3xl rounded-2xl border border-rose-400/15 bg-[#111722] p-6">
          <AlertTriangle aria-hidden="true" className="h-5 w-5 text-rose-300" />
          <h1 className="mt-4 text-lg font-semibold">Case documents could not be loaded</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-400">{loadError || caseError || 'The case service did not return this case.'}</p>
          <button type="button" onClick={() => void refreshCase()} disabled={isRefreshing} className="mt-4 min-h-10 rounded-lg border border-white/[0.12] px-3 text-xs font-semibold text-zinc-200 disabled:opacity-50">
            {isRefreshing ? 'Retrying…' : 'Try again'}
          </button>
          <Link href={`/case/${encodeURIComponent(caseId)}`} className="mt-5 inline-flex items-center gap-2 text-sm text-blue-200 hover:text-blue-100">
            <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Back to case
          </Link>
        </div>
      </main>
    );
  }

  const reviewIsActive = phase === 'reviewing' || Boolean(
    selectedDocument && !selectedReview && !selectedReviewError &&
    (!recentDocument || recentDocument.id !== selectedDocument.id),
  );
  const uploadIsActive = phase === 'uploading';
  const processingIsActive = phase === 'processing';
  const documentAvailable = Boolean(selectedDocument);
  const previewAvailable = Boolean(previewFile && previewFile.documentId === selectedDocument?.id);
  const reviewAvailable = Boolean(selectedReview);
  const hasLocation = selectedReview?.findings.some((finding) => finding.provenance.some((source) => source.pageNumber != null || source.location != null)) ?? false;
  const hasConfirmedFindings = confirmedFindingIds.size > 0;
  const workflowStages = [
    {
      label: 'Upload',
      detail: uploadIsActive ? `Sending file · ${uploadProgress}%` : documentAvailable ? 'Saved to this case' : 'Choose a PDF or image',
      state: uploadIsActive ? 'active' as const : documentAvailable ? 'complete' as const : 'pending' as const,
    },
    {
      label: 'Processing',
      detail: processingIsActive ? 'Checking the service result' : selectedDocument ? humanize(selectedDocument.processingStatus) : 'Waiting for a document',
      state: processingIsActive ? 'active' as const : selectedDocument?.processingStatus === 'failed' || selectedDocument?.processingStatus === 'ocr_required' ? 'unavailable' as const : selectedDocument ? 'complete' as const : 'pending' as const,
    },
    {
      label: 'Document preview',
      detail: selectedDocument ? previewAvailable ? 'Source file preview ready' : 'Review snapshot available' : 'Waiting for a document',
      state: selectedDocument ? 'complete' as const : 'pending' as const,
    },
    {
      label: 'Findings',
      detail: reviewIsActive ? 'Review service is analyzing the file' : selectedReview ? `${selectedReview.findings.length} returned` : selectedReviewError ? 'Review unavailable' : 'Waiting for review',
      state: reviewIsActive ? 'active' as const : selectedReview ? 'complete' as const : selectedReviewError ? 'unavailable' as const : 'pending' as const,
    },
    {
      label: 'Source / page',
      detail: reviewAvailable ? (hasLocation ? 'Page or character location returned' : 'No location returned · review snapshot shown') : 'Waiting for review data',
      state: reviewAvailable ? (hasLocation ? 'complete' as const : 'unavailable' as const) : reviewIsActive ? 'active' as const : 'pending' as const,
    },
    {
      label: 'Confirmation',
      detail: isConfirming ? 'Saving the selected confirmation' : selectedFindingIds.length > 0 ? `${selectedFindingIds.length} selected · ready to confirm` : confirmableFindings.length > 0 ? `${confirmableFindings.length} direct extraction${confirmableFindings.length === 1 ? '' : 's'} available` : hasConfirmedFindings ? 'Saved confirmation recorded' : reviewAvailable ? 'No confirmable direct extractions' : 'Waiting for findings',
      state: isConfirming ? 'active' as const : selectedFindingIds.length > 0 ? 'ready' as const : hasConfirmedFindings ? 'complete' as const : reviewAvailable && confirmableFindings.length === 0 ? 'unavailable' as const : reviewIsActive ? 'active' as const : 'pending' as const,
    },
    {
      label: 'CaseState updated',
      detail: selectedEvidence?.status === 'conflicting'
        ? 'Confirmation saved · case evidence remains conflicting'
        : hasConfirmedFindings ? `${confirmedFindingIds.size} confirmed finding${confirmedFindingIds.size === 1 ? '' : 's'} in the saved case` : 'No unconfirmed finding has changed CaseState',
      state: hasConfirmedFindings ? 'complete' as const : selectedEvidence?.status === 'conflicting' ? 'unavailable' as const : isConfirming ? 'active' as const : 'pending' as const,
    },
    {
      label: 'Guide reacts',
      detail: hasConfirmedFindings ? 'Guide has the refreshed case record' : 'Guide updates after a confirmed case change',
      state: hasConfirmedFindings ? 'complete' as const : 'pending' as const,
    },
    {
      label: 'Twin / case UI',
      detail: hasConfirmedFindings ? 'Updated facts are available in the case and Twin views' : 'Case views update after confirmation',
      state: hasConfirmedFindings ? 'complete' as const : 'pending' as const,
    },
  ];

  const WorkspaceRoot = embedded ? 'section' : 'main';
  return (
    <WorkspaceRoot
      id={embedded ? 'evidence-workspace' : undefined}
      aria-label={embedded ? 'Case evidence workspace' : undefined}
      className={embedded
        ? 'overflow-hidden rounded-[28px] border border-[#273044] bg-[#090d14] text-zinc-100 shadow-[0_24px_80px_rgba(0,0,0,0.22)]'
        : 'min-h-screen bg-[#090d14] px-4 pb-16 pt-7 text-zinc-100 sm:px-8 sm:pt-10'}
    >
      <div className={`mx-auto ${embedded ? 'max-w-full p-4 sm:p-6' : 'max-w-[1440px]'}`}>
        <header className="flex flex-wrap items-start justify-between gap-5">
          <div>
            {!embedded && <Link href={`/case/${encodeURIComponent(caseId)}`} className="inline-flex items-center gap-2 text-xs font-medium text-zinc-500 transition hover:text-zinc-200 motion-reduce:transition-none">
              <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" /> Case workspace
            </Link>}
            <div className={`${embedded ? '' : 'mt-5'} flex items-start gap-3`}>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-blue-400/15 bg-blue-400/[0.065] text-blue-200">
                <ShieldCheck aria-hidden="true" className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-blue-200/70">LawSense · case review</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{embedded ? 'Evidence workspace' : 'Document review'}</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                  Upload a source, inspect service-returned findings and provenance, then confirm only the direct extractions you recognize.
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={refreshCase}
            disabled={isRefreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-white/[0.09] bg-white/[0.025] px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-white/[0.06] disabled:opacity-50"
          >
            <RefreshCw aria-hidden="true" className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} /> Refresh case
          </button>
        </header>

        <section aria-label="Document review workflow" aria-live="polite" className={`mt-7 grid grid-cols-2 gap-2 sm:grid-cols-4 ${embedded ? 'xl:grid-cols-4' : 'xl:grid-cols-9'}`}>
          {workflowStages.map((stage) => <Stage key={stage.label} {...stage} />)}
        </section>

        {loadError && (
          <p role="status" className="mt-4 rounded-xl border border-amber-400/15 bg-amber-400/[0.04] px-4 py-3 text-xs text-amber-100/80">
            Case data could not be refreshed: {loadError}
          </p>
        )}

        <section aria-labelledby="upload-heading" className="mt-6 rounded-2xl border border-[#273044] bg-[#111722] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.16)] sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="rounded-xl border border-blue-400/15 bg-blue-400/[0.06] p-2.5 text-blue-200"><Upload aria-hidden="true" className="h-4 w-4" /></span>
              <div>
                <h2 id="upload-heading" className="text-sm font-semibold text-zinc-100">Add a source document</h2>
                <p className="mt-1 max-w-xl text-xs leading-5 text-zinc-500">Agreements, notices, receipts, screenshots, and official documents · PDF, JPG, or PNG · up to 25 MiB</p>
              </div>
            </div>
            <span className="rounded-full border border-white/[0.07] px-2.5 py-1 text-[9px] font-medium uppercase tracking-[0.13em] text-zinc-500">Case {caseId.slice(0, 12)}</span>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(260px,0.82fr)_minmax(0,1.18fr)]">
            <div
              role="button"
              tabIndex={0}
              onKeyDown={onUploadKeyDown}
              onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false); }}
              onDrop={onDrop}
              className={`flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-5 py-5 text-center outline-none transition focus-visible:ring-2 focus-visible:ring-blue-400 ${isDragging ? 'border-blue-300 bg-blue-400/[0.08]' : 'border-[#344057] bg-[#0d121b] hover:border-[#52617b]'}`}
              onClick={() => inputRef.current?.click()}
            >
              <input ref={inputRef} type="file" accept={ACCEPTED_FILE_TYPES} onChange={onFileChange} className="sr-only" aria-label="Choose a PDF or image document" />
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1a2434] text-blue-200"><FileText aria-hidden="true" className="h-4 w-4" /></span>
              <p className="mt-3 text-xs font-medium text-zinc-200">Drop a file or choose from device</p>
              <p className="mt-1 text-[10px] text-zinc-500">No OCR or text will be shown unless the service returns it.</p>
            </div>

            <div className="flex min-w-0 flex-col justify-center">
              {selectedFile ? (
                <div className="rounded-xl border border-white/[0.07] bg-[#0d121b] p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.025] text-zinc-300"><FileCheck2 aria-hidden="true" className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-zinc-100">{selectedFile.name}</p>
                      <p className="mt-1 text-[10px] text-zinc-500">{formatBytes(selectedFile.size)} · {selectedFile.type || 'Image/PDF'}</p>
                    </div>
                    <button type="button" onClick={() => setSelectedFile(null)} aria-label="Remove selected file" className="rounded-md p-1.5 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"><X aria-hidden="true" className="h-4 w-4" /></button>
                  </div>
                  <button
                    type="button"
                    onClick={submitDocument}
                    disabled={phase === 'uploading' || phase === 'processing' || reviewIsActive}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-blue-400 disabled:cursor-wait disabled:opacity-60"
                  >
                    {phase === 'uploading' || phase === 'processing' || reviewIsActive ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Upload aria-hidden="true" className="h-4 w-4" />}
                    {phase === 'uploading' ? `Uploading ${uploadProgress}%` : phase === 'processing' ? 'Checking processing result' : reviewIsActive ? 'Reviewing document' : 'Upload and review'}
                  </button>
                  {phase === 'uploading' && <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full rounded-full bg-blue-400 transition-[width] duration-300 ease-out motion-reduce:transition-none" style={{ width: `${uploadProgress}%` }} /></div>}
                </div>
              ) : (
                <div className="rounded-xl border border-white/[0.055] bg-white/[0.018] px-4 py-4">
                  <p className="text-xs font-medium text-zinc-300">Source-first review</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">The file is saved to the case and reviewed. Findings stay provisional until you confirm them.</p>
                </div>
              )}
              {validationError && <p role="alert" className="mt-3 text-xs text-rose-300">{validationError}</p>}
              {actionError && <p role="alert" className="mt-3 flex items-start gap-2 text-xs leading-5 text-rose-200"><AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />{actionError}</p>}
              {selectedReviewError && selectedDocument && <p role="status" className="mt-3 rounded-lg border border-amber-400/15 bg-amber-400/[0.035] px-3 py-2.5 text-xs leading-5 text-amber-100/80">The document is saved, but review results are unavailable: {selectedReviewError}</p>}
            </div>
          </div>
        </section>

        {requestedEvidence && (
          <section
            id="requested-evidence-record"
            tabIndex={-1}
            aria-labelledby="requested-evidence-heading"
            className="mt-7 scroll-mt-24 rounded-xl border border-cyan-200/20 bg-cyan-200/[0.035] p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/60"
          >
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-cyan-100/65">Selected evidence record</p>
            <h2 id="requested-evidence-heading" className="mt-1 text-sm font-semibold text-zinc-100">{requestedEvidence.title}</h2>
            <p className="mt-1 text-xs leading-5 text-zinc-300">
              {humanize(requestedEvidence.type)} · {humanize(requestedEvidence.status)} · {requestedEvidence.processingStatus ? humanize(requestedEvidence.processingStatus) : 'Processing status not supplied'}
            </p>
            {requestedEvidence.documentId && (
              <p className="mt-1 text-[10px] text-zinc-500">The linked document is not available in the current case document list.</p>
            )}
          </section>
        )}

        <section aria-labelledby="documents-heading" className="mt-7">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.17em] text-zinc-600">Current case</p>
              <h2 id="documents-heading" className="mt-1 text-sm font-semibold text-zinc-200">Documents <span className="ml-1 text-xs font-normal text-zinc-500">{documents.length}</span></h2>
            </div>
            {documents.length > 0 && <p className="text-[10px] text-zinc-600">Choose a document to inspect its returned review data</p>}
          </div>
          {documents.length === 0 ? (
            <EmptyState>No documents have been uploaded to this case yet.</EmptyState>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-2">
              {documents.map((document) => {
                const selected = selectedDocument?.id === document.id;
                return (
                  <button
                    key={document.id}
                    type="button"
                    onClick={() => selectDocument(document)}
                    className={`flex min-w-64 max-w-80 items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition duration-300 motion-reduce:transition-none ${selected ? 'border-blue-300/25 bg-blue-300/[0.06]' : 'border-white/[0.07] bg-[#111722] hover:border-white/[0.14]'}`}
                  >
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${selected ? 'bg-blue-400/10 text-blue-200' : 'bg-white/[0.035] text-zinc-400'}`}><FileText aria-hidden="true" className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-zinc-200">{document.filename}</span>
                      <span className="mt-1 block truncate text-[10px] text-zinc-500">{humanize(document.classification)} · {humanize(document.processingStatus)} · {humanize(document.reviewStatus)}</span>
                    </span>
                    {selected && <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-blue-200" />}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {selectedDocument && (
          <>
            <section className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(310px,0.7fr)]">
              <div id="document-preview" tabIndex={-1} className="min-w-0 scroll-mt-5 outline-none focus-visible:ring-2 focus-visible:ring-blue-200/50">
                <DocumentViewer
                  document={{
                    id: selectedDocument.id,
                    fileName: selectedDocument.filename,
                    mimeType: selectedDocument.mimeType,
                    previewUrl: previewFile?.documentId === selectedDocument.id ? previewFile.url : null,
                    previewType: selectedDocument.extension === '.pdf' ? 'pdf' : selectedDocument.extension === '.png' || selectedDocument.extension === '.jpg' || selectedDocument.extension === '.jpeg' ? 'image' : 'unsupported',
                  }}
                  pages={selectedDocument.pages.map((page) => ({ pageNumber: page.pageNumber, previewUrl: previewFile?.documentId === selectedDocument.id ? previewFile.url : null }))}
                  pageCount={selectedDocument.pageCount}
                  initialPage={currentPage}
                  onPageChange={setCurrentPage}
                  status={statusForDocument(selectedDocument)}
                  selectedSource={selectedFinding ? {
                    pageNumber: selectedFindingSource?.source === 'document' ? selectedFindingSource.pageNumber : null,
                    start: selectedFindingSource?.location?.start,
                    end: selectedFindingSource?.location?.end,
                    excerpt: selectedFinding.text,
                  } : null}
                />
              </div>

              <div className="space-y-4">
                {!previewAvailable && (
                  <section aria-labelledby="saved-document-record-heading" className="rounded-2xl border border-blue-300/10 bg-blue-300/[0.025] p-4">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-blue-200/65">Saved review record</p>
                    <h2 id="saved-document-record-heading" className="mt-1 text-xs font-semibold text-zinc-200">The original preview is not returned on a revisit</h2>
                    <p className="mt-2 text-[11px] leading-5 text-zinc-500">
                      This API does not send the original file preview back to the browser. The stored review can still be rebuilt from server-held bytes when available; case evidence and source details returned by the case service remain below.
                    </p>
                    <dl className="mt-3 grid gap-2 border-t border-white/[0.06] pt-3 text-[10px] sm:grid-cols-2">
                      <div><dt className="text-zinc-600">Processed</dt><dd className="mt-0.5 text-zinc-300">{formatTimestamp(selectedDocument.processingTimestamp)}</dd></div>
                      <div><dt className="text-zinc-600">Review state</dt><dd className="mt-0.5 text-zinc-300">{humanize(selectedDocument.reviewStatus)}</dd></div>
                      <div className="sm:col-span-2"><dt className="text-zinc-600">SHA-256 file reference</dt><dd className="mt-0.5 break-all font-mono text-[9px] leading-4 text-zinc-400">{selectedDocument.sha256 || 'Not supplied'}</dd></div>
                    </dl>
                    {selectedDocument.pages.length > 0 ? (
                      <ul className="mt-3 space-y-1.5 border-t border-white/[0.06] pt-3">
                        {selectedDocument.pages.map((page) => (
                          <li key={`${selectedDocument.id}-page-${page.pageNumber}`} className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-zinc-500">
                            <button type="button" onClick={() => jumpToPage(page.pageNumber)} className="text-left text-blue-200 underline decoration-blue-200/30 underline-offset-2 hover:text-blue-100" aria-label={`Open saved source page ${page.pageNumber}`}>
                              Page {page.pageNumber} · {humanize(page.extractionMethod)} · {humanize(page.processingStatus)}
                            </button>
                            <span>{page.textLength} characters returned</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-3 border-t border-white/[0.06] pt-3 text-[10px] text-zinc-500">No page-level extraction record was returned for this document.</p>
                    )}
                    {selectedDocument.confirmationHistory.length > 0 && (
                      <p className="mt-3 text-[10px] leading-4 text-emerald-200/70">
                        {selectedDocument.confirmationHistory.reduce((count, item) => count + item.findingIds.length, 0)} finding confirmations recorded · latest {formatTimestamp(selectedDocument.confirmationHistory.at(-1)?.confirmedAt)}
                      </p>
                    )}
                  </section>
                )}
                <section aria-labelledby="classification-heading" className="rounded-2xl border border-white/[0.07] bg-[#111722] p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span className="rounded-lg border border-violet-300/15 bg-violet-300/[0.055] p-2 text-violet-200"><Sparkles aria-hidden="true" className="h-4 w-4" /></span>
                      <div>
                        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Backend classification</p>
                        <h2 id="classification-heading" className="mt-1 text-sm font-semibold text-zinc-100">{humanize(selectedDocument.classification || 'Not reported')}</h2>
                      </div>
                    </div>
                    <span className="rounded-lg border border-white/[0.07] px-2.5 py-1.5 text-[10px] text-zinc-400">{percent(selectedDocument.classificationConfidence)}</span>
                  </div>
                  {selectedDocument.classificationSignals.length > 0 ? (
                    <div className="mt-4 border-t border-white/[0.06] pt-3">
                      <p className="text-[9px] font-semibold uppercase tracking-wide text-zinc-600">Signals returned by service</p>
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {selectedDocument.classificationSignals.map((signal, index) => <li key={`${signal}-${index}`} className="rounded-md border border-white/[0.07] bg-white/[0.02] px-2 py-1 text-[10px] text-zinc-400">{signal}</li>)}
                      </ul>
                    </div>
                  ) : (
                    <p className="mt-4 border-t border-white/[0.06] pt-3 text-xs text-zinc-500">The service returned no classification signals.</p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-white/[0.06] pt-3 text-[10px] text-zinc-500">
                    <span>{formatBytes(selectedDocument.fileSize)}</span>
                    <span>{selectedDocument.pageCount > 0 ? `${selectedDocument.pageCount} page${selectedDocument.pageCount === 1 ? '' : 's'}` : 'Page count not supplied'}</span>
                    <span>{selectedDocument.mimeType}</span>
                  </div>
                  {selectedDocument.errors.length > 0 && <ul className="mt-3 space-y-1 text-xs leading-5 text-amber-100/80">{selectedDocument.errors.map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul>}
                </section>
                <OCRStatus
                  status={ocrStatus(selectedDocument)}
                  detail={selectedDocument.processingStatus === 'ocr_required'
                    ? selectedDocument.errors[0] || 'The document service reports that OCR is required. No text or findings have been invented.'
                    : selectedDocument.processingStatus === 'failed'
                      ? selectedDocument.errors[0] || 'The document service reports processing failed.'
                      : 'The document service returned local extraction status. It did not report that OCR ran.'}
                />
              </div>
            </section>

            <section aria-labelledby="findings-heading" className="mt-7">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-[0.17em] text-zinc-600">Returned review data</p>
                  <h2 id="findings-heading" className="mt-1 text-base font-semibold text-zinc-100">Extracted findings</h2>
                </div>
                {selectedReview && <span className="rounded-full border border-white/[0.07] px-2.5 py-1 text-[10px] text-zinc-400">{regularFindings.length} findings</span>}
              </div>
              {selectedReview ? (
                regularFindings.length > 0 ? (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {regularFindings.map((finding) => {
                      const confirmable = confirmableFindings.some((item) => item.id === finding.id);
                      const confirmed = confirmedFindingIds.has(finding.id);
                      return (
                        <FindingCard
                          key={finding.id}
                          finding={finding}
                          onSelect={(pageNumber) => selectFinding(finding, pageNumber)}
                          selected={activeFindingId === finding.id}
                          confirmed={confirmed}
                          status={caseStatusForFinding(finding, confirmed, selectedDocument.id, caseData)}
                          checked={selectedFindingIds.includes(finding.id)}
                          onToggle={confirmable ? (findingId, checked) => {
                            setSelectedFindingIds((current) => checked
                              ? [...new Set([...current, findingId])]
                              : current.filter((id) => id !== findingId));
                          } : undefined}
                        />
                      );
                    })}
                  </div>
                ) : <EmptyState>The review API returned no extracted findings for this document.</EmptyState>
              ) : reviewIsActive ? (
                <div className="flex items-center gap-3 rounded-xl border border-blue-400/15 bg-blue-400/[0.035] p-4 text-sm text-blue-100/80"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />The review service is processing this file.</div>
              ) : selectedReviewError ? (
                <div role="status" className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.035] p-4">
                  <p className="text-xs font-semibold text-amber-100">Stored document review is unavailable</p>
                  <p className="mt-1 text-[11px] leading-5 text-amber-100/70">{selectedReviewError}</p>
                  <p className="mt-2 text-[11px] leading-5 text-zinc-500">The saved document record and any confirmed facts with page provenance remain available in the sections below.</p>
                  <button type="button" onClick={() => void loadReview(selectedDocument.id)} className="mt-3 inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-amber-200/15 px-2.5 text-[10px] font-semibold text-amber-100/80 transition hover:bg-amber-200/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200">
                    <RefreshCw aria-hidden="true" className="h-3 w-3" /> Retry review from stored file
                  </button>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-white/[0.09] p-4">
                  <p className="text-xs font-medium text-zinc-300">No review response is loaded</p>
                  <p className="mt-1 text-[11px] leading-5 text-zinc-500">The case record and any saved evidence remain available below. Request the stored-file review when the review service is ready.</p>
                  <button type="button" onClick={() => void loadReview(selectedDocument.id)} className="mt-3 inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-white/[0.1] px-2.5 text-[10px] font-semibold text-zinc-300 transition hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300">
                    <RefreshCw aria-hidden="true" className="h-3 w-3" /> Request stored-file review
                  </button>
                </div>
              )}
              {selectedReview && (
                <div className="mt-4 rounded-xl border border-white/[0.07] bg-[#111722] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium text-zinc-200">Confirm findings for this case</p>
                      <p className="mt-1 text-[11px] leading-5 text-zinc-500">
                        Only selected direct extractions become CaseState facts. Confirmation records that you agree with this reading; it does not verify the document&apos;s authenticity, completeness, or the truth of its contents. Interpretations and uncertain results stay provisional.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={confirmSelectedFindings}
                      disabled={selectedFindingIds.length === 0 || isConfirming}
                        className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none"
                    >
                      {isConfirming ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Check aria-hidden="true" className="h-3.5 w-3.5" />}
                      {isConfirming ? 'Updating case' : `Confirm ${selectedFindingIds.length} selected`}
                    </button>
                  </div>
                  {selectedFindingIds.length > 0 && (
                    <section aria-label="Confirmation preview" aria-live="polite" className="mt-4 rounded-xl border border-emerald-300/15 bg-emerald-300/[0.035] p-3.5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-100/80">Before you confirm</p>
                      <ul className="mt-2 space-y-2">
                        {selectedReview.findings.filter((finding) => selectedFindingIds.includes(finding.id)).map((finding) => (
                          <li key={finding.id} className="grid gap-2 rounded-lg border border-white/[0.06] bg-black/10 p-2.5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                            <span className="min-w-0 text-xs text-zinc-200"><span className="font-medium">{findingTitle(finding)}</span><span className="mt-0.5 block truncate text-[10px] text-zinc-500">{displayValue(finding.value)}</span></span>
                            <span className="inline-flex items-center gap-2 text-[10px] text-zinc-500"><StatusBadge status="AWAITING_CONFIRMATION" /><ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-zinc-500" /></span>
                            <span className="text-[10px] leading-4 text-emerald-100/75">Evidence-supported after confirmation, unless the updated case record marks a conflict.</span>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 text-[10px] leading-4 text-zinc-500">This is a preview. CaseState changes only after the confirmation request succeeds.</p>
                    </section>
                  )}
                  {confirmedFindingIds.size > 0 && (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
                      <p className="text-[10px] text-emerald-200/75">
                        {confirmedFindingIds.size} finding{confirmedFindingIds.size === 1 ? '' : 's'} recorded in confirmation history.
                      </p>
                      <div className="flex gap-3 text-[10px]">
                        <Link href={`/case/${encodeURIComponent(caseId)}/twin`} className="text-blue-200 hover:text-blue-100">Open Legal Twin</Link>
                        <Link href={`/case/${encodeURIComponent(caseId)}/guide`} className="text-blue-200 hover:text-blue-100">Ask Guide about this case</Link>
                      </div>
                    </div>
                  )}
                  {receiptForDocument && (
                    <section id="case-impact" aria-labelledby="case-impact-heading" aria-live="polite" className="mt-4 rounded-2xl border border-emerald-300/20 bg-[linear-gradient(125deg,rgba(16,185,129,0.08),rgba(17,23,34,0.8)_70%)] p-4 transition-[border-color,background-color] duration-500 motion-reduce:transition-none">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-emerald-200/70">Saved confirmation</p>
                          <h3 id="case-impact-heading" className="mt-1 text-sm font-semibold text-zinc-100">CaseState updated</h3>
                        </div>
                        <span className="rounded-lg border border-white/[0.08] px-2.5 py-1.5 text-[10px] tabular-nums text-zinc-300">
                          Facts {receiptForDocument.before.facts.length} → {receiptForDocument.after.facts.length}
                        </span>
                      </div>
                      <ul className="mt-3 space-y-2">
                        {receiptForDocument.findingSummaries.map((summary) => (
                          <li key={summary.id} className="grid gap-2 rounded-lg border border-white/[0.06] bg-black/10 p-2.5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                            <span className="min-w-0 text-xs text-zinc-200"><span className="font-medium">{summary.title}</span><span className="mt-0.5 block truncate text-[10px] text-zinc-500">{summary.value}</span></span>
                            <span className="inline-flex items-center gap-2 text-[10px] text-zinc-500"><StatusBadge status="AWAITING_CONFIRMATION" /><ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-zinc-500" /></span>
                            <span className="flex flex-wrap items-center gap-2"><StatusBadge status={summary.afterStatus} /></span>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-4 border-t border-white/[0.07] pt-3">
                        <p className="text-xs font-medium text-emerald-100">This changes your case because…</p>
                        {receiptSupportedFacts.length > 0 ? (
                          <p className="mt-1 text-[11px] leading-5 text-zinc-300">
                            {receiptSupportedFacts.length} fact{receiptSupportedFacts.length === 1 ? '' : 's'} from this document now have evidence-supported status and user-confirmed provenance. The saved CaseState is available to case analysis, Guide, and Twin.
                          </p>
                        ) : receiptConflictingFacts.length > 0 ? (
                          <p className="mt-1 text-[11px] leading-5 text-zinc-300">
                            The selected extraction{receiptConflictingFacts.length === 1 ? '' : 's'} remain{receiptConflictingFacts.length === 1 ? 's' : ''} marked conflicting in CaseState. Confirmation records the source review without resolving that conflict.
                          </p>
                        ) : (
                          <p className="mt-1 text-[11px] leading-5 text-zinc-300">
                            The document confirmation was saved, but the refreshed CaseState returned no newly linked fact. No downstream fact change is reported.
                          </p>
                        )}
                        {receiptSupportedFacts.length > 0 && receiptConflictingFacts.length > 0 && (
                          <p className="mt-1 text-[11px] leading-5 text-rose-200/80">
                            {receiptConflictingFacts.length} confirmed fact{receiptConflictingFacts.length === 1 ? '' : 's'} remain marked conflicting.
                          </p>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Link href={`/case/${encodeURIComponent(caseId)}/guide`} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#e9bd7b]/25 bg-[#e9bd7b]/[0.08] px-3 text-[10px] font-semibold text-[#f2d7aa] transition hover:bg-[#e9bd7b]/[0.14] motion-reduce:transition-none">
                            <Sparkles aria-hidden="true" className="h-3.5 w-3.5" /> Ask Guide what changed
                          </Link>
                          <Link href={`/case/${encodeURIComponent(caseId)}/twin`} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/[0.1] px-3 text-[10px] font-medium text-zinc-300 transition hover:bg-white/[0.05] motion-reduce:transition-none">
                            Open Twin with updated case
                          </Link>
                        </div>
                        <p className="mt-2 text-[10px] leading-4 text-zinc-500">Guide and Twin receive the refreshed CaseState. Conflicting facts stay marked conflicting.</p>
                      </div>
                    </section>
                  )}
                  {confirmableFindings.length === 0 && (
                    <p className="mt-3 text-[10px] text-zinc-500">No direct extraction findings are available to map into CaseState.</p>
                  )}
                  {actionError && <p role="alert" className="mt-3 text-xs text-rose-200">{actionError}</p>}
                </div>
              )}
            </section>

            <section className="mt-7 grid gap-4 xl:grid-cols-3">
              {caseData && <EvidenceMapping evidence={selectedEvidence} caseData={caseData} document={selectedDocument} onPage={jumpToPage} />}

              <section aria-labelledby="uncertainty-heading" className="rounded-2xl border border-amber-300/10 bg-[#111722] p-5">
                <div className="flex items-start gap-3">
                  <span className="rounded-lg border border-amber-300/15 bg-amber-300/[0.05] p-2 text-amber-200"><CircleHelp aria-hidden="true" className="h-4 w-4" /></span>
                  <div>
                    <h2 id="uncertainty-heading" className="text-sm font-semibold text-zinc-100">Uncertainty</h2>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">Missing text and ambiguous results stay marked as uncertain.</p>
                  </div>
                </div>
                {uncertaintyFindings.length > 0 ? (
                  <div className="mt-4 space-y-2">{uncertaintyFindings.map((finding) => <FindingCard key={finding.id} finding={finding} onSelect={(pageNumber) => selectFinding(finding, pageNumber)} selected={activeFindingId === finding.id} />)}</div>
                ) : selectedDocument.processingStatus === 'ocr_required' ? (
                  <p className="mt-4 rounded-lg border border-orange-400/15 bg-orange-400/[0.035] p-3 text-xs leading-5 text-orange-100/80">Needs OCR. The service did not return readable page text, so no document findings are shown.</p>
                ) : selectedReview ? (
                  <p className="mt-4 text-xs leading-5 text-zinc-500">The review API returned no uncertainty findings.</p>
                ) : (
                  <p className="mt-4 text-xs leading-5 text-zinc-500">Uncertainty cannot be assessed until the review API returns its results.</p>
                )}
              </section>

              <section aria-labelledby="conflicts-heading" className="rounded-2xl border border-rose-300/10 bg-[#111722] p-5">
                <div className="flex items-start gap-3">
                  <span className="rounded-lg border border-rose-300/15 bg-rose-300/[0.05] p-2 text-rose-200"><AlertTriangle aria-hidden="true" className="h-4 w-4" /></span>
                  <div>
                    <h2 id="conflicts-heading" className="text-sm font-semibold text-zinc-100">Case conflicts</h2>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">Comparisons returned by the document-review API.</p>
                  </div>
                </div>
                {conflictFindings.length > 0 ? (
                  <div className="mt-4 space-y-2">{conflictFindings.map((finding) => <FindingCard key={finding.id} finding={finding} onSelect={(pageNumber) => selectFinding(finding, pageNumber)} selected={activeFindingId === finding.id} />)}</div>
                ) : selectedReview ? (
                  <p className="mt-4 text-xs leading-5 text-zinc-500">No case conflicts were returned for this document.</p>
                ) : (
                  <p className="mt-4 text-xs leading-5 text-zinc-500">No conflict result is available until the review API completes.</p>
                )}
              </section>
            </section>

            {selectedReview?.errors && selectedReview.errors.length > 0 && (
              <section aria-label="Review service messages" className="mt-5 rounded-xl border border-amber-400/15 bg-amber-400/[0.035] p-4">
                <h2 className="text-xs font-semibold text-amber-100">Review service messages</h2>
                <ul className="mt-2 space-y-1 text-xs leading-5 text-amber-100/75">{selectedReview.errors.map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul>
              </section>
            )}

            <footer className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4 text-[10px] text-zinc-600">
              <span className="inline-flex items-center gap-1.5"><ShieldCheck aria-hidden="true" className="h-3 w-3" /> Source status and locations are service-reported.</span>
              {!embedded && <Link href={`/case/${encodeURIComponent(caseId)}`} className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200">Return to case <ChevronRight aria-hidden="true" className="h-3 w-3" /></Link>}
            </footer>
          </>
        )}
      </div>
    </WorkspaceRoot>
  );
}
