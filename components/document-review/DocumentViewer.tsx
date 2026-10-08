'use client';

import { useState } from 'react';
import { FileText } from 'lucide-react';
import { PageNavigator } from './PageNavigator';
import { StatusBadge } from './StatusBadge';
import type { DocumentDescriptor, DocumentPageContent, DocumentReviewStatus } from './types';

export interface DocumentViewerProps {
  document: DocumentDescriptor;
  pages: readonly DocumentPageContent[];
  /** Supplied page count from the document service; does not infer a count from missing page data. */
  pageCount: number;
  initialPage?: number;
  onPageChange?: (page: number) => void;
  status?: DocumentReviewStatus;
  selectedSource?: {
    pageNumber?: number | null;
    start?: number | null;
    end?: number | null;
    excerpt?: string | null;
  } | null;
}

export function DocumentViewer({ document, pages, pageCount, initialPage = 1, onPageChange, status, selectedSource }: DocumentViewerProps) {
  const safePageCount = Math.max(0, Math.floor(pageCount));
  const documentKey = document.id ?? document.fileName;
  const [pageState, setPageState] = useState(() => ({
    documentKey,
    initialPage,
    page: Math.max(1, initialPage),
  }));
  const requestedPage = pageState.documentKey === documentKey && pageState.initialPage === initialPage
    ? pageState.page
    : Math.max(1, initialPage);
  const currentPage = safePageCount > 0
    ? Math.min(Math.max(1, requestedPage), safePageCount)
    : Math.max(1, requestedPage);
  const pageContent = pages.find((page) => page.pageNumber === currentPage);
  const previewUrl = pageContent?.previewUrl || document.previewUrl || null;

  function changePage(nextPage: number) {
    if (nextPage < 1 || nextPage > safePageCount) return;
    setPageState({ documentKey, initialPage, page: nextPage });
    onPageChange?.(nextPage);
  }

  return (
    <section aria-label="Document viewer" className="overflow-hidden rounded-2xl border border-[#273044] bg-[#111722]">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/[0.07] px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-400/15 bg-blue-500/[0.08] text-blue-300">
            <FileText aria-hidden="true" className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="break-words text-sm font-semibold text-zinc-100">{document.fileName}</h2>
            <p className="mt-1 break-all text-[11px] text-zinc-500">
              {[document.mimeType, document.id ? `Document ID ${document.id}` : null].filter(Boolean).join(' · ') || 'Document details not supplied'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {status && <StatusBadge status={status} />}
          <div className="rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-right">
            <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-zinc-500">Document number</p>
            <p className="mt-1 max-w-48 break-all text-xs text-zinc-200">{document.documentNumber || 'Not supplied'}</p>
          </div>
        </div>
      </header>

      <div className="grid min-w-0 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <div className="min-w-0 border-b border-white/[0.07] xl:border-b-0 xl:border-r">
          <div className="flex min-h-[280px] items-center justify-center bg-[#090d14] p-3 sm:min-h-[420px] sm:p-5">
            {previewUrl && document.previewType === 'pdf' ? (
              <iframe
                key={`${previewUrl}-${currentPage}`}
                title={`${document.fileName}${currentPage > 0 ? `, page ${currentPage}` : ''}`}
                src={currentPage > 0 ? `${previewUrl}${previewUrl.includes('#') ? '&' : '#'}page=${currentPage}` : previewUrl}
                className="h-[min(72vh,760px)] min-h-[280px] w-full rounded-lg border border-white/[0.08] bg-white"
              />
            ) : previewUrl && document.previewType === 'image' ? (
              // The image URL is provided by the caller; this component does not derive image content.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt={`${document.fileName}${currentPage > 0 ? `, page ${currentPage}` : ''}`} className="max-h-[min(72vh,760px)] max-w-full rounded-lg object-contain" />
            ) : (
              <div className="max-w-sm px-5 text-center">
                <FileText aria-hidden="true" className="mx-auto h-8 w-8 text-zinc-600" />
                <p className="mt-3 text-sm font-medium text-zinc-300">Preview not supplied</p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  {document.previewType === 'unsupported'
                    ? 'This document type does not have a preview from the document service.'
                    : 'A document preview will appear here when one is available.'}
                </p>
              </div>
            )}
          </div>
          <PageNavigator currentPage={currentPage} totalPages={safePageCount} onPageChange={changePage} className="px-4 py-3 sm:px-5" />
        </div>

        <section aria-labelledby="document-extracted-text" className="min-w-0 p-4 sm:p-5">
          {selectedSource && (
            <section
              aria-label="Selected finding source location"
              aria-live="polite"
              className="mb-5 rounded-xl border border-amber-300/25 bg-amber-300/[0.055] p-4 transition-[border-color,background-color] duration-300 motion-reduce:transition-none"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-[0.13em] text-amber-100">Selected source location</h3>
                <span className="rounded-md border border-amber-200/15 px-2 py-1 text-[10px] text-amber-100/75">
                  {selectedSource.pageNumber != null ? `Page ${selectedSource.pageNumber}` : 'Page not supplied'}
                </span>
              </div>
              {selectedSource.start != null && selectedSource.end != null && (
                <p className="mt-2 text-[10px] text-amber-100/65">Characters {selectedSource.start}–{selectedSource.end} in the returned page text</p>
              )}
              {selectedSource.excerpt ? (
                <blockquote className="mt-3 border-l-2 border-amber-200/70 pl-3 text-sm leading-6 text-zinc-100">
                  <mark className="rounded bg-amber-200/20 px-0.5 text-inherit">{selectedSource.excerpt}</mark>
                </blockquote>
              ) : selectedSource.pageNumber != null || selectedSource.start != null || selectedSource.end != null ? (
                <p className="mt-3 text-xs leading-5 text-amber-50/75">
                  The review service returned a page or character location, but no source excerpt. The selected finding and its review details remain available in the findings list.
                </p>
              ) : (
                <p className="mt-3 text-xs leading-5 text-amber-50/75">
                  Review snapshot: the service did not return a source page, excerpt, or character location. The selected finding and its review details remain available in the findings list.
                </p>
              )}
            </section>
          )}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 id="document-extracted-text" className="text-xs font-semibold uppercase tracking-[0.13em] text-zinc-300">Extracted text</h3>
            <p className="mt-1 text-[11px] text-zinc-500">Page {currentPage}</p>
            </div>
            <span className="rounded-md border border-white/[0.08] px-2 py-1 text-[10px] text-zinc-500">
              {pageContent?.extractedText ? 'Service text provided' : 'No text provided'}
            </span>
          </div>
          {pageContent?.extractedText ? (
            <pre className="mt-4 max-h-[min(65vh,680px)] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-white/[0.06] bg-[#0c111a] p-4 font-sans text-sm leading-7 text-zinc-300">
              {pageContent.extractedText}
            </pre>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-white/[0.09] px-4 py-6 text-sm leading-6 text-zinc-500">
              No extracted text was supplied for this page.
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
