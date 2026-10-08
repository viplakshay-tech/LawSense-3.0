'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpen, Loader2, ShieldCheck } from 'lucide-react';
import { getCase, type CaseState } from '@/lib/api';
import {
  EvidencePreservationPanel,
  ImmediateDangerPrompt,
  SafetyPathway,
  SensitiveContextBanner,
  SupportPathway,
} from '@/components/women-safety';

function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function SafetyClient({ id }: { id: string }) {
  const [caseData, setCaseData] = useState<CaseState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function fetchCase() {
      try {
        setIsLoading(true);
        const data = await getCase(id);
        if (isMounted) {
          setCaseData(data);
          setError(null);
        }
      } catch (loadError) {
        if (isMounted) {
          console.error('Failed to load case safety context:', loadError);
          setError('The case could not be loaded. It may not exist or the case service may be unavailable.');
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void fetchCase();
    return () => {
      isMounted = false;
    };
  }, [id]);

  const casePath = `/case/${encodeURIComponent(id)}`;

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#070A0F] text-slate-100">
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
          Loading case safety information...
        </div>
      </div>
    );
  }

  if (!caseData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#070A0F] px-4 text-slate-100">
        <div className="w-full max-w-lg rounded-2xl border border-white/[0.08] bg-[#101722] p-6">
          <h1 className="text-lg font-semibold">Safety information unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {error ?? 'The case could not be loaded.'}
          </p>
          <Link
            href="/"
            className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 text-sm font-medium text-slate-300 transition hover:bg-white/[0.07]"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Return
          </Link>
        </div>
      </div>
    );
  }

  const safety = caseData.analysis?.safetyContext;
  const hasSafetyContext = Boolean(safety && safety.context !== 'none');

  return (
    <div className="min-h-screen bg-[#070A0F] text-slate-100">
      <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-[#070A0F]/90 backdrop-blur-xl">
        <div className="mx-auto flex min-h-16 max-w-3xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-teal-100/15 bg-teal-100/[0.06] text-teal-100/80">
              <ShieldCheck aria-hidden="true" className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Safety</p>
              <p className="truncate text-sm font-medium text-slate-200">
                {caseData.title?.trim() || 'Untitled case'}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href={`${casePath}/guide`}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 text-xs font-semibold text-slate-300 transition hover:bg-white/[0.07]"
            >
              <BookOpen aria-hidden="true" className="h-4 w-4" />
              <span className="hidden sm:inline">Legal Guide</span>
            </Link>
            <Link
              href={casePath}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 text-xs font-semibold text-slate-300 transition hover:bg-white/[0.07]"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              Case
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-8 sm:px-6">
        <div className="rounded-xl border border-white/[0.07] bg-[#101722] px-4 py-3 text-xs leading-5 text-slate-400">
          Safety resources are optional. This page does not contact anyone or send the choices you make here to the case service.
        </div>

        {hasSafetyContext && safety ? (
          <div>
            <SensitiveContextBanner
              urgent={safety.context === 'urgent_safety_context'}
              message={
                safety.recommendedSafetyPrompt?.trim() ||
                `The case service returned a ${humanize(safety.context).toLowerCase()} safety context.`
              }
            />
            {safety.indicators.length > 0 && (
              <div className="mt-4 rounded-xl border border-white/[0.07] bg-[#10131b] p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Indicators returned by case analysis
                </p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {safety.indicators.map((indicator, index) => (
                    <li
                      key={`${indicator.category}-${index}`}
                      className="rounded-lg border border-white/[0.08] bg-white/[0.025] px-3 py-1.5 text-xs text-slate-300"
                    >
                      {humanize(indicator.category)} · System inferred
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-white/[0.08] bg-[#10131b] p-5">
            <p className="text-sm font-medium text-slate-200">No safety context is recorded for this case.</p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              {safety
                ? 'The case analysis returned no safety context.'
                : 'The case analysis did not return safety information.'}
            </p>
          </div>
        )}

        <ImmediateDangerPrompt />
        <SupportPathway />
        <SafetyPathway />
        <EvidencePreservationPanel />
      </main>
    </div>
  );
}
