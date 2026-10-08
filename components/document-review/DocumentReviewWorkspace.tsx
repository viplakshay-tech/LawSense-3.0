'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, KeyboardEvent, ReactNode } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
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

const API_BASE_URL = 'http://127.0.0.1:8000';
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ACCEPTED_FILE_TYPES = '.pdf,.jpg,.jpeg,.png';

type Phase = 'idle' | 'uploading' | 'processing' | 'reviewing' | 'complete';

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
  return 'EVIDENCE_SUPPORTED';
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
  state: 'complete' | 'active' | 'pending' | 'unavailable';
}) {
  const icon = state === 'complete'
    ? <Check aria-hidden="true" className="h-3.5 w-3.5" />
    : state === 'active'
      ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
      : state === 'unavailable'
        ? <CircleHelp aria-hidden="true" className="h-3.5 w-3.5" />
        : <span className="h-1.5 w-1.5 rounded-full bg-current" />;
  const tone = state === 'complete'
    ? 'border-emerald-400/20 bg-emerald-400/[0.055] text-emerald-200'
    : state === 'active'
      ? 'border-blue-400/25 bg-blue-400/[0.07] text-blue-200'
      : state === 'unavailable'
        ? 'border-amber-400/15 bg-amber-400/[0.035] text-amber-100/80'
        : 'border-white/[0.07] bg-white/[0.018] text-zinc-500';

  return (
    <div className={`min-w-0 rounded-xl border p-3 ${tone}`}>
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.11em]">
        {icon}<span className="truncate">{label}</span>
      </div>
      <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-zinc-400">{detail}</p>
    </div>
  );
}

function ProvenanceLine({
  finding,
  onPage,
}: {
  finding: DocumentReviewApiFinding;
  onPage: (page: number) => void;
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
          {source.pageNumber != null && (
            <button
              type="button"
              onClick={() => onPage(source.pageNumber!)}
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
  onPage,
  checked,
  confirmed,
  onToggle,
}: {
  finding: DocumentReviewApiFinding;
  onPage: (page: number) => void;
  checked?: boolean;
  confirmed?: boolean;
  onToggle?: (findingId: string, checked: boolean) => void;
}) {
  const isConflict = finding.status === 'potential_conflict';
  const conflict = typeof finding.value === 'object' && finding.value !== null
    ? finding.value as Record<string, unknown>
    : null;

  return (
    <article className={`rounded-xl border p-4 ${isConflict ? 'border-rose-400/20 bg-rose-400/[0.035]' : 'border-white/[0.07] bg-[#0d121b]'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-zinc-500">{findingTitle(finding)}</p>
          <p className="mt-1 text-[9px] uppercase tracking-wide text-zinc-600">
            {finding.nature === 'interpretation' ? 'Review interpretation' : 'Extracted value'}
          </p>
        </div>
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
          <StatusBadge status={confirmed ? 'EVIDENCE_SUPPORTED' : statusForFinding(finding)} />
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
      <ProvenanceLine finding={finding} onPage={onPage} />
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
}: {
  evidence: EvidenceItem | null;
  caseData: CaseState;
  document: CaseDocument | null;
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
                    <p key={`${fact.id}-${index}`} className="mt-1 text-[10px] text-zinc-500">
                      Page {source.pageNumber} · {humanize(source.extractionMethod)} · {percent(source.confidence)} confidence
                      {source.confirmedAt ? ` · confirmed ${new Date(source.confirmedAt).toLocaleString()}` : ''}
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

export function DocumentReviewWorkspace({ caseId }: { caseId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    caseState: caseData,
    loading: isLoading,
    error: caseError,
    refreshCaseState,
    replaceCaseState,
  } = useCaseState();
  const initialReviewLoadedRef = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [recentDocument, setRecentDocument] = useState<CaseDocument | null>(null);
  const [review, setReview] = useState<{ storedDocumentId: string; result: DocumentReviewApiResponse } | null>(null);
  const [reviewError, setReviewError] = useState<{ documentId: string; message: string } | null>(null);
  const [previewFile, setPreviewFile] = useState<{ documentId: string; file: File; url: string } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [selectedFindingIds, setSelectedFindingIds] = useState<string[]>([]);

  const documents = useMemo(() => {
    const saved = caseData?.documents ?? [];
    if (!recentDocument || saved.some((document) => document.id === recentDocument.id)) return saved;
    return [...saved, recentDocument];
  }, [caseData?.documents, recentDocument]);
  const selectedDocument = documents.find((document) => document.id === selectedDocumentId) ?? documents.at(-1) ?? null;
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

  useEffect(() => {
    if (!caseData || initialReviewLoadedRef.current) return;
    initialReviewLoadedRef.current = true;
    const document = caseData.documents.at(-1);
    if (!document) return;

    let alive = true;
    void getStoredDocumentReview(caseId, document.id).then((result) => {
      if (alive) {
        setReview({ storedDocumentId: document.id, result });
        setPhase('complete');
      }
    }).catch((error: unknown) => {
      if (alive) {
        setReviewError({
          documentId: document.id,
          message: error instanceof Error ? error.message : 'The review result could not be retrieved.',
        });
        setPhase('complete');
      }
    });
    return () => { alive = false; };
  }, [caseData, caseId]);

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

  async function loadReview(documentId: string) {
    setReview(null);
    setReviewError(null);
    setSelectedFindingIds([]);
    setPhase('reviewing');
    try {
      const result = await getStoredDocumentReview(caseId, documentId);
      setReview({ storedDocumentId: documentId, result });
      setPhase('complete');
    } catch (error) {
      setReviewError({
        documentId,
        message: error instanceof Error ? error.message : 'The review result could not be retrieved.',
      });
      setPhase('complete');
    }
  }

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

      setPhase('processing');
      try {
        await refreshCaseState();
      } catch {
        // Upload response remains authoritative for the newly stored document metadata.
      }

      setPhase('reviewing');
      try {
        const result = await getStoredDocumentReview(caseId, upload.document.id);
        setReview({ storedDocumentId: upload.document.id, result });
        setPhase('complete');
      } catch (error) {
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
    if (previewFile?.documentId !== document.id) setPreviewFile(null);
    void loadReview(document.id);
  }

  async function confirmSelectedFindings() {
    if (!selectedDocument || selectedFindingIds.length === 0 || isConfirming) return;
    setIsConfirming(true);
    setActionError(null);
    try {
      const updated = await confirmDocumentFindings(caseId, selectedDocument.id, selectedFindingIds);
      replaceCaseState(updated);
      setSelectedFindingIds([]);
      try {
        const refreshedReview = await getStoredDocumentReview(caseId, selectedDocument.id);
        setReview({ storedDocumentId: selectedDocument.id, result: refreshedReview });
        setReviewError(null);
      } catch (error) {
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
    document.getElementById('document-preview')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  if (isLoading) {
    return (
      <main className="min-h-screen bg-[#090d14] px-4 py-16 text-zinc-100 sm:px-8">
        <div className="mx-auto flex max-w-4xl items-center gap-3 rounded-2xl border border-white/[0.07] bg-[#111722] p-6 text-sm text-zinc-400">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-blue-300" /> Loading case documents…
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
  const reviewAvailable = Boolean(selectedReview);
  const hasLocation = selectedReview?.findings.some((finding) => finding.provenance.some((source) => source.pageNumber != null || source.location != null)) ?? false;
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
      label: 'Classification',
      detail: selectedDocument ? humanize(selectedDocument.classification || 'Not reported') : 'Not available yet',
      state: selectedDocument ? (selectedDocument.classification && selectedDocument.classification !== 'unknown' ? 'complete' as const : 'unavailable' as const) : 'pending' as const,
    },
    {
      label: 'Findings',
      detail: reviewIsActive ? 'Review service is analyzing the file' : selectedReview ? `${selectedReview.findings.length} returned` : selectedReviewError ? 'Review unavailable' : 'Waiting for review',
      state: reviewIsActive ? 'active' as const : selectedReview ? 'complete' as const : selectedReviewError ? 'unavailable' as const : 'pending' as const,
    },
    {
      label: 'Page provenance',
      detail: reviewAvailable ? (hasLocation ? 'Page and text locations returned' : 'No location returned') : 'Waiting for review data',
      state: reviewAvailable ? (hasLocation ? 'complete' as const : 'unavailable' as const) : reviewIsActive ? 'active' as const : 'pending' as const,
    },
    {
      label: 'Evidence map',
      detail: selectedEvidence?.status === 'evidence_supported' || selectedEvidence?.status === 'conflicting'
        ? 'User-confirmed facts linked to this source'
        : selectedEvidence ? 'Awaiting user confirmation' : reviewAvailable ? 'No case evidence record returned' : 'Waiting for case links',
      state: selectedEvidence?.status === 'evidence_supported' || selectedEvidence?.status === 'conflicting'
        ? 'complete' as const
        : selectedEvidence ? 'pending' as const : reviewAvailable ? 'unavailable' as const : 'pending' as const,
    },
    {
      label: 'Uncertainty',
      detail: reviewAvailable ? `${uncertaintyFindings.length} uncertain result${uncertaintyFindings.length === 1 ? '' : 's'}` : selectedDocument?.processingStatus === 'ocr_required' ? 'OCR is required' : 'Waiting for review',
      state: reviewAvailable ? (uncertaintyFindings.length > 0 ? 'unavailable' as const : 'complete' as const) : selectedDocument?.processingStatus === 'ocr_required' ? 'unavailable' as const : reviewIsActive ? 'active' as const : 'pending' as const,
    },
    {
      label: 'Case conflicts',
      detail: reviewAvailable ? `${conflictFindings.length} conflict${conflictFindings.length === 1 ? '' : 's'} returned` : 'Waiting for review',
      state: reviewAvailable ? (conflictFindings.length > 0 ? 'unavailable' as const : 'complete' as const) : reviewIsActive ? 'active' as const : 'pending' as const,
    },
  ];

  return (
    <main className="min-h-screen bg-[#090d14] px-4 pb-16 pt-7 text-zinc-100 sm:px-8 sm:pt-10">
      <div className="mx-auto max-w-[1440px]">
        <header className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <Link href={`/case/${encodeURIComponent(caseId)}`} className="inline-flex items-center gap-2 text-xs font-medium text-zinc-500 transition hover:text-zinc-200">
              <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" /> Case workspace
            </Link>
            <div className="mt-5 flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-blue-400/15 bg-blue-400/[0.065] text-blue-200">
                <ShieldCheck aria-hidden="true" className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-blue-200/70">LawSense · case review</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Document review</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                  Review what the document service extracted, where it came from, and what still needs checking.
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
            <RefreshCw aria-hidden="true" className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} /> Refresh case
          </button>
        </header>

        <section aria-label="Document review workflow" className="mt-7 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
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
                    {phase === 'uploading' || phase === 'processing' || reviewIsActive ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Upload aria-hidden="true" className="h-4 w-4" />}
                    {phase === 'uploading' ? `Uploading ${uploadProgress}%` : phase === 'processing' ? 'Checking processing result' : reviewIsActive ? 'Reviewing document' : 'Upload and review'}
                  </button>
                  {phase === 'uploading' && <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full rounded-full bg-blue-400 transition-[width]" style={{ width: `${uploadProgress}%` }} /></div>}
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
                    className={`flex min-w-64 max-w-80 items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition ${selected ? 'border-blue-300/25 bg-blue-300/[0.06]' : 'border-white/[0.07] bg-[#111722] hover:border-white/[0.14]'}`}
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
              <div id="document-preview" className="min-w-0 scroll-mt-5">
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
                />
              </div>

              <div className="space-y-4">
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
                          onPage={jumpToPage}
                          confirmed={confirmed}
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
                <div className="flex items-center gap-3 rounded-xl border border-blue-400/15 bg-blue-400/[0.035] p-4 text-sm text-blue-100/80"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />The review service is processing this file.</div>
              ) : selectedReviewError ? (
                <EmptyState>Review results are unavailable. {selectedReviewError}</EmptyState>
              ) : (
                <EmptyState>This case stores document metadata, not the original text. Re-upload a source file to request fresh findings from the review API.</EmptyState>
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
                      className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {isConfirming ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <Check aria-hidden="true" className="h-3.5 w-3.5" />}
                      {isConfirming ? 'Updating case' : `Confirm ${selectedFindingIds.length} selected`}
                    </button>
                  </div>
                  {confirmedFindingIds.size > 0 && (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
                      <p className="text-[10px] text-emerald-200/75">
                        {confirmedFindingIds.size} finding{confirmedFindingIds.size === 1 ? '' : 's'} confirmed. CaseState analysis and journey use these facts.
                      </p>
                      <div className="flex gap-3 text-[10px]">
                        <Link href={`/case/${encodeURIComponent(caseId)}/twin`} className="text-blue-200 hover:text-blue-100">Open Legal Twin</Link>
                        <Link href={`/case/${encodeURIComponent(caseId)}/guide`} className="text-blue-200 hover:text-blue-100">Open journey</Link>
                      </div>
                    </div>
                  )}
                  {confirmableFindings.length === 0 && (
                    <p className="mt-3 text-[10px] text-zinc-500">No direct extraction findings are available to map into CaseState.</p>
                  )}
                  {actionError && <p role="alert" className="mt-3 text-xs text-rose-200">{actionError}</p>}
                </div>
              )}
            </section>

            <section className="mt-7 grid gap-4 xl:grid-cols-3">
              {caseData && <EvidenceMapping evidence={selectedEvidence} caseData={caseData} document={selectedDocument} />}

              <section aria-labelledby="uncertainty-heading" className="rounded-2xl border border-amber-300/10 bg-[#111722] p-5">
                <div className="flex items-start gap-3">
                  <span className="rounded-lg border border-amber-300/15 bg-amber-300/[0.05] p-2 text-amber-200"><CircleHelp aria-hidden="true" className="h-4 w-4" /></span>
                  <div>
                    <h2 id="uncertainty-heading" className="text-sm font-semibold text-zinc-100">Uncertainty</h2>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">Missing text and ambiguous results stay marked as uncertain.</p>
                  </div>
                </div>
                {uncertaintyFindings.length > 0 ? (
                  <div className="mt-4 space-y-2">{uncertaintyFindings.map((finding) => <FindingCard key={finding.id} finding={finding} onPage={jumpToPage} />)}</div>
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
                  <div className="mt-4 space-y-2">{conflictFindings.map((finding) => <FindingCard key={finding.id} finding={finding} onPage={jumpToPage} />)}</div>
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
              <Link href={`/case/${encodeURIComponent(caseId)}`} className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200">Return to case <ChevronRight aria-hidden="true" className="h-3 w-3" /></Link>
            </footer>
          </>
        )}
      </div>
    </main>
  );
}
