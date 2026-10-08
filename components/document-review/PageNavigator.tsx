'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface PageNavigatorProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function PageNavigator({ currentPage, totalPages, onPageChange, className = '' }: PageNavigatorProps) {
  const hasPages = totalPages > 0;
  const page = hasPages ? Math.min(Math.max(1, currentPage), totalPages) : 0;

  return (
    <nav aria-label="Document pages" className={`flex items-center justify-between gap-3 ${className}`}>
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={!hasPages || page <= 1}
        aria-label="Previous page"
        className="inline-flex h-9 items-center gap-1 rounded-lg border border-white/[0.09] bg-white/[0.025] px-3 text-xs font-medium text-zinc-300 transition hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
      >
        <ChevronLeft aria-hidden="true" className="h-4 w-4" />
        Previous
      </button>
      <p aria-live="polite" className="text-xs tabular-nums text-zinc-400">
        {hasPages ? <>Page <span className="font-semibold text-zinc-100">{page}</span> of {totalPages}</> : 'No page count supplied'}
      </p>
      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={!hasPages || page >= totalPages}
        aria-label="Next page"
        className="inline-flex h-9 items-center gap-1 rounded-lg border border-white/[0.09] bg-white/[0.025] px-3 text-xs font-medium text-zinc-300 transition hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
      >
        Next
        <ChevronRight aria-hidden="true" className="h-4 w-4" />
      </button>
    </nav>
  );
}
