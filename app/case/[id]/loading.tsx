import { ArrowRight, Loader2 } from 'lucide-react';

export default function CaseLoading() {
  return (
    <main className="flex min-h-[70vh] items-center justify-center bg-[#f3f5f8] px-5 py-16">
      <section role="status" aria-live="polite" className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-7 shadow-[0_22px_70px_rgba(19,28,40,0.09)] sm:p-9">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 text-amber-700">
          <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
        </span>
        <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">LawSense · case continuity</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">Reopening your case</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">Loading the latest case record and its saved evidence before opening this workspace.</p>
        <div className="mt-6 space-y-2" aria-hidden="true">
          <div className="h-2 w-full animate-pulse rounded-full bg-slate-100" />
          <div className="h-2 w-4/5 animate-pulse rounded-full bg-slate-100" />
          <div className="h-2 w-2/3 animate-pulse rounded-full bg-slate-100" />
        </div>
        <p className="mt-6 flex items-center gap-1.5 border-t border-slate-100 pt-4 text-[11px] text-slate-400"><ArrowRight aria-hidden="true" className="h-3 w-3" /> You can move between case pages without starting over.</p>
      </section>
    </main>
  );
}
