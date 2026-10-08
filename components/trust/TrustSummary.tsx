import { ShieldCheck } from 'lucide-react';
import { SourceBadge } from './SourceBadge';
import type { TrustSignal } from './types';

export interface TrustSummaryProps {
  signals: readonly TrustSignal[];
  summary?: string | null;
  title?: string;
}

export function TrustSummary({ signals, summary, title = 'Trust & sources' }: TrustSummaryProps) {
  const statusCounts = signals.reduce<Partial<Record<TrustSignal['status'], number>>>((counts, signal) => {
    counts[signal.status] = (counts[signal.status] ?? 0) + 1;
    return counts;
  }, {});
  const statuses = Object.entries(statusCounts) as Array<[TrustSignal['status'], number]>;

  return (
    <section aria-label={title} className="rounded-2xl border border-cyan-200/20 bg-gradient-to-r from-cyan-200/[0.07] via-[#101722] to-[#10131b] p-4 shadow-[0_12px_35px_-28px_rgba(103,232,249,0.55)] sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-cyan-100/15 bg-cyan-100/[0.07] text-cyan-100">
            <ShieldCheck aria-hidden="true" className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
            <p className="mt-1 text-xs leading-5 text-zinc-400">
              {summary?.trim() || 'Review what is sourced, inferred, and still unknown.'}
            </p>
          </div>
        </div>
        <span className="rounded-full border border-white/[0.08] bg-black/10 px-2.5 py-1 text-[10px] text-zinc-400">
          {signals.length} {signals.length === 1 ? 'signal' : 'signals'}
        </span>
      </div>

      {statuses.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Signal counts by source status">
          {statuses.map(([status, count]) => (
            <span key={status} className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-black/10 py-1 pl-1 pr-2.5">
              <SourceBadge status={status} className="border-0 bg-transparent px-1.5 py-0.5" />
              <span className="text-[10px] font-medium tabular-nums text-zinc-400">{count}</span>
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SourceBadge status="UNKNOWN" />
          <p className="text-xs text-zinc-500">No trust signals were supplied.</p>
        </div>
      )}

      {signals.length > 0 && (
        <ul className="mt-4 grid gap-2 border-t border-white/[0.07] pt-3 sm:grid-cols-2">
          {signals.map((signal, index) => (
            <li key={signal.id ?? `${signal.label}-${index}`} className="min-w-0 rounded-lg border border-white/[0.05] bg-black/[0.08] px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-zinc-200">{signal.label}</p>
                <SourceBadge status={signal.status} />
              </div>
              {signal.detail && <p className="mt-1.5 text-xs leading-5 text-zinc-400">{signal.detail}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
