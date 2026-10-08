'use client';

import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileText,
  Info,
  Loader2,
  RotateCw,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import {
  uploadEvidence,
  type CaseFact,
  type CaseState,
  type EvidenceItem,
} from '@/lib/api';

type UploadStatus =
  | 'uploading'
  | 'checking'
  | 'processing'
  | 'uploaded'
  | 'extracted'
  | 'ocr_unavailable'
  | 'failed';

interface UploadAttempt {
  file: File;
  status: UploadStatus;
  progress: number;
  message?: string;
}

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ACCEPTED_FILE_TYPES = '.pdf,.jpg,.jpeg,.png';

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value.trim() || 'No value provided.';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return 'No value provided.';
  try {
    return JSON.stringify(value) ?? 'No value provided.';
  } catch {
    return 'Value could not be displayed.';
  }
}

function getResponseDocumentId(response: unknown): string | null {
  if (typeof response !== 'object' || response === null) return null;
  const record = response as Record<string, unknown>;
  for (const key of ['documentId', 'evidenceId', 'id']) {
    if (typeof record[key] === 'string') return record[key];
  }
  return null;
}

function findUploadedDocument(
  state: CaseState,
  previousEvidenceIds: Set<string>,
  responseId: string | null,
): EvidenceItem | null {
  const documents = state.evidence.filter((item) => item.source === 'document');
  if (responseId) {
    const matching = documents.find((item) => item.id === responseId || item.documentId === responseId);
    if (matching) return matching;
  }
  return documents.find((item) => !previousEvidenceIds.has(item.id)) ?? null;
}

function evidenceStatus(item: EvidenceItem): {
  label: string;
  tone: string;
} {
  if (item.processingStatus === 'processing') {
    return {
      label: 'Processing',
      tone: 'border-blue-400/20 bg-blue-400/10 text-blue-200',
    };
  }
  if (item.processingStatus === 'extracted') {
    if (item.status === 'conflicting') {
      return {
        label: 'Confirmed · conflict',
        tone: 'border-rose-500/20 bg-rose-500/10 text-rose-300',
      };
    }
    if (item.status === 'evidence_supported') {
      return {
        label: 'Confirmed findings linked',
        tone: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
      };
    }
    return {
      label: 'Review required',
      tone: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
    };
  }
  if (item.processingStatus === 'ocr_required') {
    return {
      label: 'OCR unavailable',
      tone: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
    };
  }
  if (item.processingStatus === 'failed') {
    return {
      label: 'Processing failed',
      tone: 'border-rose-500/20 bg-rose-500/10 text-rose-200',
    };
  }
  return {
    label: 'Status not reported',
    tone: 'border-zinc-700 bg-zinc-800/70 text-zinc-300',
  };
}

function FactResult({ fact }: { fact: CaseFact }) {
  return (
    <article className="rounded-xl border border-white/[0.07] bg-[#0d111b] p-4">
      <p className="text-sm leading-6 text-zinc-200">
        {fact.key !== 'statement' && (
          <span className="font-medium text-zinc-400">{humanize(fact.key)}: </span>
        )}
        {displayValue(fact.value)}
      </p>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
        <span className="rounded-md border border-white/[0.08] px-2 py-1 text-zinc-300">
          {fact.status === 'evidence_supported' ? 'User-confirmed extraction' : humanize(fact.status)}
        </span>
        <span className="rounded-md border border-white/[0.08] px-2 py-1 text-zinc-400">
          {humanize(fact.confidence)} confidence
        </span>
      </div>
      {fact.notes && <p className="mt-3 text-xs leading-5 text-zinc-500">{fact.notes}</p>}
    </article>
  );
}

export function EvidenceWorkspace({
  caseData,
  refreshCaseState,
}: {
  caseData: CaseState;
  refreshCaseState: () => Promise<CaseState>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadAttempt, setUploadAttempt] = useState<UploadAttempt | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const documents = useMemo(
    () => caseData.evidence.filter((item) => item.source === 'document'),
    [caseData.evidence],
  );
  const selectedDocument =
    documents.find((item) => item.id === selectedDocumentId) ?? documents[0] ?? null;
  const linkedFacts = selectedDocument
    ? caseData.facts.filter((fact) => fact.sourceIds.includes(selectedDocument.id))
    : [];

  function acceptFile(file: File | undefined) {
    if (!file) return;
    setValidationMessage(null);
    if (!/\.(pdf|jpg|jpeg|png)$/i.test(file.name)) {
      setValidationMessage('Choose a PDF, JPG, or PNG image.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setValidationMessage('Files must be 25 MiB or smaller.');
      return;
    }
    setSelectedFile(file);
  }

  function onFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    acceptFile(event.currentTarget.files?.[0]);
    event.currentTarget.value = '';
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    acceptFile(event.dataTransfer.files[0]);
  }

  async function handleUpload() {
    if (!selectedFile || uploadAttempt?.status === 'uploading' || uploadAttempt?.status === 'checking') {
      return;
    }

    const file = selectedFile;
    const existingEvidenceIds = new Set(caseData.evidence.map((item) => item.id));
    setSelectedFile(null);
    setValidationMessage(null);
    setUploadAttempt({ file, status: 'uploading', progress: 0 });

    let response: unknown;
    try {
      response = await uploadEvidence(caseData.id, file, (progress) => {
        setUploadAttempt((current) =>
          current?.file === file ? { ...current, progress } : current,
        );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The document could not be uploaded.';
      setUploadAttempt({ file, status: 'failed', progress: 0, message });
      return;
    }

    setUploadAttempt({ file, status: 'checking', progress: 100 });
    try {
      const responseId = getResponseDocumentId(response);
      let latestCase = caseData;
      let uploadedDocument: EvidenceItem | null = null;

      // Re-read the case briefly so the result always comes from backend data.
      for (let attempt = 0; attempt < 4; attempt += 1) {
        latestCase = await refreshCaseState();
        uploadedDocument = findUploadedDocument(latestCase, existingEvidenceIds, responseId);
        if (uploadedDocument?.processingStatus && uploadedDocument.processingStatus !== 'processing') break;
        if (attempt < 3) await new Promise((resolve) => window.setTimeout(resolve, 900));
      }

      if (uploadedDocument) {
        setSelectedDocumentId(uploadedDocument.id);
        if (uploadedDocument.processingStatus === 'processing') {
          setUploadAttempt({
            file,
            status: 'processing',
            progress: 100,
            message: 'The backend reports that document processing is still in progress.',
          });
        } else if (uploadedDocument.processingStatus === 'extracted') {
          setUploadAttempt({ file, status: 'extracted', progress: 100 });
        } else if (uploadedDocument.processingStatus === 'ocr_required') {
          setUploadAttempt({
            file,
            status: 'ocr_unavailable',
            progress: 100,
            message: 'The backend reports that OCR is required but unavailable. No extracted text is shown.',
          });
        } else if (uploadedDocument.processingStatus === 'failed') {
          setUploadAttempt({
            file,
            status: 'failed',
            progress: 100,
            message: 'The backend reports that document processing failed.',
          });
        } else {
          setUploadAttempt({
            file,
            status: 'uploaded',
            progress: 100,
            message: 'The document is stored, but the backend has not reported its processing status.',
          });
        }
      } else {
        setUploadAttempt({
          file,
          status: 'uploaded',
          progress: 100,
          message: 'The upload was accepted, but no document result is available in the case response yet.',
        });
      }
    } catch (error) {
      setUploadAttempt({
        file,
        status: 'uploaded',
        progress: 100,
        message: error instanceof Error
          ? `Upload accepted, but the case result could not be refreshed: ${error.message}`
          : 'Upload accepted, but the case result could not be refreshed.',
      });
    }
  }

  async function refreshCase() {
    setIsRefreshing(true);
    try {
      const nextCase = await refreshCaseState();
      setRefreshError(null);
      if (selectedDocumentId && !nextCase.evidence.some((item) => item.id === selectedDocumentId)) {
        setSelectedDocumentId(null);
      } else if (selectedDocumentId && uploadAttempt?.status === 'processing') {
        const updatedDocument = nextCase.evidence.find((item) => item.id === selectedDocumentId);
        if (updatedDocument && updatedDocument.processingStatus !== 'processing') {
          const status: UploadStatus =
            updatedDocument.processingStatus === 'extracted'
              ? 'extracted'
              : updatedDocument.processingStatus === 'ocr_required'
                ? 'ocr_unavailable'
                : updatedDocument.processingStatus === 'failed'
                  ? 'failed'
                  : 'uploaded';
          setUploadAttempt({
            ...uploadAttempt,
            status,
            message: status === 'extracted'
              ? 'The backend returned extracted evidence.'
              : status === 'ocr_unavailable'
                ? 'The backend reports that OCR is required but unavailable. No extracted text is shown.'
                : status === 'failed'
                  ? 'The backend reports that document processing failed.'
                  : 'The backend has not reported a processing status.',
          });
        }
      }
    } catch {
      setRefreshError('Could not refresh case evidence. Check the backend connection and try again.');
    } finally {
      setIsRefreshing(false);
    }
  }

  const isUploading = uploadAttempt?.status === 'uploading';
  const isChecking = uploadAttempt?.status === 'checking';
  const isProcessing = uploadAttempt?.status === 'processing';

  return (
    <section
      id="evidence-workspace"
      className="overflow-hidden rounded-[28px] border border-[#273044] bg-[#111722] shadow-[0_24px_80px_rgba(0,0,0,0.22)]"
    >
      <div className="border-b border-white/[0.07] px-6 py-6 sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-blue-400/20 bg-blue-500/10 text-blue-300">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-blue-300/80">
                Case workspace / evidence
              </p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-white sm:text-2xl">
                Evidence workspace
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                Add source documents and review only evidence and processing results returned by the case service.
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] px-3.5 py-2 text-sm text-zinc-300">
            <span className="font-semibold text-white">{documents.length}</span> documents
          </div>
        </div>
      </div>

      <div className="border-b border-white/[0.06] px-6 py-3 sm:px-8">
        <p className="text-xs leading-5 text-zinc-400">
          Case text and uploads are stored on the server running LawSense. This demo has no sign-in or per-case access controls; use synthetic data only.
        </p>
      </div>

      <div className="grid lg:grid-cols-[0.92fr_1.08fr]">
        <div className="border-b border-white/[0.07] p-5 sm:p-7 lg:border-b-0 lg:border-r">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">Add a document</h3>
              <p className="mt-1 text-xs text-zinc-500">PDF, JPG, or PNG · up to 25 MiB</p>
            </div>
            <span className="rounded-full border border-white/[0.08] px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              Stored on this server
            </span>
          </div>

          <div
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false);
            }}
            onDrop={onDrop}
            className={`rounded-2xl border border-dashed px-5 py-7 text-center transition-colors ${
              isDragging
                ? 'border-blue-400 bg-blue-500/10'
                : 'border-[#344057] bg-[#0d121c] hover:border-[#53617a]'
            }`}
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1a2434] text-blue-300">
              <Upload className="h-5 w-5" />
            </div>
            <p className="mt-4 text-sm font-medium text-zinc-200">Drag and drop a document here</p>
            <p className="mt-1 text-xs text-zinc-500">or select it from your device</p>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              onChange={onFileInputChange}
              className="sr-only"
              aria-label="Choose a document to upload"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-5 rounded-lg border border-white/[0.12] bg-white/[0.04] px-4 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              Choose file
            </button>
          </div>

          {validationMessage && (
            <p role="alert" className="mt-3 flex items-center gap-2 text-xs text-rose-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {validationMessage}
            </p>
          )}

          {selectedFile && (
            <div className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3.5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#1c2637] text-zinc-300">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-200">{selectedFile.name}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {formatBytes(selectedFile.size)} · {selectedFile.type || 'File type not supplied'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedFile(null)}
                  className="rounded-md p-1.5 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
                  aria-label="Remove selected document"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <button
                type="button"
                onClick={handleUpload}
                disabled={isUploading || isChecking}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Upload document
              </button>
            </div>
          )}

          {uploadAttempt && (
            <div
              role="status"
              className={`mt-4 rounded-xl border p-3.5 ${
                uploadAttempt.status === 'failed' || uploadAttempt.status === 'ocr_unavailable'
                  ? 'border-amber-500/20 bg-amber-500/[0.06]'
                  : uploadAttempt.status === 'extracted'
                    ? 'border-emerald-500/20 bg-emerald-500/[0.05]'
                    : 'border-white/[0.08] bg-white/[0.025]'
              }`}
            >
              <div className="flex items-center gap-3">
                {isUploading || isChecking || isProcessing ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-300" />
                ) : uploadAttempt.status === 'extracted' ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" />
                ) : uploadAttempt.status === 'failed' || uploadAttempt.status === 'ocr_unavailable' ? (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
                ) : (
                  <Clock3 className="h-4 w-4 shrink-0 text-zinc-400" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-zinc-200">{uploadAttempt.file.name}</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-400">
                    {isUploading
                      ? uploadAttempt.progress >= 100
                        ? 'File sent · waiting for the server response'
                        : `Uploading · ${uploadAttempt.progress}%`
                      : isChecking
                        ? 'Upload accepted · checking case processing status'
                        : isProcessing
                          ? uploadAttempt.message
                        : uploadAttempt.message ||
                          (uploadAttempt.status === 'extracted'
                            ? 'The backend returned extracted evidence.'
                            : 'Upload finished.')}
                  </p>
                </div>
              </div>
              {isUploading && (
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.08]">
                  <div
                    className="h-full rounded-full bg-blue-400 transition-[width] duration-200"
                    style={{ width: `${uploadAttempt.progress}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-5 sm:p-7">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">Document result</h3>
              <p className="mt-1 text-xs text-zinc-500">Backend status, extracted facts, and source links</p>
            </div>
            <button
              type="button"
              onClick={() => void refreshCase()}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-2.5 py-1.5 text-xs text-zinc-400 transition hover:bg-white/[0.04] hover:text-zinc-200 disabled:opacity-50"
            >
              <RotateCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
          {refreshError && <p role="alert" className="mb-3 text-xs text-rose-300">{refreshError}</p>}

          {documents.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-[minmax(160px,0.7fr)_minmax(0,1.3fr)]">
              <div className="space-y-2">
                {documents.map((document) => {
                  const status = evidenceStatus(document);
                  const isSelected = selectedDocument?.id === document.id;
                  return (
                    <button
                      key={document.id}
                      type="button"
                      onClick={() => setSelectedDocumentId(document.id)}
                      className={`w-full rounded-xl border p-3 text-left transition ${
                        isSelected
                          ? 'border-blue-400/30 bg-blue-500/[0.07]'
                          : 'border-white/[0.07] bg-[#0d111b] hover:border-white/[0.15]'
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-zinc-200">{document.title}</p>
                          <p className="mt-1 text-[10px] text-zinc-500">{humanize(document.type)}</p>
                          <span className={`mt-2 inline-flex max-w-full rounded-md border px-1.5 py-0.5 text-[9px] leading-4 ${status.tone}`}>
                            {status.label}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {selectedDocument && (
                <div className="min-w-0 space-y-4">
                  <div className="rounded-xl border border-white/[0.07] bg-[#0d111b] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-semibold text-zinc-100">{selectedDocument.title}</p>
                        <p className="mt-1 text-xs text-zinc-500">{humanize(selectedDocument.type)} · Uploaded document</p>
                      </div>
                      <span className={`rounded-md border px-2 py-1 text-[10px] ${evidenceStatus(selectedDocument).tone}`}>
                        {evidenceStatus(selectedDocument).label}
                      </span>
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-white/[0.06] pt-3 text-xs">
                      <div>
                        <dt className="text-zinc-500">Evidence status</dt>
                        <dd className="mt-1 text-zinc-300">{humanize(selectedDocument.status)}</dd>
                      </div>
                      <div>
                        <dt className="text-zinc-500">Document reference</dt>
                        <dd className="mt-1 break-all text-zinc-300">{selectedDocument.documentId || 'Not returned'}</dd>
                      </div>
                    </dl>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">
                        Extracted evidence
                      </h4>
                      <span className="text-[10px] text-zinc-600">{linkedFacts.length} linked facts</span>
                    </div>
                    {selectedDocument.processingStatus === 'ocr_required' ? (
                      <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4">
                        <p className="flex items-center gap-2 text-sm font-medium text-amber-200">
                          <AlertTriangle className="h-4 w-4" /> OCR is unavailable
                        </p>
                        <p className="mt-2 text-xs leading-5 text-amber-100/70">
                          The backend says OCR is required for this document. Extracted text and facts are not available.
                        </p>
                      </div>
                    ) : selectedDocument.processingStatus === 'failed' ? (
                      <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.05] p-4 text-xs leading-5 text-rose-200">
                        The backend reports that processing failed. No extracted evidence is displayed.
                      </div>
                    ) : linkedFacts.length > 0 ? (
                      <div className="space-y-2">
                        {linkedFacts.map((fact) => (
                          <FactResult key={fact.id} fact={fact} />
                        ))}
                      </div>
                    ) : selectedDocument.extractedFacts.length > 0 &&
                      selectedDocument.processingStatus === 'extracted' ? (
                      <div className="rounded-xl border border-white/[0.07] bg-[#0d111b] p-4">
                        <p className="mb-2 text-xs text-zinc-500">Backend returned extracted text without linked case facts.</p>
                        <ul className="space-y-2 text-sm leading-6 text-zinc-300">
                          {selectedDocument.extractedFacts.map((fact, index) => (
                            <li key={`${selectedDocument.id}-${index}`} className="border-l border-blue-400/40 pl-3">{fact}</li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-white/[0.09] p-4 text-xs leading-5 text-zinc-500">
                        {selectedDocument.processingStatus === 'extracted' && selectedDocument.status === 'unknown'
                          ? 'Extraction is ready. Review findings and confirm them before they are added to this case.'
                          : selectedDocument.processingStatus === 'extracted'
                            ? 'No confirmed fact links are recorded for this document.'
                          : 'No extracted facts or processing result have been returned for this document.'}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                    <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">
                      <Info className="h-3.5 w-3.5" /> Provenance
                    </h4>
                    {linkedFacts.length > 0 ? (
                      <ul className="mt-3 space-y-2">
                        {linkedFacts.map((fact) => (
                          <li key={fact.id} className="flex items-start gap-2 text-xs leading-5">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-300" />
                            <span className="text-zinc-300">
                              {humanize(fact.key)} · source linked to this document
                              {fact.provenance
                                .filter((source) => source.documentId === selectedDocument.documentId)
                                .map((source) => (
                                  <span key={`${fact.id}-${source.documentId}-${source.pageNumber}`} className="block text-zinc-500">
                                    Page {source.pageNumber} · {humanize(source.extractionMethod)} · {Math.round(source.confidence * 100)}% confidence · {humanize(source.status)}
                                  </span>
                                ))}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs leading-5 text-zinc-500">
                        No fact-to-document source link is recorded. The current API does not return page-level citations.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] px-6 py-8 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.04] text-zinc-500">
                <FileText className="h-5 w-5" />
              </div>
              <p className="mt-3 text-sm font-medium text-zinc-300">No documents in this case</p>
                      <p className="mt-1 max-w-xs text-xs leading-5 text-zinc-500">
                        PDFs, JPGs, and PNGs up to 25 MiB are processed locally and linked to this case.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
